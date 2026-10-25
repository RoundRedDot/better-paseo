import { actionIconOnly } from "../../client/tasks/cards/action-row";
import { nativeProseText } from "./helpers/native-prose-text";
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
  layouts: vi.fn(),
  reduceListeners: new Set<(value: boolean) => void>(),
  loops: [] as Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }>,
}));

vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    ...rn,
    LayoutAnimation: { configureNext: motion.layouts },
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
      addEventListener: (_event: string, listener: (value: boolean) => void) => {
        motion.reduceListeners.add(listener);
        return { remove: () => motion.reduceListeners.delete(listener) };
      },
    },
  };
});

const opened = vi.hoisted(() => ({ openLink: vi.fn() }));
vi.mock("../../client/components/open-link", () => opened);

const folder = vi.hoisted(() => ({
  reveal: vi.fn<(_input: { cwd: string; path: string }) => Promise<{ revealed: string | null; error: string | null }>>(),
}));
vi.mock("@getpaseo/plugin/client", async (original) => ({
  ...await original<object>(),
  useRpc: () => folder.reveal,
}));

const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => {}), show: vi.fn(), error: vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => react.createElement("Icon", props),
    Modal: Object.assign(
      (props: Record<string, unknown> & { children?: React.ReactNode }) => props.open ? react.createElement("Modal", props, props.children) : null,
      { Content: (props: Record<string, unknown> & { children?: React.ReactNode }) => react.createElement("ModalContent", props, props.children) },
    ),
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
  formatTokenTotal,
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
import { SpinnerRing, statusRingHolders } from "../../client/tasks/cards/status-icon";
import { TagMark } from "../../client/tasks/cards/tag-mark";
import { resetSectionChoices } from "../../client/tasks/cards/detail-collapse";
import { OVERLAY_ROW_Z } from "../../client/tasks/cards/task-card";
import { SubtaskRow, SubtaskMetadata } from "../../client/tasks/cards/subtask-row";
import { ChildMark } from "../../client/tasks/cards/child-mark";
import { MARK_BITMAPS } from "../../server/mark-bitmaps";
import { ContextRing, contextRingTone, formatSessionCost, formatTokenCount } from "../../client/tasks/cards/context-ring";
import { pillTint } from "../../client/tasks/cards/tokens";
import { TasksTypography, TasksTypographyScale } from "../../client/tasks/typography";
import { MarkdownView } from "../../client/components/markdown/markdown-view";
import { modeIcon } from "../../client/tasks/cards/mode-icons";
import { menuChrome } from "../../client/tasks/board/menu";
import { cardMenuSections } from "../../client/tasks/cards/card-menu";
import { cardStrings } from "../../client/tasks/cards/strings";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { PiMark, agentPillColors, contrastRatio, tintedPillColors } from "../../client/tasks/cards/brand-mark";
import { permissionButtons } from "../../client/tasks/actions";
import { providerBrand } from "../../client/components/provider-logo";
import { seedMarkBitmaps } from "../../client/components/marks";
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
    .findAll((node) => ["Text", "EnrichedMarkdownText", "EnrichedMarkdown"].includes(String(node.type)) && !hasTextAncestor(node) && !hasHiddenAncestor(node))
    .map((node) => nativeProseText(node) ?? join(node));
}

