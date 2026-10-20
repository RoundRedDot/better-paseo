/**
 * The Tasks board's cards: status icons, row collapse per density preset,
 * phone tiers, the context thresholds, Stop's confirm state, and the
 * formatters in both languages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const motion = vi.hoisted(() => ({
  reduced: false,
  loops: [] as Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }>,
}));

vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    ...rn,
    Animated: {
      ...rn.Animated,
      loop: () => {
        const handle = { start: vi.fn(), stop: vi.fn(), reset() {} };
        motion.loops.push(handle);
        return handle;
      },
    },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(motion.reduced),
      addEventListener: () => ({ remove() {} }),
    },
  };
});

vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  return {
    Icon: (props: Record<string, unknown>) => react.createElement("Icon", props),
  };
});

import "./helpers/quiet-renderer";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { CARD_PRESETS, type CardSettings, type DensityPreset } from "../../shared/tasks-settings";
import { sampleCards } from "../../client/tasks/sample-cards";
import type { TaskCard } from "../../client/tasks/model";
import type { PermissionButton, StopPhase } from "../../client/tasks/actions";
import {
  StatusIcon,
  TaskCardView,
  TaskDetails,
  buildTaskTokens,
  cardLayout,
  contextTone,
  formatApprox,
  formatDuration,
  formatRelative,
  formatTokens,
  formatWait,
  sameCardProps,
  statusMarkSize,
  subtaskSummary,
  type TaskCardViewProps,
} from "../../client/tasks/cards";
import { statusRingHolders } from "../../client/tasks/cards/status-icon";

const LIGHT = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f7f7f8",
    surface2: "#efeff1",
    border: "#e2e2e6",
    foreground: "#1b1b1f",
    foregroundMuted: "#6b6b75",
    accent: "#3b6fe0",
    accentForeground: "#ffffff",
    statusSuccess: "#1f8a5b",
    statusWarning: "#a36a00",
    statusDanger: "#d93636",
  },
};

const DARK = {
  colors: {
    ...LIGHT.colors,
    surface0: "#18181b",
    surface1: "#1f1f23",
    surface2: "#26262b",
    border: "#2e2e33",
    foreground: "#ededef",
    foregroundMuted: "#9b9ba5",
  },
};

const NOW = Date.parse("2026-10-20T09:00:00.000Z");

function fields(preset: DensityPreset, patch: Partial<CardSettings> = {}): CardSettings {
  return { ...CARD_PRESETS[preset].fields, labelLimit: CARD_PRESETS[preset].labelLimit, ...patch };
}

function sample(id: string): TaskCard {
  const card = sampleCards(NOW).find((candidate) => candidate.id === id);
  if (!card) throw new Error(`no sample ${id}`);
  return card;
}

let renderer: ReactTestRenderer | null = null;

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  return renderer!;
}

function cardElement(card: TaskCard, overrides: Partial<TaskCardViewProps> = {}): React.ReactElement {
  const props: TaskCardViewProps = {
    card,
    fields: fields("standard"),
    theme: LIGHT,
    compact: false,
    permissionButtons: [],
    stopPhase: "idle",
    focused: false,
    highlighted: false,
    now: NOW,
    language: "zh",
    onReveal: () => {},
    onOpen: () => {},
    ...overrides,
  };
  return React.createElement(TaskCardView, props);
}

/** Every string the tree draws, one entry per Text (nested Text joined into its parent). */
function texts(root: ReactTestInstance): string[] {
  const join = (node: ReactTestInstance | string): string =>
    typeof node === "string"
      ? node.replace(/\u00a0/g, " ")
      : node.children.map((child) => join(child as ReactTestInstance | string)).join("");
  return root
    .findAll((node) => (node.type as unknown) === "Text" && !hasTextAncestor(node))
    .map((node) => join(node));
}

function hasTextAncestor(node: ReactTestInstance): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if ((parent.type as unknown) === "Text") return true;
  }
  return false;
}

/** Host elements only: rn-mock's primitives are function components carrying the same props. */
function hostByTestId(root: ReactTestInstance, testID: string): ReactTestInstance {
  return root.find((node) => typeof node.type === "string" && node.props.testID === testID);
}

function icons(root: ReactTestInstance): string[] {
  return root.findAll((node) => (node.type as unknown) === "Icon").map((node) => node.props.name as string);
}

