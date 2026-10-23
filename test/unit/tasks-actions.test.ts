import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";
import {
  permissionButtons,
  respondToPermission,
  STOP_RPC_TIMEOUT_MS,
  STOP_VERIFY_MS,
  READ_VERIFY_MS,
  useReadControl,
  stopDialogText,
  useStopControl,
  useUnarchiveControl,
  type ReadControl,
  type StopControl,
  type UnarchiveControl,
} from "../../client/tasks/actions";
import type { TaskCard, TaskPermission, TaskPermissionAction } from "../../client/tasks/model";
import { createFakePaseo, makeAgent } from "./helpers/fake-paseo";

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  stop: vi.fn(),
  stopped: vi.fn(),
  unarchive: vi.fn(),
  read: vi.fn(),
  toastError: vi.fn(),
  language: vi.fn((): "en" | "zh" => "en"),
  platform: { OS: "web" as string },
  alert: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: mocks.platform, Alert: { alert: mocks.alert } }));

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc(contract: { name: string }) {
    if (contract.name === "tasks.unarchive") return mocks.unarchive;
    if (contract.name === "tasks.read") return mocks.read;
    return contract.name === "tasks.capabilities" ? mocks.capabilities : contract.name === "tasks.stopped" ? mocks.stopped : mocks.stop;
  },
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  useToast: () => ({ error: mocks.toastError, show: vi.fn() }),
}));
vi.mock("../../client/tasks/i18n", () => ({ useTasksLanguage: mocks.language }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function permission(kind: TaskPermission["kind"], actions: TaskPermissionAction[] = []): TaskPermission {
  return { requestId: "permission-1", kind, title: "Permission", summary: null, actions, remaining: 0 };
}

function action(overrides: Partial<TaskPermissionAction> = {}): TaskPermissionAction {
  return {
    id: "allow-once",
    label: "Allow once",
    behavior: "allow",
    variant: "primary",
    ...overrides,
  };
}

describe("Tasks permission actions", () => {
  it.each(["tool", "plan", "mode"] as const)("uses request actions for %s permissions", (kind) => {
    const requested = [
      action(),
      action({ id: "reject", label: "No thanks", behavior: "deny", variant: "danger" }),
    ];
    expect(permissionButtons(permission(kind, requested), "en")).toEqual([
      { key: "allow-once", label: "Allow once", variant: "primary", kind: "respond", action: requested[0] },
      { key: "reject", label: "No thanks", variant: "danger", kind: "respond", action: requested[1] },
    ]);
  });

  it.each(["tool", "plan", "mode"] as const)("uses bilingual Allow and Deny fallbacks for %s permissions", (kind) => {
    expect(permissionButtons(permission(kind), "en")).toEqual([
      { key: "allow", label: "Allow", variant: "primary", kind: "respond", action: { behavior: "allow", id: null } },
      { key: "deny", label: "Deny", variant: "secondary", kind: "respond", action: { behavior: "deny", id: null } },
    ]);
    expect(permissionButtons(permission(kind), "zh").map(({ label }) => label)).toEqual(["允许", "拒绝"]);
  });

  it.each(["question", "other"] as const)("opens the agent tab for %s permissions, even when actions are present", (kind) => {
    const buttons = permissionButtons(permission(kind, [action()]), "zh");
    expect(buttons).toEqual([{
      key: "open",
      label: "去回答",
      variant: "primary",
      kind: "open",
      action: { behavior: "deny", id: null },
    }]);
    expect(permissionButtons(permission(kind), "en")[0]?.label).toBe("Answer");
  });

  it("uses a behavior-based variant only when a request action omits one", () => {
    expect(
      permissionButtons(permission("tool", [
        action({ variant: null }),
        action({ id: "reject", behavior: "deny", variant: null }),
      ])).map(({ variant }) => variant),
    ).toEqual(["primary", "secondary"]);
  });

  it("sends the selected action payload through the Paseo fake", async () => {
    const fake = createFakePaseo({ agents: [makeAgent({ id: "agent-a" })] });
    const buttons = permissionButtons(permission("tool", [
      action(),
      action({ id: "reject", label: "Deny", behavior: "deny", variant: "danger" }),
    ]));

    await respondToPermission(fake.paseo, "agent-a", buttons[0]!, "request-a");
    await respondToPermission(fake.paseo, "agent-a", buttons[1]!, "request-b");

    expect(fake.permissionResponses).toEqual([
      { agentId: "agent-a", requestId: "request-a", response: { behavior: "allow", selectedActionId: "allow-once" } },
      { agentId: "agent-a", requestId: "request-b", response: { behavior: "deny", selectedActionId: "reject", message: "Denied by user" } },
    ]);
  });

  it("omits selectedActionId for local fallback buttons and does not answer open actions", async () => {
    const fake = createFakePaseo({ agents: [makeAgent({ id: "agent-a" })] });
    const fallback = permissionButtons(permission("tool"));
    await respondToPermission(fake.paseo, "agent-a", fallback[0]!, "request-a");
    await respondToPermission(fake.paseo, "agent-a", fallback[1]!, "request-b");
    await expect(respondToPermission(fake.paseo, "agent-a", permissionButtons(permission("question"))[0]!, "request-c"))
      .rejects.toThrow("This permission request must be answered in the agent tab.");

    expect(fake.permissionResponses).toEqual([
      { agentId: "agent-a", requestId: "request-a", response: { behavior: "allow" } },
      { agentId: "agent-a", requestId: "request-b", response: { behavior: "deny", message: "Denied by user" } },
    ]);
  });
});

let latestControl: StopControl | undefined;

const activeAgents = new Set<string>();

function StopProbe({ confirmStop, verify = false }: { confirmStop: boolean; verify?: boolean }) {
  latestControl = useStopControl({ confirmStop, isActive: verify ? (agentId) => activeAgents.has(agentId) : undefined });
  return React.createElement("probe");
}

function taskCard(id: string, children: TaskCard["children"] = []): TaskCard {
  return { id, title: `Task ${id}`, stoppable: true, children } as unknown as TaskCard;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe("Tasks stop control", () => {
  let renderers: ReactTestRenderer[];

  beforeEach(() => {
    renderers = [];
    latestControl = undefined;
    mocks.capabilities.mockReset().mockResolvedValue({ stop: true });
    mocks.stop.mockReset().mockResolvedValue({ results: [] });
    mocks.stopped.mockReset().mockResolvedValue({ stops: [] });
    mocks.toastError.mockReset();
    mocks.language.mockReturnValue("en");
    mocks.platform.OS = "web";
    mocks.alert.mockReset();
    activeAgents.clear();
  });

  afterEach(() => {
    for (const renderer of renderers) act(() => renderer.unmount());
    vi.useRealTimers();
  });

  async function mount(confirmStop: boolean, verify = false) {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(StopProbe, { confirmStop, verify }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    renderers.push(renderer);
    return {
      control: () => {
        if (!latestControl) throw new Error("Stop control did not render");
        return latestControl;
      },
      renderer,
    };
  }

  it("keeps availability false until the one capability request returns true", async () => {
    const response = deferred<{ stop: boolean }>();
    mocks.capabilities.mockReturnValue(response.promise);
    const mounted = await mount(true);
    expect(mounted.control().available).toBe(false);
    expect(mocks.capabilities).toHaveBeenCalledTimes(1);

    await act(async () => {
      mounted.renderer.update(React.createElement(StopProbe, {
        confirmStop: true,
      }));
      response.resolve({ stop: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mounted.control().available).toBe(true);
    expect(mocks.capabilities).toHaveBeenCalledTimes(1);
  });

  it("confirms within three seconds, tracks successful stops, and clears the marker on a new run", async () => {
    mocks.stop.mockResolvedValue({ results: [{ agentId: "agent-a", ok: true, error: null }] });
    const mounted = await mount(true);
    const card = taskCard("agent-a");

    act(() => mounted.control().press(card));
    expect(mounted.control().phase("agent-a")).toBe("confirming");
    expect(mocks.stop).not.toHaveBeenCalled();

    await act(async () => {
      mounted.control().press(card);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.stop).toHaveBeenCalledWith({ agentIds: ["agent-a"] });
    expect(mounted.control().phase("agent-a")).toBe("idle");
    expect(mounted.control().stoppedManually.has("agent-a")).toBe(true);

    act(() => mounted.control().noteRunning("agent-a"));
    expect(mounted.control().stoppedManually.has("agent-a")).toBe(false);
  });

  it("asks a context menu's Stop in the browser's confirm on web, and stops only on yes", async () => {
    mocks.stop.mockResolvedValue({ results: [{ agentId: "agent-a", ok: true, error: null }] });
    const world = globalThis as { confirm?: unknown };
    const confirm = vi.fn(() => false);
    world.confirm = confirm;
    try {
      const mounted = await mount(true);
      await act(async () => {
        mounted.control().press(taskCard("agent-a"), { dialog: true });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(confirm).toHaveBeenCalledWith("Stop this task?\n\nTask agent-a");
      expect(mocks.stop).not.toHaveBeenCalled();
      // The dialog replaces the armed button: the card never shows "Confirm stop".
      expect(mounted.control().phase("agent-a")).toBe("idle");

      confirm.mockReturnValue(true);
      await act(async () => {
        mounted.control().press(taskCard("agent-a"), { dialog: true });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mocks.stop).toHaveBeenCalledWith({ agentIds: ["agent-a"] });
    } finally {
      delete world.confirm;
    }
  });

  it("stops a context menu's Stop at once when confirm before stopping is off", async () => {
    mocks.stop.mockResolvedValue({ results: [{ agentId: "agent-a", ok: true, error: null }] });
    const world = globalThis as { confirm?: unknown };
    const confirm = vi.fn(() => false);
    world.confirm = confirm;
    try {
      const mounted = await mount(false);
      await act(async () => {
        mounted.control().press(taskCard("agent-a"), { dialog: true });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(mocks.stop).toHaveBeenCalledWith({ agentIds: ["agent-a"] });
    } finally {
      delete world.confirm;
    }
  });

  it("cancels confirmation and returns to idle after the three-second timeout", async () => {
    vi.useFakeTimers();
    const mounted = await mount(true);
    act(() => mounted.control().press(taskCard("agent-a")));
    expect(mounted.control().phase("agent-a")).toBe("confirming");
    act(() => mounted.control().cancel("agent-a"));
    expect(mounted.control().phase("agent-a")).toBe("idle");

    act(() => mounted.control().press(taskCard("agent-b")));
    expect(mounted.control().phase("agent-b")).toBe("confirming");
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(mounted.control().phase("agent-b")).toBe("idle");
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("stops immediately without confirmation and includes only active direct children", async () => {
    mocks.stop.mockResolvedValue({ results: [{ agentId: "parent", ok: true, error: null }] });
    const mounted = await mount(false);
    const card = taskCard("parent", [
      { id: "running-child", title: "Running", status: "running" },
      { id: "waiting-child", title: "Waiting", status: "needs_input" },
      { id: "done-child", title: "Done", status: "done" },
      { id: "failed-child", title: "Failed", status: "failed" },
    ]);

    await act(async () => {
      mounted.control().press(card, { withChildren: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.stop).toHaveBeenCalledWith({ agentIds: ["parent", "running-child", "waiting-child"] });
    expect(mounted.control().phase("parent")).toBe("idle");
  });

  type AlertButton = { text: string; style: string; onPress(): void };
  const lastAlert = () => {
    const [title, message, buttons, options] = mocks.alert.mock.lastCall as [string, string, AlertButton[], { onDismiss(): void }];
    return { title, message, buttons, options, cancel: buttons[0]!, confirm: buttons[1]! };
  };

  it.each(["ios", "android"])("asks in a system dialog on %s, and a double tap never stops", async (os) => {
    mocks.platform.OS = os;
    mocks.stop.mockResolvedValue({ results: [{ agentId: "agent-a", ok: true, error: null }] });
    const mounted = await mount(true);
    const card = taskCard("agent-a");

    act(() => mounted.control().press(card));
    act(() => mounted.control().press(card));
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(mounted.control().phase("agent-a")).toBe("idle");
    expect(mocks.stop).not.toHaveBeenCalled();
    const dialog = lastAlert();
    expect(dialog).toMatchObject({ title: "Stop this task?", message: "Task agent-a" });
    expect(dialog.confirm).toMatchObject({ text: "Stop", style: "destructive" });
    expect(dialog.cancel).toMatchObject({ text: "Cancel", style: "cancel" });

    await act(async () => {
      dialog.confirm.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.stop).toHaveBeenCalledWith({ agentIds: ["agent-a"] });
    expect(mounted.control().stoppedManually.has("agent-a")).toBe(true);
  });

  it("stops nothing when the dialog is cancelled or dismissed, and asks again on the next press", async () => {
    mocks.platform.OS = "ios";
    const mounted = await mount(true);
    const card = taskCard("agent-a");

    act(() => mounted.control().press(card));
    act(() => lastAlert().cancel.onPress());
    act(() => mounted.control().press(card));
    act(() => lastAlert().options.onDismiss());
    act(() => mounted.control().press(card));

    expect(mocks.alert).toHaveBeenCalledTimes(3);
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("names the subtasks a native stop takes along, and stops them on confirm", async () => {
    mocks.platform.OS = "android";
    mocks.language.mockReturnValue("zh");
    const mounted = await mount(true);
    const card = taskCard("parent", [
      { id: "running-child", title: "Running", status: "running" },
      { id: "done-child", title: "Done", status: "done" },
    ]);

    act(() => mounted.control().press(card, { withChildren: true }));
    expect(lastAlert()).toMatchObject({ title: "停止任务和 1 个子任务？", message: "Task parent" });
    expect(lastAlert().confirm.text).toBe("全部停止");
    await act(async () => {
      lastAlert().confirm.onPress();
      await Promise.resolve();
    });
    expect(mocks.stop).toHaveBeenCalledWith({ agentIds: ["parent", "running-child"] });
  });

  it("stops on the first press on native when confirmation is off", async () => {
    mocks.platform.OS = "ios";
    const mounted = await mount(false);
    await act(async () => {
      mounted.control().press(taskCard("agent-a"));
      await Promise.resolve();
    });
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledWith({ agentIds: ["agent-a"] });
  });

  it("heads the dialog with the stop and gives the task's name, cut when long", () => {
    const card = taskCard("agent-a");
    expect(stopDialogText(card, 0, "zh")).toEqual({ title: "停止任务？", message: "Task agent-a", cancel: "取消", confirm: "停止" });
    expect(stopDialogText(card, 1, "en")).toMatchObject({ title: "Stop this task and 1 subtask?", message: "Task agent-a", confirm: "Stop all" });
    expect(stopDialogText(card, 3, "en").title).toBe("Stop this task and 3 subtasks?");
    expect(stopDialogText({ ...card, title: ` ${"x".repeat(150)} ` }, 0, "en").message).toBe(`${"x".repeat(119)}\u2026`);
  });

  it("disarms every armed stop at once (Esc), and says when none was armed", async () => {
    const mounted = await mount(true);
    act(() => mounted.control().press(taskCard("agent-a")));
    act(() => mounted.control().press(taskCard("agent-b")));
    let disarmed = false;
    act(() => { disarmed = mounted.control().cancelAll(); });
    expect(disarmed).toBe(true);
    expect(mounted.control().phase("agent-a")).toBe("idle");
    expect(mounted.control().phase("agent-b")).toBe("idle");
    act(() => { disarmed = mounted.control().cancelAll(); });
    expect(disarmed).toBe(false);
  });

  it("keeps Stopping until the agent leaves running, then is done without a toast", async () => {
    vi.useFakeTimers();
    mocks.stop.mockResolvedValue({ results: [{ agentId: "agent-a", ok: true, error: null }] });
    activeAgents.add("agent-a");
    const mounted = await mount(false, true);
    await act(async () => {
      mounted.control().press(taskCard("agent-a"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.control().phase("agent-a")).toBe("stopping");
    // The board still lists it as running right after the stop: the marker stays.
    act(() => mounted.control().noteRunning("agent-a"));
    expect(mounted.control().stoppedManually.has("agent-a")).toBe(true);
    activeAgents.delete("agent-a");
    act(() => mounted.control().reconcile());
    expect(mounted.control().phase("agent-a")).toBe("idle");
    expect(mounted.control().stoppedManually.has("agent-a")).toBe(true);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("says so when the daemon accepted the stop but the agent keeps running", async () => {
    vi.useFakeTimers();
    mocks.stop.mockResolvedValue({ results: [{ agentId: "zombie", ok: true, error: null }] });
    activeAgents.add("zombie");
    const mounted = await mount(false, true);
    await act(async () => {
      mounted.control().press(taskCard("zombie"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.control().phase("zombie")).toBe("stopping");
    act(() => { vi.advanceTimersByTime(STOP_VERIFY_MS); });
    expect(mocks.toastError).toHaveBeenCalledWith("Stop was sent, but the task is still running");
    expect(mounted.control().phase("zombie")).toBe("idle");
    expect(mounted.control().stoppedManually.has("zombie")).toBe(false);
  });

  it("fails a stop whose RPC never answers", async () => {
    vi.useFakeTimers();
    mocks.stop.mockReturnValue(new Promise(() => {}));
    const mounted = await mount(false, true);
    await act(async () => {
      mounted.control().press(taskCard("agent-a"));
      await Promise.resolve();
    });
    expect(mounted.control().phase("agent-a")).toBe("stopping");
    await act(async () => {
      vi.advanceTimersByTime(STOP_RPC_TIMEOUT_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.toastError).toHaveBeenCalledWith("Could not stop task: The stop request did not answer.");
    expect(mounted.control().phase("agent-a")).toBe("idle");
  });

  it("reads the server's earlier stops once, and survives a server without the RPC", async () => {
    mocks.stopped.mockResolvedValue({ stops: [{ agentId: "agent-a", stoppedAt: "2026-10-20T10:00:00.000Z" }] });
    const mounted = await mount(true);
    expect(mocks.stopped).toHaveBeenCalledTimes(1);
    expect([...mounted.control().restored]).toEqual([["agent-a", "2026-10-20T10:00:00.000Z"]]);
    mocks.stopped.mockRejectedValue(new Error("Unknown RPC tasks.stopped"));
    const old = await mount(true);
    expect(old.control().restored.size).toBe(0);
  });

  it("surfaces per-agent and rejected RPC failures through the toast", async () => {
    mocks.stop.mockResolvedValue({ results: [
      { agentId: "agent-a", ok: false, error: "Paseo CLI timed out." },
    ] });
    const mounted = await mount(false);

    await act(async () => {
      mounted.control().press(taskCard("agent-a"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.toastError).toHaveBeenCalledWith("Could not stop task: Paseo CLI timed out.");

    mocks.stop.mockRejectedValueOnce(new Error("RPC unavailable"));
    await act(async () => {
      mounted.control().press(taskCard("agent-b"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.toastError).toHaveBeenCalledWith("Could not stop task: RPC unavailable");
  });
});

describe("Tasks unarchive control", () => {
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    mocks.unarchive.mockReset();
    mocks.toastError.mockReset();
    mocks.language.mockReturnValue("en");
  });

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount());
    renderer = null;
  });

  async function mountUnarchive(verify: (agentId: string) => Promise<boolean | null>) {
    let control: UnarchiveControl | null = null;
    function Probe() {
      control = useUnarchiveControl({ available: true, verify });
      return null;
    }
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Probe));
    });
    return () => control!;
  }

  async function press(control: () => UnarchiveControl, agentId: string) {
    await act(async () => {
      control().press(agentId);
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });
  }

  it("reads the agent again after the RPC, and is quiet when it is back", async () => {
    mocks.unarchive.mockResolvedValue({ ok: true, error: null });
    const verify = vi.fn(async () => false);
    const control = await mountUnarchive(verify);
    await press(control, "parent");
    expect(mocks.unarchive).toHaveBeenCalledWith({ agentId: "parent" });
    expect(verify).toHaveBeenCalledWith("parent");
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(control().pending("parent")).toBe(false);
  });

  it("says so when the RPC answered ok but the agent is still archived or gone", async () => {
    mocks.unarchive.mockResolvedValue({ ok: true, error: null });
    const verify = vi.fn<(agentId: string) => Promise<boolean | null>>(async () => true);
    const control = await mountUnarchive(verify);
    await press(control, "parent");
    expect(mocks.toastError).toHaveBeenLastCalledWith("Could not unarchive: The agent is still archived.");
    verify.mockResolvedValueOnce(null);
    await press(control, "parent");
    expect(mocks.toastError).toHaveBeenLastCalledWith("Could not unarchive: The agent no longer exists.");
  });

  it("toasts the server's error, a rejected RPC and a failed read", async () => {
    const verify = vi.fn<(agentId: string) => Promise<boolean | null>>(async () => false);
    const control = await mountUnarchive(verify);
    mocks.unarchive.mockResolvedValueOnce({ ok: false, error: "Paseo CLI exited with code 1." });
    await press(control, "parent");
    expect(mocks.toastError).toHaveBeenLastCalledWith("Could not unarchive: Paseo CLI exited with code 1.");
    expect(verify).not.toHaveBeenCalled();
    mocks.unarchive.mockRejectedValueOnce(new Error("socket closed"));
    await press(control, "parent");
    expect(mocks.toastError).toHaveBeenLastCalledWith("Could not unarchive: socket closed");
    mocks.unarchive.mockResolvedValueOnce({ ok: true, error: null });
    verify.mockRejectedValueOnce(new Error("agent fetch failed"));
    await press(control, "parent");
    expect(mocks.toastError).toHaveBeenLastCalledWith("Could not unarchive: agent fetch failed");
  });
});

describe("Tasks read control", () => {
  let renderers: ReactTestRenderer[];
  let control: ReadControl | undefined;
  const readable = new Set<string>();
  const onRead = vi.fn();

  function ReadProbe() {
    control = useReadControl({ isReadable: (agentId) => readable.has(agentId), onRead });
    return React.createElement("probe");
  }

  const card = (id: string, isReadable = true) => ({ id, readable: isReadable }) as unknown as TaskCard;
  const current = () => {
    if (!control) throw new Error("Read control did not render");
    return control;
  };
  const flush = async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  };

  beforeEach(() => {
    renderers = [];
    control = undefined;
    readable.clear();
    onRead.mockReset();
    mocks.capabilities.mockReset().mockResolvedValue({ stop: true, read: true });
    mocks.read.mockReset().mockResolvedValue({ ok: true, error: null });
    mocks.toastError.mockReset();
    mocks.language.mockReturnValue("en");
  });

  afterEach(() => {
    for (const renderer of renderers) act(() => renderer.unmount());
    vi.useRealTimers();
  });

  async function mount() {
    await act(async () => {
      renderers.push(TestRenderer.create(React.createElement(ReadProbe)));
      await flush();
    });
  }

  it("is available only when the server says it reaches the daemon", async () => {
    mocks.capabilities.mockResolvedValue({ stop: true });
    await mount();
    expect(current().available).toBe(false);
    act(() => current().press(card("agent-a")));
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("stays pending until the card leaves review, then is done without a toast", async () => {
    readable.add("agent-a");
    await mount();
    expect(current().available).toBe(true);

    await act(async () => {
      current().press(card("agent-a"));
      await flush();
    });
    expect(mocks.read).toHaveBeenCalledWith({ agentIds: ["agent-a"] });
    // The board reads the marks again, so a failure the attention does not carry moves too.
    expect(onRead).toHaveBeenCalledWith("agent-a");
    expect(current().pending("agent-a")).toBe(true);
    // A second press while it waits sends nothing.
    act(() => current().press(card("agent-a")));
    expect(mocks.read).toHaveBeenCalledTimes(1);

    readable.delete("agent-a");
    act(() => current().reconcile());
    expect(current().pending("agent-a")).toBe(false);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("says so when the daemon accepted but the card is still in review", async () => {
    vi.useFakeTimers();
    readable.add("agent-a");
    await mount();
    await act(async () => {
      current().press(card("agent-a"));
      await flush();
    });
    await act(async () => {
      vi.advanceTimersByTime(READ_VERIFY_MS);
    });
    expect(current().pending("agent-a")).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith("Could not mark as read: the task is still to review.");
  });

  it("toasts the server's error and a rejected RPC, and ignores a card that is not readable", async () => {
    readable.add("agent-a");
    mocks.language.mockReturnValue("zh");
    await mount();
    act(() => current().press(card("agent-a", false)));
    expect(mocks.read).not.toHaveBeenCalled();

    mocks.read.mockResolvedValueOnce({ ok: false, error: "Could not reach the Paseo daemon." });
    await act(async () => {
      current().press(card("agent-a"));
      await flush();
    });
    expect(mocks.toastError).toHaveBeenLastCalledWith("标为已读失败：Could not reach the Paseo daemon.");
    expect(onRead).not.toHaveBeenCalled();
    expect(current().pending("agent-a")).toBe(false);

    mocks.read.mockRejectedValueOnce(new Error("socket closed"));
    await act(async () => {
      current().press(card("agent-a"));
      await flush();
    });
    expect(mocks.toastError).toHaveBeenLastCalledWith("标为已读失败：socket closed");
    expect(current().pending("agent-a")).toBe(false);
  });
});
