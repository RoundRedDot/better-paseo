import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";
import {
  permissionButtons,
  respondToPermission,
  useStopControl,
  type StopControl,
} from "../../client/tasks/actions";
import type { TaskCard, TaskPermission, TaskPermissionAction } from "../../client/tasks/model";
import { createFakePaseo, makeAgent } from "./helpers/fake-paseo";

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  stop: vi.fn(),
  toastError: vi.fn(),
  language: vi.fn(() => "en" as const),
}));

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc(contract: { name: string }) {
    return contract.name === "tasks.capabilities" ? mocks.capabilities : mocks.stop;
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
      label: "去回答 ↗",
      variant: "primary",
      kind: "open",
      action: { behavior: "deny", id: null },
    }]);
    expect(permissionButtons(permission(kind), "en")[0]?.label).toBe("Answer ↗");
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

function StopProbe({ confirmStop }: { confirmStop: boolean }) {
  latestControl = useStopControl({ confirmStop });
  return React.createElement("probe");
}

function taskCard(id: string, children: TaskCard["children"] = []): TaskCard {
  return { id, stoppable: true, children } as unknown as TaskCard;
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
    mocks.toastError.mockReset();
    mocks.language.mockReturnValue("en");
  });

  afterEach(() => {
    for (const renderer of renderers) act(() => renderer.unmount());
    vi.useRealTimers();
  });

  async function mount(confirmStop: boolean) {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(StopProbe, { confirmStop }));
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