function hasHiddenAncestor(node: ReactTestInstance): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.props.accessibilityElementsHidden || parent.props["aria-hidden"]) return true;
  }
  return false;
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
  motion.layouts.mockClear();
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

  it("draws a working button's spinner as the running ring without its dot, on the same clock", async () => {
    const tree = await render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(StatusIcon, { key: "running", kind: "running", theme: LIGHT }),
        React.createElement(SpinnerRing, { key: "spinner", size: 13, color: "#d93636", testID: "button-spinner" }),
      ),
    );
    const spinner = hostByTestId(tree.root, "button-spinner");
    expect(flat(spinner.props.style)).toMatchObject({ width: 13, height: 13 });
    // A hollow track and the turning quarter; no centre dot.
    const [track, arc] = spinner.children as ReactTestInstance[];
    expect(spinner.children).toHaveLength(2);
    const mark = statusMarkSize(13);
    expect(flat(track!.props.style)).toMatchObject({ width: mark, borderRadius: mark / 2, borderWidth: (1.5 * mark) / 12, borderColor: "#d93636", opacity: 0.3 });
    expect(flat(track!.props.style).backgroundColor).toBeUndefined();
    expect(flat(arc!.props.style)).toMatchObject({ borderColor: "transparent", borderTopColor: "#d93636", opacity: 0.9 });
    // One loop for the status ring and the spinner, turning both in phase.
    expect(motion.loops).toHaveLength(1);
    expect(statusRingHolders()).toBe(2);
    const rotations = tree.root
      .findAll((node) => (node.type as unknown) === "Animated.View")
      .map((node) => (flat(node.props.style).transform as Array<{ rotate: unknown }>)[0]!.rotate);
    expect(new Set(rotations).size).toBe(1);
    await act(async () => tree.unmount());
    renderer = null;
    expect(statusRingHolders()).toBe(0);
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
    ["zh", new Date(2026, 9, 22, 12), new Date(2026, 9, 22, 10), "8m · 2 小时前"],
    ["en", new Date(2026, 9, 22, 12), new Date(2026, 9, 22, 10), "~8m · 2h ago"],
    ["zh", new Date(2026, 9, 22, 0, 5), new Date(2026, 9, 21, 23, 59, 10), "8m · 2026-10-21 23:59:10"],
    ["en", new Date(2026, 9, 22, 12), new Date(2026, 9, 13, 23, 9, 10), "~8m · 2026-10-13 23:09:10"],
    ["zh", new Date(2026, 9, 22, 12), new Date(2026, 9, 21, 12), "8m · 2026-10-21 12:00:00"],
    ["zh", new Date(2026, 0, 1), new Date(2025, 11, 31, 23, 59, 59), "8m · 2025-12-31 23:59:59"],
  ] as const)("renders the %s footer at %s for a turn ended at %s", async (language, now, ended, expected) => {
    const card = sample("sample-done");
    card.timing = { ...card.timing, updatedAt: now.toISOString(), lastTurnMs: 8 * 60_000, lastTurnEndedAt: ended.toISOString() };
    const tree = await render(cardElement(card, { now: now.getTime(), language }));
    expect(texts(hostByTestId(tree.root, "task-card-timer"))).toEqual([expected]);
  });

  it("switches from relative time to a full timestamp when the board clock crosses midnight", async () => {
    let time = new Date(2026, 9, 21, 23, 59, 59).getTime();
    const clock = createTaskClock(() => time);
    const card = sample("sample-done");
    // No turn on record: timed from the latest prompt.
    card.timing = { ...card.timing, lastUserMessageAt: new Date(2026, 9, 21, 23, 58, 10).toISOString(), lastTurnMs: null, lastTurnEndedAt: null };
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
      "task-card-control-row",
      "task-card-subtasks-panel",
    ]);
    expect(flat(hostByTestId(tree.root, "task-card-subtasks-panel").props.style).height).toBe(0);
    // The project's letter avatar (`projectIcon` is on at standard), then project › workspace.
    expect(texts(hostByTestId(tree.root, "task-card-meta"))).toEqual(["B", "better-paseo › tasks-board"]);
    const title = hostByTestId(tree.root, "task-card-title");
    expect(title.props.numberOfLines).toBe(2);
    expect(title.props.ellipsizeMode).toBe("tail");
    // Native (a tablet's desk lanes): the small step; the web draws it at base (see tasks-board-render).
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
    // Native shows Open all the time, on its own row under the footer.
    expect(texts(footer)).toEqual([RUNNING_START, "12m 30s"]);
    expect(texts(hostByTestId(tree.root, "task-card-control-row"))).toEqual(["打开"]);
    expect(icons(hostByTestId(footer, "task-card-started"))).toEqual(["Clock"]);
    expect(icons(hostByTestId(footer, "task-card-timer"))).toEqual(["Hourglass"]);
    expect(texts(tree.root).some((text) => text.includes("未提交"))).toBe(false);
  });

  it("draws a card waiting on its subtasks with their start and length, as a running turn's", async () => {
    const running = sample("sample-running");
    const child: TaskChild = { id: "child", title: "child", status: "running", lane: "running", timing: running.timing };
    const card: TaskCard = { ...sample("sample-done"), lane: "running", status: "running", waitingOnSubtasks: true, children: [child] };
    const tree = await render(cardElement(card));
    const footer = hostByTestId(tree.root, "task-card-footer");
    expect(texts(footer)).toEqual([RUNNING_START, "12m 30s"]);
    expect(icons(hostByTestId(footer, "task-card-started"))).toEqual(["Clock"]);
    expect(icons(hostByTestId(footer, "task-card-timer"))).toEqual(["Hourglass"]);
  });

  it("draws pills fully rounded and outlined, with a solid tag in the label colour", async () => {
    const tree = await render(cardElement(sample("sample-running"), { fields: fields("standard", { labelLimit: "all" }) }));
    for (const [id] of pills(tree.root)) {
      // borderWidth is StyleSheet.hairlineWidth, which rn-mock reports as 1; the agent pills have none.
      const agent = id === "pill-model" || id === "pill-branch";
      expect(flat(hostByTestId(tree.root, id).props.style)).toMatchObject({ height: 20, borderRadius: 10, borderWidth: agent ? 0 : 1 });
    }
    // A label pill has no fill, only the neutral hairline: its colour is only in the solid tag before the name.
    const tokens = buildTaskTokens(LIGHT.colors);
    const pillColors = (id: string) => {
      const style = flat(hostByTestId(tree.root, id).props.style);
      return { background: style.backgroundColor, border: style.borderColor };
    };
    expect(pillColors("pill-label-frontend")).toEqual({ background: "transparent", border: tokens.card.pillBorder });
    expect(pillColors("pill-label-board")).toEqual({ background: "transparent", border: tokens.card.pillBorder });
    // The branch: a faint fixed blue, borderless; folder, path and PR stay neutral.
    expect(pillColors("pill-branch").background).toBe(mix("#ffffff", tokens.branch, 0.08));
    // Codex's mark is monochrome, like the ChatGPT app's, so its agent pill is the neutral one; the subtasks pill its dominant status (2 running).
    expect(pillColors("pill-model").background).toBe(mix("#ffffff", LIGHT.colors.foreground, 0.06));
    expect(pillColors("pill-subtasks").background).toBe(mix("#ffffff", tokens.status.running, 0.1));
    const tag = (name: string) => hostByTestId(tree.root, `pill-label-${name}`).findByType(TagMark).props;
    // The hole shows the card through the clear pill.
    expect(tag("frontend")).toMatchObject({ color: "#8b5cf6", hole: flat(hostByTestId(tree.root, "task-card-sample-running").props.style).backgroundColor });
    expect(tag("p1").color).toBe("#ef4444");
    // No colour: a neutral grey tag.
    expect(tag("board").color).toBe("#6b6b75");
  });

  it("keeps the title row, the agent pill and the footer at minimal", async () => {
    const tree = await render(cardElement(sample("sample-running"), { fields: fields("minimal") }));
    expect(rows(tree.root, "sample-running")).toEqual(["task-card-title-row", "task-card-pills", "task-card-footer", "task-card-control-row"]);
    // Minimal: the model and thinking switches are on, the provider's mark is off.
    expect(pills(tree.root)).toEqual([
      ["pill-model", "GPT-5.5 Codex"],
    ]);
    expect(texts(tree.root)).toEqual(["Port the status ring to React Native", "GPT-5.5 Codex", "·", "Medium", RUNNING_START, "12m 30s", "打开"]);
    expect(hostByTestId(tree.root, "pill-model").findAll((node) => (node.type as unknown) === "Image")).toHaveLength(0);
    // No jump arrow on the title row: Open sits on the row under the footer.
    expect(icons(hostByTestId(tree.root, "task-card-title-row"))).not.toContain("ArrowUpRight");
  });

  it("collapses the pill row and the footer when their fields are off", async () => {
    const off = fields("minimal", { model: false, thinking: false, timer: false });
    const tree = await render(cardElement(sample("sample-running"), { fields: off, onOpen: undefined }));
    expect(rows(tree.root, "sample-running")).toEqual(["task-card-title-row"]);
    expect(texts(tree.root)).toEqual(["Port the status ring to React Native"]);
    // Open alone takes the buttons' row, without an empty footer above it.
    await act(async () => tree.update(cardElement(sample("sample-running"), { fields: off })));
    expect(rows(tree.root, "sample-running")).toEqual(["task-card-title-row", "task-card-control-row"]);
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
    // Uncommitted changes are a warning dot alone, no word beside it.
    const branch = hostByTestId(tree.root, "pill-branch");
    expect(texts(branch)).toEqual(["feat/tasks-board", "↑3 ↓0"]);
    const dots = branch.findAll((node) => typeof node.type === "string" && flat(node.props.style).width === 6);
    expect(dots.map((node) => flat(node.props.style).backgroundColor)).toEqual([taskTokens(LIGHT).warning]);
    expect(texts(hostByTestId(tree.root, "pill-path"))).toEqual(["~/code/better-paseo/.worktrees/tasks-board"]);
    expect(texts(hostByTestId(tree.root, "pill-pr"))).toEqual(["#42"]);
    expect(ids).not.toContain("pill-labels-more");
    expect(hostByTestId(tree.root, "task-card-meta").findAll((node) => (node.type as unknown) === "View" && flat(node.props.style).width === 12)).toHaveLength(1);
  });

  it.each([LIGHT, DARK])("colours git ahead green and behind orange, keeping zero muted in either theme", async (theme) => {
    const tokens = taskTokens(theme);
    const base = sample("sample-running");
    for (const [ahead, behind] of [[3, 2], [0, 2], [3, 0], [0, 0], [null, 2], [3, null], [null, null]] as const) {
      const card = { ...base, location: { ...base.location, git: { dirty: true, ahead, behind } } };
      const tree = await render(cardElement(card, { theme, fields: fields("full") }));
      const branch = hostByTestId(tree.root, "pill-branch");
      const status = branch.findAll((node) => (node.type as unknown) === "Text" && !hasTextAncestor(node))[1];
      if (ahead === null && behind === null) {
        expect(status).toBeUndefined();
        expect(texts(branch)).toEqual(["feat/tasks-board"]);
        await act(async () => tree.unmount());
        renderer = null;
        continue;
      }
      expect(flat(status!.props.style).color).toBe(tokens.foregroundMuted);
      const counts = status!.findAll((node) => (node.type as unknown) === "Text" && hasTextAncestor(node));
      expect(counts.map((node) => [node.props.children, flat(node.props.style).color])).toEqual([
        ...(ahead !== null ? [[`↑${ahead}`, ahead > 0 ? tokens.success : tokens.foregroundMuted]] : []),
        ...(behind !== null ? [[`↓${behind}`, behind > 0 ? tokens.warning : tokens.foregroundMuted]] : []),
      ]);
      expect(texts(branch)).toEqual(["feat/tasks-board", [ahead !== null ? `↑${ahead}` : null, behind !== null ? `↓${behind}` : null].filter(Boolean).join(" ")]);
      await act(async () => tree.unmount());
      renderer = null;
    }
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

  it("copies the model, branch, folder and path a pill shows, with the host's toast", async () => {
    clipboard.copyText.mockClear();
    clipboard.show.mockClear();
    const selected = vi.fn();
    const details = vi.fn();
    const tree = await render(cardElement(sample("sample-running"), { fields: fields("full"), onSelect: selected, onDetails: details }));
    for (const [testID, text, toast] of [
      ["pill-model", "GPT-5.5 Codex", "Copied model name"],
      ["pill-branch", "feat/tasks-board", "Copied branch name"],
      ["pill-path", "/Users/dev/code/better-paseo/.worktrees/tasks-board", "Copied path"],
    ] as const) {
      const pill = hostByTestId(tree.root, testID);
      expect(pill.props.accessibilityRole).toBe("button");
      await act(async () => pill.props.onPress());
      expect(clipboard.copyText).toHaveBeenLastCalledWith(text);
      expect(clipboard.show).toHaveBeenLastCalledWith(toast);
    }
    // The press stays on the pill; long press opens the card's action menu.
    expect(selected).not.toHaveBeenCalled();
    await act(async () => hostByTestId(tree.root, "pill-branch").props.onLongPress());
    expect(details).not.toHaveBeenCalled();
    expect(hostByTestId(tree.root, "task-card-menu")).toBeDefined();

    const done = await render(cardElement(sample("sample-done")));
    await act(async () => hostByTestId(done.root, "pill-folder").props.onPress());
    expect(clipboard.copyText).toHaveBeenLastCalledWith("scratch");
    expect(clipboard.show).toHaveBeenLastCalledWith("Copied folder name");
    // Labels do not copy.
    expect(hostByTestId(done.root, "pill-label-frontend").props.onPress).toBeUndefined();
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
      "Port the status ring to React Native",
    ]);
    expect(icons(hostByTestId(tree.root, "task-card-meta-parent"))).toEqual(["CornerLeftUp"]);
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
    // The card's long-press menu shows the parent's card too.
    onReveal.mockClear();
    await act(async () => hostByTestId(tree.root, "task-card-sample-child-1").props.onLongPress());
    const reveal = hostByTestId(tree.root, "task-card-menu").find(
      (node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "显示父任务卡片",
    );
    await act(async () => reveal.props.onPress());
    expect(onReveal).toHaveBeenCalledWith("sample-running");

    const orphan = { ...sample("sample-child-1"), parent: { id: "gone", title: null, missing: true, archived: true } };
    await act(async () => tree.update(cardElement(orphan, { onReveal, fields: fields("minimal") })));
    // Its title unknown: the generic name, and the Archived tag beside it.
    expect(texts(hostByTestId(tree.root, "task-card-meta"))).toEqual(["父任务", "已归档"]);
    expect(icons(hostByTestId(tree.root, "task-card-meta-archived"))).toEqual(["Archive"]);
    const named = { ...orphan, parent: { ...orphan.parent, title: "多设备连接" } };
    await act(async () => tree.update(cardElement(named, { onReveal, fields: fields("minimal") })));
    expect(texts(hostByTestId(tree.root, "task-card-meta"))).toEqual(["多设备连接", "已归档"]);
    // A parent whose workspace is archived says so instead.
    const parked = { ...orphan, parent: { id: "parked", title: "整理推送链路", missing: true, archived: false, archivedAs: "workspace" as const } };
    await act(async () => tree.update(cardElement(parked, { onReveal, fields: fields("minimal") })));
    expect(texts(hostByTestId(tree.root, "task-card-meta"))).toEqual(["整理推送链路", "工作区已归档"]);
    // On the board in the archived lane: still tagged, the link still reveals it.
    const inLane = { ...orphan, parent: { id: "lane", title: "多设备连接", missing: false, archived: false, archivedAs: "agent" as const } };
    await act(async () => tree.update(cardElement(inLane, { onReveal, fields: fields("minimal") })));
    expect(texts(hostByTestId(tree.root, "task-card-meta"))).toEqual(["多设备连接", "已归档"]);
    // Off the board but not archived (an old done task): its title, never "archived".
    const old = { ...orphan, parent: { id: "old", title: "多设备连接", missing: true, archived: false } };
    await act(async () => tree.update(cardElement(old, { onReveal, fields: fields("minimal") })));
    expect(texts(hostByTestId(tree.root, "task-card-meta"))).toEqual(["多设备连接"]);
  });

  it.each([
    { compact: false, theme: LIGHT, ui: 14 },
    { compact: true, theme: DARK, ui: 21 },
  ])("keeps the parent icon aligned with metadata and its hover colour ($compact, $ui)", async ({ compact, theme, ui }) => {
    const scaledTheme = { ...theme, typography: { fontSize: { ui } } };
    const tree = await render(React.createElement(TasksTypography, {
      theme: scaledTheme,
      children: cardElement(sample("sample-child-1"), { compact, theme: scaledTheme }),
    }));
    const parent = () => hostByTestId(tree.root, "task-card-meta-parent");
    const icon = () => parent().find((node) => (node.type as unknown) === "Icon");
    const label = () => parent().find((node) => (node.type as unknown) === "Text");
    expect(icon().props).toMatchObject({ name: "CornerLeftUp", size: Math.round(12 * ui / 14), color: theme.colors.foregroundMuted });
    expect(label().props.numberOfLines).toBe(1);
    expect(flat(label().props.style)).toMatchObject({ flexShrink: 1, minWidth: 0, fontSize: icon().props.size });
    expect(flat(parent().props.style)).toMatchObject({ flexDirection: "row", alignItems: "center", minWidth: 0, overflow: "hidden" });
    await act(async () => parent().props.onHoverIn());
    expect(icon().props.color).toBe(theme.colors.foreground);
    expect(flat(label().props.style).color).toBe(theme.colors.foreground);
    await act(async () => parent().props.onHoverOut());
    expect(icon().props.color).toBe(theme.colors.foregroundMuted);
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
        // The label and arrow: the amber pulled until it reads at 4.5:1 on the card and on its hover.
        expect(answer.findByType("Icon" as never).props.color).toBe(tokens.card.answerText);
        expect(flat(answer.find((node) => (node.type as unknown) === "Text").props.style).color).toBe(tokens.card.answerText);
        const rest = flat(answer.props.style);
        expect(rest).toMatchObject({
          backgroundColor: "transparent",
          borderColor: mix(tokens.card.background, amber, tokens.isDark ? 0.45 : 0.4),
          borderWidth: 0.5,
        });
        await act(async () => answer.props.onHoverIn());
        expect(flat(byLabel(tree.root, set[0]!.label).props.style).backgroundColor).toBe(
          mix(tokens.card.background, amber, tokens.isDark ? 0.16 : 0.1),
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

  it("outlines Mark read in the unread green, and keeps it plain on a failed card", async () => {
    const tokens = buildTaskTokens(LIGHT.colors);
    const colors = (button: ReactTestInstance) => [
      ...button.findAll((node) => (node.type as unknown) === "Icon").map((node) => node.props.color),
      flat(button.find((node) => (node.type as unknown) === "Text").props.style).color,
    ];
    const tree = await render(cardElement({ ...sample("sample-unread"), readable: true }, { onRead: () => {} }));
    const unread = byLabel(tree.root, "标为已读");
    expect(flat(unread.props.style)).toMatchObject({ backgroundColor: "transparent", borderColor: tokens.card.readBorder });
    expect(colors(unread)).toEqual([tokens.card.readText, tokens.card.readText]);
    for (const theme of [LIGHT, DARK]) {
      const card = buildTaskTokens(theme.colors).card;
      expect(contrastRatio(card.readText, card.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(card.readText, card.readHover)).toBeGreaterThanOrEqual(4.5);
    }
    await act(async () => tree.update(cardElement({ ...sample("sample-failed"), readable: true }, { onRead: () => {} })));
    const failed = byLabel(tree.root, "标为已读");
    expect(flat(failed.props.style)).toMatchObject({ backgroundColor: "transparent", borderColor: tokens.card.buttonBorder });
    expect(colors(failed)).toEqual([tokens.foreground, tokens.foreground]);
  });

  it("outlines Allow in the accent and Deny in the danger colour, tinting each on hover", async () => {
    const buttons = permissionButtons(sample("sample-input").permission!, "zh");
    const tree = await render(cardElement(sample("sample-input"), { permissionButtons: buttons }));
    const tokens = buildTaskTokens(LIGHT.colors);
    expect(flat(byLabel(tree.root, "允许").props.style)).toMatchObject({ backgroundColor: "transparent", borderColor: tokens.card.primaryBorder });
    expect(flat(byLabel(tree.root, "拒绝").props.style)).toMatchObject({ backgroundColor: "transparent", borderColor: tokens.danger });
    await act(async () => byLabel(tree.root, "允许").props.onHoverIn());
    await act(async () => byLabel(tree.root, "拒绝").props.onHoverIn());
    expect(flat(byLabel(tree.root, "允许").props.style).backgroundColor).toBe(tokens.card.primaryHover);
    expect(flat(byLabel(tree.root, "拒绝").props.style).backgroundColor).toBe(tokens.card.dangerHover);
    for (const theme of [LIGHT, DARK]) {
      const card = buildTaskTokens(theme.colors).card;
      expect(contrastRatio(card.primaryText, card.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(card.primaryText, card.primaryHover)).toBeGreaterThanOrEqual(4.5);
    }
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
    expect(allow).toMatchObject({ minHeight: 32, flexGrow: 1, flexShrink: 0, flexBasis: "auto", minWidth: 32 });
    expect(allow.height).toBeUndefined();
    expect(allow.flex).toBeUndefined();
    const label = byLabel(tree.root, "Allow").find((node) => (node.type as unknown) === "Text");
    expect(label.props.numberOfLines).toBe(1);
    expect(flat(label.props.style).flexShrink).toBe(0);
    // No flexWrap: on Android it left a phantom second row's height under the buttons.
    expect(flat(hostByTestId(tree.root, "task-card-actions").props.style).flexWrap).toBeUndefined();
    const stop = () => flat(hostByTestId(tree.root, "task-card-stop").props.style);
    // The shared action row owns folding; no button shrinks its label independently.
    expect(stop()).toMatchObject({ flexGrow: 1, flexShrink: 0, flexBasis: "auto" });
    // No `flex` beside `flexShrink`: React Native Web warns when they update together.
    expect(stop().flex).toBeUndefined();
    expect(icons(byLabel(tree.root, "Stop"))).toEqual(["Power"]);
    await act(async () => tree.update(element("confirming")));
    expect(stop()).toMatchObject({ flexGrow: 1, flexShrink: 0, flexBasis: "auto" });
    expect(stop().flex).toBeUndefined();
    const confirm = byLabel(tree.root, "Confirm stop");
    expect(flat(confirm.props.style)).toMatchObject({ minHeight: 32, paddingHorizontal: 10 });
    expect(confirm.find((node) => (node.type as unknown) === "Text").props).toMatchObject({ numberOfLines: 1 });
    // Confirmation keeps its distinct icon, including when its label folds.
    expect(icons(confirm)).toEqual(["OctagonAlert"]);
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
    // A tablet's Open takes a row of its own under the answer row.
    expect(texts(hostByTestId(hostByTestId(tree.root, "task-card-permission"), "task-card-control-row"))).toEqual(["打开"]);
    // The buttons start at the card's edge, as its text does, not under the request's icon.
    expect(flat(hostByTestId(tree.root, "task-card-answer-row").props.style).paddingLeft).toBeUndefined();
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
  it("uses the host's thresholds and number formats", () => {
    expect([0.69, 0.7, 0.9, 0.91].map(contextRingTone)).toEqual(["normal", "warning", "warning", "danger"]);
    expect([950, 1500, 647_000, 1_000_000, 1_499_999, 2_600_000].map(formatTokenCount)).toEqual(["950", "2k", "647k", "1m", "1m", "3m"]);
    expect(formatSessionCost(32.48)).toBe("$32.48");
    expect(formatSessionCost(0.005)).toBe("$0.0050");
    expect(formatSessionCost(0)).toBeNull();
    expect(formatSessionCost(null)).toBeNull();
  });

  it("sits at the meta row's far right, coloured by the host's thresholds", async () => {
    for (const [used, color] of [[46, "#6b6b75"], [75, "#a36a00"], [95, "#d93636"]] as const) {
      const tree = await render(cardElement(withContext(used)));
      const meta = hostByTestId(tree.root, "task-card-meta");
      const meter = hostByTestId(meta, "task-card-context");
      // Where the jump arrow was: after the location, which takes the rest of the row.
      const hosts = (node: ReactTestInstance): ReactTestInstance[] =>
        node.children.flatMap((child) => (typeof child === "string" ? [] : typeof child.type === "string" ? [child] : hosts(child)));
      const row = hosts(meta);
      expect(row[row.length - 1]).toBe(meter);
      expect(hostByTestId(tree.root, "task-card-footer").findAll((node) => node.props.testID === "task-card-context")).toHaveLength(0);
      const track = hostByTestId(meter, "context-ring-track");
      expect(flat(track.props.style)).toMatchObject({ width: 14, height: 14 });
      const arc = hostByTestId(meter, "context-ring-fill").find((node) => (node.type as unknown) === "Image");
      expect((arc.type as unknown)).toBe("Image");
      expect(flat(arc.props.style)).toMatchObject({ tintColor: color });
      expect(arc.props.source.uri).toMatch(/^data:image\/png;base64,/);
      await act(async () => tree.unmount());
      renderer = null;
    }
  });

  it.each([
    [-0.2, 0], [0, 0], [0.254, 25], [0.756, 76], [1, 100], [1.2, 100],
  ])("selects the nearest displayed percent from the padded PNG atlas (ratio %s)", async (ratio, percent) => {
    const tree = await render(React.createElement(ContextRing, { ratio, color: "#123456", track: "#abcdef" }));
    const ring = hostByTestId(tree.root, "context-ring");
    const images = ring.findAll((node) => (node.type as unknown) === "Image");
    expect(images).toHaveLength(percent > 0 ? 2 : 1);
    expect(images[0]!.props).toMatchObject({ resizeMode: "stretch", fadeDuration: 0, accessible: false });
    expect(flat(images[0]!.props.style)).toMatchObject({ tintColor: "#abcdef", left: -1601, top: -1, width: 1616, height: 16 });
    if (percent > 0) {
      expect(images[1]!.props.source.uri).toBe(images[0]!.props.source.uri);
      expect(flat(images[1]!.props.style)).toMatchObject({ tintColor: "#123456", left: -percent * 16 - 1 });
    }
    expect(ring.findAll((node) => (node.type as unknown) === "View" && flat(node.props.style).transform !== undefined)).toHaveLength(0);
  });

  it("uses the thinner 12px bitmap for subtask rings", async () => {
    const tree = await render(React.createElement(ContextRing, { ratio: 0.5, color: "#000", track: "#ccc", variant: "subtask" }));
    const ring = hostByTestId(tree.root, "context-ring");
    expect(flat(ring.props.style)).toMatchObject({ width: 12, height: 12 });
    const image = hostByTestId(ring, "context-ring-fill").children[0] as ReactTestInstance;
    expect(flat(image.props.style)).toMatchObject({ left: -701, width: 1414, height: 14 });
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

  it("shows the host's context details below the ring on hover, desktop only", async () => {
    const tree = await render(cardElement(withContext(86, { context: { usedTokens: 647_000, maxTokens: 1_000_000 }, usage: { inputTokens: 1, cachedInputTokens: null, outputTokens: 1, totalCostUsd: 32.48 } })));
    await act(async () => hostByTestId(tree.root, "task-card-context").props.onHoverIn());
    const details = hostByTestId(tree.root, "task-card-context-details");
    expect(texts(details)).toEqual(["上下文窗口", "已使用 65%", "647k / 1m tokens", "会话费用 $32.48"]);
    expect(flat(details.props.style)).toMatchObject({ position: "absolute", top: 22 });
    // It opens downwards over the rows below, so the ring's row is raised above them.
    expect(flat(hostByTestId(tree.root, "task-card-meta").props.style).zIndex).toBe(OVERLAY_ROW_Z + 1);
    await act(async () => hostByTestId(tree.root, "task-card-context").props.onHoverOut());
    expect(flat(hostByTestId(tree.root, "task-card-meta").props.style).zIndex).toBeUndefined();

    // No cost line without a cost; no details on a phone.
    await act(async () => tree.update(cardElement(withContext(86, { usage: null }), { compact: true })));
    await act(async () => hostByTestId(tree.root, "task-card-context").props.onHoverIn());
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-context-details")).toHaveLength(0);
  });

  it("moves up to the title row without a meta row", async () => {
    const tree = await render(cardElement(withContext(50), { fields: fields("standard", { project: false, workspace: false }) }));
    expect(rows(tree.root, "sample-running")).not.toContain("task-card-meta");
    const titleRow = hostByTestId(tree.root, "task-card-title-row");
    expect(hostByTestId(titleRow, "task-card-context")).toBeDefined();
    await act(async () => hostByTestId(tree.root, "task-card-context").props.onHoverIn());
    expect(flat(titleRow.props.style).zIndex).toBe(OVERLAY_ROW_Z + 1);
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
    expect(flat(hostByTestId(tree.root, "pill-model").props.style)).toMatchObject({ height: 24, borderRadius: 12 });
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
  it("puts Open under the footer, its arrow after the label, and opens on a press of the card", async () => {
    const onOpen = vi.fn();
    const tree = await render(cardElement(sample("sample-done"), { onOpen }));
    const open = byLabel(hostByTestId(tree.root, "task-card-control-row"), "打开");
    expect(icons(open)).toEqual(["ArrowUpRight"]);
    expect(icons(tree.root).filter((name) => name === "ArrowUpRight")).toHaveLength(1);
    expect(flat(open.props.style)).toMatchObject({ height: 28, borderRadius: 6 });
    hostByTestId(tree.root, "task-card-sample-done").props.onPress();
    open.props.onPress();
    expect(onOpen.mock.calls).toEqual([["sample-done"], ["sample-done"]]);

    await act(async () => tree.update(cardElement(sample("sample-done"), { onOpen: undefined })));
    expect(texts(tree.root)).not.toContain("打开");
    expect(hostByTestId(tree.root, "task-card-sample-done").props.onPress).toBeUndefined();
  });

  it("has no Open on an archived task, which Paseo would not show, but keeps it for an archived workspace's", async () => {
    const onOpen = vi.fn();
    const archived = { ...sample("sample-done"), lane: "archived" as const, status: "archived" as const, archived: "agent" as const };
    const tree = await render(cardElement(archived, { onOpen }));
    expect(texts(tree.root)).not.toContain("打开");
    expect(hostByTestId(tree.root, "task-card-sample-done").props.onPress).toBeUndefined();

    await act(async () => tree.update(cardElement({ ...archived, archived: "workspace" }, { onOpen })));
    byLabel(hostByTestId(tree.root, "task-card-control-row"), "打开").props.onPress();
    expect(onOpen).toHaveBeenCalledWith("sample-done");
  });

  it("puts Archive before Open on a done task, as wide as its label on a phone", async () => {
    const onArchive = vi.fn();
    const done = sample("sample-done");
    const tree = await render(cardElement(done, { onOpen: vi.fn(), onArchive }));
    expect(texts(hostByTestId(tree.root, "task-card-control-row"))).toEqual(["归档", "打开"]);
    expect(icons(hostByTestId(tree.root, "task-card-archive"))).toEqual(["Archive"]);
    // A yellow outline and label with no fill; Open stays a plain outline.
    const yellow = taskTokens(LIGHT).card;
    expect(flat(hostByTestId(tree.root, "task-card-archive").props.style)).toMatchObject({ backgroundColor: "transparent", borderColor: yellow.archiveBorder });
    expect(hostByTestId(tree.root, "task-card-archive").findAll((node) => (node.type as unknown) === "Text")[0]!.props.style.color).toBe(yellow.archiveText);
    for (const theme of [LIGHT, DARK]) {
      const card = taskTokens(theme).card;
      expect(contrastRatio(card.archiveText, card.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(card.archiveText, card.archiveHover)).toBeGreaterThanOrEqual(4.5);
    }
    expect(flat(hostByTestId(tree.root, "task-card-open-tab").props.style).backgroundColor).toBe("transparent");
    hostByTestId(tree.root, "task-card-archive").props.onPress();
    expect(onArchive).toHaveBeenCalledWith("sample-done");

    await act(async () => tree.update(cardElement(done, { compact: true, onOpen: vi.fn(), onArchive })));
    expect(texts(hostByTestId(tree.root, "task-card-actions"))).toEqual(["归档", "打开"]);
    expect(flat(hostByTestId(tree.root, "task-card-archive").props.style).flexGrow).toBe(0);
    expect(flat(hostByTestId(tree.root, "task-card-open-tab").props.style).flexGrow).toBe(1);

    // Not for a task still in another lane, nor one already archived.
    await act(async () => tree.update(cardElement(sample("sample-running"), { onArchive })));
    expect(tree.root.findAll((node) => node.props.testID === "task-card-archive")).toHaveLength(0);
    await act(async () => tree.update(cardElement({ ...done, lane: "archived", status: "archived", archived: "agent" }, { onArchive })));
    expect(tree.root.findAll((node) => node.props.testID === "task-card-archive")).toHaveLength(0);
  });

  it("puts Unarchive where Open was on an archived task, spinning while it runs", async () => {
    const onUnarchive = vi.fn();
    const archived = { ...sample("sample-done"), lane: "archived" as const, status: "archived" as const, archived: "agent" as const };
    const tree = await render(cardElement(archived, { onOpen: vi.fn(), onUnarchive }));
    expect(texts(hostByTestId(tree.root, "task-card-control-row"))).toEqual(["取消归档"]);
    expect(icons(hostByTestId(tree.root, "task-card-unarchive"))).toEqual(["ArchiveRestore"]);
    hostByTestId(tree.root, "task-card-unarchive").props.onPress();
    expect(onUnarchive).toHaveBeenCalledWith("sample-done");

    await act(async () => tree.update(cardElement(archived, { onOpen: vi.fn(), onUnarchive, unarchivePending: true })));
    // Working: the same label, dimmed, a spinner where the icon was, no second press.
    const busy = hostByTestId(tree.root, "task-card-unarchive");
    expect(texts(hostByTestId(tree.root, "task-card-control-row"))).toEqual(["取消归档"]);
    expect(busy.props.disabled).toBe(true);
    expect(flat(busy.props.style)).toMatchObject({ opacity: 0.6 });
    expect(icons(busy)).not.toContain("ArchiveRestore");
    expect(hostByTestId(tree.root, "task-card-unarchive-spinner")).toBeTruthy();

    // The phone's card has it in its action row.
    await act(async () => tree.update(cardElement(archived, { compact: true, onUnarchive })));
    expect(texts(hostByTestId(tree.root, "task-card-actions"))).toEqual(["取消归档"]);
    // An archived workspace's task has nothing of its own to unarchive, and a host without the CLI no Unarchive.
    await act(async () => tree.update(cardElement({ ...archived, archived: "workspace" }, { onUnarchive })));
    expect(tree.root.findAll((node) => node.props.testID === "task-card-unarchive")).toHaveLength(0);
    await act(async () => tree.update(cardElement(archived, {})));
    expect(tree.root.findAll((node) => node.props.testID === "task-card-unarchive")).toHaveLength(0);
  });

  it("gives a tablet card's buttons a row of their own under the timer, Open at the right", async () => {
    const tree = await render(cardElement(sample("sample-child-1"), { onStop: () => {} }));
    expect(rows(tree.root, "sample-child-1")).toEqual(["task-card-meta", "task-card-title-row", "task-card-pills", "task-card-footer", "task-card-control-row"]);
    expect(texts(hostByTestId(tree.root, "task-card-footer"))).not.toContain("停止");
    const row = hostByTestId(tree.root, "task-card-control-row");
    expect(flat(row.props.style)).toMatchObject({ flexDirection: "row", justifyContent: "flex-end" });
    // A subtask's Open parent sits before Open.
    expect(texts(row)).toEqual(["停止", "打开父任务", "打开"]);
  });

  it("leaves Open out beside a question's Answer, which opens the tab itself", async () => {
    const card = { ...sample("sample-input"), permission: { requestId: "q", kind: "question" as const, title: "Which database?", summary: null, actions: [], remaining: 0 } };
    const tree = await render(cardElement(card, { permissionButtons: permissionButtons(card.permission, "zh") }));
    expect(texts(tree.root)).toContain("去回答");
    expect(texts(tree.root)).not.toContain("打开");
  });

  it("ends a phone card's action bar with Open, its arrow after the label", async () => {
    const onOpen = vi.fn();
    const running = await render(cardElement(sample("sample-running"), { compact: true, onOpen, onStop: () => {} }));
    expect(icons(byLabel(running.root, "打开"))).toEqual(["ArrowUpRight"]);
    expect(texts(hostByTestId(running.root, "task-card-actions"))).toEqual(["停止", "打开"]);
    // The details sheet's proportions: Open takes the room, Stop is as wide as its label.
    expect(flat(byLabel(running.root, "打开").props.style)).toMatchObject({ flexGrow: 1 });
    expect(flat(hostByTestId(running.root, "task-card-stop").props.style)).toMatchObject({ flexGrow: 0 });
    byLabel(running.root, "打开").props.onPress();
    expect(onOpen).toHaveBeenCalledWith("sample-running");
    await act(async () => running.unmount());

    // A subtask adds Open parent before Open; the two share the room Stop leaves.
    const child = await render(cardElement(sample("sample-child-1"), { compact: true, onOpen, onStop: () => {} }));
    expect(texts(hostByTestId(child.root, "task-card-actions"))).toEqual(["停止", "打开父任务", "打开"]);
    expect(flat(byLabel(child.root, "打开父任务").props.style)).toMatchObject({ flexGrow: 1 });
    byLabel(child.root, "打开父任务").props.onPress();
    expect(onOpen).toHaveBeenLastCalledWith("sample-running");
    // An archived parent has no tab Paseo would show: no Open parent.
    await act(async () => child.update(cardElement({ ...sample("sample-child-1"), parent: { id: "sample-running", title: "Port", missing: true, archived: true } }, { compact: true, onOpen, onStop: () => {} })));
    expect(texts(hostByTestId(child.root, "task-card-actions"))).toEqual(["停止", "打开"]);
    await act(async () => child.unmount());

    // A done card has nothing else to do, so Open stands alone.
    const done = await render(cardElement(sample("sample-done"), { compact: true }));
    expect(texts(hostByTestId(done.root, "task-card-actions"))).toEqual(["打开"]);
    await act(async () => done.unmount());

    // A permission's Allow and Deny follow it; a question's "Answer" already opens the tab.
    const input = sample("sample-input");
    const allow = await render(cardElement(input, { compact: true, permissionButtons: permissionButtons(input.permission!, "zh") }));
    // Beside Allow and Deny it is a square icon, its label read out.
    const square = byLabel(allow.root, "打开");
    expect(texts(square)).toEqual([]);
    expect(icons(square)).toEqual(["ArrowUpRight"]);
    expect(flat(square.props.style)).toMatchObject({ width: 32, flexGrow: 0 });
    await act(async () => allow.unmount());
    const question = { ...input, permission: { requestId: "q", kind: "question" as const, title: "Which database?", summary: null, actions: [], remaining: 0 } };
    const answer = await render(cardElement(question, { compact: true, onStop: () => {}, permissionButtons: permissionButtons(question.permission!, "zh") }));
    expect(texts(hostByTestId(answer.root, "task-card-actions"))).toEqual(["去回答", "停止"]);
    expect(flat(hostByTestId(answer.root, "task-card-stop").props.style)).toMatchObject({ flexGrow: 0 });
    await act(async () => answer.unmount());

    // Without onOpen there is nothing to open.
    const none = await render(cardElement(sample("sample-done"), { compact: true, onOpen: undefined }));
    expect(none.root.findAll((node) => node.props.testID === "task-card-actions")).toEqual([]);
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
    // Armed, the same outline with no fill: only the words change.
    expect(flat(confirm.props.style)).toMatchObject({ borderColor: "#d93636", backgroundColor: "transparent" });
    confirm.props.onPress();
    expect(onStop).toHaveBeenCalledWith(card, { withChildren: false });

    // Stopping: the rest label and outline, dimmed, a spinner where the icon was, no second press.
    await act(async () => tree.update(cardElement(card, { onStop, stopPhase: "stopping" as StopPhase })));
    expect(texts(tree.root)).not.toContain("停止中…");
    const stopping = byLabel(tree.root, "停止");
    expect(texts(stopping)).toEqual(["停止"]);
    expect(stopping.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(flat(stopping.props.style)).toMatchObject({ opacity: 0.6, backgroundColor: "transparent" });
    expect(icons(stopping)).not.toContain("Power");
    expect(hostByTestId(tree.root, "task-card-stop-spinner").children).toHaveLength(2);
    expect(stopping.findAll((node) => (node.type as unknown) === "ActivityIndicator")).toHaveLength(0);
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
    expect(flat(button.props.style)).toMatchObject({ height: 28, borderRadius: 6, borderWidth: 0.5 });
    button.props.onPress();
    expect(onRead).toHaveBeenCalledWith(card);

    await act(async () => tree.update(cardElement(card, { onRead, readPending: true })));
    const pending = byLabel(tree.root, "标为已读");
    expect(pending.props.disabled).toBe(true);
    expect(pending.props.accessibilityState).toMatchObject({ busy: true });
    // A spinner in the icon's place; the label stays as it was.
    expect(icons(pending)).toEqual([]);
    expect(pending.findAll((node) => node.props.testID === "task-card-read-spinner").length).toBeGreaterThan(0);
    expect(texts(pending)).toEqual(["标为已读"]);
    expect(flat(pending.props.style)).toMatchObject({ opacity: 0.6 });
    await act(async () => tree.unmount());
    renderer = null;

    // A phone puts it in the action bar, at Stop's touch size.
    const phone = await render(cardElement(card, { onRead, compact: true }));
    const bar = phone.root.find((node) => node.props.testID === "task-card-actions");
    expect(texts(bar)).toEqual(["标为已读", "打开"]);
    expect(flat(byLabel(bar, "标为已读").props.style)).toMatchObject({ flexGrow: 0 });
    expect(flat(byLabel(bar, "标为已读").props.style)).toMatchObject({ minHeight: 32, borderRadius: 7 });
  });

  it("draws Stop like the details sidebar's: a rounded rectangle led by Lucide's Power", async () => {
    const tokens = buildTaskTokens(LIGHT.colors);
    const square = (root: ReactTestInstance, label: string) =>
      byLabel(root, label).find((node) => (node.type as unknown) === "Icon" && node.props.name === "Power").props;
    const tree = await render(cardElement(sample("sample-running"), { onStop: () => {} }));
    expect(square(tree.root, "停止")).toMatchObject({ size: 13, color: tokens.danger });
    expect(flat(byLabel(tree.root, "停止").props.style)).toMatchObject({ height: 28, borderTopLeftRadius: 6, borderBottomLeftRadius: 6 });
    await act(async () => tree.update(cardElement(sample("sample-running"), { onStop: () => {}, stopPhase: "confirming" })));
    // Armed, the stop sign with an exclamation mark asks for the second press.
    expect(icons(byLabel(tree.root, "确认停止"))).toEqual(["OctagonAlert"]);
    expect(byLabel(tree.root, "确认停止").find((node) => (node.type as unknown) === "Icon").props.color).toBe(tokens.danger);
    // The parent's menu leads "stop only this" with the same icon.
    await act(async () => byLabel(tree.root, "停止选项").props.onPress());
    const [only] = tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem");
    expect(texts(only!)).toEqual(["仅停止此任务"]);
    expect(icons(only!)).toEqual(["Power"]);
    await act(async () => tree.unmount());
    renderer = null;

    const phone = await render(cardElement(sample("sample-child-1"), { onStop: () => {}, compact: true }));
    expect(square(phone.root, "停止")).toMatchObject({ size: 14, color: tokens.danger });
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
    byLabel(tree.root, "Measure the sidebar ring 运行中").props.onPress();
    expect(onReveal).toHaveBeenCalledWith("sample-child-1");
    const list = hostByTestId(tree.root, "task-card-subtasks");
    // Each row: the agent's mark on the left, aligned with the title's first line, its status on the
    // corner in every state; no state words.
    for (const child of sample("sample-running").children) {
      const slot = hostByTestId(list, `subtask-status-${child.id}`);
      expect(slot.props.style).toMatchObject({ height: 18 });
      expect(slot.findAll((node) => typeof node.type === "string" && node.props.testID === `status-${child.status}`)).toHaveLength(1);
    }
    // A running child's start and timer below the title; a finished one's last turn and when.
    expect(texts(hostByTestId(list, "subtask-time-sample-child-1"))).toEqual([formatClockTime(NOW - 3 * 60_000, NOW), "3m"]);
    expect(texts(hostByTestId(list, "subtask-time-sample-child-2"))).toEqual([formatClockTime(NOW - 312_000, NOW), "5m 12s"]);
    expect(list.findAllByType(SubtaskMetadata)).toHaveLength(3);
    for (const word of ["运行中", "已完成", "待输入"]) expect(texts(list)).not.toContain(word);
  });

  it.each([true, false])("keeps subtask timing below the title without competing for its width (compact=%s)", async (compact) => {
    const running = sample("sample-running");
    const base = { ...running, children: running.children.map((child, index) => index === 0 ? { ...child, title: "f206r3 笔记编辑器与侧栏设置排版验证" } : child) };
    const onReveal = vi.fn();
    const onOpen = vi.fn();
    const tree = await render(cardElement(base, { compact, onReveal, onOpen }));
    await act(async () =>
      tree.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityState?.expanded === false).props.onPress(),
    );
    const list = hostByTestId(tree.root, "task-card-subtasks");
    for (const child of base.children) {
      const row = byLabel(list, `${child.title} ${cardStrings("zh").status[child.status]}`);
      const title = hostByTestId(row, `subtask-title-${child.id}`);
      const time = hostByTestId(row, `subtask-time-${child.id}`);
      const content = hostByTestId(row, `subtask-content-${child.id}`);
      expect(flat(content.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
      expect(flat(content.props.style).flexDirection).toBeUndefined(); // Native View defaults to column.
      expect(texts(content)[0]).toBe(child.title);
      expect(content.findAll((node) => node === title || node === time)).toHaveLength(2);
      expect(flat(title.props.style).flex).toBeUndefined();
      expect(title.props.numberOfLines).toBe(1);
      expect(title.props.ellipsizeMode).toBe("tail");
      expect(flat(hostByTestId(row, `subtask-status-${child.id}`).props.style).flexShrink).toBe(0);
      const open = byLabel(row, cardStrings("zh").openInWorkspace);
      const openStyle = flat(open.props.style);
      // The jump button occupies only the title line; metadata reaches the right edge.
      expect(openStyle).toMatchObject({ position: "absolute", top: 0, right: 0, flexShrink: 0 });
      expect(openStyle.height).toBe(flat(title.props.style).lineHeight);
      expect(flat(title.props.style).marginRight).toBe(Number(openStyle.width) + 8);
      expect(flat(content.props.style).paddingRight).toBeUndefined();
      expect(flat(hostByTestId(content, `subtask-meta-${child.id}`).props.style).marginRight).toBeUndefined();
      expect(content.findAll((node) => node === open)).toHaveLength(1);
      row.props.onPress();
      expect(onReveal).toHaveBeenLastCalledWith(child.id);
    }
    if (compact) {
      byLabel(byLabel(list, `${base.children[0]!.title} ${cardStrings("zh").status[base.children[0]!.status]}`), cardStrings("zh").openInWorkspace).props.onPress();
      expect(onOpen).toHaveBeenCalledWith(base.children[0]!.id);
    }
  });

  it.each([true, false])("fills a subtask's second line with its model, effort, mode, context and live timing (compact=%s)", async (compact) => {
    const base = sample("sample-running");
    const child = base.children[0]!;
    let now = NOW;
    const clock = createTaskClock(() => now);
    const tree = await render(cardElement(base, { compact, now: undefined, clock }));
    await act(async () => hostByTestId(tree.root, "pill-subtasks").props.onPress());
    const meta = () => hostByTestId(tree.root, `subtask-meta-${child.id}`);
    expect(texts(meta())).toEqual(["Opus 4.7", "High", "Bypass", formatClockTime(NOW - 3 * 60_000, NOW), "3m"]);
    expect(flat(meta().props.style).flexWrap).toBe("nowrap");
    expect(icons(meta())).toEqual(["Brain", "ShieldOff", "Clock", "Hourglass"]);
    expect(hostByTestId(meta(), "context-ring")).toBeDefined();
    expect(meta().findByType(ContextRing).props.ratio).toBe(0.6);
    now += 1000;
    await act(async () => clock.tick());
    expect(texts(meta())).toContain("3m 1s");
    await act(async () => tree.update(cardElement({ ...base, children: [{ ...child, context: { usedTokens: 190_000, maxTokens: 200_000 }, status: "needs_input" }] }, { compact, now: NOW })));
    expect(texts(meta())).toContain("等待输入");
    expect(texts(meta()).some((text) => text.includes("上下文"))).toBe(false);
    expect(meta().findByType(ContextRing).props).toMatchObject({ ratio: 0.95, color: taskTokens(LIGHT).danger });
  });

  it.each([true, false])("omits absent subtask metadata and keeps a title-only child usable (compact=%s)", async (compact) => {
    const base = sample("sample-running");
    const child: TaskChild = { id: "sparse", title: "No metadata", status: "done" };
    const tree = await render(cardElement({ ...base, children: [child] }, { compact }));
    await act(async () => hostByTestId(tree.root, "pill-subtasks").props.onPress());
    expect(texts(hostByTestId(tree.root, "subtask-content-sparse"))).toEqual(["No metadata"]);
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "subtask-meta-sparse")).toHaveLength(0);
  });

  it("marks a subtask row's agent icon with its status in every state, archived as the muted box", async () => {
    const base = sample("sample-running");
    const kinds = ["running", "needs_input", "unread", "failed", "done", "archived"] as const;
    const children: TaskChild[] = kinds.map((status) => ({ ...base.children[2]!, id: `child-${status}`, title: status, status }));
    const tree = await render(cardElement({ ...base, children }));
    await act(async () =>
      tree.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityState?.expanded === false).props.onPress(),
    );
    const list = hostByTestId(tree.root, "task-card-subtasks");
    for (const status of kinds) {
      const slot = hostByTestId(list, `subtask-status-child-${status}`);
      expect(slot.findAll((node) => typeof node.type === "string" && node.props.testID === `status-${status}`)).toHaveLength(1);
    }
    expect(icons(hostByTestId(list, "subtask-status-child-done"))).toContain("CircleCheck");
    expect(icons(hostByTestId(list, "subtask-status-child-archived"))).toContain("Archive");
  });

  it("draws a provider subagent's row as Paseo's track, ending with a parent-tab arrow; a press on the row reveals its card", async () => {
    const base = sample("sample-running");
    const subagent: TaskChild = {
      id: "sub-1",
      title: "mac studio run check",
      status: "running",
      kind: "provider",
      subtitle: "general-purpose · Opus 5.5 · High · 132.8k tokens",
      subagentType: "general-purpose",
      provider: "claude",
      lane: "running",
      timing: base.children[0]!.timing,
    };
    const onReveal = vi.fn();
    const onOpen = vi.fn();
    const tree = await render(cardElement({ ...base, children: [...base.children, subagent] }, { onReveal, onOpen }));
    await act(async () =>
      tree.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityState?.expanded === false).props.onPress(),
    );
    const list = hostByTestId(tree.root, "task-card-subtasks");
    // Drawn without a hover: the button is what tells it from a child with a tab of its own.
    expect(icons(hostByTestId(list, "subtask-parent-tab-sub-1"))).toEqual(["CornerLeftUp"]);
    // Provider facts and timing use the same secondary component as ordinary subtasks.
    const facts = hostByTestId(list, "subtask-meta-sub-1");
    expect(texts(facts)[0]).toBe("Opus 5.5 · High · 132.8k tokens");
    expect(icons(facts)).toEqual(["Clock", "Hourglass"]);
    expect(icons(hostByTestId(list, "subtask-status-sub-1"))).toContain("Shapes");
    expect(texts(hostByTestId(list, "subtask-time-sub-1"))).toEqual([formatClockTime(NOW - 3 * 60_000, NOW), "3m"]);
    for (const child of base.children) expect(list.findAll((node) => node.props.testID === `subtask-parent-tab-${child.id}`)).toHaveLength(0);
    // The row reveals the subagent's card, naming the parent for the board's fallback; the button opens the parent's tab.
    byLabel(tree.root, "mac studio run check 运行中").props.onPress();
    expect(onReveal).toHaveBeenCalledWith("sub-1", base.id);
    expect(onOpen).not.toHaveBeenCalled();
    byLabel(list, "在父任务的 tab 中打开").props.onPress();
    expect(onOpen).toHaveBeenCalledWith(base.id);
  });

  it("draws a provider subagent's card read-only: its facts line, no Stop, a press chooses it for the details", async () => {
    const base = sample("sample-running");
    const card: TaskCard = {
      ...base,
      id: "sub-1",
      title: "mac studio run check",
      model: null,
      modelLabel: null,
      thinkingLabel: null,
      context: null,
      usage: null,
      children: [],
      stoppable: false,
      parent: { id: base.id, title: base.title, missing: false, archived: false },
      subagent: { subtitle: "general-purpose · Opus 5.5 · High · 12.4k tokens", type: "general-purpose" },
    };
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    const onDetails = vi.fn();
    const onStop = vi.fn();
    const tree = await render(cardElement(card, { onOpen, onSelect, onDetails, onStop }));
    // The type as the timeline's icon in place of its name; the screen reader still hears it.
    expect(texts(hostByTestId(tree.root, "pill-model"))).toContain("Opus 5.5 · High · 12.4k tokens");
    expect(icons(hostByTestId(tree.root, "pill-model"))).toEqual(["Shapes"]);
    expect(hostByTestId(tree.root, "pill-model").props.accessibilityLabel).toBe(`${base.providerLabel} general-purpose · Opus 5.5 · High · 12.4k tokens`);
    // The facts line is not a model name to copy.
    expect(hostByTestId(tree.root, "pill-model").props.accessibilityRole).not.toBe("button");
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-stop")).toHaveLength(0);
    // Dashed and flat at rest: work inside its parent's session, not a task of its own.
    expect(flat(hostByTestId(tree.root, "task-card-sub-1").props.style)).toMatchObject({ borderStyle: "dashed", borderWidth: 1, boxShadow: "none" });
    await act(async () => byLabel(tree.root, "mac studio run check").props.onPress());
    // Chosen for the details as any card; Open goes through the board, which opens the parent's.
    expect(onSelect).toHaveBeenCalledWith(card);
    expect(onOpen).not.toHaveBeenCalled();
    // As any subtask: Open, and Open parent before it, both opening the parent's tab, since a subagent has none of its own.
    expect(texts(hostByTestId(tree.root, "task-card-control-row"))).toEqual(["打开父任务", "打开"]);
    await act(async () => byLabel(tree.root, "打开父任务").props.onPress());
    expect(onOpen).toHaveBeenCalledWith(base.id);
    expect(texts(hostByTestId(tree.root, "task-card-meta-parent"))).toEqual([base.title]);
    // Its id is a tool call's: the menu copies no session ID.
    const keys = cardMenuSections(card, cardStrings("en"), { copy: () => {}, open: () => {}, children: 0 }).flatMap((section) => section.items.map((item) => item.key));
    expect(keys).toEqual(["open", "copy-title", "copy-workspace", "copy-project"]);
    const items = cardMenuSections(card, cardStrings("zh"), { copy: () => {}, open: () => {}, openParent: () => {}, revealParent: () => {}, children: 0 })[0]!.items;
    expect(items.map((item) => item.icon)).toEqual(["ArrowUpRight", "CornerLeftUp", "LocateFixed"]);
    const open = items.map((item) => item.label);
    expect(open).toEqual(["打开", "打开父任务", "显示父任务卡片"]);
  });

  it("draws a provider subagent's pill as an agent's when its line names an effort but no model", async () => {
    const base = sample("sample-running");
    const card: TaskCard = {
      ...base,
      id: "sub-2",
      title: "Subagent",
      model: null,
      // As withSubagentCards reads "general-purpose · High · 518k tokens": the model is inherited, unnamed.
      modelLabel: null,
      thinkingLabel: "High",
      context: null,
      usage: null,
      children: [],
      stoppable: false,
      parent: { id: base.id, title: base.title, missing: false, archived: false },
      subagent: { subtitle: "general-purpose · High · 518k tokens", type: "general-purpose" },
    };
    const tree = await render(cardElement(card, {}));
    const pill = hostByTestId(tree.root, "pill-model");
    // The type's icon, the agent's name in the model's place, then the Brain-marked effort; no token count.
    expect(icons(pill)).toEqual(["Shapes", "Brain"]);
    expect(texts(pill).join("")).toBe(`${base.providerLabel}·High`);
    expect(pill.props.accessibilityLabel).toBe(`${base.providerLabel} general-purpose · High · 518k tokens`);
  });

  it("ends a subtask row that finished on another day with a short stamp, leaving the title room", async () => {
    const card = sample("sample-running");
    const child = card.children[2]!;
    child.timing = { ...child.timing!, lastTurnEndedAt: new Date(2026, 9, 19, 16, 57, 33).toISOString(), lastTurnMs: 60_000 };
    const tree = await render(cardElement(card, { now: new Date(2026, 9, 20, 12).getTime() }));
    await act(async () =>
      tree.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityState?.expanded === false).props.onPress(),
    );
    expect(texts(hostByTestId(tree.root, "subtask-time-sample-child-3"))).toEqual(["1m · 10-19 16:57"]);
  });

  it.each([false, true])("prepares native subtask layout before updating board expansion (expanded=%s)", async (expanded) => {
    const card = sample("sample-running");
    const onSubtasksExpandedChange = vi.fn((id: string, next: boolean) => {
      expect(id).toBe(card.id);
      expect(next).toBe(!expanded);
      expect(motion.layouts).toHaveBeenCalledExactlyOnceWith({
        duration: expanded ? 140 : 180,
        update: { type: "easeOut" },
      });
    });
    const tree = await render(cardElement(card, { compact: true, animated: true, subtasksExpanded: expanded, onSubtasksExpandedChange }));
    expect(motion.layouts).not.toHaveBeenCalled();
    await act(async () => hostByTestId(tree.root, "pill-subtasks").props.onPress());
    expect(onSubtasksExpandedChange).toHaveBeenCalledOnce();
  });

  it.each(["reduced", "static"])("does not prepare a native subtask transition for %s motion", async (mode) => {
    motion.reduced = mode === "reduced";
    const onSubtasksExpandedChange = vi.fn();
    const tree = await render(cardElement(sample("sample-running"), {
      animated: mode !== "static", subtasksExpanded: false, onSubtasksExpandedChange,
    }));
    try {
      if (mode === "reduced") await act(async () => motion.reduceListeners.forEach((listener) => listener(true)));
      await act(async () => hostByTestId(tree.root, "pill-subtasks").props.onPress());
      expect(onSubtasksExpandedChange).toHaveBeenCalledOnce();
      expect(motion.layouts).not.toHaveBeenCalled();
    } finally {
      await act(async () => motion.reduceListeners.forEach((listener) => listener(false)));
    }
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
    clipboard.error.mockClear();
    folder.reveal.mockReset();
    folder.reveal.mockResolvedValue({ revealed: "/repo", error: null });
    resetSectionChoices();
  });

  const details = (card: TaskCard, more: Record<string, unknown> = {}, language: "zh" | "en" = "zh") =>
    React.createElement(TaskDetailCards, { card, theme: LIGHT, now: NOW, language, strings: BOARD_STRINGS[language].sidebar, ...more });

  it("uses identical shared rows in expanded cards, the sidebar and the mobile sheet", async () => {
    seedMarkBitmaps({ "lobe:codex": MARK_BITMAPS["lobe:codex"]!, "lobe:claude": MARK_BITMAPS["lobe:claude"]! });
    const base = sample("sample-running");
    const provider: TaskChild = { ...base.children[0]!, id: "provider", kind: "provider", subtitle: "general-purpose · High · 132.8k tokens", subagentType: "general-purpose", modelLabel: null, thinkingLabel: null, modeLabel: null, context: null };
    const card = { ...base, children: [...base.children, provider] };
    const onOpen = vi.fn();
    const surfaces = [
      cardElement(card, { subtasksExpanded: true, onOpen }),
      details(card, { touch: false, scrollBody: true, onOpen, onJump: vi.fn() }),
      details(card, { touch: true, onOpen, onJump: vi.fn() }),
    ];
    const layouts: unknown[] = [];
    for (const surface of surfaces) {
      const tree = await render(surface);
      const rows = tree.root.findAllByType(SubtaskRow);
      expect(rows.map((row) => row.props.child.id).sort()).toEqual(card.children.map((child) => child.id).sort());
      // Native surfaces all use the same touch targets, even a wide tablet sidebar.
      expect(rows.every((row) => row.props.touch)).toBe(true);
      const byId = card.children.map((child) => {
        const row = rows.find((candidate) => candidate.props.child.id === child.id)!;
        expect(row.findAllByType(SubtaskMetadata)).toHaveLength(1);
        const mark = row.findByType(ChildMark);
        expect(mark.props.child.provider).toBe(child.provider);
        if (child.kind === "provider") {
          expect(mark.findAll((node) => (node.type as unknown) === "Image")).toHaveLength(0);
          expect(icons(mark)).toContain("Shapes");
        } else {
          const brand = mark.find((node) => (node.type as unknown) === "Image");
          expect(brand.props.source.uri).toBe(MARK_BITMAPS[`lobe:${child.provider}`]);
          expect(flat(brand.props.style)).toMatchObject({ width: 14, height: 14 });
        }
        // The status shares the identity mark's frame, overlapping its bottom-right corner.
        expect(mark.findAll((node) => typeof node.type === "string" && flat(node.props.style).position === "absolute" && flat(node.props.style).right === -5 && flat(node.props.style).bottom === -5)).toHaveLength(1);
        return row.findAll((node) => typeof node.type === "string").map((node) => ({
          type: node.type,
          style: flat(node.props.style),
          lines: node.props.numberOfLines,
          icon: node.props.name,
        }));
      });
      layouts.push(byId);
      await act(async () => tree.unmount());
    }
    expect(layouts[1]).toEqual(layouts[0]);
    expect(layouts[2]).toEqual(layouts[0]);
  });

  it.each([
    { type: "Explore", icon: "Search" },
    { type: "Plan", icon: "ListChecks" },
    { type: "general-purpose", icon: "Shapes" },
  ])("combines the provider subagent's $type icon with its status in every surface", async ({ type, icon }) => {
    const base = sample("sample-running");
    for (const status of ["running", "failed"] as const) {
      const child: TaskChild = { ...base.children[0]!, kind: "provider", subagentType: type, subtitle: null, status, lane: status === "running" ? "running" : "review", modelLabel: null, thinkingLabel: null, modeLabel: null, context: null };
      const card = { ...base, children: [child] };
      for (const element of [cardElement(card, { subtasksExpanded: true }), details(card, { touch: false }), details(card, { touch: true })]) {
        const tree = await render(element);
        const row = tree.root.findByType(SubtaskRow);
        const mark = row.findByType(ChildMark);
        expect(icons(mark)).toContain(icon);
        expect(mark.findAll((node) => (node.type as unknown) === "Image")).toHaveLength(0);
        expect(hostByTestId(mark, `status-${status}`)).toBeDefined();
        expect(icons(row.findByType(SubtaskMetadata))).not.toContain(icon);
        await act(async () => tree.unmount());
      }
    }
  });

  it.each(["card", "sidebar", "sheet"] as const)("hides optional running metadata only in a narrow column and restores it (%s)", async (surface) => {
    const base = sample("sample-running");
    const child = { ...base.children[0]!, provider: "codex", modeLabel: "Full Access" };
    const card = { ...base, children: [child] };
    const tree = await render(surface === "card"
      ? cardElement(card, { subtasksExpanded: true })
      : details(card, { touch: surface === "sheet", scrollBody: surface === "sidebar", onOpen: vi.fn(), onJump: vi.fn() }));
    const prefix = surface === "card" ? "subtask" : "detail-subtask";
    const meta = () => hostByTestId(tree.root, `${prefix}-meta-${child.id}`);
    const resize = async (width: number) => act(async () => meta().props.onLayout({ nativeEvent: { layout: { width, height: 40 } } }));
    await resize(400);
    expect(texts(meta())).toContain("Full Access");
    expect(icons(meta())).toEqual(["Brain", "ShieldOff", "Clock", "Hourglass"]);
    await resize(240);
    expect(texts(meta())).toEqual([child.modelLabel, child.thinkingLabel]);
    expect(icons(meta())).toEqual(["Brain", "ShieldOff"]);
    expect(meta().findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Full Access" && node.props.accessible === true)).toHaveLength(1);
    expect(meta().findByType(ContextRing).props.ratio).toBe(0.6);
    expect(hostByTestId(tree.root, `${prefix}-status-${child.id}`).findAllByType(ChildMark)).toHaveLength(1);
    expect(hostByTestId(tree.root, `${prefix}-title-${child.id}`).props.numberOfLines).toBe(1);
    await resize(241);
    expect(texts(meta())).toContain("Full Access");
    expect(icons(meta())).toEqual(["Brain", "ShieldOff", "Clock", "Hourglass"]);
  });

  it("keeps measuring a runtime-only row while its secondary information is hidden", async () => {
    const base = sample("sample-running");
    const child: TaskChild = { id: "runtime-only", title: "Only runtime", status: "running", lane: "running", timing: base.children[0]!.timing };
    const tree = await render(details({ ...base, children: [child] }));
    const meta = () => hostByTestId(tree.root, "detail-subtask-meta-runtime-only");
    await act(async () => meta().props.onLayout({ nativeEvent: { layout: { width: 180, height: 40 } } }));
    expect(texts(meta())).toEqual([]);
    await act(async () => meta().props.onLayout({ nativeEvent: { layout: { width: 400, height: 0 } } }));
    expect(texts(meta())).toEqual([formatClockTime(NOW - 3 * 60_000, NOW), "3m"]);
  });

  it.each([
    ["medium", "m"], ["Medium", "m"], ["high", "h"], ["High", "h"],
    ["Xhigh", "xh"], ["xhigh", "xh"], ["Extra High", "xh"], ["Low", "l"],
    ["None", "n"], ["Minimal", "min"], ["Max", "max"], ["Custom effort", "Custom effort"],
    [" MEDIUM ", "m"], ["constructor", "constructor"],
  ])("abbreviates subtask thinking labels while keeping card and details pills in full (%s)", async (thinkingLabel, expected) => {
    const base = sample("sample-running");
    const child = { ...base.children[0]!, thinkingLabel };
    const card = { ...base, children: [child] };
    for (const surface of ["card", "sidebar", "sheet"]) {
      const tree = await render(surface === "card"
        ? cardElement(card, { subtasksExpanded: true })
        : details(card, { touch: surface === "sheet" }));
      const prefix = surface === "card" ? "subtask" : "detail-subtask";
      const meta = () => hostByTestId(tree.root, `${prefix}-meta-${child.id}`);
      expect(texts(meta())).toContain(thinkingLabel);
      await act(async () => meta().props.onLayout({ nativeEvent: { layout: { width: 300 } } }));
      await act(async () => hostByTestId(tree.root, `${prefix}-meta-measure-${child.id}`).props.onLayout({ nativeEvent: { layout: { width: 390 } } }));
      expect(texts(meta())).toContain(expected);
      expect(icons(meta())).toContain("Brain");
      if (expected !== thinkingLabel) {
        expect(texts(meta())).not.toContain(thinkingLabel);
        expect(meta().findAll((node) => typeof node.type === "string" && node.props.accessible === true && node.props.accessibilityLabel === thinkingLabel)).toHaveLength(1);
      }
      await act(async () => meta().props.onLayout({ nativeEvent: { layout: { width: 400 } } }));
      expect(texts(meta())).toContain(thinkingLabel);
      await act(async () => tree.unmount());
    }
    for (const compact of [false, true]) {
      const parent = { ...base, thinkingLabel, children: [] };
      const combined = await render(cardElement(parent, { compact }));
      expect(texts(hostByTestId(combined.root, "agent-pill-thinking"))).toEqual([thinkingLabel]);
      expect(hostByTestId(combined.root, "pill-model").props.accessibilityLabel).toContain(thinkingLabel);
      await act(async () => combined.unmount());
      if (!compact) {
        const separate = await render(cardElement(parent, { fields: fields("standard", { provider: false, model: false }) }));
        expect(texts(hostByTestId(separate.root, "pill-thinking"))).toEqual([thinkingLabel]);
        await act(async () => separate.unmount());
      }
      const detail = await render(details(parent, { touch: compact }));
      expect(texts(hostByTestId(detail.root, "detail-thinking"))).toEqual([thinkingLabel]);
      await act(async () => detail.unmount());
    }
  });

  it.each(["card", "sidebar", "sheet"] as const)("omits unread text at every width and folds permission text to keep one metadata line (%s)", async (surface) => {
    for (const language of ["zh", "en"] as const) {
      for (const modeLabel of ["Full Access", "Default Permissions", "Bypass", "Allow All", "Plan Mode", "Custom permissions"]) {
        const base = sample("sample-running");
        const child: TaskChild = { ...base.children[0]!, title: "Child layout", status: "unread", lane: "review", modeLabel };
        const card = { ...base, children: [child] };
        const tree = await render(surface === "card"
          ? cardElement(card, { language, subtasksExpanded: true })
          : details(card, { touch: surface === "sheet", scrollBody: surface === "sidebar" }, language));
        const prefix = surface === "card" ? "subtask" : "detail-subtask";
        const meta = () => hostByTestId(tree.root, `${prefix}-meta-${child.id}`);
        const words = cardStrings(language);
        const resize = async (width: number) => act(async () => meta().props.onLayout({ nativeEvent: { layout: { width } } }));
        for (const width of [0, 241, 240, 180, 400]) {
          await resize(width);
          const narrow = width > 0 && width <= 240;
          const folded = narrow;
          expect(texts(meta()).includes(modeLabel)).toBe(!folded);
          expect(texts(meta())).not.toContain(words.details.subtaskUnread);
          expect(hostByTestId(tree.root, `${prefix}-${child.id}`).props.accessibilityLabel).toBe(`Child layout ${words.status.unread}`);
          expect(hostByTestId(tree.root, `${prefix}-status-${child.id}`).findAll((node) => typeof node.type === "string" && node.props.testID === "status-unread")).toHaveLength(1);
          expect(icons(meta())).toContain(modeIcon(child.provider!, modeLabel));
          expect(meta().findByType(ContextRing).props.ratio).toBe(0.6);
          expect(hostByTestId(meta(), `${prefix}-time-${child.id}`)).toBeDefined();
          expect(flat(meta().props.style).flexWrap).toBe("nowrap");
          expect(flat(hostByTestId(meta(), `${prefix}-time-${child.id}`).props.style).flexWrap).toBe("nowrap");
          expect(meta().findAll((node) => (node.type as unknown) === "Text").every((node) => node.props.numberOfLines === 1)).toBe(true);
          if (folded) {
            const mode = meta().find((node) => typeof node.type === "string" && node.props.accessibilityLabel === modeLabel && node.props.accessible === true);
            expect(flat(mode.props.style)).toMatchObject({ minWidth: 12, flexShrink: 0, gap: 0 });
          }
        }
        // A wide column can still overflow with long labels or timing.
        await resize(300);
        const probe = () => hostByTestId(tree.root, `${prefix}-meta-measure-${child.id}`);
        await act(async () => probe().props.onLayout({ nativeEvent: { layout: { width: 390 } } }));
        expect(texts(meta())).not.toContain(words.details.subtaskUnread);
        expect(texts(meta())).not.toContain(modeLabel);
        await resize(400);
        expect(texts(meta())).not.toContain(words.details.subtaskUnread);
        expect(texts(meta())).toContain(modeLabel);
        await act(async () => tree.unmount());
      }
    }
  });

  it.each(["zh", "en"] as const)("omits an unread-only metadata line while keeping its accessible status (%s)", async (language) => {
    const child: TaskChild = { id: "unread-only", title: "Child layout", status: "unread" };
    const card = { ...sample("sample-running"), children: [child] };
    for (const surface of ["card", "sidebar", "sheet"]) {
      for (const ui of [14, 21]) {
        const theme = { ...LIGHT, typography: { fontSize: { ui } } };
        const tree = await render(React.createElement(TasksTypography, {
          theme,
          children: surface === "card"
            ? cardElement(card, { language, subtasksExpanded: true })
            : details(card, { touch: surface === "sheet" }, language),
        }));
        const prefix = surface === "card" ? "subtask" : "detail-subtask";
        expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === `${prefix}-meta-unread-only`)).toHaveLength(0);
        expect(texts(hostByTestId(tree.root, `${prefix}-content-unread-only`))).toEqual([child.title]);
        expect(hostByTestId(tree.root, `${prefix}-unread-only`).props.accessibilityLabel).toBe(`${child.title} ${cardStrings(language).status.unread}`);
        await act(async () => tree.unmount());
      }
    }
  });

  it("keeps overflowing permission text folded across clock ticks and invalidates measurements when labels change", async () => {
    let now = NOW;
    const clock = createTaskClock(() => now);
    const base = sample("sample-running");
    const child = { ...base.children[0]!, modeLabel: "Full Access" };
    const element = (modelLabel = child.modelLabel) => details({ ...base, children: [{ ...child, modelLabel }] }, { now: undefined, clock });
    const tree = await render(element());
    const meta = () => hostByTestId(tree.root, `detail-subtask-meta-${child.id}`);
    const probe = () => hostByTestId(tree.root, `detail-subtask-meta-measure-${child.id}`);
    await act(async () => meta().props.onLayout({ nativeEvent: { layout: { width: 300 } } }));
    await act(async () => probe().props.onLayout({ nativeEvent: { layout: { width: 390 } } }));
    expect(texts(meta())).not.toContain("Full Access");
    now += 1000;
    await act(async () => clock.tick());
    expect(texts(meta())).not.toContain("Full Access");
    expect(texts(meta())).toContain("3m 1s");
    await act(async () => tree.update(element("Short model")));
    await act(async () => probe().props.onLayout({ nativeEvent: { layout: { width: 280 } } }));
    expect(texts(meta())).toContain("Full Access");
  });

  it("measures full thinking labels without a mode and restores them across width and font changes", async () => {
    const child: TaskChild = { id: "effort-only", title: "Effort", status: "done", thinkingLabel: "Medium" };
    const card = { ...sample("sample-running"), children: [child] };
    const element = (ui: number) => {
      const theme = { ...LIGHT, typography: { fontSize: { ui } } };
      return React.createElement(TasksTypography, { theme, children: details(card) });
    };
    const tree = await render(element(14));
    const meta = () => hostByTestId(tree.root, "detail-subtask-meta-effort-only");
    const probe = () => hostByTestId(tree.root, "detail-subtask-meta-measure-effort-only");
    const resize = async (width: number) => act(async () => meta().props.onLayout({ nativeEvent: { layout: { width } } }));
    const measure = async (width: number) => act(async () => probe().props.onLayout({ nativeEvent: { layout: { width } } }));
    await measure(80);
    await resize(0);
    expect(texts(meta())).toEqual(["Medium"]);
    await resize(80);
    expect(texts(meta())).toEqual(["Medium"]);
    await resize(79);
    expect(texts(meta())).toEqual(["m"]);
    // The probe keeps the full label while the visible row uses its abbreviation.
    expect(probe().findAll((node) => (node.type as unknown) === "Text").map((node) => node.children.join(""))).toEqual(["Medium"]);
    await resize(80);
    expect(texts(meta())).toEqual(["Medium"]);
    await act(async () => tree.update(element(21)));
    await measure(120);
    expect(texts(meta())).toEqual(["m"]);
    await act(async () => tree.update(element(14)));
    await measure(80);
    expect(texts(meta())).toEqual(["Medium"]);
  });

  it.each(["failed", "done"] as const)("preserves attention and finished timing in a narrow single-line row (%s)", async (status) => {
    const base = sample("sample-running");
    const child: TaskChild = { ...base.children[2]!, status, lane: status === "failed" ? "review" : "done", modeLabel: "Bypass" };
    const tree = await render(details({ ...base, children: [child] }));
    const meta = () => hostByTestId(tree.root, `detail-subtask-meta-${child.id}`);
    const timeId = `detail-subtask-time-${child.id}`;
    const before = texts(hostByTestId(meta(), timeId));
    await act(async () => meta().props.onLayout({ nativeEvent: { layout: { width: 180 } } }));
    expect(texts(hostByTestId(meta(), timeId))).toEqual(before);
    expect(texts(meta())).not.toContain("Bypass");
    expect(icons(meta())).toContain("ShieldOff");
    expect(before.length).toBeGreaterThan(0);
    if (status === "failed") expect(texts(meta())).toContain(cardStrings("zh").details.subtaskFailed);
  });

  it.each(["Full Access", "Plan Mode", "Bypass"])("preserves waiting time and attention status in a narrow row (%s)", async (modeLabel) => {
    const base = sample("sample-running");
    const child = { ...base.children[0]!, status: "needs_input" as const, lane: "needs_input" as const, modeLabel };
    const tree = await render(details({ ...base, children: [child] }));
    const meta = () => hostByTestId(tree.root, `detail-subtask-meta-${child.id}`);
    await act(async () => meta().props.onLayout({ nativeEvent: { layout: { width: 180, height: 40 } } }));
    expect(texts(meta())).toContain("等待输入");
    expect(icons(meta())).toContain("Clock");
    expect(meta().findByType(ContextRing).props.ratio).toBe(0.6);
    expect(texts(meta())).not.toContain(modeLabel);
    expect(icons(meta())).toContain(modeIcon(child.provider!, modeLabel));
    expect(meta().findAll((node) => typeof node.type === "string" && node.props.accessible === true && node.props.accessibilityLabel === modeLabel)).toHaveLength(1);
  });

  it("adapts the width threshold when the host font changes without another layout event", async () => {
    const base = sample("sample-running");
    const child = { ...base.children[0]!, modeLabel: "Full Access" };
    const element = (ui: number) => {
      const theme = { ...LIGHT, typography: { fontSize: { ui } } };
      return React.createElement(TasksTypography, { theme, children: details({ ...base, children: [child] }) });
    };
    const tree = await render(element(14));
    const meta = () => hostByTestId(tree.root, `detail-subtask-meta-${child.id}`);
    await act(async () => meta().props.onLayout({ nativeEvent: { layout: { width: 300, height: 40 } } }));
    expect(texts(meta())).toContain("Full Access");
    await act(async () => tree.update(element(21)));
    expect(texts(meta())).not.toContain("Full Access");
    await act(async () => tree.update(element(14)));
    expect(texts(meta())).toContain("Full Access");
  });

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

  it("leaves the session's tokens out of the running turn when none are read", async () => {
    const tree = await render(details(sample("sample-running"), { sessionTokens: null }));
    expect(texts(hostByTestId(tree.root, "detail-turn"))).toEqual(["本轮计时", "12:30", "上一轮 18m", "上下文", "86%", "172k / 200k"]);
    expect(tree.root.findAll((node) => node.props.testID === "detail-turn-tokens")).toHaveLength(0);
    // The timer beside the context, its ring at full size.
    expect(flat(hostByTestId(tree.root, "detail-context").props.style)).toMatchObject({ flex: 1, flexDirection: "row", borderLeftWidth: 1 });
    expect(tree.root.findAll((node) => (node.type as { name?: string }).name === "ProgressRing")[0]!.props).toMatchObject({ size: 44 });
  });

  it("heads with the status, the title, the agent's chips and the actions, then the running turn", async () => {
    const onOpen = vi.fn();
    const tree = await render(details(sample("sample-running"), { onOpen, sessionTokens: { total: 15_322_587, cached: 14_943_278 } }));
    const header = hostByTestId(tree.root, "detail-header");
    expect(texts(header).slice(0, 11)).toEqual(["运行中", "本轮 12:30", "Port the status ring to React Native", "GPT-5.5 Codex", "Medium", "Bypass", "frontend", "p1", "board", "切换到 tab", "已打开"]);
    // The turn's block: its clock, the session's tokens so far and the context ring (86% is past the warning line).
    const turn = hostByTestId(tree.root, "detail-turn");
    expect(texts(turn)).toEqual(["本轮计时", "12:30", "上一轮 18m", "累计 token", "15.3M", "缓存占 98%", "上下文", "86%", "172k / 200k"]);
    expect(turn.findAll((node) => (node.type as { name?: string }).name === "ProgressRing")).toHaveLength(1);
    // One row of three alike cells: the ring shrinks to the context's label icon.
    const ring = turn.findAll((node) => (node.type as { name?: string }).name === "ProgressRing")[0]!;
    expect(ring.props).toMatchObject({ size: 14, stroke: 2 });
    expect(flat(hostByTestId(tree.root, "detail-context").props.style)).toMatchObject({ flex: 1, borderLeftWidth: 1 });
    expect(flat(hostByTestId(tree.root, "detail-context").props.style).flexDirection).toBeUndefined();
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

  it("keeps properties first while preserving state-specific section defaults", async () => {
    const order = (root: ReactTestInstance) =>
      root.findAll((node) => typeof node.type === "string" && ["detail-location", "detail-subtasks", "detail-usage", "detail-activity"].includes(node.props.testID)).map((node) => node.props.testID);
    const running = await render(details(sample("sample-running")));
    expect(order(running.root)).toEqual(["detail-location", "detail-subtasks", "detail-usage", "detail-activity"]);
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

  it.each(["ios", "android"])("hides folder opening on %s while keeping directory copy", async (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    try {
      for (const touch of [false, true]) {
        const card = sample("sample-running");
        const tree = await render(details(card, { touch }));
        const row = hostByTestId(tree.root, "detail-cwd");
        await act(async () => row.props.onHoverIn());
        expect(icons(row)).not.toContain("FolderOpen");
        await act(async () => row.props.onPress());
        expect(clipboard.copyText).toHaveBeenLastCalledWith(card.location.cwd);
        expect(folder.reveal).not.toHaveBeenCalled();
        await act(async () => tree.unmount());
      }
    } finally {
      delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
    }
  });

  it("offers Unarchive for an archived parent where the host can, else says it cannot open", async () => {
    const orphan = { ...sample("sample-child-1"), parent: { id: "gone", title: "多设备连接", missing: true, archived: true } };
    const plain = await render(details(orphan, { onJump: vi.fn() }));
    expect(texts(hostByTestId(plain.root, "detail-parent"))).toEqual(["多设备连接", "已归档", "无法跳转"]);
    expect(icons(hostByTestId(plain.root, "detail-parent-tag"))).toEqual(["Archive"]);
    expect(plain.root.findAll((node) => node.props.testID === "detail-parent-unarchive")).toHaveLength(0);
    await act(async () => plain.unmount());
    renderer = null;

    const unarchive = { pending: vi.fn(() => false), press: vi.fn() };
    const tree = await render(details(orphan, { onJump: vi.fn(), unarchive }));
    expect(texts(hostByTestId(tree.root, "detail-parent"))).toEqual(["多设备连接", "已归档", "取消归档"]);
    // The card's Allow look: the accent outline and its icon.
    const card = taskTokens(LIGHT).card;
    expect(flat(hostByTestId(tree.root, "detail-parent-unarchive").props.style)).toMatchObject({ backgroundColor: "transparent", borderColor: card.primaryBorder, borderRadius: 6 });
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

  it("offers Archive beside Open in a done task's header", async () => {
    const archive = { pending: vi.fn(() => false), press: vi.fn() };
    const done = sample("sample-done");
    const tree = await render(details(done, { onOpen: vi.fn(), archive }));
    const actions = hostByTestId(tree.root, "detail-actions");
    const order = actions.findAll((node) => typeof node.type === "string" && typeof node.props.testID === "string" && /^detail-(open|archive)$/.test(node.props.testID)).map((node) => node.props.testID);
    expect(order).toEqual(["detail-open", "detail-archive"]);
    expect(texts(hostByTestId(tree.root, "detail-archive"))).toEqual(["归档"]);
    expect(flat(hostByTestId(tree.root, "detail-archive").props.style)).toMatchObject({ backgroundColor: taskTokens(LIGHT).card.background, borderColor: taskTokens(LIGHT).card.archiveBorder });
    await act(async () => hostByTestId(tree.root, "detail-archive").props.onPress());
    expect(archive.press).toHaveBeenCalledWith(done.id);

    archive.pending.mockReturnValue(true);
    await act(async () => tree.update(details(done, { onOpen: vi.fn(), archive: { ...archive } })));
    expect(hostByTestId(tree.root, "detail-archive").props.accessibilityState).toEqual({ disabled: true, busy: true });

    // A running or an archived task has none.
    await act(async () => tree.update(details(sample("sample-running"), { onOpen: vi.fn(), archive })));
    expect(tree.root.findAll((node) => node.props.testID === "detail-archive")).toHaveLength(0);
    await act(async () => tree.update(details({ ...done, lane: "archived", status: "archived", archived: "agent" }, { archive })));
    expect(tree.root.findAll((node) => node.props.testID === "detail-archive")).toHaveLength(0);
  });

  it("offers Unarchive in the header of an archived task, not of an archived workspace's", async () => {
    const archived = { ...sample("sample-done"), lane: "archived" as const, status: "archived" as const, archived: "agent" as const };
    const unarchive = { pending: vi.fn(() => false), press: vi.fn() };
    const tree = await render(details(archived, { onOpen: vi.fn(), unarchive }));
    expect(texts(hostByTestId(tree.root, "detail-header"))).toContain("已归档");
    expect(icons(hostByTestId(tree.root, "detail-header"))).toContain("Archive");
    expect(texts(hostByTestId(tree.root, "detail-unarchive"))).toEqual(["取消归档"]);
    await act(async () => hostByTestId(tree.root, "detail-unarchive").props.onPress());
    expect(unarchive.press).toHaveBeenCalledWith(archived.id);

    unarchive.pending.mockReturnValue(true);
    await act(async () => tree.update(details(archived, { onOpen: vi.fn(), unarchive: { ...unarchive } })));
    // Working: the same label, dimmed, a spinner where the icon was, no second press.
    const button = hostByTestId(tree.root, "detail-unarchive");
    expect(texts(button)).toEqual(["取消归档"]);
    expect(button.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(flat(button.props.style)).toMatchObject({ opacity: 0.6 });
    expect(icons(button)).not.toContain("ArchiveRestore");
    expect(hostByTestId(tree.root, "detail-unarchive-spinner")).toBeTruthy();

    // Paseo would drop an archived task's tab and show another: no Open until it is back, and Unarchive leads.
    expect(tree.root.findAll((node) => node.props.testID === "detail-open")).toHaveLength(0);
    expect(flat(hostByTestId(tree.root, "detail-unarchive").props.style).flexGrow).toBe(1);

    // Its workspace is archived, not the task: nothing of its own to bring back.
    await act(async () => tree.update(details({ ...archived, archived: "workspace" }, { onOpen: vi.fn(), unarchive })));
    expect(tree.root.findAll((node) => node.props.testID === "detail-unarchive")).toHaveLength(0);
    expect(tree.root.findAll((node) => node.props.testID === "detail-open").length).toBeGreaterThan(0);
    // A host without the CLI has no Unarchive at all.
    await act(async () => tree.update(details(archived, { onOpen: vi.fn(), unarchive: null })));
    expect(tree.root.findAll((node) => node.props.testID === "detail-unarchive")).toHaveLength(0);
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
      // The longest run first; every row uses the shared icon-led metadata.
      "Write the ring geometry test",
      start(312_000),
      "5m 12s",
      "Measure the sidebar ring",
      "Opus 4.7",
      "High",
      "Bypass",
      start(3 * 60_000),
      "3m",
      "Collect status colours",
      "18m · 2 分钟前",
    ]);
    // The running count is in the status colour, the rest muted.
    const summary = hostByTestId(running.root, "detail-subtasks").findAll((node) => (node.type as unknown) === "Text" && node.props.children === 2);
    expect(flat(summary[0]!.props.style).color).toBe(taskTokens(LIGHT).status.running);
    // The agent's mark leads each row, its status on the corner in every state, done too;
    // the secondary facts are muted, a finished row's title muted too.
    const tokens = taskTokens(LIGHT);
    const corner = (id: string) =>
      hostByTestId(section, `detail-subtask-status-${id}`)
        .findAll((node) => typeof node.type === "string" && typeof node.props.testID === "string" && node.props.testID.startsWith("status-"))
        .map((node) => node.props.testID);
    expect(corner("sample-child-2")).toContain("status-running");
    expect(corner("sample-child-3")).toEqual(["status-done"]);
    expect(icons(hostByTestId(section, "detail-subtask-status-sample-child-3"))).toContain("CircleCheck");
    expect(section.findAllByType(SubtaskMetadata)).toHaveLength(3);
    expect(section.findAll((node) => node.props.testID === "detail-subtasks-footnote")).toHaveLength(0);
    const doneTitle = hostByTestId(section, "detail-subtask-title-sample-child-3");
    expect(flat(doneTitle.props.style).color).toBe(tokens.foregroundMuted);
    // No progress ring any more: the counts say it.
    expect(byLabel(running.root, "收起子任务").findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "progressbar")).toEqual([]);
    byLabel(running.root, "Measure the sidebar ring 运行中").props.onPress();
    expect(onJump).toHaveBeenCalledWith("sample-child-1");
    // Hovering a row shows its open-tab button beside the title.
    const row = hostByTestId(section, "detail-subtask-sample-child-1");
    expect(section.findAllByType(SubtaskRow)).toHaveLength(3);
    await act(async () => row.props.onHoverIn());
    await act(async () => hostByTestId(running.root, "detail-subtask-open-sample-child-1").props.onPress());
    expect(onOpen).toHaveBeenCalledWith("sample-child-1");

    const allDone = sample("sample-running");
    // A finished child still unread (the green dot) counts as done.
    const finished = await render(details({ ...allDone, children: allDone.children.map((child, index) => ({ ...child, status: index === 0 ? ("unread" as const) : ("done" as const), lane: "done" as const })) }));
    expect(texts(hostByTestId(finished.root, "detail-subtasks"))).toContain("3 个全部完成");
    expect(icons(byLabel(finished.root, "收起子任务"))).toContain("CircleCheck");
    // All finished: no title steps back.
    const title = hostByTestId(finished.root, "detail-subtask-title-sample-child-3");
    expect(flat(title.props.style).color).toBe(tokens.foreground);
  });

  it.each([true, false])("keeps a detail subtask title on one line above its timing and metadata (touch=%s)", async (touch) => {
    const base = sample("sample-running");
    const child = { ...base.children[0]!, title: "RRD-12345 笔记编辑器与侧栏设置排版验证" };
    const sparse: TaskChild = { id: "sparse", title: "No metadata", status: "done" };
    const onJump = vi.fn();
    const onOpen = vi.fn();
    let now = NOW;
    const clock = createTaskClock(() => now);
    const tree = await render(details({ ...base, children: [child, sparse] }, { touch, onJump, onOpen, now: undefined, clock }));
    const row = hostByTestId(tree.root, `detail-subtask-${child.id}`);
    const title = hostByTestId(row, `detail-subtask-title-${child.id}`);
    const content = hostByTestId(row, `detail-subtask-content-${child.id}`);
    const secondary = hostByTestId(content, `detail-subtask-meta-${child.id}`);
    expect(title.props).toMatchObject({ numberOfLines: 1, ellipsizeMode: "tail" });
    expect(texts(title)).toEqual([child.title]);
    expect(icons(hostByTestId(row, `detail-subtask-meta-${child.id}`))).toEqual(["Brain", "ShieldOff", "Clock", "Hourglass"]);
    expect(hostByTestId(row, `detail-subtask-meta-${child.id}`).findByType(ContextRing).props.ratio).toBe(0.6);
    expect(flat(content.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
    expect(flat(content.props.style).flexDirection).toBeUndefined();
    expect((content.children[0] as ReactTestInstance).props.testID).toBe(`detail-subtask-title-${child.id}`);
    expect(flat(secondary.props.style)).toMatchObject({ flexDirection: "row", flexWrap: "nowrap" });
    expect(texts(hostByTestId(secondary, `detail-subtask-time-${child.id}`))).toEqual([formatClockTime(NOW - 3 * 60_000, NOW), "3m"]);
    expect(texts(secondary)).toEqual(["Opus 4.7", "High", "Bypass", formatClockTime(NOW - 3 * 60_000, NOW), "3m"]);
    expect(row.findByType(SubtaskMetadata).props.child).toBe(child);
    expect(flat(hostByTestId(row, `detail-subtask-status-${child.id}`).props.style).flexShrink).toBe(0);
    const before = flat(content.props.style);
    await act(async () => row.props.onHoverIn());
    expect(flat(content.props.style)).toEqual(before);
    row.props.onPress();
    expect(onJump).toHaveBeenCalledWith(child.id);
    const button = hostByTestId(row, `detail-subtask-open-${child.id}`);
    const buttonStyle = flat(button.props.style);
    expect(buttonStyle).toMatchObject({ position: "absolute", top: 0, right: 0, flexShrink: 0 });
    expect(buttonStyle.height).toBe(flat(title.props.style).lineHeight);
    expect(flat(title.props.style).marginRight).toBe(Number(buttonStyle.width) + 8);
    expect(flat(content.props.style).paddingRight).toBeUndefined();
    expect(flat(secondary.props.style).marginRight).toBeUndefined();
    expect(content.findAll((node) => node === button)).toHaveLength(1);
    if (touch) {
      row.props.onLongPress();
    } else {
      button.props.onPress();
    }
    expect(onOpen).toHaveBeenCalledWith(child.id);
    now += 1000;
    await act(async () => clock.tick());
    expect(texts(hostByTestId(secondary, `detail-subtask-time-${child.id}`))).toEqual([formatClockTime(NOW - 3 * 60_000, now), "3m 1s"]);
    expect(texts(hostByTestId(tree.root, "detail-subtask-content-sparse"))).toEqual([sparse.title]);
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
    const subagent: TaskChild = { id: "sub-1", title: "RRD-10161 desktop native fatal", status: "failed", kind: "provider", subtitle: "general-purpose · Opus 5.5 · High · 189.7k tokens", subagentType: "general-purpose", provider: "claude", lane: "review", timing: sample("sample-running").children[2]!.timing };
    const onOpen = vi.fn();
    const tree = await render(details({ ...base, children: [subagent] }, { onOpen }));
    const meta = hostByTestId(tree.root, "detail-subtask-meta-sub-1");
    expect(texts(meta)[0]).toBe("Opus 5.5 · High · 189.7k tokens");
    expect(icons(meta)).toEqual(["Hourglass"]);
    expect(meta.findAll((node) => (node.type as { name?: string }).name === "BrandMark")).toHaveLength(0);
    const mark = hostByTestId(tree.root, "detail-subtask-status-sub-1");
    expect(mark.findAll((node) => (node.type as { name?: string }).name === "BrandMark")).toHaveLength(0);
    expect(icons(mark)).toContain("Shapes");
    expect(mark.findAll((node) => typeof node.type === "string" && node.props.testID === "status-failed")).toHaveLength(1);
    const jump = hostByTestId(tree.root, "detail-subtask-parent-tab-sub-1");
    expect(icons(jump)).toEqual(["CornerLeftUp"]);
    jump.props.onPress();
    expect(onOpen).toHaveBeenCalledWith(base.id);
  });

  it("keeps shared metadata and context icons in a narrow card while abbreviating its heading", async () => {
    const tree = await render(details(sample("sample-running")));
    const section = hostByTestId(tree.root, "detail-subtasks");
    await act(async () => section.props.onLayout({ nativeEvent: { layout: { width: 320, height: 400 } } }));
    const shown = texts(hostByTestId(tree.root, "detail-subtasks"));
    expect(shown[1]).toBe("1/3 完成");
    const meta = hostByTestId(section, "detail-subtask-meta-sample-child-1");
    expect(texts(meta)).toEqual(["Opus 4.7", "High", "Bypass", formatClockTime(NOW - 3 * 60_000, NOW), "3m"]);
    expect(icons(meta)).toEqual(["Brain", "ShieldOff", "Clock", "Hourglass"]);
    expect(meta.findByType(ContextRing).props.ratio).toBe(0.6);
  });

  it.each([
    { status: "needs_input", lane: "needs_input", ratio: 0.8, word: "等待输入", tone: "warning", timerIcon: "Clock" },
    { status: "failed", lane: "review", ratio: 0.95, word: "失败", tone: "danger", timerIcon: "Hourglass" },
    { status: "unread", lane: "review", ratio: 0.6, word: "待查看", tone: "foregroundMuted", timerIcon: "Hourglass" },
  ] as const)("keeps per-child effort, mode and context with shared models ($status)", async ({ status, lane, ratio, word, tone, timerIcon }) => {
    const base = sample("sample-running");
    const child = { ...base.children[0]!, status, lane, context: { usedTokens: ratio * 200_000, maxTokens: 200_000 } };
    const card = { ...base, modelLabel: child.modelLabel!, thinkingLabel: child.thinkingLabel!, modeLabel: child.modeLabel!, children: [child, { ...child, id: "same-model" }] };
    const tree = await render(details(card, { touch: true }));
    const section = hostByTestId(tree.root, "detail-subtasks");
    await act(async () => section.props.onLayout({ nativeEvent: { layout: { width: 280, height: 400 } } }));
    for (const id of [child.id, "same-model"]) {
      const meta = hostByTestId(section, `detail-subtask-meta-${id}`);
      expect(texts(meta)).toEqual(expect.arrayContaining([child.modelLabel, child.thinkingLabel, child.modeLabel]));
      if (status === "unread") expect(texts(meta)).not.toContain(word);
      else expect(texts(meta)).toContain(word);
      expect(icons(meta)).toEqual(["Brain", "ShieldOff", timerIcon]);
      expect(meta.findByType(ContextRing).props).toMatchObject({ ratio, color: taskTokens(LIGHT)[tone] });
    }
  });

  it("shows the first prompt as Markdown, folded to four lines, copyable, and waits for Load on a closed agent", async () => {
    const text = ["Check whether this issue is handled:", "", "1. The board", "2. The sidebar", "3. The sheet", "4. The phone"].join("\n");
    const load = vi.fn();
    const tree = await render(details(sample("sample-failed"), { firstPrompt: { prompt: { state: "ready", text }, load } }, "en"));
    const sections = tree.root.findAll((node) => typeof node.type === "string" && ["detail-prompt", "detail-location", "detail-activity", "detail-usage"].includes(node.props.testID));
    expect(sections.map((node) => node.props.testID)).toEqual(["detail-location", "detail-prompt", "detail-activity", "detail-usage"]);
    const body = hostByTestId(tree.root, "detail-prompt-text");
    expect(body.props.style).toMatchObject({ maxHeight: 4 * 18, overflow: "hidden" });
    expect(texts(hostByTestId(tree.root, "detail-prompt"))).toEqual(["First prompt", "Check whether this issue is handled:", "The board\nThe sidebar\nThe sheet\nThe phone", "Show all · 6 lines"]);
    await act(async () => hostByTestId(tree.root, "detail-prompt-more").props.onPress());
    expect(hostByTestId(tree.root, "detail-prompt-text").props.style).toBeNull();
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

  it("scales both prompt and reply prose within the compact floating sidebar scope", async () => {
    const read = { prompt: { state: "ready", text: "A short message" } as const, load: vi.fn() };
    const content = () => details(sample("sample-failed"), { touch: true, firstPrompt: read, lastMessage: read }, "en");
    const tree = await render(content());
    expect(tree.root.findAllByType(MarkdownView).map((node) => node.props.size)).toEqual([15, 15]);
    await act(async () => tree.update(React.createElement(TasksTypographyScale, { factor: 0.9, children: content() })));
    expect(tree.root.findAllByType(MarkdownView).map((node) => node.props.size)).toEqual([14, 14]);
  });

  it("shows the latest reply under the first prompt, copyable, with its own empty note", async () => {
    const load = vi.fn();
    const firstPrompt = { prompt: { state: "ready", text: "Fix the board" } as const, load };
    const tree = await render(details(sample("sample-failed"), { firstPrompt, lastMessage: { prompt: { state: "ready", text: "Four subagents failed." }, load } }, "en"));
    const sections = tree.root.findAll((node) => typeof node.type === "string" && ["detail-prompt", "detail-message", "detail-location"].includes(node.props.testID));
    expect(sections.map((node) => node.props.testID)).toEqual(["detail-location", "detail-prompt", "detail-message"]);
    expect(texts(hostByTestId(tree.root, "detail-message"))).toEqual(["Last reply", "Four subagents failed."]);
    await act(async () => byLabel(tree.root, "Copy message").props.onPress());
    expect(clipboard.copyText).toHaveBeenLastCalledWith("Four subagents failed.");

    await act(async () => tree.update(details(sample("sample-failed"), { firstPrompt, lastMessage: { prompt: { state: "none" }, load } }, "zh")));
    expect(texts(hostByTestId(tree.root, "detail-message"))).toEqual(["最后回复消息", "agent 还没有回复"]);
  });

  it("shows the last message a person sent between the first prompt and the latest reply", async () => {
    const load = vi.fn();
    const firstPrompt = { prompt: { state: "ready", text: "Fix the board", timestamp: "2026-10-25T08:00:00Z" } as const, load };
    const lastMessage = { prompt: { state: "ready", text: "Four subagents failed." } as const, load };
    const ids = ["detail-prompt", "detail-human", "detail-message"];
    const shown = (tree: Awaited<ReturnType<typeof render>>) =>
      tree.root.findAll((node) => typeof node.type === "string" && ids.includes(node.props.testID)).map((node) => node.props.testID);
    const humanMessage = { prompt: { state: "ready", text: "Retry the failed ones", timestamp: "2026-10-25T09:00:00Z" } as const, load };
    const tree = await render(details(sample("sample-failed"), { firstPrompt, humanMessage, lastMessage }, "en"));
    expect(shown(tree)).toEqual(ids);
    expect(texts(hostByTestId(tree.root, "detail-human"))).toEqual(expect.arrayContaining(["Last sent message", "Retry the failed ones"]));
    await act(async () => byLabel(tree.root, "Copy sent message").props.onPress());
    expect(clipboard.copyText).toHaveBeenLastCalledWith("Retry the failed ones");

    // The first prompt again (one turn so far): its own section shows it.
    await act(async () => tree.update(details(sample("sample-failed"), { firstPrompt, humanMessage: { prompt: { state: "first" }, load }, lastMessage }, "en")));
    expect(shown(tree)).toEqual(["detail-prompt", "detail-message"]);
    await act(async () => tree.update(details(sample("sample-failed"), { firstPrompt, humanMessage: { prompt: firstPrompt.prompt, load }, lastMessage }, "en")));
    expect(shown(tree)).toEqual(["detail-prompt", "detail-message"]);

    await act(async () => tree.update(details(sample("sample-failed"), { firstPrompt, humanMessage: { prompt: { state: "none" }, load }, lastMessage }, "zh")));
    expect(texts(hostByTestId(tree.root, "detail-human"))).toEqual(["最后发送消息", "对话记录里没有找到发送的消息"]);
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
    // The card's looks: Allow an accent outline, Deny a danger one, neither filled.
    const card0 = taskTokens(LIGHT).card;
    expect(flat(byLabel(tree.root, "允许").props.style)).toMatchObject({ backgroundColor: card0.background, borderColor: card0.primaryBorder, borderWidth: 0.5 });
    expect(flat(byLabel(tree.root, "拒绝").props.style)).toMatchObject({ backgroundColor: card0.background, borderColor: taskTokens(LIGHT).danger });
    await act(async () => byLabel(tree.root, "允许").props.onHoverIn());
    expect(flat(byLabel(tree.root, "允许").props.style).backgroundColor).toBe(card0.primaryHover);
    await act(async () => byLabel(tree.root, "允许").props.onPress());
    expect(onPermission).toHaveBeenCalledWith(expect.objectContaining({ kind: "respond" }));
    // The phone's bar carries them instead.
    await act(async () => tree.update(details(card, { onPermission, permissionButtons: permissionButtons(card.permission!, "zh"), actions: false })));
    expect(hostByTestId(tree.root, "detail-permission").findAll((node) => node.props.testID === "detail-permission-buttons")).toEqual([]);
  });

  it("puts the phone's actions in a bar: stop then open while running, open last while asking", async () => {
    const strings = BOARD_STRINGS.zh.sidebar;
    const bar = (card: TaskCard, more: Record<string, unknown> = {}) =>
      React.createElement(DetailActionBar, { card, theme: LIGHT, language: "zh", strings, onOpen: vi.fn(), ...more });
    const running = await render(bar(sample("sample-running"), { stop: { phase: "idle", onPress: vi.fn() } }));
    expect(texts(hostByTestId(running.root, "detail-action-bar"))).toEqual(["停止", "切换到 tab"]);
    // The main button is an accent outline, not a solid fill.
    const look = taskTokens(LIGHT).card;
    expect(flat(hostByTestId(running.root, "detail-bar-open").props.style)).toMatchObject({ backgroundColor: look.background, borderColor: look.primaryBorder, borderWidth: 0.5 });
    await act(async () => running.unmount());
    renderer = null;
    const card = sample("sample-input");
    const asking = await render(bar(card, { onPermission: vi.fn(), permissionButtons: permissionButtons(card.permission!, "zh") }));
    const labels = asking.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button").map((node) => node.props.accessibilityLabel);
    // Deny, then allow, then the tab shrunk to a square at the right.
    expect(labels).toEqual(["拒绝", "允许", "打开处理"]);
    expect(flat(byLabel(asking.root, "允许").props.style)).toMatchObject({ backgroundColor: look.background, borderColor: look.primaryBorder });
    expect(flat(byLabel(asking.root, "拒绝").props.style)).toMatchObject({ backgroundColor: look.background, borderColor: taskTokens(LIGHT).danger });
    await act(async () => asking.unmount());
    renderer = null;
    // An archived task opens nowhere: Unarchive is its main button, or the bar has nothing to hold.
    const archivedCard: TaskCard = { ...sample("sample-done"), lane: "archived", status: "archived", archived: "agent" };
    const unarchive = { pending: vi.fn(() => false), press: vi.fn() };
    const archived = await render(bar(archivedCard, { unarchive }));
    expect(texts(hostByTestId(archived.root, "detail-action-bar"))).toEqual(["取消归档"]);
    await act(async () => hostByTestId(archived.root, "detail-bar-unarchive").props.onPress());
    expect(unarchive.press).toHaveBeenCalledWith(archivedCard.id);
    // Working: the same label, dimmed, a spinner where the icon was, no second press.
    unarchive.pending.mockReturnValue(true);
    await act(async () => archived.update(bar(archivedCard, { unarchive: { ...unarchive } })));
    const busy = hostByTestId(archived.root, "detail-bar-unarchive");
    expect(texts(busy)).toEqual(["取消归档"]);
    expect(busy.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(flat(busy.props.style)).toMatchObject({ opacity: 0.6 });
    expect(icons(busy)).not.toContain("ArchiveRestore");
    expect(hostByTestId(archived.root, "detail-bar-unarchive-spinner")).toBeTruthy();
    await act(async () => archived.update(bar(archivedCard)));
    expect(archived.toJSON()).toBeNull();
    await act(async () => archived.unmount());
    renderer = null;
    // A done task: Archive as wide as its label, then Open taking the rest.
    const archive = { pending: vi.fn(() => false), press: vi.fn() };
    const done = await render(bar(sample("sample-done"), { archive }));
    expect(texts(hostByTestId(done.root, "detail-action-bar"))).toEqual(["归档", "切换到 tab"]);
    expect(flat(hostByTestId(done.root, "detail-bar-archive").props.style)).toMatchObject({ flexGrow: 0, backgroundColor: taskTokens(LIGHT).card.background, borderColor: taskTokens(LIGHT).card.archiveBorder });
    await act(async () => hostByTestId(done.root, "detail-bar-archive").props.onPress());
    expect(archive.press).toHaveBeenCalledWith("sample-done");
  });

  it("names the stop button by its phase", async () => {
    const onPress = vi.fn();
    const tree = await render(details(sample("sample-running"), { stop: { phase: "idle", onPress } }));
    expect(texts(hostByTestId(tree.root, "detail-stop"))).toEqual(["停止"]);
    hostByTestId(tree.root, "detail-stop").props.onPress();
    expect(onPress).toHaveBeenCalled();
    await act(async () => tree.update(details(sample("sample-running"), { stop: { phase: "confirming", onPress } })));
    expect(texts(hostByTestId(tree.root, "detail-stop"))).toEqual(["确认停止"]);
    // Stopping keeps the rest label: dimmed, a spinner where the icon was, no second press.
    await act(async () => tree.update(details(sample("sample-running"), { stop: { phase: "stopping", onPress } })));
    const busy = hostByTestId(tree.root, "detail-stop");
    expect(texts(busy)).toEqual(["停止"]);
    expect(busy.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(flat(busy.props.style)).toMatchObject({ opacity: 0.6 });
    expect(icons(busy)).not.toContain("Power");
    expect(hostByTestId(tree.root, "detail-stop-spinner")).toBeTruthy();
  });

  it("leads the desktop header's actions with Open and ends the touch header's with it", async () => {
    const more = { onOpen: vi.fn(), stop: { phase: "idle", onPress: vi.fn() } };
    const desk = await render(details(sample("sample-running"), more));
    expect(texts(hostByTestId(desk.root, "detail-actions"))).toEqual(["切换到 tab", "已打开", "停止"]);
    await act(async () => desk.update(details(sample("sample-running"), { ...more, touch: true })));
    expect(texts(hostByTestId(desk.root, "detail-actions"))).toEqual(["停止", "切换到 tab", "已打开"]);
  });

  it("paints the stop button as a danger outline, armed or not", async () => {
    const tokens = taskTokens(LIGHT);
    const look = (root: ReactTestInstance, id: string) => {
      const button = hostByTestId(root, id);
      const label = button.findAll((node) => typeof node.type === "string" && typeof node.props.children === "string")[0]!;
      return { ...pick(flat(button.props.style)), text: flat(label.props.style).color };
    };
    // A 0.5 pt outline, as the card's buttons are, in the sidebar and the phone's bar alike.
    const pick = (style: Record<string, unknown>) => ({ fill: style.backgroundColor, border: style.borderColor, width: style.borderWidth });
    const tint = { fill: tokens.card.background, border: tokens.danger, text: tokens.danger, width: 0.5 };
    const tree = await render(details(sample("sample-running"), { stop: { phase: "idle", onPress: vi.fn() } }));
    expect(look(tree.root, "detail-stop")).toEqual(tint);
    await act(async () => tree.update(details(sample("sample-running"), { stop: { phase: "confirming", onPress: vi.fn() } })));
    expect(look(tree.root, "detail-stop")).toEqual(tint);
    expect(icons(hostByTestId(tree.root, "detail-stop"))).toEqual(["OctagonAlert"]);
    await act(async () => tree.unmount());
    renderer = null;
    const strings = BOARD_STRINGS.zh.sidebar;
    const bar = await render(React.createElement(DetailActionBar, { card: sample("sample-running"), theme: LIGHT, language: "zh", strings, onOpen: vi.fn(), stop: { phase: "idle", onPress: vi.fn() } }));
    expect(look(bar.root, "detail-bar-stop")).toEqual(tint);
    // Stopping: the same outline and label, dimmed, a spinner where the icon was.
    await act(async () => bar.update(React.createElement(DetailActionBar, { card: sample("sample-running"), theme: LIGHT, language: "zh", strings, onOpen: vi.fn(), stop: { phase: "stopping", onPress: vi.fn() } })));
    expect(look(bar.root, "detail-bar-stop")).toEqual(tint);
    const busy = hostByTestId(bar.root, "detail-bar-stop");
    expect(texts(busy)).toEqual(["停止"]);
    expect(busy.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(icons(busy)).not.toContain("Power");
    expect(hostByTestId(bar.root, "detail-bar-stop-spinner")).toBeTruthy();
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

  it("names the agent in the details' model chip for a subagent whose line names an effort but no model", async () => {
    const base = sample("sample-running");
    const card: TaskCard = { ...base, model: null, modelLabel: null, thinkingLabel: "High", modeLabel: null, subagent: { subtitle: "general-purpose · High · 518k tokens", type: "general-purpose" } };
    const agent = hostByTestId((await render(details(card))).root, "detail-agent");
    expect(texts(hostByTestId(agent, "detail-model"))).toEqual([base.providerLabel]);
    expect(texts(hostByTestId(agent, "detail-thinking"))).toEqual(["High"]);
  });

  it("leads the details' label chips with a solid tag in the label's colour, its hole the card's", async () => {
    const card = { ...sample("sample-input"), labels: [{ name: "linear", color: "#cc8f64" }, { name: "spare", color: null }] };
    const tree = await render(details(card));
    const tokens = buildTaskTokens(LIGHT.colors);
    const tags = hostByTestId(tree.root, "detail-labels").findAllByType(TagMark).map((tag) => tag.props);
    expect(tags.map((tag) => tag.color)).toEqual(["#cc8f64", tokens.foregroundMuted]);
    expect(tags.every((tag) => tag.hole === tokens.card.background)).toBe(true);
  });

  it("grows every agent and label chip together with the host's text size", async () => {
    const card = { ...sample("sample-input"), labels: [{ name: "linear", color: null }] };
    const pill = (node: ReactTestInstance) => (node.type as unknown) === "View" && flat(node.props.style).borderRadius === 999;
    const heights = (tree: ReactTestRenderer) =>
      ["detail-agent", "detail-labels"].flatMap((id) => hostByTestId(tree.root, id).findAll(pill).map((chip) => flat(chip.props.style).height));
    expect(heights(await render(details(card)))).toEqual([22, 22, 22, 22]);
    const large = { ...LIGHT, typography: { fontSize: { ui: 21 } } };
    const scaled = await render(React.createElement(TasksTypography, { theme: large, children: details(card, { theme: large }) }));
    expect(heights(scaled)).toEqual([33, 33, 33, 33]);
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
      expect(flat(menu.props.style)).toMatchObject({ position: "absolute", left: 0, top: 32, width: 220 });
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
      // A neutral button's half-pixel outline: a step further on a dark theme, where the border all but matches the card.
      expect(card.buttonBorder).toBe(mix(colors.border, colors.foreground, dark ? 0.2 : 0.05));
      expect(card.pillFill).toBe(mix(bg, colors.foreground, dark ? 0.06 : 0.035));
      expect(card.primaryHover).toBe(mix(bg, colors.accent, dark ? 0.16 : 0.1));
      expect(card.dangerHover).toBe(mix(bg, colors.statusDanger, dark ? 0.16 : 0.1));
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
      expect(flat(armed.props.style)).toMatchObject({ backgroundColor: "transparent", borderColor: colors.statusDanger });
      expect(flat(armed.find((node) => (node.type as unknown) === "Text").props.style).color).toBe(colors.statusDanger);
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
    expect(formatApprox(8 * 60_000, "zh")).toBe("8m");
    expect(formatApprox(20_000, "en")).toBe("~1m");
    expect(formatApprox(90 * 60_000, "zh")).toBe("1h 30m");
    expect(formatRelative(5 * 60_000, "zh")).toBe("5 分钟前");
    expect(formatRelative(5 * 60_000, "en")).toBe("5m ago");
    expect(formatRelative(10_000, "zh")).toBe("刚刚");
    expect(formatRelative(3 * 3_600_000, "en")).toBe("3h ago");
    expect(formatRelative(2 * 86_400_000, "zh")).toBe("2 天前");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(182_000)).toBe("182k");
    expect(formatTokens(1_250_000)).toBe("1.25M");
    // Three figures at most, rounding up to the next unit.
    expect([950, 12_345, 812_000, 999_600, 15_322_587, 354_800_101, 1_234_000_000].map(formatTokenTotal)).toEqual(["950", "12.3k", "812k", "1.00M", "15.3M", "355M", "1.23B"]);
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


describe("responsive task actions", () => {
  it("folds complete labels from the left, retaining the rightmost label longest", () => {
    const sizes = [{ full: 80, icon: 32 }, { full: 140, icon: 32 }, { full: 80, icon: 32 }];
    expect(actionIconOnly(316, sizes, 8)).toEqual([false, false, false]);
    expect(actionIconOnly(280, sizes, 8)).toEqual([true, false, false]);
    expect(actionIconOnly(220, sizes, 8)).toEqual([true, true, false]);
    expect(actionIconOnly(120, sizes, 8)).toEqual([true, true, true]);
    expect(actionIconOnly(316, sizes, 8)).toEqual([false, false, false]);
  });

  it.each([false, true])("folds a child card's actions and restores them after resizing (compact=%s)", async (compact) => {
    const card = sample("sample-child-1");
    const onOpen = vi.fn();
    const tree = await render(cardElement(card, { compact, onOpen, onStop: () => {}, language: "zh" }));
    const row = () => hostByTestId(tree.root, compact ? "task-card-actions" : "task-card-control-row")
      .find((node) => typeof node.type === "string" && typeof node.props.onLayout === "function");
    await act(async () => {
      row().props.onLayout({ nativeEvent: { layout: { width: 240 } } });
      for (const label of row().findAll((node) => (node.type as unknown) === "Text" && typeof node.props.onLayout === "function")) {
        label.props.onLayout({ nativeEvent: { layout: { width: texts(label).join("").includes("父") ? 120 : 50 } } });
      }
    });
    expect(icons(byLabel(tree.root, "打开父任务"))).toEqual(["CornerLeftUp"]);
    expect(texts(byLabel(tree.root, "打开父任务"))).toEqual([]);
    expect(texts(byLabel(tree.root, "停止"))).toEqual([]);
    expect(texts(byLabel(tree.root, "打开"))).toEqual(["打开"]);
    byLabel(tree.root, "打开父任务").props.onPress();
    expect(onOpen).toHaveBeenLastCalledWith(card.parent!.id);
    byLabel(tree.root, "打开").props.onPress();
    expect(onOpen).toHaveBeenLastCalledWith(card.id);
    await act(async () => row().props.onLayout({ nativeEvent: { layout: { width: 900 } } }));
    expect(texts(byLabel(tree.root, "打开父任务"))).toEqual(["打开父任务"]);
    expect(texts(byLabel(tree.root, "停止"))).toEqual(["停止"]);
  });

  it.each(["sidebar", "sheet"])("applies ordered folding and busy semantics in the %s", async (surface) => {
    const card = sample("sample-running");
    const props = { card, theme: LIGHT, language: "zh" as const, strings: BOARD_STRINGS.zh.sidebar, onOpen: () => {}, stop: { phase: "stopping" as const, onPress() {} } };
    const element = surface === "sidebar" ? React.createElement(TaskDetailCards, { ...props, now: NOW, touch: true }) : React.createElement(DetailActionBar, props);
    const tree = await render(element);
    const rowId = surface === "sidebar" ? "detail-actions" : "detail-action-bar";
    const stopId = surface === "sidebar" ? "detail-stop" : "detail-bar-stop";
    const row = () => hostByTestId(tree.root, rowId);
    await act(async () => {
      row().props.onLayout({ nativeEvent: { layout: { width: 150 } } });
      for (const label of row().findAll((node) => (node.type as unknown) === "Text" && typeof node.props.onLayout === "function")) {
        label.props.onLayout({ nativeEvent: { layout: { width: 70 } } });
      }
    });
    const stop = hostByTestId(tree.root, stopId);
    expect(texts(stop)).toEqual([]);
    expect(stop.props.accessibilityLabel).toBe("停止");
    expect(stop.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(hostByTestId(stop, `${stopId}-spinner`)).toBeDefined();
    await act(async () => row().props.onLayout({ nativeEvent: { layout: { width: 600 } } }));
    expect(texts(hostByTestId(tree.root, stopId))).toEqual(["停止"]);
  });
});


describe("TaskCardView long-press menu", () => {
  const rows = (root: ReactTestInstance) => root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem");
  const choose = async (root: ReactTestInstance, label: string) => {
    await act(async () => rows(root).find((row) => row.props.accessibilityLabel === label)!.props.onPress());
  };

  it.each([false, true])("opens the shared actions on native and preserves tap selection (compact=%s)", async (compact) => {
    const card = sample("sample-running");
    const onSelect = vi.fn();
    const onDetails = vi.fn();
    const onLongPress = vi.fn();
    const onStop = vi.fn();
    const tree = await render(cardElement(card, { compact, onSelect, onDetails, onLongPress, onStop }));
    const surface = () => hostByTestId(tree.root, `task-card-${card.id}`);
    await act(async () => surface().props.onPress());
    expect(onSelect).toHaveBeenCalledWith(card);
    onSelect.mockClear();
    expect(surface().props.delayLongPress).toBe(450);
    await act(async () => surface().props.onLongPress());
    expect(onLongPress).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDetails).not.toHaveBeenCalled();
    expect(rows(tree.root).map((row) => row.props.accessibilityLabel)).toEqual([
      "打开", "复制会话 ID", "复制标题", "复制工作区名称", "复制项目名称", "仅停止此任务", "连同子任务一起停止",
    ]);
    expect(rows(tree.root).every((row) => Number(flat(row.props.style).minHeight) >= 44)).toBe(true);
    await choose(tree.root, "连同子任务一起停止");
    expect(onStop).toHaveBeenCalledWith(card, { withChildren: true, dialog: true });
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-menu")).toHaveLength(0);
  });

  it("copies from the menu and dismisses through the host", async () => {
    clipboard.copyText.mockClear();
    const tree = await render(cardElement(sample("sample-running")));
    const open = () => hostByTestId(tree.root, "task-card-sample-running").props.onLongPress();
    await act(async () => open());
    await choose(tree.root, "复制会话 ID");
    expect(clipboard.copyText).toHaveBeenCalledWith("sample-running");
    await act(async () => open());
    await act(async () => tree.root.find((node) => (node.type as unknown) === "Modal").props.onOpenChange(false));
    expect(rows(tree.root)).toHaveLength(0);
  });

  it.each([
    ["sample-done", "归档", "onArchive"],
    ["sample-archived", "取消归档", "onUnarchive"],
  ] as const)("runs %s's available action from the menu", async (id, label, callback) => {
    const action = vi.fn();
    const card = id === "sample-archived"
      ? { ...sample("sample-done"), id, lane: "archived" as const, status: "archived" as const, archived: "agent" as const }
      : sample(id);
    const tree = await render(cardElement(card, { [callback]: action }));
    await act(async () => hostByTestId(tree.root, `task-card-${id}`).props.onLongPress());
    await choose(tree.root, label);
    expect(action).toHaveBeenCalledWith(id);
  });

  it("marks a readable card read and removes the action while pending", async () => {
    const card = { ...sample("sample-done"), readable: true };
    const onRead = vi.fn();
    const tree = await render(cardElement(card, { onRead }));
    const open = () => hostByTestId(tree.root, `task-card-${card.id}`).props.onLongPress();
    await act(async () => open());
    await choose(tree.root, "标为已读");
    expect(onRead).toHaveBeenCalledWith(card);
    await act(async () => tree.update(cardElement(card, { onRead, readPending: true })));
    await act(async () => open());
    expect(rows(tree.root).map((row) => row.props.accessibilityLabel)).not.toContain("标为已读");
  });

  it("does not open the menu when the board rejects a press after a swipe", async () => {
    const tree = await render(cardElement(sample("sample-running"), { onLongPress: () => false }));
    await act(async () => hostByTestId(tree.root, "task-card-sample-running").props.onLongPress());
    expect(rows(tree.root)).toHaveLength(0);
  });
});
