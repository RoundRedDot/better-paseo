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
  tildePath,
  sameCardProps,
  statusMarkSize,
  subtaskSummary,
  type TaskCardViewProps,
} from "../../client/tasks/cards";
import { statusRingHolders } from "../../client/tasks/cards/status-icon";
import { OVERLAY_ROW_Z } from "../../client/tasks/cards/task-card";
import { contextRingTone, formatSessionCost, formatTokenCount } from "../../client/tasks/cards/context-ring";
import { pillTint } from "../../client/tasks/cards/tokens";
import { modeIcon } from "../../client/tasks/cards/mode-icons";
import { PiMark, agentPillColors, contrastRatio } from "../../client/tasks/cards/brand-mark";
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
    expect(flat(title.props.style)).toMatchObject({ fontSize: 13, fontWeight: "500" });
    expect(pills(tree.root)).toEqual([
      ["pill-model", "GPT-5.5 Codex"],
      ["pill-thinking", "Medium"],
      ["pill-branch", "feat/tasks-board"],
      ["pill-label-frontend", "frontend"],
      ["pill-label-p1", "p1"],
      ["pill-labels-more", "+1"],
      ["pill-subtasks", "2"],
    ]);
    expect(texts(hostByTestId(tree.root, "task-card-footer"))).toEqual(["12m 30s"]);
    expect(texts(tree.root).some((text) => text.includes("未提交"))).toBe(false);
  });

  it("draws pills fully rounded and outlined, with label dots in the label colour", async () => {
    const tree = await render(cardElement(sample("sample-running"), { fields: fields("standard", { labelLimit: "all" }) }));
    for (const [id] of pills(tree.root)) {
      // borderWidth is StyleSheet.hairlineWidth, which rn-mock reports as 1; the agent pills have none.
      const agent = id === "pill-model" || id === "pill-thinking";
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
    expect(pillColors("pill-branch")).toEqual({ background: tokens.card.pillFill, border: tokens.card.pillBorder });
    // The agent pill takes the provider's brand (Codex green); the subtasks pill its dominant status (2 running).
    // The agent pills are borderless, in the brand's colours (Codex green).
    expect(pillColors("pill-model").background).toBe(mix("#ffffff", "#10A37F", 0.12));
    expect(pillColors("pill-thinking").background).toBe(mix("#ffffff", "#10A37F", 0.12));
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
      ["pill-thinking", "Medium"],
    ]);
    expect(texts(tree.root)).toEqual(["Port the status ring to React Native", "GPT-5.5 Codex", "Medium", "12m 30s"]);
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

  it("names the provider in the model pill when the model is off, and drops the thinking pill", async () => {
    const tree = await render(cardElement(sample("sample-done"), { fields: fields("standard", { model: false, thinking: false }) }));
    expect(pills(tree.root)[0]).toEqual(["pill-model", "Claude"]);
    expect(pills(tree.root).map(([id]) => id)).not.toContain("pill-thinking");
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

    const orphan = { ...sample("sample-child-1"), parent: { id: "gone", title: null, missing: true } };
    await act(async () => tree.update(cardElement(orphan, { onReveal, fields: fields("minimal") })));
    expect(texts(hostByTestId(tree.root, "task-card-meta"))).toEqual(["↳ 父任务（已归档）"]);
  });

  it("draws the failure reason in the danger colour", async () => {
    const tree = await render(cardElement(sample("sample-failed")));
    const reason = tree.root.find(
      (node) => (node.type as unknown) === "Text" && node.props.children === "Provider exited with code 1: rate limit reached",
    );
    expect(flat(reason.props.style).color).toBe("#d93636");
    expect(icons(tree.root)).toContain("CircleX");
  });

  it("draws a manual stop's reason muted, in the review and the done lane", async () => {
    for (const lane of ["review", "done"] as const) {
      const card = { ...sample("sample-done"), lane, status: lane === "review" ? ("unread" as const) : ("done" as const), error: "已手动停止" };
      const tree = await render(cardElement(card));
      const reason = tree.root.find((node) => (node.type as unknown) === "Text" && node.props.children === "已手动停止");
      expect(flat(reason.props.style).color).toBe("#6b6b75");
      expect(icons(tree.root)).toContain("Square");
      expect(icons(tree.root)).not.toContain("CircleX");
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
        expect(answer.findByType("Icon" as never).props.color).toBe(amber);
        expect(flat(answer.find((node) => (node.type as unknown) === "Text").props.style).color).toBe(amber);
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

  it("leaves Allow and Deny as they were", async () => {
    const buttons = permissionButtons(sample("sample-input").permission!, "zh");
    const tree = await render(cardElement(sample("sample-input"), { permissionButtons: buttons }));
    const tokens = buildTaskTokens(LIGHT.colors);
    expect(flat(byLabel(tree.root, "允许").props.style)).toMatchObject({ backgroundColor: tokens.card.primaryFill, borderColor: tokens.card.primaryFill });
    expect(flat(byLabel(tree.root, "拒绝").props.style)).toMatchObject({ backgroundColor: "transparent", borderColor: tokens.card.pillBorder });
    expect(icons(byLabel(tree.root, "允许"))).toEqual(["Check"]);
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
      expect(texts(timerBox!)).toEqual(["12m 30s"]);
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
      ["pill-thinking", "Medium"],
      ["pill-branch", "feat/tasks-board"],
      ["pill-label-frontend", "frontend"],
      ["pill-labels-more", "+2"],
      ["pill-subtasks", "2"],
    ]);
    // The brand stays on a phone even with the provider switched off.
    expect(flat(hostByTestId(tree.root, "pill-model").props.style)).toMatchObject({ height: 28, borderRadius: 14 });
    expect(flat(hostByTestId(tree.root, "task-card-title").props.style)).toMatchObject({ fontSize: 16 });
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
    // Each row: the official status icon on the left, aligned with the title's first line; no state words.
    for (const child of sample("sample-running").children) {
      const slot = hostByTestId(list, `subtask-status-${child.id}`);
      expect(hostByTestId(slot, `status-${child.status}`).props.style).toMatchObject({ height: 18 });
    }
    expect(texts(list)).toEqual(["Measure the sidebar ring", "Write the ring geometry test", "Collect status colours"]);
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
        "~/code/better-paseo/.worktrees/tasks-board",
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

  it("lays rows out as a fixed key column and a wrapping value column", async () => {
    const tree = await render(React.createElement(TaskDetails, { card: sample("sample-running"), theme: LIGHT, now: NOW, language: "zh" }));
    for (const key of ["工作目录", "Workspace", "分支"]) {
      const row = hostByTestId(tree.root, `detail-row-${key}`);
      const [keyText, valueColumn] = row.children as ReactTestInstance[];
      expect(flat(keyText!.props.style)).toMatchObject({ width: 84, flexShrink: 0 });
      expect(flat(valueColumn!.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
      for (const text of valueColumn!.findAll((node) => (node.type as unknown) === "Text")) {
        const style = flat(text.props.style);
        expect(style.flex).toBeUndefined();
        expect(style.position).toBeUndefined();
        expect(text.props.numberOfLines).toBeUndefined();
      }
    }
    expect(texts(hostByTestId(tree.root, "detail-row-工作目录"))).toEqual(["工作目录", "~/code/better-paseo/.worktrees/tasks-board"]);
  });

  it("says a directory is not a git checkout", async () => {
    const tree = await render(React.createElement(TaskDetails, { card: sample("sample-done"), theme: LIGHT, now: NOW, language: "en" }));
    expect(texts(tree.root)).toEqual(expect.arrayContaining(["Not a git directory", "directory"]));
    expect(texts(tree.root)).not.toContain("Open tab");
  });
});

describe("model, thinking and brand marks", () => {
  const PROVIDERS = [
    "paseo", "claude", "codex", "omp", "pi", "gemini", "antigravity", "copilot",
    "opencode", "minimax", "deepseek", "grok", "cursor", "ollama", "some-new-agent",
  ] as const;
  const MONOCHROME = new Set(["paseo", "omp", "grok", "cursor", "ollama", "some-new-agent"]);
  // Marks rasterised in colour carry their hue in the image; the rest are tinted.
  const RASTER_COLOURED = new Set(["claude", "gemini", "antigravity", "minimax", "deepseek"]);
  const WRONG_ON_LIGHT = ["#E5E7EB", "#818CF8", "#CBD5E1", "#94A3B8", "#6366F1"];

  beforeEach(() => {
    seedMarkBitmaps(Object.fromEntries([...MARK_IDS].map((id) => [id, `data:image/png;base64,${id}`])));
  });

  it("draws monochrome marks in the theme foreground and coloured brands in their hue", async () => {
    for (const theme of [LIGHT, DARK]) {
      const tokens = buildTaskTokens(theme.colors);
      for (const provider of PROVIDERS) {
        const card = { ...sample("sample-done"), provider, providerMark: provider };
        const tree = await render(cardElement(card, { theme }));
        const model = hostByTestId(tree.root, "pill-model");
        const [image] = model.findAll((node) => (node.type as unknown) === "Image");
        const brand = providerBrand(provider);
        expect(brand.monochrome).toBe(MONOCHROME.has(provider));
        let drawn: unknown;
        if (provider === "pi") {
          // Pi: the coloured pixel mark from Views, the same on both themes, on a neutral pill.
          expect(image).toBeUndefined();
          const cells = hostByTestId(model, "pi-mark").children.map((cell) => flat((cell as ReactTestInstance).props.style).backgroundColor);
          expect(cells).toEqual(["#e39586", "#e39586", "#6198bb", "#6198bb", "#e9c069"]);
          expect(flat(model.props.style).backgroundColor).toBe(mix(tokens.card.background, tokens.foreground, 0.06));
          await act(async () => tree.unmount());
          renderer = null;
          continue;
        }
        if (image) {
          drawn = flat(image.props.style).tintColor;
          if (MONOCHROME.has(provider)) expect(drawn).toBe(tokens.foreground);
          else if (RASTER_COLOURED.has(provider)) expect(drawn).toBeUndefined();
          else expect(drawn).toBe(brand.color);
        } else {
          // No mark at all (an unknown agent): the letter fallback, in the foreground.
          expect(provider).toBe("some-new-agent");
          const letter = model.find((node) => (node.type as unknown) === "Text" && String(node.props.children).length === 1);
          drawn = flat(letter.props.style).color;
          expect(drawn).toBe(tokens.foreground);
        }
        if (theme === LIGHT) expect(WRONG_ON_LIGHT).not.toContain(drawn);
        // Tint: a coloured brand's hue, a monochrome mark's neutral grey.
        const fill = flat(model.props.style).backgroundColor;
        expect(fill).toBe(
          MONOCHROME.has(provider)
            ? mix(tokens.card.background, tokens.foreground, 0.06)
            : mix(tokens.card.background, brand.color, tokens.isDark ? 0.2 : 0.12),
        );
        await act(async () => tree.unmount());
        renderer = null;
      }
    }
  });

  it("draws Pi's mark on its 4 x 4 grid with the shipped margin", async () => {
    const tree = await render(React.createElement(PiMark, { size: 20 }));
    const cells = hostByTestId(tree.root, "pi-mark").children.map((cell) => flat((cell as ReactTestInstance).props.style));
    // Cell 4 px (20 less a 2 px margin each side, over 4).
    expect(cells.map(({ left, top, width, height }) => [left, top, width, height])).toEqual([
      [2, 2, 12, 4],
      [10, 6, 4, 4],
      [2, 6, 4, 12],
      [6, 10, 4, 4],
      [14, 10, 4, 8],
    ]);
  });

  it("styles the agent pills as Linear's status pill: brand tint, no border, readable label, brand icon", async () => {
    // The reference: #606acd over white gives #ecedfa and a #4349a3 label.
    const reference = buildTaskTokens(PALETTES.paseoLight);
    const near = (a: string, b: string) =>
      [1, 3, 5].every((i) => Math.abs(Number.parseInt(a.slice(i, i + 2), 16) - Number.parseInt(b.slice(i, i + 2), 16)) <= 1);
    expect(near(mix(reference.card.background, "#606acd", 0.12), "#ecedfa")).toBe(true);
    for (const palette of [PALETTES.paseoLight, PALETTES.paseoDark, PALETTES.sepiaLight, PALETTES.blueDark]) {
      const tokens = buildTaskTokens(palette);
      for (const provider of ["claude", "codex", "gemini", "copilot", "deepseek", "minimax", "antigravity", "opencode"]) {
        const brand = providerBrand(provider).color;
        const colors = agentPillColors(tokens, provider);
        expect(colors.background).toBe(mix(tokens.card.background, brand, tokens.isDark ? 0.2 : 0.12));
        expect(colors.icon).toBe(brand);
        expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
        // Darker than the brand on a light theme, lighter on a dark one.
        const lighter = contrastRatio(colors.text, "#000000") > contrastRatio(brand, "#000000");
        expect(lighter).toBe(tokens.isDark);
      }
      for (const provider of ["grok", "cursor", "ollama", "omp", "paseo", "pi", "some-new-agent"]) {
        expect(agentPillColors(tokens, provider)).toEqual({
          background: mix(tokens.card.background, palette.foreground, 0.06),
          text: palette.foreground,
          icon: palette.foreground,
        });
      }
    }

    for (const theme of [LIGHT, DARK]) {
      const tokens = buildTaskTokens(theme.colors);
      const tree = await render(cardElement(sample("sample-running"), { theme }));
      const colors = agentPillColors(tokens, "codex");
      for (const id of ["pill-model", "pill-thinking"]) {
        const node = hostByTestId(tree.root, id);
        expect(flat(node.props.style)).toMatchObject({ backgroundColor: colors.background, borderWidth: 0 });
        expect(flat(node.find((child) => (child.type as unknown) === "Text").props.style)).toMatchObject({ color: colors.text, fontWeight: "500" });
      }
      // The Brain icon and the (tinted) Codex mark wear the brand colour itself.
      expect(hostByTestId(tree.root, "pill-thinking").findByType("Icon" as never).props.color).toBe("#10A37F");
      await act(async () => tree.unmount());
      renderer = null;
    }
  });

  it("draws the thinking pill with the host's Brain icon", async () => {
    const tree = await render(cardElement(sample("sample-running")));
    const thinking = hostByTestId(tree.root, "pill-thinking");
    expect(icons(thinking)).toEqual(["Brain"]);
    expect(texts(thinking)).toEqual(["Medium"]);
  });

  it("maps modes to the composer's icons", () => {
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

  it("lists model, thinking and mode with icons in the details", async () => {
    const tree = await render(React.createElement(TaskDetails, { card: sample("sample-input"), theme: LIGHT, now: NOW, language: "zh" }));
    const agent = hostByTestId(tree.root, "task-details-agent");
    expect(texts(hostByTestId(agent, "task-details-model"))).toEqual(["Opus 5.5"]);
    expect(hostByTestId(agent, "task-details-model").findAll((node) => (node.type as unknown) === "Image")).toHaveLength(1);
    expect(texts(hostByTestId(agent, "task-details-thinking"))).toEqual(["High"]);
    expect(icons(hostByTestId(agent, "task-details-thinking"))).toEqual(["Brain"]);
    expect(texts(hostByTestId(agent, "task-details-mode"))).toEqual(["Bypass"]);
    expect(icons(hostByTestId(agent, "task-details-mode"))).toEqual(["ShieldOff"]);
  });
});

describe("TaskCardView chrome", () => {
  it("is Linear's card: radius 6, a hairline, and on hover only the fill and shadow change", async () => {
    const tokens = buildTaskTokens(LIGHT.colors);
    const tree = await render(cardElement(sample("sample-done")));
    const surface = () => flat(hostByTestId(tree.root, "task-card-sample-done").props.style);
    const rest = surface();
    expect(rest).toMatchObject({ borderRadius: 6, borderWidth: 1, borderColor: tokens.card.border, backgroundColor: tokens.card.background });
    expect(rest.boxShadow).toBe(tokens.card.shadow);
    await act(async () => hostByTestId(tree.root, "task-card-sample-done").props.onHoverIn());
    const hovered = surface();
    expect(hovered.backgroundColor).toBe(tokens.card.hoverBackground);
    expect(hovered.borderColor).toBe(rest.borderColor);
    expect(hovered.boxShadow).toBe(tokens.card.shadowHover);
    expect({ ...hovered, backgroundColor: 0, boxShadow: 0, zIndex: 0 }).toEqual({ ...rest, backgroundColor: 0, boxShadow: 0, zIndex: 0 });
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
