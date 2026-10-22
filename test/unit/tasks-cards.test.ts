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

const opened = vi.hoisted(() => ({ openLink: vi.fn() }));
vi.mock("../../client/components/open-link", () => opened);

const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => {}), show: vi.fn(), error: vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => react.createElement("Icon", props),
    ScrollView: rn.ScrollView,
    copyText: clipboard.copyText,
    useToast: () => ({ show: clipboard.show, error: clipboard.error }),
  };
});

import "./helpers/quiet-renderer";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { CARD_PRESETS, type CardSettings, type DensityPreset } from "../../shared/tasks-settings";
import { previewSampleCards, sampleCards } from "../../client/tasks/sample-cards";
import type { TaskCard, TaskChild } from "../../client/tasks/model";
import type { PermissionButton, StopPhase } from "../../client/tasks/actions";
import {
  StatusIcon,
  TaskCardView,
  TaskDetailCards,
  DetailActionBar,
  branchHint,
  breakable,
  foldPath,
  pathLines,
  pathTokens,
  buildTaskTokens,
  taskTokens,
  cardLayout,
  contextTone,
  formatApprox,
  formatClockTime,
  formatDuration,
  formatRelative,
  formatTokens,
  formatWait,
  tildePath,
  sameCardProps,
  createTaskClock,
  useTime,
  statusMarkSize,
  subtaskSummary,
  type TaskCardViewProps,
} from "../../client/tasks/cards";
import { statusRingHolders } from "../../client/tasks/cards/status-icon";
import { resetSectionChoices } from "../../client/tasks/cards/detail-collapse";
import { LARGE_FONT_SCALE, OVERLAY_ROW_Z, PHONE_BUTTON_MIN_WIDTH, phoneButtonSizing } from "../../client/tasks/cards/task-card";
import { ContextRing, contextRingTone, formatSessionCost, formatTokenCount } from "../../client/tasks/cards/context-ring";
import { pillTint } from "../../client/tasks/cards/tokens";
import { modeIcon } from "../../client/tasks/cards/mode-icons";
import { menuChrome } from "../../client/tasks/board/menu";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { PiMark, agentPillColors, contrastRatio, tintedPillColors } from "../../client/tasks/cards/brand-mark";
import { permissionButtons } from "../../client/tasks/actions";
import { providerBrand } from "../../client/components/provider-logo";
import { MARK_IDS, seedMarkBitmaps } from "../../client/components/marks";
import { mix } from "../../client/components/theme-tokens";
import { identityColor, projectIconRadius, projectInitial, projectViewKey } from "../../client/tasks/cards/project-icon";

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
/** The running sample's start, 12m 30s before NOW, in the machine's time zone. */
const RUNNING_START = formatClockTime(NOW - 12 * 60_000 - 30_000, NOW);

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
      ? node.replace(/\u00a0/g, " ").replace(/[\u200b\u2060]/g, "")
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

/** The test ids of a card's rows, in order. */
function rows(root: ReactTestInstance, id: string): string[] {
  const card = hostByTestId(root, `task-card-${id}`);
  const hosts = (node: ReactTestInstance): ReactTestInstance[] =>
    node.children.flatMap((child) =>
      typeof child === "string" ? [] : typeof child.type === "string" ? [child] : hosts(child),
    );
  return hosts(card).map((node) => String(node.props.testID));
}