function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

function byLabel(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
}

beforeEach(() => {
  motion.reduced = false;
  motion.loops.length = 0;
});

afterEach(async () => {
  if (renderer) {
    const current = renderer;
    await act(async () => current.unmount());
    renderer = null;
  }
});

describe("StatusIcon", () => {
  const kinds = ["running", "needs_input", "unread", "failed", "done"] as const;

  it("draws each kind with Paseo's primitive and statusDot colour", async () => {
    const tree = await render(
      React.createElement(
        React.Fragment,
        null,
        ...kinds.map((kind) => React.createElement(StatusIcon, { key: kind, kind, theme: LIGHT })),
      ),
    );
    const root = tree.root;
    const box = (kind: string) => hostByTestId(root, `status-${kind}`);

    const running = box("running");
    const [track, arc, dot] = running.children as ReactTestInstance[];
    expect(flat(track!.props.style)).toMatchObject({ width: 12, height: 12, borderWidth: 1.5, borderColor: "#268ae0", opacity: 0.3 });
    expect(running.findAll((node) => (node.type as unknown) === "Animated.View")).toHaveLength(1);
    expect(arc!.findAll((node) => (node.type as unknown) === "Animated.View")).toHaveLength(1);
    expect(flat(arc!.props.style)).toMatchObject({ borderTopColor: "#268ae0", borderColor: "transparent", opacity: 0.9 });
    expect(flat(dot!.props.style)).toMatchObject({ width: 6, height: 6, backgroundColor: "#268ae0" });

    const alert = box("needs_input");
    expect(flat((alert.children[0] as ReactTestInstance).props.style)).toMatchObject({ width: 10, backgroundColor: "#b37824" });

    expect(flat((box("unread").children[0] as ReactTestInstance).props.style)).toMatchObject({ width: 6, backgroundColor: "#299f51", opacity: 1 });
    expect(flat((box("failed").children[0] as ReactTestInstance).props.style)).toMatchObject({ width: 8, backgroundColor: "#f12e2f" });
    expect(flat((box("done").children[0] as ReactTestInstance).props.style)).toMatchObject({ width: 6, backgroundColor: "#6b6b75", opacity: 0.3 });
  });

  it("draws the needs-input \"!\" inside the disc, in the backdrop colour, at 12, 16 and 20 px", async () => {
    for (const [size, scale] of [[12, 0.75], [16, 1], [20, 14 / 12]] as const) {
      const tree = await render(React.createElement(StatusIcon, { kind: "needs_input", size, theme: LIGHT, backdrop: "#f7f7f8" }));
      const disc = hostByTestId(tree.root, "status-needs_input-disc");
      expect(flat(disc.props.style)).toMatchObject({ width: 10 * scale, height: 10 * scale, backgroundColor: "#b37824" });
      // The bar and the dot are the disc's children, so they paint over it on every platform.
      const bar = hostByTestId(disc, "status-needs_input-bar");
      const dot = hostByTestId(disc, "status-needs_input-dot");
      expect(flat(bar.props.style)).toMatchObject({ width: 1.5 * scale, height: 3 * scale, backgroundColor: "#f7f7f8" });
      expect(flat(dot.props.style)).toMatchObject({ width: 1.5 * scale, height: 1.5 * scale, backgroundColor: "#f7f7f8" });
      // Nothing absolutely positioned: on web that would paint over its in-flow siblings.
      const positioned = hostByTestId(tree.root, "status-needs_input").findAll(
        (node) => typeof node.type === "string" && flat(node.props.style).position === "absolute",
      );
      expect(positioned).toHaveLength(0);
      expect(icons(tree.root)).toEqual([]);
      await act(async () => tree.unmount());
      renderer = null;
    }
  });

  it("takes the dark band on a dark surface", async () => {
    const tree = await render(React.createElement(StatusIcon, { kind: "unread", theme: DARK }));
    const dot = hostByTestId(tree.root, "status-unread").children[0] as ReactTestInstance;
    expect(flat(dot.props.style).backgroundColor).toBe("#35c264");
    expect(buildTaskTokens(DARK.colors).status).toEqual({ running: "#5caaf6", warning: "#db932e", success: "#35c264", danger: "#f7796d" });
  });

  it("scales the mark for 12, 16 and 20 px boxes", () => {
    expect(statusMarkSize(12)).toBe(9);
    expect(statusMarkSize(16)).toBe(12);
    expect(statusMarkSize(20)).toBe(14);
  });

  it("runs every ring from one shared animation, and stops it when the last ring leaves", async () => {
    const tree = await render(
      React.createElement(
        React.Fragment,
        null,
        ...[16, 12, 20].map((size) => React.createElement(StatusIcon, { key: size, kind: "running", size, theme: LIGHT })),
      ),
    );
    expect(motion.loops).toHaveLength(1);
    expect(motion.loops[0]!.start).toHaveBeenCalledTimes(1);
    expect(statusRingHolders()).toBe(3);
    const rotations = tree.root
      .findAll((node) => (node.type as unknown) === "Animated.View")
      .map((node) => (flat(node.props.style).transform as Array<{ rotate: unknown }>)[0]!.rotate);
    expect(rotations).toHaveLength(3);
    expect(new Set(rotations).size).toBe(1);

    await act(async () => tree.unmount());
    renderer = null;
    expect(statusRingHolders()).toBe(0);
    expect(motion.loops[0]!.stop).toHaveBeenCalled();
  });

  it("does not animate when told not to, or under reduced motion", async () => {
    await render(React.createElement(StatusIcon, { kind: "running", theme: LIGHT, animated: false }));
    expect(motion.loops).toHaveLength(0);
    await act(async () => renderer!.unmount());

    motion.reduced = true;
    await render(React.createElement(StatusIcon, { kind: "running", theme: LIGHT }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(statusRingHolders()).toBe(0);
    motion.reduced = false;
  });
});

describe("TaskCardView rows", () => {
  it("draws the standard card's groups", async () => {
    const tree = await render(cardElement(sample("sample-running")));
    const all = texts(tree.root);
    expect(all).toContain("Port the status ring to React Native");
    expect(all).toContain("Codex · GPT-5.5 Codex · Medium");
    expect(all).toContain("better-paseo › tasks-board");
    expect(all).toContain("feat/tasks-board");
    expect(all).toContain("12m 30s");
    expect(all).toContain("上下文 86%");
    expect(all).toContain("3 个子任务：2 运行中 · 1 已完成");
    expect(all).toContain("frontend");
    expect(all).toContain("+1");
    expect(all.some((text) => text.includes("未提交"))).toBe(false);
  });

  it("keeps only the header and the timer at minimal", async () => {
    const tree = await render(cardElement(sample("sample-running"), { fields: fields("minimal") }));
    const all = texts(tree.root);
    expect(all).toEqual(["Port the status ring to React Native", "Codex · GPT-5.5 Codex · Medium", "12m 30s"]);
    expect(icons(tree.root)).not.toContain("GitBranch");
    expect(icons(tree.root)).not.toContain("Gauge");
  });

  it("collapses the location group and the footer when their fields are off", async () => {
    const off = fields("minimal", { project: false, timer: false });
    const tree = await render(cardElement(sample("sample-running"), { fields: off }));
    expect(texts(tree.root)).toEqual(["Port the status ring to React Native", "Codex · GPT-5.5 Codex · Medium"]);
  });

  it("adds git status, the full path and the PR at full", async () => {
    const tree = await render(cardElement(sample("sample-running"), { fields: fields("full") }));
    const all = texts(tree.root);
    expect(all).toContain("未提交 ↑3 ↓0");
    expect(all).toContain("/Users/dev/code/better-paseo/.worktrees/tasks-board");
    expect(all).toContain("#42 feat: Tasks board");
    expect(all).not.toContain("+1");
    expect(icons(tree.root)).toEqual(expect.arrayContaining(["GitBranch", "FolderOpen", "GitPullRequest"]));
  });

  it("folds labels past the limit into +N", async () => {
    for (const [limit, expected] of [["1", "+2"], ["2", "+1"], ["3", null], ["all", null]] as const) {
      const tree = await render(cardElement(sample("sample-done"), { fields: fields("standard", { labelLimit: limit }) }));
      const plus = texts(tree.root).filter((text) => text.startsWith("+"));
      expect(plus).toEqual(expected ? [expected] : []);
      await act(async () => tree.unmount());
      renderer = null;
    }
  });

  it("leads the second row with the workspace kind when there is no branch", async () => {
    const tree = await render(cardElement(sample("sample-done")));
    expect(texts(tree.root)).toContain("scratch");
    expect(icons(tree.root)).not.toContain("GitBranch");
    expect(icons(tree.root)).toContain("Folder");
    const layout = cardLayout(sample("sample-failed"), fields("standard"), false);
    expect(layout.branch).toBe(true);
  });

  it("shows the parent link and reveals the parent", async () => {
    const onReveal = vi.fn();
    const tree = await render(cardElement(sample("sample-child-1"), { onReveal }));
    expect(texts(tree.root)[0]).toBe("Port the status ring to React Native");
    byLabel(tree.root, "定位到父任务").props.onPress();
    expect(onReveal).toHaveBeenCalledWith("sample-running");

    const orphan = { ...sample("sample-child-1"), parent: { id: "gone", title: null, missing: true } };
    await act(async () => tree.update(cardElement(orphan, { onReveal })));
    expect(texts(tree.root)[0]).toBe("父任务（已归档）");
  });

  it("draws the failure reason in the danger colour", async () => {
    const tree = await render(cardElement(sample("sample-failed")));
    const reason = tree.root.find(
      (node) => (node.type as unknown) === "Text" && node.props.children === "Provider exited with code 1: rate limit reached",
    );
    expect(flat(reason.props.style).color).toBe("#d93636");
    expect(icons(tree.root)).toContain("CircleX");
  });

  it("draws the permission summary, its buttons and the remaining count", async () => {
    const buttons: PermissionButton[] = [
      { key: "allow", label: "允许", variant: "primary", kind: "respond", action: { behavior: "allow", id: null } },
      { key: "deny", label: "拒绝", variant: "secondary", kind: "respond", action: { behavior: "deny", id: null } },
    ];
    const onPermission = vi.fn();
    const onOpen = vi.fn();
    const card = sample("sample-input");
    const tree = await render(cardElement(card, { permissionButtons: buttons, onPermission, onOpen }));
    const all = texts(tree.root);
    expect(all).toContain("Bash · npm run db:migrate -- --env staging");
    expect(all).toContain("还有 1 条");
    expect(all).toContain("等待 4m");
    byLabel(tree.root, "拒绝").props.onPress();
    expect(onPermission).toHaveBeenCalledWith(card, buttons[1]);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("TaskCardView context bar", () => {
  const withContext = (used: number) => ({ ...sample("sample-running"), context: { usedTokens: used, maxTokens: 100 } });
  const label = (tree: ReactTestRenderer) =>
    tree.root.findAll((node) => (node.type as unknown) === "Text" && texts(node)[0]?.startsWith("上下文") === true);

  it("turns warning above 80% and danger above 90%", async () => {
    expect([contextTone(0.8), contextTone(0.81), contextTone(0.9), contextTone(0.91)]).toEqual(["normal", "warning", "warning", "danger"]);
    for (const [used, color] of [[46, "#6b6b75"], [85, "#a36a00"], [95, "#d93636"]] as const) {
      const tree = await render(cardElement(withContext(used)));
      expect(flat(label(tree)[0]!.props.style).color).toBe(color);
      await act(async () => tree.unmount());
      renderer = null;
    }
  });

  it("hides when the context is unknown, and on a phone until 80%", async () => {
    let tree = await render(cardElement({ ...sample("sample-running"), context: null }));
    expect(label(tree)).toHaveLength(0);
    await act(async () => tree.update(cardElement(withContext(46), { compact: true })));
    expect(label(tree)).toHaveLength(0);
    await act(async () => tree.update(cardElement(withContext(86), { compact: true })));
    expect(label(tree)).toHaveLength(1);
  });
});

describe("TaskCardView compact tiers", () => {
  it("never draws details-only fields, keeps the must tier, and shows one label", async () => {
    const card = {
      ...sample("sample-running"),
      location: { ...sample("sample-running").location, projectIcon: "data:image/png;base64,AAAA", folder: "board" },
    };
    const tree = await render(cardElement(card, { compact: true, fields: fields("full", { provider: false, model: false, timer: false }) }));
    const all = texts(tree.root);
    expect(all).toContain("Codex · GPT-5.5 Codex · Medium");
    expect(all).toContain("better-paseo › tasks-board");
    expect(all).toContain("feat/tasks-board");
    expect(all).toContain("12m 30s");
    expect(all).toContain("frontend");
    expect(all).toContain("+2");
    expect(all.some((text) => text.includes("/Users/dev"))).toBe(false);
    expect(all.some((text) => text.includes("#42"))).toBe(false);
    expect(all.some((text) => text.includes("未提交"))).toBe(false);
    expect(all).not.toContain("board");
    expect(tree.root.findAll((node) => (node.type as unknown) === "Image" && node.props.source?.uri === card.location.projectIcon)).toHaveLength(0);
    expect(icons(tree.root)).not.toContain("GitPullRequest");
  });

  it("puts Stop in the action bar on a phone", async () => {
    const onStop = vi.fn();
    const card = sample("sample-child-1");
    const tree = await render(cardElement(card, { compact: true, onStop }));
    byLabel(tree.root, "停止").props.onPress();
    expect(onStop).toHaveBeenCalledWith(card, { withChildren: false });
  });
});

describe("TaskCardView actions", () => {
  it("hides the jump button without onOpen, and opens on a press of the card", async () => {
    const onOpen = vi.fn();
    const tree = await render(cardElement(sample("sample-done"), { onOpen }));
    expect(icons(tree.root)).toContain("ArrowUpRight");
    hostByTestId(tree.root, "task-card-sample-done").props.onPress();
    byLabel(tree.root, "在 workspace 中打开").props.onPress();
    expect(onOpen.mock.calls).toEqual([["sample-done"], ["sample-done"]]);

    await act(async () => tree.update(cardElement(sample("sample-done"), { onOpen: undefined })));
    expect(icons(tree.root)).not.toContain("ArrowUpRight");
    expect(hostByTestId(tree.root, "task-card-sample-done").props.onPress).toBeUndefined();
  });

  it("shows Stop only for a stoppable card with onStop, and its confirm state", async () => {
    const onStop = vi.fn();
    const card = sample("sample-child-1");
    const tree = await render(cardElement(card));
    expect(texts(tree.root)).not.toContain("停止");

    await act(async () => tree.update(cardElement({ ...card, stoppable: false }, { onStop })));
    expect(texts(tree.root)).not.toContain("停止");

    await act(async () => tree.update(cardElement(card, { onStop })));
    expect(texts(tree.root)).toContain("停止");

    await act(async () => tree.update(cardElement(card, { onStop, stopPhase: "confirming" as StopPhase })));
    const confirm = byLabel(tree.root, "确认停止");
    expect(flat(confirm.props.style)).toMatchObject({ borderColor: "#d93636" });
    confirm.props.onPress();
    expect(onStop).toHaveBeenCalledWith(card, { withChildren: false });
  });

  it("offers a parent with running children the stop-with-subtasks menu", async () => {
    const onStop = vi.fn();
    const card = sample("sample-running");
    const tree = await render(cardElement(card, { onStop }));
    await act(async () => byLabel(tree.root, "停止选项").props.onPress());
    expect(texts(tree.root)).toEqual(expect.arrayContaining(["仅停止此任务", "连同子任务一起停止", "2"]));
    await act(async () =>
      tree.root
        .find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem" && texts(node)[0] === "连同子任务一起停止")
        .props.onPress(),
    );
    expect(onStop).toHaveBeenCalledWith(card, { withChildren: true });
    await act(async () => tree.update(cardElement(card, { onStop, stopPhase: "confirming" })));
    expect(texts(tree.root)).toContain("确认停止全部");
  });

  it("expands the subtasks into rows that reveal and open each child", async () => {
    const onReveal = vi.fn();
    const onOpen = vi.fn();
    const tree = await render(cardElement(sample("sample-running"), { onReveal, onOpen }));
    await act(async () =>
      tree.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityState?.expanded === false).props.onPress(),
    );
    byLabel(tree.root, "Measure the sidebar ring").props.onPress();
    expect(onReveal).toHaveBeenCalledWith("sample-child-1");
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID?.startsWith?.("status-"))).toHaveLength(4);
  });
});

describe("TaskCardView memo", () => {
  const onReveal = () => {};
  const standard = fields("standard");
  const none: PermissionButton[] = [];
  const base = (card: TaskCard, now: number): TaskCardViewProps => ({
    card,
    fields: standard,
    theme: LIGHT,
    compact: false,
    permissionButtons: none,
    stopPhase: "idle",
    focused: false,
    highlighted: false,
    now,
    onReveal,
  });

  it("re-renders on a tick only when the timer text changes", () => {
    const running = sample("sample-running");
    expect(sameCardProps(base(running, NOW), base(running, NOW + 1000))).toBe(false);
    const done = sample("sample-done");
    expect(sameCardProps(base(done, NOW), base(done, NOW + 1000))).toBe(true);
    expect(sameCardProps(base(done, NOW), base(done, NOW + 60_000))).toBe(false);
    const quiet = { ...base(running, NOW), fields: fields("standard", { timer: false }) };
    expect(sameCardProps(quiet, { ...quiet, now: NOW + 5000 })).toBe(true);
    expect(sameCardProps(base(done, NOW), { ...base(done, NOW), highlighted: true })).toBe(false);
  });
});

describe("TaskDetails", () => {
  it("lists location, stats and the open-tab button", async () => {
    const onOpen = vi.fn();
    const tree = await render(React.createElement(TaskDetails, { card: sample("sample-running"), theme: LIGHT, now: NOW, onOpen, language: "zh" }));
    const all = texts(tree.root);
    expect(all).toEqual(
      expect.arrayContaining([
        "feat/tasks-board",
        "↑3 ↓0 origin · 有未提交改动",
        "/Users/dev/code/better-paseo/.worktrees/tasks-board",
        "#42 feat: Tasks board",
        "1 小时前",
        "Bypass",
        "182k (缓存 120k)",
        "14k",
        "$1.84",
        "172k / 200k",
        "打开 tab",
      ]),
    );
    byLabel(tree.root, "打开 tab").props.onPress();
    expect(onOpen).toHaveBeenCalledWith("sample-running");
  });

  it("says a directory is not a git checkout", async () => {
    const tree = await render(React.createElement(TaskDetails, { card: sample("sample-done"), theme: LIGHT, now: NOW, language: "en" }));
    expect(texts(tree.root)).toEqual(expect.arrayContaining(["Not a git directory", "directory"]));
    expect(texts(tree.root)).not.toContain("Open tab");
  });
});

describe("formatters", () => {
  it("formats durations, waits, estimates and relative times in both languages", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(12 * 60_000 + 30_000)).toBe("12m 30s");
    expect(formatDuration(65 * 60_000 + 5_000)).toBe("1h 5m");
    expect(formatWait(4 * 60_000 + 20_000, "zh")).toBe("等待 4m");
    expect(formatWait(4 * 60_000, "en")).toBe("Waiting 4m");
    expect(formatApprox(8 * 60_000, "zh")).toBe("约 8m");
    expect(formatApprox(20_000, "en")).toBe("~1m");
    expect(formatApprox(90 * 60_000, "zh")).toBe("约 1h 30m");
    expect(formatRelative(5 * 60_000, "zh")).toBe("5 分钟前");
    expect(formatRelative(5 * 60_000, "en")).toBe("5m ago");
    expect(formatRelative(10_000, "zh")).toBe("刚刚");
    expect(formatRelative(3 * 3_600_000, "en")).toBe("3h ago");
    expect(formatRelative(2 * 86_400_000, "zh")).toBe("2 天前");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(182_000)).toBe("182k");
    expect(formatTokens(1_250_000)).toBe("1.25M");
  });

  it("summarises subtasks", () => {
    const children = sample("sample-running").children;
    expect(subtaskSummary(children, "zh")).toBe("3 个子任务：2 运行中 · 1 已完成");
    expect(subtaskSummary(children, "en")).toBe("3 subtasks: 2 running · 1 done");
  });

  it("derives the prototype's tokens from the host colours", () => {
    const tokens = buildTaskTokens(LIGHT.colors);
    expect(tokens.isDark).toBe(false);
    // mix(foregroundMuted, surface0, 22%) = surface0 + 22% towards muted.
    expect(tokens.dotGrid).toBe("#dedee1");
    expect(tokens.scrim).toBe("rgba(0, 0, 0, 0.32)");
    expect(buildTaskTokens(DARK.colors).scrim).toBe("rgba(0, 0, 0, 0.56)");
  });
});