/** Every pill's test id and first text, in order. */
function pills(root: ReactTestInstance): Array<[string, string]> {
  return root
    .findAll((node) => typeof node.type === "string" && String(node.props.testID ?? "").startsWith("pill-"))
    .map((node) => [String(node.props.testID), texts(node)[0] ?? ""]);
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
    expect(flat((alert.children[0] as ReactTestInstance).props.style)).toMatchObject({ width: 12, borderWidth: 1.5, borderColor: "#b37824" });

    expect(flat((box("unread").children[0] as ReactTestInstance).props.style)).toMatchObject({ width: 6, backgroundColor: "#299f51" });
    expect(flat((box("failed").children[0] as ReactTestInstance).props.style)).toMatchObject({ width: 8, backgroundColor: "#f12e2f" });
    const done = box("done");
    expect(icons(done)).toEqual(["CircleCheck"]);
    expect(done.findByProps({ name: "CircleCheck" }).props).toMatchObject({ size: 16, color: "#299f51" });
  });

  it("draws needs-input as a hollow amber ring, unlike the running ring, at 12, 16 and 20 px", async () => {
    for (const [size, scale] of [[12, 0.75], [16, 1], [20, 14 / 12]] as const) {
      const tree = await render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(StatusIcon, { key: "input", kind: "needs_input", size, theme: LIGHT, animated: false }),
          React.createElement(StatusIcon, { key: "running", kind: "running", size, theme: LIGHT, animated: false }),
        ),
      );
      const ring = hostByTestId(tree.root, "status-needs_input-ring");
      const style = flat(ring.props.style);
      // The running ring's track, whole and opaque: same diameter and stroke, no fill, nothing inside.
      expect(style).toMatchObject({ width: 12 * scale, height: 12 * scale, borderRadius: 6 * scale, borderWidth: 1.5 * scale, borderColor: "#b37824" });
      expect(style.backgroundColor).toBeUndefined();
      expect(style.opacity).toBeUndefined();
      expect(ring.children).toHaveLength(0);
      const running = hostByTestId(tree.root, "status-running");
      const [track] = running.children as ReactTestInstance[];
      expect(flat(track!.props.style)).toMatchObject({ width: style.width, borderWidth: style.borderWidth, opacity: 0.3 });
      // Running keeps its centre dot and arc; needs-input has neither.
      expect(running.children.length).toBe(3);
      expect(icons(hostByTestId(tree.root, "status-needs_input"))).toEqual([]);
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

  it("runs every ring from one shared native-driver loop, and stops it when the last ring leaves", async () => {
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
  it.each([LIGHT, DARK])("draws the branch on a faint blue fill with a blue icon and a monospace name in either theme", async (theme) => {
    const tree = await render(cardElement(sample("sample-running"), { theme, fields: fields("full") }));
    const tokens = buildTaskTokens(theme.colors);
    const branch = hostByTestId(tree.root, "pill-branch");
    expect(flat(branch.props.style).backgroundColor).toBe(mix(tokens.card.background, tokens.branch, tokens.isDark ? 0.14 : 0.08));
    expect(icons(branch)).toEqual(["GitBranch"]);
    expect(branch.find((node) => (node.type as unknown) === "Icon").props.color).toBe(tokens.branch);
    const name = branch.findAll((node) => (node.type as unknown) === "Text")[0]!;
    expect(flat(name.props.style).color).toBe(tokens.foreground);
    expect(flat(name.props.style).fontFamily).toMatch(/mono|Menlo/i);
  });

  it.each([
    ["zh", new Date(2026, 9, 22, 12), new Date(2026, 9, 22, 10), "约 8m · 2 小时前"],
    ["en", new Date(2026, 9, 22, 12), new Date(2026, 9, 22, 10), "~8m · 2h ago"],
    ["zh", new Date(2026, 9, 22, 0, 5), new Date(2026, 9, 21, 23, 59, 10), "约 8m · 2026-10-21 23:59:10"],
    ["en", new Date(2026, 9, 22, 12), new Date(2026, 9, 13, 23, 9, 10), "~8m · 2026-10-13 23:09:10"],
    ["zh", new Date(2026, 9, 22, 12), new Date(2026, 9, 21, 12), "约 8m · 2026-10-21 12:00:00"],
    ["zh", new Date(2026, 0, 1), new Date(2025, 11, 31, 23, 59, 59), "约 8m · 2025-12-31 23:59:59"],
  ] as const)("renders the %s footer at %s for an update at %s", async (language, now, updated, expected) => {
    const card = sample("sample-done");
    card.timing = { ...card.timing, updatedAt: updated.toISOString(), lastTurnMs: 8 * 60_000 };
    const tree = await render(cardElement(card, { now: now.getTime(), language }));
    expect(texts(hostByTestId(tree.root, "task-card-timer"))).toEqual([expected]);
  });

  it("switches from relative time to a full timestamp when the board clock crosses midnight", async () => {
    let time = new Date(2026, 9, 21, 23, 59, 59).getTime();
    const clock = createTaskClock(() => time);
    const card = sample("sample-done");
    card.timing = { ...card.timing, updatedAt: new Date(2026, 9, 21, 23, 58, 10).toISOString(), lastTurnMs: null };
    const tree = await render(cardElement(card, { now: undefined, clock }));
    expect(texts(hostByTestId(tree.root, "task-card-timer"))).toEqual(["1 分钟前"]);
    time += 1000;
    act(() => clock.tick());
    expect(texts(hostByTestId(tree.root, "task-card-timer"))).toEqual(["2026-10-21 23:58:10"]);
  });

  it("lays the card out as Linear does: meta, title, pills, footer, then the lane blocks", async () => {
    const tree = await render(cardElement(sample("sample-running")));
    expect(rows(tree.root, "sample-running")).toEqual([
      "task-card-meta",
      "task-card-title-row",
      "task-card-pills",
      "task-card-footer",
    ]);
    // The project's letter avatar (`projectIcon` is on at standard), then project › workspace.
    expect(texts(hostByTestId(tree.root, "task-card-meta"))).toEqual(["B", "better-paseo › tasks-board"]);
    const title = hostByTestId(tree.root, "task-card-title");
    expect(title.props.numberOfLines).toBe(2);
    expect(title.props.ellipsizeMode).toBe("tail");
    expect(flat(title.props.style)).toMatchObject({ fontSize: 12, fontWeight: "500" });
    expect(pills(tree.root)).toEqual([
      ["pill-model", "GPT-5.5 Codex"],
      ["pill-branch", "feat/tasks-board"],
      ["pill-label-frontend", "frontend"],
      ["pill-label-p1", "p1"],
      ["pill-labels-more", "+1"],
      ["pill-subtasks", "2"],
    ]);
    // Model and thinking share one pill, each with its icon, joined by a middle dot.
    const agent = hostByTestId(tree.root, "pill-model");
    expect(texts(agent)).toEqual(["GPT-5.5 Codex", "·", "Medium"]);
    expect(icons(agent)).toEqual(["Brain"]);
    expect(flat(hostByTestId(agent, "agent-pill-dot").props.style).marginHorizontal).toBe(-3);
    expect(agent.props.accessibilityLabel).toBe("Codex GPT-5.5 Codex Medium");
    // The turn's start behind a clock, then how long it has run behind an hourglass, as the turn footer draws them.
    const footer = hostByTestId(tree.root, "task-card-footer");
    expect(texts(footer)).toEqual([RUNNING_START, "12m 30s"]);
    expect(icons(hostByTestId(footer, "task-card-started"))).toEqual(["Clock"]);
    expect(icons(hostByTestId(footer, "task-card-timer"))).toEqual(["Hourglass"]);
    expect(texts(tree.root).some((text) => text.includes("未提交"))).toBe(false);
  });

  it("draws pills fully rounded and outlined, with label dots in the label colour", async () => {
    const tree = await render(cardElement(sample("sample-running"), { fields: fields("standard", { labelLimit: "all" }) }));
    for (const [id] of pills(tree.root)) {
      // borderWidth is StyleSheet.hairlineWidth, which rn-mock reports as 1; the agent pills have none.
      const agent = id === "pill-model" || id === "pill-branch";
      expect(flat(hostByTestId(tree.root, id).props.style)).toMatchObject({ height: 24, borderRadius: 12, borderWidth: agent ? 0 : 1 });
    }
    // Tints: a label's colour at 10% over the card with a stronger hairline; neutral grey without one.
    const tokens = buildTaskTokens(LIGHT.colors);
    const pillColors = (id: string) => {
      const style = flat(hostByTestId(tree.root, id).props.style);
      return { background: style.backgroundColor, border: style.borderColor };
    };
    expect(pillColors("pill-label-frontend")).toEqual({ background: mix("#ffffff", "#8b5cf6", 0.1), border: mix("#ffffff", "#8b5cf6", 0.26) });
    expect(pillColors("pill-label-board")).toEqual({ background: tokens.card.pillFill, border: tokens.card.pillBorder });
    // The branch: a faint fixed blue, borderless; folder, path and PR stay neutral.
    expect(pillColors("pill-branch").background).toBe(mix("#ffffff", tokens.branch, 0.08));
    // Codex's mark is monochrome, like the ChatGPT app's, so its agent pill is the neutral one; the subtasks pill its dominant status (2 running).
    expect(pillColors("pill-model").background).toBe(mix("#ffffff", LIGHT.colors.foreground, 0.06));
    expect(pillColors("pill-subtasks").background).toBe(mix("#ffffff", tokens.status.running, 0.1));
    const dot = (name: string) =>
      flat((hostByTestId(tree.root, `pill-label-${name}`).findAll((node) => typeof node.type === "string" && flat(node.props.style).width === 8)[0])!.props.style)
        .backgroundColor;
    expect(dot("frontend")).toBe("#8b5cf6");
    expect(dot("p1")).toBe("#ef4444");
    // No colour: a neutral grey dot.
    expect(dot("board")).toBe("#6b6b75");
  });

  it("keeps the title row, the agent pill and the footer at minimal", async () => {
    const tree = await render(cardElement(sample("sample-running"), { fields: fields("minimal") }));
    expect(rows(tree.root, "sample-running")).toEqual(["task-card-title-row", "task-card-pills", "task-card-footer"]);
    // Minimal: the model and thinking switches are on, the provider's mark is off.
    expect(pills(tree.root)).toEqual([
      ["pill-model", "GPT-5.5 Codex"],
    ]);
    expect(texts(tree.root)).toEqual(["Port the status ring to React Native", "GPT-5.5 Codex", "·", "Medium", RUNNING_START, "12m 30s"]);
    expect(hostByTestId(tree.root, "pill-model").findAll((node) => (node.type as unknown) === "Image")).toHaveLength(0);
    // With no meta row, the jump button moves up to the title row, which then holds the overlays.
    expect(icons(hostByTestId(tree.root, "task-card-title-row"))).toContain("ArrowUpRight");
    expect(flat(hostByTestId(tree.root, "task-card-title-row").props.style).zIndex).toBe(OVERLAY_ROW_Z);
  });

  it("collapses the pill row and the footer when their fields are off", async () => {
    const off = fields("minimal", { model: false, thinking: false, timer: false });
    const tree = await render(cardElement(sample("sample-running"), { fields: off }));
    expect(rows(tree.root, "sample-running")).toEqual(["task-card-title-row"]);
    expect(texts(tree.root)).toEqual(["Port the status ring to React Native"]);
  });

  it("names the provider in the model pill when the model is off, and drops the thinking level", async () => {
    const tree = await render(cardElement(sample("sample-done"), { fields: fields("standard", { model: false, thinking: false }) }));
    expect(pills(tree.root)[0]).toEqual(["pill-model", "Claude"]);
    expect(texts(hostByTestId(tree.root, "pill-model"))).toEqual(["Claude"]);
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "agent-pill-dot")).toHaveLength(0);
  });

  it("keeps the thinking level in a pill of its own when the model pill is off", async () => {
    const tree = await render(cardElement(sample("sample-running"), { fields: fields("standard", { provider: false, model: false }) }));
    expect(pills(tree.root).slice(0, 2)).toEqual([
      ["pill-thinking", "Medium"],
      ["pill-branch", "feat/tasks-board"],
    ]);
    expect(icons(hostByTestId(tree.root, "pill-thinking"))).toEqual(["Brain"]);
  });

  it("adds git status, the full path and the PR at full", async () => {
    const tree = await render(cardElement(sample("sample-running"), { fields: fields("full") }));
    const ids = pills(tree.root).map(([id]) => id);
    expect(ids).toEqual(expect.arrayContaining(["pill-branch", "pill-path", "pill-pr"]));
    expect(texts(hostByTestId(tree.root, "pill-branch"))).toEqual(["feat/tasks-board", "未提交 ↑3 ↓0"]);
    expect(texts(hostByTestId(tree.root, "pill-path"))).toEqual(["~/code/better-paseo/.worktrees/tasks-board"]);
    expect(texts(hostByTestId(tree.root, "pill-pr"))).toEqual(["#42"]);
    expect(ids).not.toContain("pill-labels-more");
    expect(hostByTestId(tree.root, "task-card-meta").findAll((node) => (node.type as unknown) === "View" && flat(node.props.style).width === 12)).toHaveLength(1);
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

  it("draws the folder as a pill when there is no branch", async () => {
    const tree = await render(cardElement(sample("sample-done")));
    expect(texts(hostByTestId(tree.root, "pill-folder"))).toEqual(["scratch"]);
    expect(icons(tree.root)).not.toContain("GitBranch");
    expect(cardLayout(sample("sample-failed"), fields("standard"), false).branch).toBe(true);
  });

  it("appends the parent link to the meta row and reveals the parent", async () => {
    const onReveal = vi.fn();
    const tree = await render(cardElement(sample("sample-child-1"), { onReveal }));
    expect(texts(hostByTestId(tree.root, "task-card-meta"))).toEqual([
      "B",
      "better-paseo › tasks-board",
      " › ",
      "↳ Port the status ring to React Native",
    ]);
    // Only the parent link gives way: "project > workspace" keeps its text while it fits.
    const shrink = (id: string) => flat(hostByTestId(tree.root, id).props.style).flexShrink as number;
    expect(shrink("task-card-meta-parent")).toBeGreaterThanOrEqual(1000 * shrink("task-card-meta-location"));
    const separator = hostByTestId(tree.root, "task-card-meta").find(
      (node) => (node.type as unknown) === "Text" && texts(node)[0] === " › ",
    );
    expect(flat(separator.props.style).flexShrink).toBe(0);
    // Non-breaking spaces around the separator: a web text box drops a leading space.
    expect(String(separator.props.children)).toBe("\u00a0\u203a\u00a0");
    byLabel(tree.root, "定位到父任务").props.onPress();
    expect(onReveal).toHaveBeenCalledWith("sample-running");

    const orphan = { ...sample("sample-child-1"), parent: { id: "gone", title: null, missing: true, archived: true } };
    await act(async () => tree.update(cardElement(orphan, { onReveal, fields: fields("minimal") })));
    expect(texts(hostByTestId(tree.root, "task-card-meta"))).toEqual(["↳ 父任务（已归档）"]);
    // Off the board but not archived (an old done task): its title, never "archived".
    const old = { ...orphan, parent: { id: "old", title: "多设备连接", missing: true, archived: false } };
    await act(async () => tree.update(cardElement(old, { onReveal, fields: fields("minimal") })));
    expect(texts(hostByTestId(tree.root, "task-card-meta"))).toEqual(["↳ 多设备连接"]);
  });

  it("draws the failure reason in the danger colour", async () => {
    const tree = await render(cardElement(sample("sample-failed")));
    const reason = tree.root.find(
      (node) => (node.type as unknown) === "Text" && node.props.children === "Provider exited with code 1: rate limit reached",
    );
    expect(flat(reason.props.style).color).toBe("#d93636");
    expect(icons(tree.root)).toContain("CircleX");
  });

  it("draws a failure marked read in grey in the done lane, with the same mark", async () => {
    const card = { ...sample("sample-failed"), lane: "done" as const, status: "done" as const };
    const tree = await render(cardElement(card));
    const reason = tree.root.find(
      (node) => (node.type as unknown) === "Text" && node.props.children === "Provider exited with code 1: rate limit reached",
    );
    expect(flat(reason.props.style).color).toBe("#6b6b75");
    const mark = tree.root.find((node) => (node.type as unknown) === "Icon" && node.props.name === "CircleX");
    expect(mark.props.color).toBe("#6b6b75");
    expect(icons(tree.root)).not.toContain("Square");
  });

  it("draws a manual stop's reason muted, in the review and the done lane", async () => {
    for (const lane of ["review", "done"] as const) {
      const card = { ...sample("sample-done"), lane, status: lane === "review" ? ("unread" as const) : ("done" as const), error: "已手动停止", stoppedManually: true };
      const tree = await render(cardElement(card));
      const reason = tree.root.find((node) => (node.type as unknown) === "Text" && node.props.children === "已手动停止");
      expect(flat(reason.props.style).color).toBe("#6b6b75");
      // The approved stopped mark: a solid square, on the title and the reason, never Lucide's hollow one or a dot.
      expect(icons(tree.root)).not.toContain("Square");
      expect(icons(tree.root)).not.toContain("CircleX");
      expect(flat(hostByTestId(tree.root, "task-card-reason-stopped").props.style)).toMatchObject({ backgroundColor: "#6b6b75", borderRadius: 2 });
      const mark = hostByTestId(tree.root, "status-stopped");
      expect(flat((mark.children[0] as ReactTestInstance).props.style)).toMatchObject({ backgroundColor: "#6b6b75" });
      expect(tree.root.findAll((node) => typeof node.type === "string" && /^status-(unread|done)$/.test(String(node.props.testID)))).toHaveLength(0);
      await act(async () => tree.unmount());
      renderer = null;
    }
  });

  it("draws no reason on running or needs-input cards", async () => {
    const tree = await render(cardElement({ ...sample("sample-child-1"), error: "已手动停止" }));
    expect(texts(tree.root)).not.toContain("已手动停止");
  });

  it("draws the answer button in the needs-input amber with a single arrow", async () => {
    for (const theme of [LIGHT, DARK]) {
      const tokens = buildTaskTokens(theme.colors);
      const amber = tokens.status.warning;
      const card = {
        ...sample("sample-input"),
        permission: { requestId: "q", kind: "question" as const, title: "Which database?", summary: null, actions: [], remaining: 0 },
      };
      const buttons = permissionButtons(card.permission, "zh");
      // An older label with its own arrow still ends up with one.
      const withArrow = buttons.map((button) => ({ ...button, label: `${button.label} \u2197` }));
      for (const set of [buttons, withArrow]) {
        const tree = await render(cardElement(card, { theme, permissionButtons: set }));
        const answer = byLabel(tree.root, set[0]!.label);
        expect(texts(answer)).toEqual(["去回答"]);
        expect(icons(answer)).toEqual(["ArrowUpRight"]);
        // The label and arrow: the amber pulled until it reads at 4.5:1 on the tint.
        expect(answer.findByType("Icon" as never).props.color).toBe(tokens.card.answerText);
        expect(flat(answer.find((node) => (node.type as unknown) === "Text").props.style).color).toBe(tokens.card.answerText);
        const rest = flat(answer.props.style);
        expect(rest).toMatchObject({
          backgroundColor: mix(tokens.card.background, amber, tokens.isDark ? 0.18 : 0.12),
          borderColor: mix(tokens.card.background, amber, tokens.isDark ? 0.45 : 0.4),
          borderWidth: 1,
        });
        await act(async () => answer.props.onHoverIn());
        expect(flat(byLabel(tree.root, set[0]!.label).props.style).backgroundColor).toBe(
          mix(tokens.card.background, amber, (tokens.isDark ? 0.18 : 0.12) + 0.08),
        );
        await act(async () => tree.unmount());
        renderer = null;
      }
    }
  });

  it("sizes Stop and Mark read like the answer button beside them", async () => {
    const box = (style: unknown) => {
      const flatStyle = flat(style);
      return {
        height: flatStyle.height,
        radius: flatStyle.borderRadius ?? flatStyle.borderTopLeftRadius,
        padding: flatStyle.paddingHorizontal,
        gap: flatStyle.gap,
      };
    };
    const card = {
      ...sample("sample-input"),
      permission: { requestId: "q", kind: "question" as const, title: "Which database?", summary: null, actions: [], remaining: 0 },
    };
    const buttons = permissionButtons(card.permission, "zh");
    const tree = await render(cardElement(card, { permissionButtons: buttons, onStop: () => {} }));
    const answer = box(byLabel(tree.root, "去回答").props.style);
    expect(answer).toEqual({ height: 28, radius: 6, padding: 10, gap: 5 });
    expect(box(byLabel(tree.root, "停止").props.style)).toEqual(answer);
    await act(async () => tree.update(cardElement({ ...sample("sample-unread"), readable: true }, { onRead: () => {} })));
    expect(box(byLabel(tree.root, "标为已读").props.style)).toEqual(answer);
    expect(icons(byLabel(tree.root, "标为已读"))[0]).toBe("CheckCheck");
  });

  it("tints Allow with the accent and Deny with the danger colour", async () => {
    const buttons = permissionButtons(sample("sample-input").permission!, "zh");
    const tree = await render(cardElement(sample("sample-input"), { permissionButtons: buttons }));
    const tokens = buildTaskTokens(LIGHT.colors);
    expect(flat(byLabel(tree.root, "允许").props.style)).toMatchObject({ backgroundColor: tokens.card.primaryFill, borderColor: tokens.card.primaryFill });
    expect(flat(byLabel(tree.root, "拒绝").props.style)).toMatchObject({ backgroundColor: tokens.card.dangerFill, borderColor: tokens.card.dangerFill });
    expect(byLabel(tree.root, "拒绝").findAll((node) => (node.type as unknown) === "Icon").map((node) => node.props.color)).toEqual([tokens.danger]);
    expect(icons(byLabel(tree.root, "允许"))).toEqual(["Check"]);
  });

  it("on a phone, keeps the action labels on one line, sized to their text, in one row", async () => {
    const card = sample("sample-input");
    const buttons = permissionButtons(card.permission!, "en");
    const element = (stopPhase: StopPhase) =>
      cardElement(card, { compact: true, language: "en", permissionButtons: buttons, onStop: () => {}, stopPhase });
    const tree = await render(element("idle"));
    const allow = flat(byLabel(tree.root, "Allow").props.style);
    expect(allow).toMatchObject({ minHeight: 40, flexGrow: 1, flexShrink: 0, flexBasis: "auto", minWidth: PHONE_BUTTON_MIN_WIDTH });
    expect(allow.height).toBeUndefined();
    expect(allow.flex).toBeUndefined();
    const label = byLabel(tree.root, "Allow").find((node) => (node.type as unknown) === "Text");
    expect(label.props.numberOfLines).toBe(1);
    expect(flat(label.props.style).flexShrink).toBe(0);
    // No flexWrap: on Android it left a phantom second row's height under the buttons.
    expect(flat(hostByTestId(tree.root, "task-card-actions").props.style).flexWrap).toBeUndefined();
    const stop = () => flat(hostByTestId(tree.root, "task-card-stop").props.style);
    // Only the stop pill gives width back, its label shrinking its font on one line.
    expect(stop()).toMatchObject({ flexGrow: 1, flexShrink: 1, flexBasis: "auto" });
    // No `flex` beside `flexShrink`: React Native Web warns when they update together.
    expect(stop().flex).toBeUndefined();
    expect(icons(byLabel(tree.root, "Stop"))).toEqual(["Power"]);
    await act(async () => tree.update(element("confirming")));
    expect(stop()).toMatchObject({ flexGrow: 1, flexShrink: 1, flexBasis: "auto" });
    expect(stop().flex).toBeUndefined();
    const confirm = byLabel(tree.root, "Confirm stop");
    expect(flat(confirm.props.style)).toMatchObject({ minHeight: 40, paddingHorizontal: 10 });
    expect(confirm.find((node) => (node.type as unknown) === "Text").props).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.75 });
    // Armed, the pill drops its square to fit "Confirm stop" at full size.
    expect(icons(confirm)).toEqual([]);
  });

  it("lets a phone label wrap between words only with an enlarged system font", () => {
    expect(phoneButtonSizing(1)).toMatchObject({ wraps: false, lines: 1, label: { flexShrink: 0 }, box: { flexShrink: 0 }, fit: {} });
    expect(phoneButtonSizing(1, true)).toMatchObject({ wraps: false, lines: 1, box: { flexShrink: 1 }, fit: { adjustsFontSizeToFit: true } });
    expect(phoneButtonSizing(1.1).wraps).toBe(false);
    expect(phoneButtonSizing(LARGE_FONT_SCALE)).toMatchObject({ wraps: true, lines: 2, label: { flexShrink: 1 }, box: { flexShrink: 1 }, fit: {} });
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
    // The wait sits on the buttons' row, under the divider, not on a footer row above it.
    expect(rows(tree.root, "sample-input")).not.toContain("task-card-footer");
    expect(texts(hostByTestId(hostByTestId(tree.root, "task-card-permission"), "task-card-footer"))).toEqual(["等待 4m"]);
    byLabel(tree.root, "拒绝").props.onPress();
    expect(onPermission).toHaveBeenCalledWith(card, buttons[1]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("leaves out a permission summary its title already says", async () => {
    const base = sample("sample-input");
    const card: TaskCard = { ...base, permission: { ...base.permission!, title: "Run npm run db:migrate", summary: "npm run  db:migrate" } };
    const all = texts((await render(cardElement(card))).root);
    expect(all).toContain("Run npm run db:migrate");
    expect(all.some((text) => text.includes(" · npm run"))).toBe(false);
  });
});

describe("ProjectIcon", () => {
  it("hashes the view key into Paseo's identity colours", () => {
    expect(identityColor("a")).toBe("#b06260"); // 97 % 10 = 7, red
    expect(identityColor("prj_sample")).toBe("#6a70b8");
    expect(identityColor(JSON.stringify(["host-1", "prj_sample"]))).toBe("#5179b0");
    expect(identityColor("remote:github.com/RoundRedDot/better-paseo")).toBe("#3d7ea6");
    expect(projectIconRadius(12)).toBe(3);
    expect(projectIconRadius(16)).toBe(4);
    expect(projectInitial("RoundRedDot/better-paseo")).toBe("B");
    expect(projectInitial("  atlas-web ")).toBe("A");
  });

  it("keys the colour by projectKey, then [hostId, projectId], then projectId", () => {
    const location = sample("sample-running").location;
    expect(location.projectKey).toBe("remote:github.com/RoundRedDot/better-paseo");
    expect(projectViewKey(location, "host-1")).toBe("remote:github.com/RoundRedDot/better-paseo");
    const keyless = { ...location, projectKey: null };
    expect(projectViewKey(keyless, "host-1")).toBe(JSON.stringify(["host-1", "prj_sample"]));
    expect(projectViewKey(keyless)).toBe("prj_sample");
  });

  it("draws the generated square on the card, or the uploaded image unrounded", async () => {
    // The sample's projectKey wins over the host pair.
    const tree = await render(cardElement(sample("sample-running"), { hostId: "host-1" }));
    const square = hostByTestId(tree.root, "project-icon-generated");
    expect(flat(square.props.style)).toMatchObject({ width: 12, height: 12, borderRadius: 3, backgroundColor: "#3d7ea6" });
    const keyless = { ...sample("sample-running"), location: { ...sample("sample-running").location, projectKey: null } };
    await act(async () => tree.update(cardElement(keyless, { hostId: "host-1" })));
    expect(flat(hostByTestId(tree.root, "project-icon-generated").props.style).backgroundColor).toBe("#5179b0");
    const initial = square.find((node) => (node.type as unknown) === "Text");
    expect(initial.props.children).toBe("B");
    expect(flat(initial.props.style).color).toBe("#ffffff");

    const withImage = { ...sample("sample-running"), location: { ...sample("sample-running").location, projectIcon: "data:image/png;base64,AAAA" } };
    await act(async () => tree.update(cardElement(withImage)));
    const image = hostByTestId(tree.root, "project-icon-image");
    expect(image.props.source).toEqual({ uri: "data:image/png;base64,AAAA" });
    expect(flat(image.props.style).borderRadius).toBeUndefined();
  });
});

describe("TaskCardView context ring", () => {
  const withContext = (used: number, extra: Partial<TaskCard> = {}) => ({
    ...sample("sample-running"),
    context: { usedTokens: used, maxTokens: 100 },
    ...extra,
  });
  const ring = (tree: ReactTestRenderer) =>
    tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-context");
  const rotation = (node: ReactTestInstance) =>
    (flat((node.children[0] as ReactTestInstance).props.style).transform as Array<{ rotate: string }>)[0]!.rotate;

  it("uses the host's thresholds and number formats", () => {
    expect([0.69, 0.7, 0.9, 0.91].map(contextRingTone)).toEqual(["normal", "warning", "warning", "danger"]);
    expect([950, 1500, 647_000, 1_000_000, 1_499_999, 2_600_000].map(formatTokenCount)).toEqual(["950", "2k", "647k", "1m", "1m", "3m"]);
    expect(formatSessionCost(32.48)).toBe("$32.48");
    expect(formatSessionCost(0.005)).toBe("$0.0050");
    expect(formatSessionCost(0)).toBeNull();
    expect(formatSessionCost(null)).toBeNull();
  });

  it("sits at the footer's far right, after the timer, coloured by the host's thresholds", async () => {
    for (const [used, color] of [[46, "#6b6b75"], [75, "#a36a00"], [95, "#d93636"]] as const) {
      const tree = await render(cardElement(withContext(used)));
      const footer = hostByTestId(tree.root, "task-card-footer");
      const meter = hostByTestId(footer, "task-card-context");
      // The timer first, then the ring pushed to the far right.
      const hosts = (node: ReactTestInstance): ReactTestInstance[] =>
        node.children.flatMap((child) => (typeof child === "string" ? [] : typeof child.type === "string" ? [child] : hosts(child)));
      const [timerBox, ringBox] = hosts(footer);
      expect(texts(timerBox!)).toEqual([RUNNING_START, "12m 30s"]);
      expect(flat(ringBox!.props.style).marginLeft).toBe("auto");
      expect(hostByTestId(ringBox!, "task-card-context")).toBe(meter);
      const track = hostByTestId(meter, "context-ring").children[0] as ReactTestInstance;
      expect(flat(track.props.style)).toMatchObject({ width: 14, height: 14, borderWidth: 2 });
      const arc = hostByTestId(meter, "context-ring-right").children[0] as ReactTestInstance;
      expect(flat(arc.props.style)).toMatchObject({ borderColor: "transparent", borderTopColor: color, borderRightColor: color });
      await act(async () => tree.unmount());
      renderer = null;
    }
  });

  it("fills clockwise from twelve with two half rings and round caps", async () => {
    let tree = await render(cardElement(withContext(25)));
    const quarter = hostByTestId(tree.root, "context-ring");
    expect(rotation(hostByTestId(quarter, "context-ring-right"))).toBe("-45deg");
    expect(quarter.findAll((node) => typeof node.type === "string" && node.props.testID === "context-ring-left")).toHaveLength(0);
    // Track, right clip, two caps.
    expect((quarter.children as ReactTestInstance[]).length).toBe(4);
    await act(async () => tree.update(cardElement(withContext(75))));
    const three = hostByTestId(tree.root, "context-ring");
    expect(rotation(hostByTestId(three, "context-ring-right"))).toBe("45deg");
    expect(rotation(hostByTestId(three, "context-ring-left"))).toBe("135deg");
  });

  it("hides the ring from assistive tech with native props off the web and aria-hidden on it", async () => {
    const tree = await render(React.createElement(ContextRing, { ratio: 0.5, color: "#000", track: "#ccc" }));
    expect(hostByTestId(tree.root, "context-ring").props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" });
    await act(async () => tree.unmount());
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    try {
      const web = await render(React.createElement(ContextRing, { ratio: 0.5, color: "#000", track: "#ccc" }));
      const ring = hostByTestId(web.root, "context-ring");
      expect(ring.props["aria-hidden"]).toBe(true);
      expect(ring.props.accessibilityElementsHidden).toBeUndefined();
      expect(ring.props.importantForAccessibility).toBeUndefined();
      await act(async () => web.unmount());
    } finally {
      delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
    }
    renderer = null;
  });

  it("shows the host's context details above the ring on hover, desktop only", async () => {
    const tree = await render(cardElement(withContext(86, { context: { usedTokens: 647_000, maxTokens: 1_000_000 }, usage: { inputTokens: 1, cachedInputTokens: null, outputTokens: 1, totalCostUsd: 32.48 } })));
    await act(async () => hostByTestId(tree.root, "task-card-context").props.onHoverIn());
    const details = hostByTestId(tree.root, "task-card-context-details");
    expect(texts(details)).toEqual(["上下文窗口", "已使用 65%", "647k / 1m tokens", "会话费用 $32.48"]);
    expect(flat(details.props.style).position).toBe("absolute");
    expect(flat(hostByTestId(tree.root, "task-card-footer").props.style).zIndex).toBe(OVERLAY_ROW_Z + 1);
    await act(async () => hostByTestId(tree.root, "task-card-context").props.onHoverOut());
    expect(flat(hostByTestId(tree.root, "task-card-footer").props.style).zIndex).toBeUndefined();

    // No cost line without a cost; no details on a phone.
    await act(async () => tree.update(cardElement(withContext(86, { usage: null }), { compact: true })));
    await act(async () => hostByTestId(tree.root, "task-card-context").props.onHoverIn());
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-context-details")).toHaveLength(0);
  });

  it("stays bottom right without a timer", async () => {
    const tree = await render(cardElement(withContext(50), { fields: fields("standard", { timer: false }) }));
    const footer = hostByTestId(tree.root, "task-card-footer");
    expect(texts(footer)).toEqual([]);
    const ringBox = footer.find((node) => typeof node.type === "string" && flat(node.props.style).marginLeft === "auto");
    expect(hostByTestId(ringBox, "task-card-context")).toBeDefined();
  });

  it("hides when the context is unknown, off the running lane, and on a phone until 80%", async () => {
    const tree = await render(cardElement({ ...sample("sample-running"), context: null }));
    expect(ring(tree)).toHaveLength(0);
    await act(async () => tree.update(cardElement({ ...withContext(86), lane: "review" })));
    expect(ring(tree)).toHaveLength(0);
    await act(async () => tree.update(cardElement(withContext(46), { compact: true })));
    expect(ring(tree)).toHaveLength(0);
    await act(async () => tree.update(cardElement(withContext(86), { compact: true })));
    expect(ring(tree)).toHaveLength(1);
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
    expect(pills(tree.root)).toEqual([
      ["pill-model", "GPT-5.5 Codex"],
      ["pill-branch", "feat/tasks-board"],
      ["pill-label-frontend", "frontend"],
      ["pill-labels-more", "+2"],
      ["pill-subtasks", "2"],
    ]);
    // The brand stays on a phone even with the provider switched off.
    expect(flat(hostByTestId(tree.root, "pill-model").props.style)).toMatchObject({ height: 28, borderRadius: 14 });
    expect(flat(hostByTestId(tree.root, "task-card-title").props.style)).toMatchObject({ fontSize: 14 });
    expect(all).toContain("better-paseo › tasks-board");
    expect(all).toContain("12m 30s");
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

  it("shows Mark read only for a readable card with onRead, in Stop's shape, and holds it while pending", async () => {
    const onRead = vi.fn();
    const card: TaskCard = { ...sample("sample-unread"), readable: true };
    const tree = await render(cardElement(card));
    expect(texts(tree.root)).not.toContain("标为已读");

    await act(async () => tree.update(cardElement({ ...card, readable: false }, { onRead })));
    expect(texts(tree.root)).not.toContain("标为已读");

    await act(async () => tree.update(cardElement(card, { onRead })));
    const button = byLabel(tree.root, "标为已读");
    expect(icons(button)).toEqual(["CheckCheck"]);
    expect(flat(button.props.style)).toMatchObject({ height: 28, borderRadius: 6, borderWidth: 1 });
    button.props.onPress();
    expect(onRead).toHaveBeenCalledWith(card);

    await act(async () => tree.update(cardElement(card, { onRead, readPending: true })));
    const pending = byLabel(tree.root, "标记中");
    expect(pending.props.disabled).toBe(true);
    // A spinner in the icon's place, and no ellipsis after the label.
    expect(icons(pending)).toEqual([]);
    expect(pending.findAll((node) => node.props.testID === "task-card-read-spinner").length).toBeGreaterThan(0);
    expect(texts(pending)).toEqual(["标记中"]);
    expect(flat(pending.props.style)).toMatchObject({ opacity: 0.6 });
    await act(async () => tree.unmount());
    renderer = null;

    // A phone puts it in the action bar, at Stop's touch size.
    const phone = await render(cardElement(card, { onRead, compact: true }));
    const bar = phone.root.find((node) => node.props.testID === "task-card-actions");
    expect(texts(bar)).toEqual(["标为已读"]);
    expect(flat(byLabel(bar, "标为已读").props.style)).toMatchObject({ minHeight: 40, borderRadius: 8 });
  });

  it("draws Stop like the details sidebar's: a rounded rectangle led by Lucide's Power", async () => {
    const tokens = buildTaskTokens(LIGHT.colors);
    const square = (root: ReactTestInstance, label: string) =>
      byLabel(root, label).find((node) => (node.type as unknown) === "Icon" && node.props.name === "Power").props;
    const tree = await render(cardElement(sample("sample-running"), { onStop: () => {} }));
    expect(square(tree.root, "停止")).toMatchObject({ size: 13, color: tokens.danger });
    expect(flat(byLabel(tree.root, "停止").props.style)).toMatchObject({ height: 28, borderTopLeftRadius: 6, borderBottomLeftRadius: 6 });
    await act(async () => tree.update(cardElement(sample("sample-running"), { onStop: () => {}, stopPhase: "confirming" })));
    expect(square(tree.root, "确认停止").color).toBe(LIGHT.colors.accentForeground);
    // The parent's menu leads "stop only this" with the same icon.
    await act(async () => byLabel(tree.root, "停止选项").props.onPress());
    const [only] = tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem");
    expect(texts(only!)).toEqual(["仅停止此任务"]);
    expect(icons(only!)).toEqual(["Power"]);
    await act(async () => tree.unmount());
    renderer = null;

    const phone = await render(cardElement(sample("sample-child-1"), { onStop: () => {}, compact: true }));
    expect(square(phone.root, "停止")).toMatchObject({ size: 16, color: tokens.danger });
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
    const list = hostByTestId(tree.root, "task-card-subtasks");
    // Each row: the agent's mark on the left, aligned with the title's first line, its status on the
    // corner while it runs; no state words.
    for (const child of sample("sample-running").children) {
      const slot = hostByTestId(list, `subtask-status-${child.id}`);
      expect(slot.props.style).toMatchObject({ height: 16 });
      expect(slot.findAll((node) => typeof node.type === "string" && node.props.testID === "status-running")).toHaveLength(child.status === "running" ? 1 : 0);
    }
    // A running child's start and timer at the end, as the footer; a finished one's last turn and when.
    expect(texts(hostByTestId(list, "subtask-time-sample-child-1"))).toEqual([`${formatClockTime(NOW - 3 * 60_000, NOW)} · 3m`]);
    expect(texts(hostByTestId(list, "subtask-time-sample-child-2"))).toEqual([`${formatClockTime(NOW - 312_000, NOW)} · 5m 12s`]);
    expect(texts(list).filter((text) => !text.includes(" · "))).toEqual(["Measure the sidebar ring", "Write the ring geometry test", "Collect status colours"]);
    for (const word of ["运行中", "已完成", "待输入"]) expect(texts(list)).not.toContain(word);
  });

  it("counts subtasks by status icon in the pill, without words", async () => {
    const tree = await render(cardElement(sample("sample-running")));
    const pill = hostByTestId(tree.root, "pill-subtasks");
    expect(icons(pill)[0]).toBe("ListTree");
    const groups = pill.findAll((node) => typeof node.type === "string" && String(node.props.testID ?? "").startsWith("subtask-count-"));
    expect(groups.map((group) => [group.props.testID, texts(group)])).toEqual([
      ["subtask-count-running", ["2"]],
      ["subtask-count-done", ["1"]],
    ]);
    expect(hostByTestId(groups[0]!, "status-running")).toBeDefined();
    expect(hostByTestId(groups[1]!, "status-done")).toBeDefined();
    expect(pill.props.accessibilityLabel).toBe("3 个子任务：2 运行中 · 1 已完成");
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

  it("leaves a tick of the board's clock to the timer text", async () => {
    let time = NOW;
    const clock = createTaskClock(() => time);
    const running = sample("sample-running");
    const props: TaskCardViewProps = { ...base(running, NOW), now: undefined, clock, language: "en" };
    // Same props across ticks: the memo never lets a tick through to the card.
    expect(sameCardProps(props, { ...props })).toBe(true);
    const tree = await render(React.createElement(TaskCardView, props));
    expect(texts(tree.root)).toContain("12m 30s");
    time = NOW + 1000;
    act(() => clock.tick());
    expect(texts(tree.root)).toContain("12m 31s");
    expect(texts(tree.root)).not.toContain("12m 30s");
  });
});

describe("useTime", () => {
  it("re-renders a reader only when what it selects changes", async () => {
    let time = NOW;
    const clock = createTaskClock(() => time);
    const seen: string[] = [];
    function Minutes() {
      const minutes = useTime({ clock }, (now) => String(Math.floor(now / 60_000)));
      seen.push(minutes);
      return null;
    }
    await render(React.createElement(Minutes));
    for (let step = 1; step <= 59; step += 1) {
      time = NOW + step * 1000;
      act(() => clock.tick());
    }
    expect(seen).toHaveLength(1);
    time = NOW + 60_000;
    act(() => clock.tick());
    expect(seen).toHaveLength(2);
  });

  it("holds a fixed instant, and the mount time without a clock", async () => {
    const seen: number[] = [];
    function Probe(props: { now?: number }) {
      seen.push(useTime(props, (now) => now));
      return null;
    }
    await render(React.createElement(Probe, { now: NOW }));
    expect(seen.at(-1)).toBe(NOW);
    await act(async () => renderer!.update(React.createElement(Probe, {})));
    const mounted = seen.at(-1)!;
    expect(Math.abs(mounted - Date.now())).toBeLessThan(1000);
  });
});

describe("TaskDetailCards", () => {
  beforeEach(() => {
    clipboard.copyText.mockClear();
    clipboard.show.mockClear();
    resetSectionChoices();
  });

  const details = (card: TaskCard, more: Record<string, unknown> = {}, language: "zh" | "en" = "zh") =>
    React.createElement(TaskDetailCards, { card, theme: LIGHT, now: NOW, language, strings: BOARD_STRINGS[language].sidebar, ...more });

  it("ticks the header's turn clock each second with the board's clock", async () => {
    let time = NOW;
    const clock = createTaskClock(() => time);
    const tree = await render(details(sample("sample-running"), { now: undefined, clock }));
    expect(texts(hostByTestId(tree.root, "detail-header"))).toContain("本轮 12:30");
    expect(texts(hostByTestId(tree.root, "detail-turn"))).toContain("12:30");
    time = NOW + 1000;
    act(() => clock.tick());
    expect(texts(hostByTestId(tree.root, "detail-header"))).toContain("本轮 12:31");
    expect(texts(hostByTestId(tree.root, "detail-turn"))).toContain("12:31");
  });

  it("shows a scrollbar on the scrolling sections that keeps clear of the text", async () => {
    const sectionPad = (root: ReactTestInstance) => {
      const section = hostByTestId(root, "detail-usage");
      const [divider, body] = section.children as ReactTestInstance[];
      return { divider: flat(divider!.props.style), body: flat(body!.props.style) };
    };
    const native = await render(details(sample("sample-done"), { scrollBody: true }));
    expect(hostByTestId(native.root, "detail-body-scroll").props.showsVerticalScrollIndicator).toBe(true);
    expect(sectionPad(native.root)).toMatchObject({ divider: { marginLeft: 12, marginRight: 12 }, body: { paddingLeft: 6, paddingRight: 6 } });
    await act(async () => native.unmount());
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    try {
      const web = await render(details(sample("sample-done"), { scrollBody: true }));
      const scroll = hostByTestId(web.root, "detail-body-scroll");
      expect(scroll.props).toMatchObject({ showsVerticalScrollIndicator: true, dataSet: { bcdetails: "inset" } });
      // The scrollbar's 6 gutter comes out of the right padding: the text keeps the header's edge.
      expect(sectionPad(web.root)).toMatchObject({ divider: { marginLeft: 12, marginRight: 6 }, body: { paddingLeft: 6, paddingRight: 0 } });
      expect(flat(hostByTestId(web.root, "detail-header").props.style)).toMatchObject({ paddingLeft: 12, paddingRight: 12 });
      await act(async () => web.unmount());
    } finally {
      delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
    }
    renderer = null;
  });

  it("heads with the status, the title, the agent's chips and the actions, then the running turn", async () => {
    const onOpen = vi.fn();
    const tree = await render(details(sample("sample-running"), { onOpen }));
    const header = hostByTestId(tree.root, "detail-header");
    expect(texts(header).slice(0, 11)).toEqual(["运行中", "本轮 12:30", "Port the status ring to React Native", "GPT-5.5 Codex", "Medium", "Bypass", "frontend", "p1", "board", "切换到 tab", "已打开"]);
    // The turn's block: its clock and the context ring (86% is past the warning line).
    expect(texts(hostByTestId(tree.root, "detail-turn"))).toEqual(["本轮计时", "12:30", "上一轮 18m", "上下文", "86%", "172k / 200k"]);
    expect(hostByTestId(tree.root, "detail-turn").findAll((node) => (node.type as { name?: string }).name === "ProgressRing")).toHaveLength(1);
    // Its tab is open somewhere: the button switches to it.
    byLabel(tree.root, "切换到 tab").props.onPress();
    expect(onOpen).toHaveBeenCalledWith("sample-running");
    // One raised card holds the header and the sections: radius 12, a hairline, the card's shadow.
    expect(flat(hostByTestId(tree.root, "detail-cards").props.style)).toMatchObject({ borderRadius: 12, borderWidth: 1, boxShadow: taskTokens(LIGHT).card.shadow });
    expect(flat(header.props.style).borderWidth).toBeUndefined();
    // Bypassing permissions wears the warning colour.
    const modeIconNode = hostByTestId(header, "detail-mode").findAll((node) => node.props.name === "ShieldOff")[0]!;
    expect(modeIconNode.props.color).toBe(taskTokens(LIGHT).warning);
  });

  it("orders the sections by state: subtasks first while running, properties first while asking", async () => {
    const order = (root: ReactTestInstance) =>
      root.findAll((node) => typeof node.type === "string" && ["detail-location", "detail-subtasks", "detail-usage", "detail-activity"].includes(node.props.testID)).map((node) => node.props.testID);
    const running = await render(details(sample("sample-running")));
    expect(order(running.root)).toEqual(["detail-subtasks", "detail-location", "detail-usage", "detail-activity"]);
    await act(async () => running.unmount());
    renderer = null;
    const asking = await render(details(sample("sample-input"), { onPermission: vi.fn(), permissionButtons: permissionButtons(sample("sample-input").permission!, "zh") }));
    expect(order(asking.root)).toEqual(["detail-location", "detail-usage", "detail-activity"]);
    // Usage starts closed while a card asks: its heading and summary only.
    expect(texts(hostByTestId(asking.root, "detail-usage"))).toEqual(["用量", "$1.84 · 46%"]);
    expect(byLabel(asking.root, "展开用量").props.accessibilityState).toEqual({ expanded: false });
    // Opening it is remembered for every card.
    await act(async () => byLabel(asking.root, "展开用量").props.onPress());
    expect(texts(hostByTestId(asking.root, "detail-usage"))).toContain("Token 构成");
    await act(async () => byLabel(asking.root, "收起用量").props.onPress());
  });

  it("lists the place, then copyable branch and directory, an openable PR, each state in a note line", async () => {
    opened.openLink.mockClear();
    const tree = await render(details(sample("sample-running")));
    const location = hostByTestId(tree.root, "detail-location");
    expect(texts(location).slice(0, 2)).toEqual(["属性", "feat/tasks-board"]);
    // No label column at the default width; the workspace and its kind are the note line.
    expect(texts(hostByTestId(location, "detail-place"))).toEqual(["B", "better-paseo", "tasks-board · worktree"]);
    expect(texts(hostByTestId(location, "detail-branch"))).toEqual(["feat/tasks-board", "↑3 ↓0 · ● 未提交改动"]);
    // A branch wraps after "/" and "-"; the directory is whole while it fits two lines.
    expect(hostByTestId(location, "detail-branch-value").props.children[1]).toBe("feat/\u200btasks-\u200bboard");
    expect(hostByTestId(location, "detail-branch-value").props.numberOfLines).toBe(3);
    expect(texts(hostByTestId(location, "detail-cwd")).join("")).toBe("~/code/better-paseo/.worktrees/tasks-board");
    expect(texts(hostByTestId(location, "detail-pr"))).toEqual(["#42\u2002feat: Tasks board"]);

    for (const [testID, text] of [["detail-branch", "feat/tasks-board"], ["detail-cwd", "/Users/dev/code/better-paseo/.worktrees/tasks-board"]] as const) {
      const row = hostByTestId(tree.root, testID);
      expect(row.props.accessibilityRole).toBe("button");
      await act(async () => row.props.onPress());
      expect(clipboard.copyText).toHaveBeenLastCalledWith(text);
    }
    expect(clipboard.copyText).toHaveBeenCalledTimes(2);
    // The host's toast confirms a copy; the row keeps its note line.
    expect(clipboard.show).toHaveBeenCalled();
    expect(texts(hostByTestId(location, "detail-cwd")).join("")).toBe("~/code/better-paseo/.worktrees/tasks-board");
    // A press on the PR opens it.
    await act(async () => hostByTestId(tree.root, "detail-pr").props.onPress());
    expect(opened.openLink).toHaveBeenCalledWith("https://github.com/RoundRedDot/better-paseo/pull/42");
    // The place row only informs.
    expect(hostByTestId(location, "detail-place").props.onPress).toBeUndefined();
  });

  it("offers Unarchive for an archived parent where the host can, else says it cannot open", async () => {
    const orphan = { ...sample("sample-child-1"), parent: { id: "gone", title: "多设备连接", missing: true, archived: true } };
    const plain = await render(details(orphan, { onJump: vi.fn() }));
    expect(texts(hostByTestId(plain.root, "detail-parent"))).toEqual(["多设备连接", "已归档 · 无法跳转"]);
    expect(plain.root.findAll((node) => node.props.testID === "detail-parent-unarchive")).toHaveLength(0);
    await act(async () => plain.unmount());
    renderer = null;

    const unarchive = { pending: vi.fn(() => false), press: vi.fn() };
    const tree = await render(details(orphan, { onJump: vi.fn(), unarchive }));
    expect(texts(hostByTestId(tree.root, "detail-parent"))).toEqual(["多设备连接", "已归档", "取消归档"]);
    // The card's Allow look: the accent tint and its icon.
    const card = taskTokens(LIGHT).card;
    expect(flat(hostByTestId(tree.root, "detail-parent-unarchive").props.style)).toMatchObject({ backgroundColor: card.primaryFill, borderColor: card.primaryFill, borderRadius: 6 });
    expect(icons(hostByTestId(tree.root, "detail-parent"))).toContain("ArchiveRestore");
    // The row itself still does nothing: only the button acts.
    expect(hostByTestId(tree.root, "detail-parent").props.onPress).toBeUndefined();
    await act(async () => hostByTestId(tree.root, "detail-parent-unarchive").props.onPress());
    expect(unarchive.press).toHaveBeenCalledWith("gone");

    unarchive.pending.mockReturnValue(true);
    await act(async () => tree.update(details(orphan, { onJump: vi.fn(), unarchive: { ...unarchive } })));
    const button = hostByTestId(tree.root, "detail-parent-unarchive");
    // Working: the same label, a spinner where the icon was, no second press.
    expect(texts(button)).toEqual(["取消归档"]);
    expect(button.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(icons(button)).not.toContain("ArchiveRestore");
    expect(hostByTestId(tree.root, "detail-parent-unarchive-spinner")).toBeTruthy();

    // Back on the board: the row jumps and offers nothing more.
    const onJump = vi.fn();
    await act(async () => tree.update(details({ ...orphan, parent: { id: "gone", title: "多设备连接", missing: false, archived: false } }, { onJump, unarchive })));
    expect(tree.root.findAll((node) => node.props.testID === "detail-parent-unarchive")).toHaveLength(0);
    await act(async () => hostByTestId(tree.root, "detail-parent").props.onPress());
    expect(onJump).toHaveBeenCalledWith("gone");
  });

  it("opens a parent that is only off the board, and says nothing until it is known to be archived", async () => {
    const unarchive = { pending: vi.fn(() => false), press: vi.fn() };
    const onOpen = vi.fn();
    const onJump = vi.fn();
    // Read, not archived: a done task older than the board's window.
    const old = { ...sample("sample-child-1"), parent: { id: "old", title: "多设备连接", missing: true, archived: false } };
    const tree = await render(details(old, { onJump, onOpen, unarchive }));
    expect(texts(hostByTestId(tree.root, "detail-parent"))).toEqual(["多设备连接", "不在看板上"]);
    expect(tree.root.findAll((node) => node.props.testID === "detail-parent-unarchive")).toHaveLength(0);
    await act(async () => hostByTestId(tree.root, "detail-parent").props.onPress());
    expect(onOpen).toHaveBeenCalledWith("old");
    expect(onJump).not.toHaveBeenCalled();

    // Not read yet: neither archived nor an Unarchive button.
    await act(async () => tree.update(details({ ...old, parent: { ...old.parent, archived: null } }, { onJump, onOpen, unarchive })));
    expect(texts(hostByTestId(tree.root, "detail-parent"))).toEqual(["多设备连接"]);
    expect(tree.root.findAll((node) => node.props.testID === "detail-parent-unarchive")).toHaveLength(0);
  });

  it("adds the label column from 448 wide and drops it under 440", async () => {
    const tree = await render(details(sample("sample-running")));
    const properties = hostByTestId(tree.root, "detail-properties");
    const layout = (width: number) => act(async () => properties.props.onLayout({ nativeEvent: { layout: { width, height: 200 } } }));
    const labelled = () => texts(hostByTestId(tree.root, "detail-cwd"))[0] === "工作目录";
    expect(labelled()).toBe(false);
    await layout(520);
    expect(labelled()).toBe(true);
    // Inside the 8 between, the column stays as it was.
    await layout(444);
    expect(labelled()).toBe(true);
    await layout(436);
    expect(labelled()).toBe(false);
    await layout(444);
    expect(labelled()).toBe(false);
  });

  it("charts the usage: the token mix with Codex's cached input split out, the cost and the last turn", async () => {
    const tree = await render(details(sample("sample-running")));
    const usage = hostByTestId(tree.root, "detail-usage");
    // Running: the context is in the turn's block, not repeated here.
    expect(usage.findAll((node) => node.props.testID === "detail-context-bar")).toEqual([]);
    expect(texts(hostByTestId(usage, "detail-tokens"))).toEqual(["Token 构成", "196k", "缓存输入", "120k", "新输入", "62k", "输出", "14k"]);
    expect(texts(hostByTestId(usage, "detail-usage-cost"))).toEqual(["累计费用", "$1.84"]);
    expect(texts(hostByTestId(usage, "detail-usage-turn"))).toEqual(["上一轮耗时", "18m"]);
    // A segment grows with its count.
    expect(flat(hostByTestId(usage, "detail-tokens-cached").props.style).flexGrow).toBe(120_000);
  });

  it("draws the activity as a timeline, the live span in the status colour", async () => {
    const tree = await render(details(sample("sample-running")));
    const activity = hostByTestId(tree.root, "detail-activity");
    expect(texts(activity).slice(0, 2)).toEqual(["活动", "1 小时前创建"]);
    expect(texts(hostByTestId(activity, "detail-timeline-created"))).toEqual(["创建", "1 小时前"]);
    expect(texts(hostByTestId(activity, "detail-timeline-message"))).toEqual(["最后消息", "20 分钟前"]);
    expect(texts(hostByTestId(activity, "detail-timeline-turn"))).toEqual(["本轮开始", "12 分钟前"]);
    expect(texts(hostByTestId(activity, "detail-timeline-now"))).toEqual(["现在", "进行中"]);
  });

  it("says nothing beside a clean, level branch", async () => {
    const base = sample("sample-running");
    const card = { ...base, location: { ...base.location, git: { dirty: false, ahead: 0, behind: 0 } } };
    const tree = await render(details(card));
    expect(texts(hostByTestId(tree.root, "detail-branch"))).toEqual(["feat/tasks-board"]);
    expect(branchHint({ dirty: false, ahead: 0, behind: 0 })).toEqual({ sync: null, dirty: false });
    expect(branchHint({ dirty: true, ahead: null, behind: 2 })).toEqual({ sync: { ahead: 0, behind: 2 }, dirty: true });
    expect(branchHint(null)).toEqual({ sync: null, dirty: false });
  });

  it("draws the branch in the text colour and its ahead count green, behind orange, a zero muted", async () => {
    const base = sample("sample-running");
    const card = { ...base, location: { ...base.location, git: { dirty: false, ahead: 1768, behind: 0 } } };
    const tree = await render(details(card));
    const tokens = taskTokens(LIGHT);
    const row = hostByTestId(tree.root, "detail-branch");
    expect(flat(hostByTestId(row, "detail-branch-value").props.style).color).toBe(tokens.foreground);
    const textOf = (node: ReactTestInstance | string): string => (typeof node === "string" ? node : node.children.map((child) => textOf(child as ReactTestInstance | string)).join(""));
    const colorOf = (root: ReactTestInstance, text: string) => {
      const node = root.find((each) => (each.type as unknown) === "Text" && textOf(each) === text);
      return flat(node.props.style).color;
    };
    expect(colorOf(row, "↑1768")).toBe(tokens.success);
    expect(colorOf(row, "↑1768 ↓0")).toBe(tokens.foregroundMuted);
    const behind = { ...base, location: { ...base.location, git: { dirty: false, ahead: 0, behind: 2 } } };
    const behindRow = hostByTestId((await render(details(behind))).root, "detail-branch");
    expect(colorOf(behindRow, " ↓2")).toBe(tokens.warning);
    expect(colorOf(behindRow, "↑0 ↓2")).toBe(tokens.foregroundMuted);
  });

  it("says a directory is not a git checkout, sums up a finished card, and has no open button without onOpen", async () => {
    const tree = await render(details(sample("sample-done"), {}, "en"));
    expect(texts(hostByTestId(tree.root, "detail-branch"))).toEqual(["Not a git directory"]);
    expect(hostByTestId(tree.root, "detail-branch").props.onPress).toBeUndefined();
    expect(texts(hostByTestId(tree.root, "detail-place"))).toEqual(["B", "better-paseo", "tasks-board · directory"]);
    expect(tree.root.findAll((node) => node.props.testID === "detail-open")).toEqual([]);
    expect(texts(hostByTestId(tree.root, "detail-summary"))).toEqual(["Last turn", "18m", "Ended 2m ago", "Cost", "$1.84", "Total", "Token", "316k", "38% cached"]);
  });

  it("lists the subtasks most urgent first, each with its status, time and meta line, a press showing one", async () => {
    const onJump = vi.fn();
    const onOpen = vi.fn();
    const running = await render(details(sample("sample-running"), { onJump, onOpen }));
    const section = hostByTestId(running.root, "detail-subtasks");
    const start = (ms: number) => formatClockTime(NOW - ms, NOW);
    expect(texts(section)).toEqual([
      "子任务",
      "2 运行中 · 1/3 完成",
      // The longest run first; the meta wraps between its parts, never inside one.
      "Write the ring geometry test",
      "5m 12s",
      `${start(312_000)} 开始`,
      "Measure the sidebar ring",
      "3m",
      `${start(3 * 60_000)} 开始 ·`,
      "上下文 60%",
      "Collect status colours",
      "2 分钟前",
      "上一轮 18m",
      // Only one child names its model, and it is not the parent's GPT-5.5 Codex.
      "均为 Opus 4.7 · High · Bypass",
    ]);
    // The running count is in the status colour, the rest muted.
    const summary = hostByTestId(running.root, "detail-subtasks").findAll((node) => (node.type as unknown) === "Text" && node.props.children === 2);
    expect(flat(summary[0]!.props.style).color).toBe(taskTokens(LIGHT).status.running);
    // The agent's mark leads each row, its status on the corner while it runs and none once done;
    // a running timer is in the foreground colour, a finished row's title muted.
    const tokens = taskTokens(LIGHT);
    expect(hostByTestId(section, "detail-subtask-status-sample-child-2").findAll((node) => node.props.testID === "status-running").length).toBeGreaterThan(0);
    expect(hostByTestId(section, "detail-subtask-status-sample-child-3").findAll((node) => typeof node.props.testID === "string" && node.props.testID.startsWith("status-"))).toEqual([]);
    expect(flat(hostByTestId(section, "detail-subtask-time-sample-child-2").props.style).color).toBe(tokens.foreground);
    expect(flat(hostByTestId(section, "detail-subtask-time-sample-child-3").props.style).color).toBe(tokens.foregroundMuted);
    const doneTitle = hostByTestId(section, "detail-subtask-sample-child-3").find((node) => (node.type as unknown) === "Text" && node.props.numberOfLines === 2);
    expect(flat(doneTitle.props.style).color).toBe(tokens.foregroundMuted);
    // No progress ring any more: the counts say it.
    expect(byLabel(running.root, "收起子任务").findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "progressbar")).toEqual([]);
    byLabel(running.root, "Measure the sidebar ring 运行中").props.onPress();
    expect(onJump).toHaveBeenCalledWith("sample-child-1");
    // Hovering a row shows its open-tab button after the time.
    const row = hostByTestId(section, "detail-subtask-sample-child-1");
    expect(section.findAll((node) => node.props.testID === "detail-subtask-open")).toEqual([]);
    await act(async () => row.props.onHoverIn());
    await act(async () => hostByTestId(running.root, "detail-subtask-open").props.onPress());
    expect(onOpen).toHaveBeenCalledWith("sample-child-1");

    const allDone = sample("sample-running");
    // A finished child still unread (the green dot) counts as done.
    const finished = await render(details({ ...allDone, children: allDone.children.map((child, index) => ({ ...child, status: index === 0 ? ("unread" as const) : ("done" as const), lane: "done" as const })) }));
    expect(texts(hostByTestId(finished.root, "detail-subtasks"))).toContain("3 个全部完成");
    expect(icons(byLabel(finished.root, "收起子任务"))).toContain("CircleCheck");
    // All finished: no title steps back.
    const title = hostByTestId(finished.root, "detail-subtask-sample-child-3").find((node) => (node.type as unknown) === "Text" && node.props.numberOfLines === 2);
    expect(flat(title.props.style).color).toBe(tokens.foreground);
  });

  it("lists the first ten subtasks after sorting and opens the rest on demand, closed again on the next card", async () => {
    const base = sample("sample-running");
    const many = (id: string): TaskCard => ({
      ...base,
      id,
      children: Array.from({ length: 14 }, (_, index) => ({ ...base.children[2]!, id: `${id}-child-${index}`, title: `Child ${index}`, status: index === 12 ? ("needs_input" as const) : ("done" as const) })),
    });
    const titles = (tree: ReactTestRenderer) => texts(hostByTestId(tree.root, "detail-subtasks")).filter((text) => text.startsWith("Child "));
    const tree = await render(details(many("many-a")));
    // The one asking for input moves to the top; the four hidden are all done.
    expect(titles(tree)).toEqual(["Child 12", ...Array.from({ length: 9 }, (_, index) => `Child ${index}`)]);
    expect(texts(hostByTestId(tree.root, "detail-subtasks-more"))).toEqual(["显示全部 14 个", "其余 4 个已完成"]);
    await act(async () => byLabel(tree.root, "显示全部 14 个 其余 4 个已完成").props.onPress());
    expect(titles(tree)).toHaveLength(14);
    await act(async () => byLabel(tree.root, "收起").props.onPress());
    expect(titles(tree)).toHaveLength(10);
    await act(async () => byLabel(tree.root, "显示全部 14 个 其余 4 个已完成").props.onPress());
    await act(async () => tree.update(details(many("many-b"))));
    expect(titles(tree)).toHaveLength(10);
  });

  it("merges a failed provider subagent's status into its agent's mark, off its own line", async () => {
    const base = sample("sample-done");
    const subagent: TaskChild = { id: "sub-1", title: "RRD-10161 desktop native fatal", status: "failed", kind: "provider", subtitle: "general-purpose · Opus 5.5 · High · 189.7k tokens", provider: "claude", lane: "review", timing: sample("sample-running").children[2]!.timing };
    const tree = await render(details({ ...base, children: [subagent] }));
    const meta = hostByTestId(tree.root, "detail-subtask-meta-sub-1");
    expect(texts(meta)[0]).toBe("general-purpose · Opus 5.5 · High · 189.7k tokens ·");
    expect(meta.findAll((node) => (node.type as { name?: string }).name === "BrandMark")).toHaveLength(0);
    const mark = hostByTestId(tree.root, "detail-subtask-status-sub-1");
    expect(mark.findAll((node) => (node.type as { name?: string }).name === "BrandMark")).toHaveLength(1);
    expect(mark.findAll((node) => typeof node.type === "string" && node.props.testID === "status-failed")).toHaveLength(1);
  });

  it("drops the running count, the start and a low context share in a narrow card", async () => {
    const tree = await render(details(sample("sample-running")));
    const section = hostByTestId(tree.root, "detail-subtasks");
    await act(async () => section.props.onLayout({ nativeEvent: { layout: { width: 320, height: 400 } } }));
    const shown = texts(hostByTestId(tree.root, "detail-subtasks"));
    expect(shown[1]).toBe("1/3 完成");
    expect(shown.filter((text) => text.includes("开始") || text.includes("上下文 60%"))).toEqual([]);
  });

  it("shows the first prompt in full under four lines, copyable, and waits for Load on a closed agent", async () => {
    const text = ["Check whether this issue is handled:", "", "1. The board", "2. The sidebar", "3. The sheet", "4. The phone"].join("\n");
    const load = vi.fn();
    const tree = await render(details(sample("sample-failed"), { firstPrompt: { prompt: { state: "ready", text }, load } }, "en"));
    const sections = tree.root.findAll((node) => typeof node.type === "string" && ["detail-prompt", "detail-location", "detail-activity", "detail-usage"].includes(node.props.testID));
    expect(sections.map((node) => node.props.testID)).toEqual(["detail-prompt", "detail-location", "detail-activity", "detail-usage"]);
    const body = hostByTestId(tree.root, "detail-prompt-text");
    expect(body.props.numberOfLines).toBe(4);
    expect(texts(hostByTestId(tree.root, "detail-prompt"))).toEqual(["First prompt", text, "Show all · 6 lines"]);
    await act(async () => hostByTestId(tree.root, "detail-prompt-more").props.onPress());
    expect(hostByTestId(tree.root, "detail-prompt-text").props.numberOfLines).toBeUndefined();
    await act(async () => byLabel(tree.root, "Copy prompt").props.onPress());
    expect(clipboard.copyText).toHaveBeenLastCalledWith(text);

    await act(async () => tree.update(details(sample("sample-failed"), { firstPrompt: { prompt: { state: "idle" }, load } }, "en")));
    expect(texts(hostByTestId(tree.root, "detail-prompt"))).toEqual(["First prompt", "Load"]);
    await act(async () => hostByTestId(tree.root, "detail-prompt-load").props.onPress());
    expect(load).toHaveBeenCalledTimes(1);

    // The settings preview passes no prompt: no section.
    await act(async () => tree.update(details(sample("sample-failed"), {}, "en")));
    expect(tree.root.findAll((node) => node.props.testID === "detail-prompt")).toHaveLength(0);
  });

  it("shows the latest reply under the first prompt, copyable, with its own empty note", async () => {
    const load = vi.fn();
    const firstPrompt = { prompt: { state: "ready", text: "Fix the board" } as const, load };
    const tree = await render(details(sample("sample-failed"), { firstPrompt, lastMessage: { prompt: { state: "ready", text: "Four subagents failed." }, load } }, "en"));
    const sections = tree.root.findAll((node) => typeof node.type === "string" && ["detail-prompt", "detail-message", "detail-location"].includes(node.props.testID));
    expect(sections.map((node) => node.props.testID)).toEqual(["detail-prompt", "detail-message", "detail-location"]);
    expect(texts(hostByTestId(tree.root, "detail-message"))).toEqual(["Latest message", "Four subagents failed."]);
    await act(async () => byLabel(tree.root, "Copy message").props.onPress());
    expect(clipboard.copyText).toHaveBeenLastCalledWith("Four subagents failed.");

    await act(async () => tree.update(details(sample("sample-failed"), { firstPrompt, lastMessage: { prompt: { state: "none" }, load } }, "zh")));
    expect(texts(hostByTestId(tree.root, "detail-message"))).toEqual(["最近一条消息", "agent 还没有回复"]);
  });

  it("leads with the error when a card failed, and with a grey line after a manual stop", async () => {
    const failed = await render(details(sample("sample-failed"), {}, "en"));
    expect(texts(hostByTestId(failed.root, "detail-error"))).toEqual(["Run failed", "Provider exited with code 1: rate limit reached"]);
    expect(icons(hostByTestId(failed.root, "detail-error"))).toEqual(["CircleAlert", "Copy"]);
    await act(async () => byLabel(failed.root, "Copy error").props.onPress());
    expect(clipboard.copyText).toHaveBeenLastCalledWith("Provider exited with code 1: rate limit reached");
    await act(async () => failed.unmount());
    renderer = null;
    const stopped = previewSampleCards(NOW).find((card) => card.id === "sample-stopped")!;
    const tree = await render(details(stopped, {}, "en"));
    expect(texts(hostByTestId(tree.root, "detail-error"))).toEqual(["Stopped manually"]);
    expect(icons(hostByTestId(tree.root, "detail-error"))).toEqual(["OctagonX"]);
  });

  it("leads with the permission request and its buttons while a card asks", async () => {
    const onPermission = vi.fn();
    const card = sample("sample-input");
    const tree = await render(details(card, { onPermission, permissionButtons: permissionButtons(card.permission!, "zh") }));
    expect(texts(hostByTestId(tree.root, "detail-permission"))).toEqual(["Bash", "还有 1 个请求", "npm run db:migrate -- --env staging", "允许", "拒绝", "4m"]);
    await act(async () => byLabel(tree.root, "允许").props.onPress());
    expect(onPermission).toHaveBeenCalledWith(expect.objectContaining({ kind: "respond" }));
    // The phone's bar carries them instead.
    await act(async () => tree.update(details(card, { onPermission, permissionButtons: permissionButtons(card.permission!, "zh"), actions: false })));
    expect(hostByTestId(tree.root, "detail-permission").findAll((node) => node.props.testID === "detail-permission-buttons")).toEqual([]);
  });

  it("puts the phone's actions in a bar: open and stop while running, allow first while asking", async () => {
    const strings = BOARD_STRINGS.zh.sidebar;
    const bar = (card: TaskCard, more: Record<string, unknown> = {}) =>
      React.createElement(DetailActionBar, { card, theme: LIGHT, language: "zh", strings, onOpen: vi.fn(), ...more });
    const running = await render(bar(sample("sample-running"), { stop: { phase: "idle", onPress: vi.fn() } }));
    expect(texts(hostByTestId(running.root, "detail-action-bar"))).toEqual(["切换到 tab", "停止"]);
    await act(async () => running.unmount());
    renderer = null;
    const card = sample("sample-input");
    const asking = await render(bar(card, { onPermission: vi.fn(), permissionButtons: permissionButtons(card.permission!, "zh") }));
    const labels = asking.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button").map((node) => node.props.accessibilityLabel);
    // The tab shrinks to a square; deny, then allow under the thumb.
    expect(labels).toEqual(["打开 tab 处理", "拒绝", "允许"]);
  });

  it("names the stop button by its phase", async () => {
    const onPress = vi.fn();
    const tree = await render(details(sample("sample-running"), { stop: { phase: "idle", onPress } }));
    expect(texts(hostByTestId(tree.root, "detail-stop"))).toEqual(["停止"]);
    hostByTestId(tree.root, "detail-stop").props.onPress();
    expect(onPress).toHaveBeenCalled();
    await act(async () => tree.update(details(sample("sample-running"), { stop: { phase: "confirming", onPress } })));
    expect(texts(hostByTestId(tree.root, "detail-stop"))).toEqual(["确认停止"]);
  });

  it("paints the stop button in the danger colour, tinted at rest and solid to confirm", async () => {
    const tokens = taskTokens(LIGHT);
    const look = (root: ReactTestInstance, id: string) => {
      const button = hostByTestId(root, id);
      const label = button.findAll((node) => typeof node.type === "string" && typeof node.props.children === "string")[0]!;
      return { ...pick(flat(button.props.style)), text: flat(label.props.style).color };
    };
    const pick = (style: Record<string, unknown>) => ({ fill: style.backgroundColor, border: style.borderColor });
    const tint = { fill: tokens.card.dangerFill, border: tokens.danger, text: tokens.danger };
    const solid = { fill: tokens.danger, border: tokens.danger, text: tokens.card.onStrong };
    const tree = await render(details(sample("sample-running"), { stop: { phase: "idle", onPress: vi.fn() } }));
    expect(look(tree.root, "detail-stop")).toEqual(tint);
    await act(async () => tree.update(details(sample("sample-running"), { stop: { phase: "confirming", onPress: vi.fn() } })));
    expect(look(tree.root, "detail-stop")).toEqual(solid);
    await act(async () => tree.unmount());
    renderer = null;
    const strings = BOARD_STRINGS.zh.sidebar;
    const bar = await render(React.createElement(DetailActionBar, { card: sample("sample-running"), theme: LIGHT, language: "zh", strings, onOpen: vi.fn(), stop: { phase: "idle", onPress: vi.fn() } }));
    expect(look(bar.root, "detail-bar-stop")).toEqual(tint);
  });

  it("folds a long path's middle, keeping its head and as much tail as fits", () => {
    expect(foldPath("~/code/app", 10)).toBe("~/code/app");
    // Two lines of 26 that break only after "/": the space a break leaves counts.
    expect(foldPath("~/workspace/rrd/ideashell-system/ideashell-android/.worktrees/align-206-integration", 26)).toBe(
      "~/workspace/…/.worktrees/align-206-integration",
    );
    // A segment longer than a line runs on from the "/" before it, so "a/bbbbbbbbbb" wraps as one run.
    expect(pathLines("~/a/bbbbbbbbbb", 5)).toBe(4);
    expect(pathLines("~/workspace/…/.worktrees/align-206-integration", 26)).toBe(2);
    // A last segment longer than a line follows "…/" and wraps inside itself; cut only past the lines.
    const longLast = "~/bc-tasks/ios/proj/voice-input-native-bridge-runtime-migration-sandbox";
    expect(foldPath(longLast, 34)).toBe("~/bc-tasks/…/voice-input-native-bridge-runtime-migration-sandbox");
    // Drawn as runs in a wrapping row: a segment longer than a line is cut after each "-", its first part kept with the "…/".
    expect(pathTokens("…/voice-input-native-bridge-runtime-migration-sandbox", 34)).toEqual(["…/voice-", "input-", "native-", "bridge-", "runtime-", "migration-", "sandbox"]);
    // A browser breaks a long segment only after its "-": in 35 columns "proj/" no longer fits beside it.
    const sandbox = "~/bc-tasks/web/proj/voice-input-native-bridge-runtime-migration-sandbox";
    expect(pathLines("~/bc-tasks/…/proj/voice-input-native-bridge-runtime-migration-sandbox", 35)).toBe(3);
    expect(foldPath(sandbox, 35)).toBe("~/bc-tasks/…/voice-input-native-bridge-runtime-migration-sandbox");
    // Two lines of 12: the segment keeps its first and last hyphen parts around "…", never cut inside a word.
    const narrow = foldPath(longLast, 12);
    expect(narrow).toMatch(/^…\/voice-….*sandbox$/);
    expect(pathLines(narrow, 12)).toBeLessThanOrEqual(2);
    expect(pathTokens("~/a-b/c", 10)).toEqual(["~/", "a-b/", "c"]);
    expect(breakable("feat/align-ios")).toBe("feat/\u200balign-\u200bios");
    expect(modeIcon("claude", "Bypass")).toBe("ShieldOff");
    expect(modeIcon("claude", "Plan Mode")).toBe("ShieldEllipsis");
    expect(modeIcon("claude", "Always Ask")).toBe("Shield");
    expect(modeIcon("omp", "Always Ask")).toBe("ShieldCheck");
    expect(modeIcon("codex", "Auto-review")).toBe("ShieldCheck");
    expect(modeIcon("copilot", "Allow All")).toBe("ShieldOff");
    expect(modeIcon("opencode", "Build")).toBe("Shield");
    expect(modeIcon("someone", "Write Approval")).toBe("ShieldAlert");
    expect(modeIcon("claude", "Something new")).toBe("Bot");
  });

  it("lists model, thinking and mode with icons", async () => {
    const tree = await render(details(sample("sample-input")));
    const agent = hostByTestId(tree.root, "detail-agent");
    expect(texts(hostByTestId(agent, "detail-model"))).toEqual(["Opus 5.5"]);
    expect(hostByTestId(agent, "detail-model").findAll((node) => (node.type as { name?: string }).name === "BrandMark")).toHaveLength(1);
    expect(texts(hostByTestId(agent, "detail-thinking"))).toEqual(["High"]);
    expect(icons(hostByTestId(agent, "detail-thinking"))).toEqual(["Brain"]);
    expect(texts(hostByTestId(agent, "detail-mode"))).toEqual(["Bypass"]);
    expect(icons(hostByTestId(agent, "detail-mode"))).toEqual(["ShieldOff"]);
  });
});

describe("overlays in the board's menu chrome", () => {
  const chromeOf = (theme: typeof LIGHT) => {
    const chrome = menuChrome(theme);
    return { backgroundColor: chrome.background, borderColor: chrome.border, borderWidth: 1, borderRadius: 12, boxShadow: chrome.shadow };
  };

  it("draws the stop menu with the shared Linear menu", async () => {
    for (const theme of [LIGHT, DARK]) {
      const onStop = vi.fn();
      const card = sample("sample-running");
      const tree = await render(cardElement(card, { theme, onStop }));
      await act(async () => byLabel(tree.root, "停止选项").props.onPress());
      const menu = hostByTestId(tree.root, "task-card-stop-menu");
      expect(flat(menu.props.style)).toMatchObject({ position: "absolute", right: 0, top: 32, width: 220 });
      const panel = hostByTestId(menu, "menu-panel");
      expect(flat(panel.props.style)).toMatchObject(chromeOf(theme));
      const rows = menu.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem");
      expect(rows.map((row) => texts(row))).toEqual([["仅停止此任务"], ["连同子任务一起停止", "2"]]);
      for (const row of rows) expect(flat(row.props.style)).toMatchObject({ height: 32, borderRadius: 6, marginHorizontal: 6 });
      // Leading marks: Stop's Power; the tree with a stop square at its corner.
      expect(icons(rows[0]!)).toEqual(["Power"]);
      expect(icons(rows[1]!)).toEqual(["ListTree"]);
      await act(async () => rows[1]!.props.onPress());
      expect(onStop).toHaveBeenCalledWith(card, { withChildren: true });
      expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-stop-menu")).toHaveLength(0);
      await act(async () => tree.unmount());
      renderer = null;
    }
  });

  it("opens the phone's stop menu above the action bar", async () => {
    const tree = await render(cardElement(sample("sample-running"), { compact: true, onStop: () => {} }));
    await act(async () => byLabel(tree.root, "停止选项").props.onPress());
    const menu = hostByTestId(tree.root, "task-card-stop-menu");
    // Two 32 rows and 6 above and below, plus the hairlines and a 6 gap.
    expect(flat(menu.props.style).top).toBe(-(6 + 32 * 2 + 6 + 2 + 6));
  });

  it("frames the context tooltip in the menu chrome", async () => {
    for (const theme of [LIGHT, DARK]) {
      const tree = await render(cardElement(sample("sample-running"), { theme }));
      await act(async () => hostByTestId(tree.root, "task-card-context").props.onHoverIn());
      expect(flat(hostByTestId(tree.root, "task-card-context-details").props.style)).toMatchObject({ position: "absolute", ...chromeOf(theme) });
      await act(async () => tree.unmount());
      renderer = null;
    }
    // The card itself keeps its own radius.
    const card = await render(cardElement(sample("sample-done")));
    expect(flat(hostByTestId(card.root, "task-card-sample-done").props.style).borderRadius).toBe(8);
  });
});

describe("TaskCardView chrome", () => {
  it("is Linear's card: radius 8, a hairline, and on hover only the fill and shadow change", async () => {
    const tokens = buildTaskTokens(LIGHT.colors);
    const tree = await render(cardElement(sample("sample-done")));
    const surface = () => flat(hostByTestId(tree.root, "task-card-sample-done").props.style);
    const rest = surface();
    expect(rest).toMatchObject({ borderRadius: 8, borderWidth: 1, borderColor: tokens.card.border, backgroundColor: tokens.card.background });
    expect(rest.boxShadow).toBe(tokens.card.shadow);
    await act(async () => hostByTestId(tree.root, "task-card-sample-done").props.onHoverIn());
    const hovered = surface();
    expect(hovered.backgroundColor).toBe(tokens.card.hoverBackground);
    expect(hovered.borderColor).toBe(rest.borderColor);
    expect(hovered.boxShadow).toBe(tokens.card.shadowHover);
    expect({ ...hovered, backgroundColor: 0, boxShadow: 0, zIndex: 0 }).toEqual({ ...rest, backgroundColor: 0, boxShadow: 0, zIndex: 0 });
  });

  it("tints a failed card in danger red, unless it is the sidebar's card", async () => {
    const tokens = buildTaskTokens(LIGHT.colors);
    const failed = { ...sample("sample-done"), lane: "review" as const, status: "failed" as const, error: "You've hit your session limit" };
    const tree = await render(cardElement(failed));
    const surface = () => flat(hostByTestId(tree.root, "task-card-sample-done").props.style);
    expect(surface()).toMatchObject({ backgroundColor: tokens.card.failed, borderColor: tokens.card.failedBorder });
    expect(flat(hostByTestId(tree.root, "task-card-reason").props.style).borderTopColor).toBe(tokens.card.failedBorder);
    await act(async () => hostByTestId(tree.root, "task-card-sample-done").props.onHoverIn());
    expect(surface().backgroundColor).toBe(tokens.card.failedHover);
    await act(async () => tree.update(cardElement(failed, { current: true })));
    expect(surface()).toMatchObject({ backgroundColor: tokens.card.current, borderColor: tokens.card.currentBorder });
  });
});

/** Paseo v0.12.0's default themes as the plugin sees them, and two palettes of our own. */
const PALETTES = {
  paseoLight: {
    surface0: "#ffffff", surface1: "#fafafa", surface2: "#f4f4f5", border: "#e4e4e7", foreground: "#1a1a1e",
    foregroundMuted: "#71717a", accent: "#20744a", accentForeground: "#ffffff",
    statusSuccess: "#3e704a", statusWarning: "#7b5d39", statusDanger: "#9d433b",
  },
  paseoDark: {
    surface0: "#181b1a", surface1: "#1e2120", surface2: "#272a29", border: "#252b2a", foreground: "#fafafa",
    foregroundMuted: "#a1a5a4", accent: "#20744a", accentForeground: "#ffffff",
    statusSuccess: "#6cb17b", statusWarning: "#c09664", statusDanger: "#d8847b",
  },
  sepiaLight: {
    surface0: "#fbf6ec", surface1: "#f4ecdc", surface2: "#ece2cf", border: "#e2d5bd", foreground: "#3b2f22",
    foregroundMuted: "#7a6650", accent: "#a0522d", accentForeground: "#fff8ee",
    statusSuccess: "#5b7a3a", statusWarning: "#9a6a1f", statusDanger: "#a63d2f",
  },
  blueDark: {
    surface0: "#0f1626", surface1: "#152036", surface2: "#1c2944", border: "#26365a", foreground: "#e6edf8",
    foregroundMuted: "#8fa0bf", accent: "#4c8dff", accentForeground: "#0f1626",
    statusSuccess: "#58c08a", statusWarning: "#e0b25c", statusDanger: "#f0707a",
  },
};

describe("card tokens follow the host theme", () => {
  for (const [name, colors] of Object.entries(PALETTES)) {
    it(`derives every card colour from ${name}`, async () => {
      const tokens = buildTaskTokens(colors);
      const dark = name.endsWith("Dark");
      expect(tokens.isDark).toBe(dark);
      const card = tokens.card;
      const bg = dark ? colors.surface2 : colors.surface0;
      expect(card.background).toBe(bg);
      expect(card.hoverBackground).toBe(mix(bg, colors.foreground, 0.04));
      expect(card.hoverBackground).not.toBe(bg);
      expect(card.border).toBe(colors.border);
      expect(card.pillBorder).toBe(mix(colors.border, colors.foreground, dark ? 0.08 : 0.05));
      expect(card.pillFill).toBe(mix(bg, colors.foreground, dark ? 0.06 : 0.035));
      expect(card.primaryFill).toBe(mix(bg, colors.accent, dark ? 0.18 : 0.1));
      expect(card.dangerFill).toBe(mix(bg, colors.statusDanger, dark ? 0.16 : 0.1));
      expect(card.onStrong).toBe(colors.accentForeground);
      expect(tokens.danger).toBe(colors.statusDanger);
      expect(tokens.warning).toBe(colors.statusWarning);
      expect(tokens.success).toBe(colors.statusSuccess);
      expect(tokens.foreground).toBe(colors.foreground);
      expect(tokens.foregroundMuted).toBe(colors.foregroundMuted);
      // Data colours keep their hue; only the tint's strength follows the theme.
      expect(pillTint(tokens, "#8b5cf6").background).toBe(mix(bg, "#8b5cf6", dark ? 0.16 : 0.1));
      // Shadows: black, fainter on a light theme than the stronger dark-theme ones.
      const alpha = (shadow: string) => Number(/rgba\(0, 0, 0, ([0-9.]+)\)/.exec(shadow)![1]);
      expect(alpha(card.shadow) < alpha(card.shadowHover)).toBe(true);

      // The rendered card uses them: fill, hairline colour, title and meta text, the stop pill.
      const theme = { colors };
      const tree = await render(cardElement(sample("sample-child-1"), { theme, onStop: () => {}, stopPhase: "confirming" }));
      const surface = flat(hostByTestId(tree.root, "task-card-sample-child-1").props.style);
      expect(surface).toMatchObject({ backgroundColor: bg, borderColor: colors.border });
      expect(flat(hostByTestId(tree.root, "task-card-title").props.style).color).toBe(colors.foreground);
      expect(flat(hostByTestId(tree.root, "task-card-meta-location").props.style).color).toBe(colors.foregroundMuted);
      const armed = byLabel(tree.root, "确认停止");
      expect(flat(armed.props.style)).toMatchObject({ backgroundColor: colors.statusDanger, borderColor: colors.statusDanger });
      expect(flat(armed.find((node) => (node.type as unknown) === "Text").props.style).color).toBe(colors.accentForeground);
      await act(async () => tree.unmount());
      renderer = null;
    });
  }

  it("lands near Linear's measured greys on Paseo's default light theme", () => {
    const card = buildTaskTokens(PALETTES.paseoLight).card;
    // Linear: hover #f5f5f5, pill hairline #d8d8da on white.
    expect(card.hoverBackground).toBe("#f6f6f6");
    expect(card.pillBorder).toBe("#dadadd");
  });
});

describe("formatters", () => {
  it("formats durations, waits, estimates and relative times in both languages", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(12 * 60_000 + 30_000)).toBe("12m 30s");
    expect(formatDuration(65 * 60_000 + 5_000)).toBe("1h 5m");
    const local = (day: number, hours: number, minutes: number) => new Date(2026, 9, day, hours, minutes).getTime();
    expect(formatClockTime(local(20, 9, 5), local(20, 23, 0))).toBe("09:05");
    expect(formatClockTime(local(19, 23, 58), local(20, 0, 10))).toBe("10/19 23:58");
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

  it("shows the home directory as ~", () => {
    expect(tildePath("/Users/dev/code/app")).toBe("~/code/app");
    expect(tildePath("/Users/dev")).toBe("~");
    expect(tildePath("/home/luke/src")).toBe("~/src");
    expect(tildePath("C:\\Users\\Luke\\code\\app")).toBe("~\\code\\app");
    expect(tildePath("/Users/devs-shared")).toBe("~");
    expect(tildePath("/tmp/tasks-qa")).toBe("/tmp/tasks-qa");
    expect(tildePath("/opt/Users/dev/x")).toBe("/opt/Users/dev/x");
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

describe("StatusIcon steps", () => {
  it("turns the ring in twelve held steps per period", async () => {
    const { STATUS_RING_STEPS } = await import("../../client/tasks/cards/status-icon");
    const { steppedEasing } = await import("../../client/ui/tokens/motion");
    const easing = steppedEasing(STATUS_RING_STEPS);
    expect(STATUS_RING_STEPS).toBe(12);
    expect([0, 0.08, 1 / 12, 0.5, 0.999, 1].map((t) => Math.round(easing(t) * 360))).toEqual([0, 0, 30, 180, 330, 330]);
  });
});
