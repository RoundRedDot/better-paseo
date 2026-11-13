/**
 * A phone card's action bar, laid out by Yoga as Fabric lays it out on a
 * phone (`helpers/yoga-host-layout`), with each label's measured width fed
 * back through `onLayout` until the row settles. Every button must stay
 * inside the card, with its whole label. On a phone, Stop beside Allow and
 * Deny ran past the card and the screen; these cases fit when `onLayout`
 * widths are fed by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

vi.hoisted(() => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock("react-native", async () => import("./helpers/rn-mock"));
// The details' Info tab reveals folders over RPC; the request block never calls it.
vi.mock("@getpaseo/plugin/client", async (original) => ({ ...await original<object>(), useRpc: () => async () => ({ revealed: null, error: null }) }));
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
    copyText: async () => {},
    useToast: () => ({ show() {}, error() {} }),
  };
});

import "./helpers/quiet-renderer";
import { asExitPlan } from "./helpers/plan-request";
import { unavailableTask } from "../../shared/task-availability";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { CARD_PRESETS } from "../../shared/tasks-settings";
import { previewSampleCards as sampleCards } from "../../client/tasks/sample-cards";
import type { TaskCard } from "../../client/tasks/model";
import type { StopPhase } from "../../client/tasks/actions";
import { permissionButtons, respondToPermission } from "../../client/tasks/actions";
import { createFakePaseo } from "./helpers/fake-paseo";
import { TaskCardView, type TaskCardViewProps } from "../../client/tasks/cards";
import { SubtaskRow } from "../../client/tasks/cards/subtask-row";
import { taskTokens } from "../../client/tasks/cards/tokens";
import { createTitleUpdateControl } from "../../client/tasks/actions/title-update";
import { TasksTypographyScale } from "../../client/tasks/typography";
import { cardStrings } from "../../client/tasks/cards/strings";
import { estimateTextWidth, hostChildren, measureHostTree, settleHostLayout, wrapLines, type Frame } from "./helpers/yoga-host-layout";
import { resetActionWidths } from "../../client/tasks/cards/action-row";
import { DetailActionBar, TaskDetailCards } from "../../client/tasks/cards/detail-cards";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";

const NOW = Date.parse("2026-10-20T09:00:00.000Z");
const THEME = {
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

let renderer: ReactTestRenderer | null = null;
// The layout here scales text without the window's font scale, which keys the
// shared label widths on a device: each case measures its labels anew.
beforeEach(() => resetActionWidths());
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
});

function sample(id: string): TaskCard {
  const card = sampleCards(NOW).find((candidate) => candidate.id === id);
  if (!card) throw new Error(`no sample ${id}`);
  return card;
}

type Language = "zh" | "en";

function phoneCard(card: TaskCard, language: Language, overrides: Partial<TaskCardViewProps> = {}): React.ReactElement {
  const props: TaskCardViewProps = {
    card,
    fields: { ...CARD_PRESETS.standard.fields, labelLimit: CARD_PRESETS.standard.labelLimit },
    theme: THEME as never,
    compact: true,
    permissionButtons: card.permission ? permissionButtons(card.permission, language) : [],
    stopPhase: "idle",
    focused: false,
    highlighted: false,
    now: NOW,
    language,
    onReveal: () => {},
    onStop: () => {},
    ...overrides,
  };
  return React.createElement(TaskCardView, props);
}

const row = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-actions");
/** A question's or a tool permission's answers, under its divider. */
const questionRow = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-question-actions");
const actionButtons = (node: ReactTestInstance) => node.findAll((child) => typeof child.type === "string" && child.props.accessibilityRole === "button");
/** The labels a section request's controls row draws; its other labels are the request's answers. */
const CONTROL_LABELS = new Set(["停止", "Stop", "确认停止", "Confirm stop", "打开", "Open"]);

/** The labels drawn in the row itself; an open menu is a separate native layer. */
function labelsOf(node: ReactTestInstance): ReactTestInstance[] {
  const inMenu = (child: ReactTestInstance) => {
    for (let parent = child.parent; parent && parent !== node; parent = parent.parent) if ((parent.type as unknown) === "Modal") return true;
    return false;
  };
  return node.findAll((child) => (child.type as unknown) === "Text" && !inMenu(child));
}

/** A permission card whose agent also runs two subtasks: Stop gets its options chevron. */
function parentAsking(): TaskCard {
  const input = sample("sample-input");
  return { ...sample("sample-running"), lane: "needs_input", status: "needs_input", permission: input.permission, stoppable: true };
}

/**
 * The sample tool permission as another request kind: a plan is a real
 * Claude ExitPlanMode request (`helpers/plan-request`). Every kind takes the
 * request section a tool permission does.
 */
function asKind(card: TaskCard, kind: "plan" | "plan-resume" | "mode" | "other"): TaskCard {
  if (kind === "plan" || kind === "plan-resume") return { ...asExitPlan(card, { resume: kind === "plan-resume" }), lane: card.lane, status: card.status };
  return { ...card, permission: { ...card.permission!, kind, actions: [] } };
}
const modeInput = () => asKind(sample("sample-input"), "mode");
const modeParentAsking = () => asKind(parentAsking(), "mode");
type Kind = "tool" | "plan" | "plan-resume" | "mode" | "question" | "other";
/** A waiting card of each kind: the sample tool permission, a real ExitPlanMode, a mode change, a Codex question, an unknown request. */
function kindCard(kind: Kind): TaskCard {
  return kind === "question" ? choice()() : kind === "tool" ? sample("sample-input") : asKind(sample("sample-input"), kind);
}
/** Each kind's answers, in the order the request sends them. */
const ANSWERS: Record<Kind, Record<Language, string[]>> = {
  tool: { zh: ["允许", "拒绝"], en: ["Allow", "Deny"] },
  mode: { zh: ["允许", "拒绝"], en: ["Allow", "Deny"] },
  plan: { zh: ["拒绝", "实施"], en: ["Reject", "Implement"] },
  "plan-resume": { zh: ["拒绝", "实施", "Implement with Bypass"], en: ["Reject", "Implement", "Implement with Bypass"] },
  question: { zh: ["允许", "拒绝", "查看问题"], en: ["允许", "拒绝", "View questions"] },
  other: { zh: ["去回答"], en: ["Answer"] },
};
const KINDS: Kind[] = ["tool", "plan", "plan-resume", "mode", "question", "other"];

/** A question card: "Answer" opens the tab, and Stop is as wide as its label beside it. */
function question(): TaskCard {
  return sample("sample-question");
}

/** A Codex async question as the daemon sends it, its options written by the model. */
function choice(labels: [string, string] = ["允许", "拒绝"]): () => TaskCard {
  return () => ({ ...question(), permission: { ...question().permission!, summary: "按上述方案执行吗？", questions: [{
    id: "0", header: "Question 1", question: "按上述方案执行吗？", multiSelect: false,
    options: labels.map((label) => ({ label })),
  }] } });
}

interface Case {
  name: string;
  card: () => TaskCard;
  props?: Partial<TaskCardViewProps>;
  /** The labels the row draws once settled, zh then en, when nothing has folded. */
  expected: Record<Language, string[]>;
  /** Press the parent Stop's chevron so its menu is open. */
  openMenu?: boolean;
  /** Lay wrapping labels (a question's written options) out on as many lines as they take. */
  wrap?: boolean;
  /** The narrowest card that shows every label at the default text size, when not the reported phone's 340pt. */
  fullFrom?: Partial<Record<Language, number>>;
}

const confirming: StopPhase = "confirming";
const WIDE_CJK = ["从现在持续观察一小时再说", "回看最近一小时的日志即可"] as const;
const WIDE_LATIN = ["Use the existing schema!", "Rebuild it from scratch."] as const;
const CASES: Case[] = [
  // Every request kind as a tool permission: its answers under the divider, Stop (and Open) on the bar above.
  { name: "a mode request's Allow and Deny under Stop", card: modeInput, expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "a mode request's Allow and Deny under Stop and Open", card: modeInput, props: { onOpen: () => {} }, expected: { zh: ["允许", "拒绝", "停止", "打开"], en: ["Allow", "Deny", "Stop", "Open"] } },
  { name: "a mode request's Allow and Deny under an armed Stop", card: modeInput, props: { stopPhase: confirming }, expected: { zh: ["允许", "拒绝", "确认停止"], en: ["Allow", "Deny", "Confirm stop"] } },
  { name: "a mode request's Allow and Deny under a parent's Stop with its menu open", card: modeParentAsking, openMenu: true, expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "a real ExitPlanMode's Reject and Implement under Stop and Open", card: () => asKind(sample("sample-input"), "plan"), props: { onOpen: () => {} }, expected: { zh: ["拒绝", "实施", "停止", "打开"], en: ["Reject", "Implement", "Stop", "Open"] } },
  // On the reported phone in English, Reject folds to its X (its label still read out); 387pt shows all three.
  { name: "a real ExitPlanMode's three choices under Stop and Open", card: () => asKind(sample("sample-input"), "plan-resume"), props: { onOpen: () => {} }, fullFrom: { en: 387 }, expected: { zh: ["拒绝", "实施", "Implement with Bypass", "停止", "打开"], en: ["Reject", "Implement", "Implement with Bypass", "Stop", "Open"] } },
  { name: "a real ExitPlanMode's choices under a parent's Stop with its menu open", card: () => asKind(parentAsking(), "plan"), openMenu: true, expected: { zh: ["拒绝", "实施", "停止"], en: ["Reject", "Implement", "Stop"] } },
  // An unknown request's "Answer" opens the tab, so it stands in for Open.
  { name: "an unknown request's Answer under Stop", card: () => asKind(sample("sample-input"), "other"), props: { onOpen: () => {} }, expected: { zh: ["去回答", "停止"], en: ["Answer", "Stop"] } },
  // A tool permission, as a question: Allow and Deny under its divider, Stop (and Open) on the bar above.
  { name: "a tool permission's Allow and Deny under Stop", card: () => sample("sample-input"), expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "a tool permission's Allow and Deny under Stop and Open", card: () => sample("sample-input"), props: { onOpen: () => {} }, expected: { zh: ["允许", "拒绝", "停止", "打开"], en: ["Allow", "Deny", "Stop", "Open"] } },
  { name: "a tool permission's Allow and Deny under an armed Stop", card: () => sample("sample-input"), props: { stopPhase: confirming }, expected: { zh: ["允许", "拒绝", "确认停止"], en: ["Allow", "Deny", "Confirm stop"] } },
  { name: "a tool permission's Allow and Deny under a parent's Stop with its menu open", card: parentAsking, openMenu: true, expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "Answer beside a hugging Stop", card: question, props: { onOpen: () => {} }, expected: { zh: ["去回答", "停止"], en: ["Answer", "Stop"] } },
  { name: "two written options beside Stop and Open", card: choice(), props: { onOpen: () => {} }, expected: { zh: ["允许", "拒绝", "停止"], en: ["允许", "拒绝", "Stop"] } },
  // The widest options answered inline: QUICK_ANSWER_COLUMNS of CJK and of Latin.
  // The widest options answered inline (QUICK_ANSWER_COLUMNS) wrap rather than run off the card or lose words.
  { name: "the widest CJK options beside Stop and Open", card: choice([WIDE_CJK[0], WIDE_CJK[1]]), props: { onOpen: () => {} }, wrap: true, expected: { zh: [...WIDE_CJK], en: [...WIDE_CJK] } },
  { name: "the widest Latin options beside Stop and Open", card: choice([WIDE_LATIN[0], WIDE_LATIN[1]]), props: { onOpen: () => {} }, wrap: true, expected: { zh: [...WIDE_LATIN], en: [...WIDE_LATIN] } },
  { name: "a running Stop beside Open tab", card: () => sample("sample-running"), props: { onOpen: () => {} }, expected: { zh: ["停止", "打开"], en: ["Stop", "Open"] } },
  { name: "a running Stop alone", card: () => sample("sample-running"), expected: { zh: ["停止"], en: ["Stop"] } },
];

// Card content widths: iPhone SE / mini, iPhone 16 Pro (the report), Pro Max, and a narrow window.
const WIDTHS = [300, 322, 340, 387];
// The system text size: default, larger, and the largest non-accessibility sizes.
const TEXT_SCALES = [1, 1.35, 1.8];

async function settle(item: Case, language: Language, width: number, textScale: number) {
  renderer = null;
  await act(async () => {
    renderer = TestRenderer.create(phoneCard(item.card(), language, item.props));
  });
  if (item.openMenu) {
    const chevron = row().find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === cardStrings(language).stopOptions);
    await act(async () => chevron.props.onPress());
    expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-stop-menu")).not.toHaveLength(0);
  }
  return settleHostLayout(row, { width, textScale, wrapText: item.wrap });
}

/** What runs out of the card or loses part of a label; empty when the row fits. */
function overflows(frames: Map<ReactTestInstance, Frame>, textScale: number, bar = row()): string[] {
  const box = frames.get(bar)!;
  const problems: string[] = [];
  for (const item of hostChildren(bar)) {
    const frame = frames.get(item)!;
    const name = String(item.props.testID ?? item.props.accessibilityLabel ?? item.type);
    // Every action stays inside the card's content column.
    if (frame.left < box.left - 0.5 || frame.left + frame.width > box.left + box.width + 0.5) {
      problems.push(`${name} spans ${frame.left}..${frame.left + frame.width} in a ${box.width} row`);
    }
    for (const text of labelsOf(item)) {
      const textFrame = frames.get(text)!;
      const fontSize = (Object.assign({}, ...[text.props.style].flat(Infinity).filter(Boolean)) as { fontSize?: number }).fontSize ?? 14;
      const words = text.children.join("");
      // A drawn label is whole and within its own button; one that may wrap counts its lines.
      const lines = text.props.numberOfLines === undefined ? Math.round(textFrame.height / Math.ceil(fontSize * 1.25)) : 1;
      if (text.props.ellipsizeMode !== "tail" && textFrame.width * lines < estimateTextWidth(words, fontSize) * textScale - 0.5) problems.push(`"${words}" cut to ${textFrame.width} x ${lines}`);
      if (textFrame.left + textFrame.width > frame.left + frame.width + 0.5) problems.push(`"${words}" ends past ${name}`);
      if (textFrame.top + textFrame.height > frame.top + frame.height + 0.5) problems.push(`"${words}" ends below ${name}`);
    }
  }
  return problems;
}

const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)) as { minWidth?: unknown; flexBasis?: unknown };
/** The width a button starts from before its line's spare room: its numeric `minWidth` or `flexBasis`, whichever is larger. */
const baseWidth = (node: ReactTestInstance) => Math.max(...[styleOf(node).minWidth, styleOf(node).flexBasis].map((value) => typeof value === "number" ? value : 0));

/** A row's buttons line by line, top to bottom, each line left to right. */
function buttonLines(frames: Map<ReactTestInstance, Frame>, bar: ReactTestInstance): Array<Array<{ node: ReactTestInstance; frame: Frame }>> {
  const lines = new Map<number, Array<{ node: ReactTestInstance; frame: Frame }>>();
  for (const node of actionButtons(bar)) {
    const frame = frames.get(node)!;
    const top = Math.round(frame.top);
    lines.set(top, [...(lines.get(top) ?? []), { node, frame }]);
  }
  return [...lines.entries()].sort(([a], [b]) => a - b).map(([, line]) => line.sort((a, b) => a.frame.left - b.frame.left));
}

/** Buttons drawn over each other or out of the row. */
function collisions(frames: Map<ReactTestInstance, Frame>, bar: ReactTestInstance): string[] {
  const box = frames.get(bar)!;
  const buttons = actionButtons(bar).map((node) => ({ name: String(node.props.accessibilityLabel), node, frame: frames.get(node)! }));
  const problems: string[] = [];
  for (const { name, frame } of buttons) {
    if (frame.left < box.left - 0.5 || frame.left + frame.width > box.left + box.width + 0.5) problems.push(`${name} spans ${frame.left}..${frame.left + frame.width} in a ${box.width} row`);
  }
  for (const [index, a] of buttons.entries()) for (const b of buttons.slice(index + 1)) {
    const x = Math.min(a.frame.left + a.frame.width, b.frame.left + b.frame.width) - Math.max(a.frame.left, b.frame.left);
    const y = Math.min(a.frame.top + a.frame.height, b.frame.top + b.frame.height) - Math.max(a.frame.top, b.frame.top);
    if (x > 0.5 && y > 0.5) problems.push(`${a.name} and ${b.name} overlap by ${x}`);
  }
  return problems;
}

/** Views under (and including) `bar` that wrap: on Android a wrapping row left a phantom second row's height under its buttons (4473e943). */
function wrapping(bar: ReactTestInstance): string[] {
  return [bar, ...bar.findAll((node) => typeof node.type === "string")].filter((node) => {
    const wrap = (Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)) as { flexWrap?: string }).flexWrap;
    return wrap !== undefined && wrap !== "nowrap";
  }).map((node) => String(node.props.testID ?? node.props.accessibilityLabel ?? node.type));
}

/** Lines that leave room at either end, or share their spare room (each button's width past its `baseWidth`) unevenly. */
function unevenLines(frames: Map<ReactTestInstance, Frame>, bar: ReactTestInstance): string[] {
  const box = frames.get(bar)!;
  return buttonLines(frames, bar).flatMap((line) => {
    const names = line.map(({ node }) => String(node.props.accessibilityLabel)).join(" | ");
    const problems: string[] = [];
    if (Math.abs(line[0]!.frame.left - box.left) > 0.5 || Math.abs(line.at(-1)!.frame.left + line.at(-1)!.frame.width - box.left - box.width) > 0.5) problems.push(`${names} does not span the row`);
    const spare = line.map(({ node, frame }) => frame.width - baseWidth(node));
    if (line.length > 1 && Math.max(...spare) - Math.min(...spare) > 1) problems.push(`${names} share their spare room as ${spare.map((value) => value.toFixed(1)).join(" / ")}`);
    return problems;
  });
}

describe("phone card action bar under native (Yoga) layout", () => {
  it.each(WIDTHS.flatMap((width) => TEXT_SCALES.flatMap((scale) => (["zh", "en"] as const).map((language) => [width, scale, language] as const))))(
    "fits quick answers, View questions, Stop and Open at %ipt, scale %f, %s",
    async (width, textScale, language) => {
      const card = choice()();
      await act(async () => {
        renderer = TestRenderer.create(phoneCard(card, language, { permissionButtons: permissionButtons(card.permission!, language, true), onOpen() {} }));
      });
      const frames = await settleHostLayout(row, { width, textScale, wrapText: true });
      expect(overflows(frames, textScale)).toEqual([]);
      const answerFrames = await settleHostLayout(questionRow, { width, textScale, wrapText: true });
      expect(overflows(answerFrames, textScale, questionRow())).toEqual([]);
      for (const button of actionButtons(questionRow())) {
        const box = answerFrames.get(button)!;
        for (const label of labelsOf(button)) {
          const frame = answerFrames.get(label)!;
          expect(frame.left).toBeGreaterThanOrEqual(box.left - 0.5);
          expect(frame.left + frame.width).toBeLessThanOrEqual(box.left + box.width + 0.5);
          expect(frame.top + frame.height).toBeLessThanOrEqual(box.top + box.height + 0.5);
        }
      }
      expect(questionRow().findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === (language === "zh" ? "查看问题" : "View questions"))).toHaveLength(1);
    },
  );
  it.each((["sidebar", "sheet"] as const).flatMap((surface) => (["question", "tool"] as const).map((kind) => [surface, kind] as const)))("places controls before the request on the %s and preserves each action (%s)", async (surface, kind) => {
    // A tool's Allow and Deny answer in place as a question's options do: both sit under the section's rule.
    const card = kind === "question" ? choice()() : sample("sample-input");
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const onStop = vi.fn();
    const onPermission = vi.fn();
    const buttons = permissionButtons(card.permission!, "zh", true);
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(TaskDetailCards, {
        card, theme: THEME as never, language: "zh", strings: BOARD_STRINGS.zh.sidebar,
        now: NOW, touch: true, tabs: true, actions: surface === "sheet" ? false : undefined,
        questionActionsInHeader: surface === "sheet", onSheetClose: onClose,
        stop: { phase: "idle", onPress: onStop }, onOpen, onPermission, permissionButtons: buttons,
      }));
    });
    const nodes = renderer!.root.findAll((node) => typeof node.type === "string");
    const controls = nodes.find((node) => node.props.testID === "detail-question-controls")!;
    const question = nodes.find((node) => node.props.testID === "detail-permission")!;
    expect(nodes.indexOf(controls)).toBeLessThan(nodes.indexOf(question));
    expect(Object.assign({}, ...[nodes.find((node) => node.props.testID === "detail-question-section")!.props.style].flat(Infinity).filter(Boolean)).borderTopWidth).toBe(0.5);
    expect(nodes.filter((node) => node.props.testID === "detail-action-bar")).toHaveLength(0);
    await act(async () => {
      controls.find((node) => node.props.testID === "detail-bar-stop").props.onPress();
      controls.find((node) => node.props.testID === "detail-bar-open").props.onPress();
      controls.find((node) => node.props.testID === "detail-bar-close").props.onPress();
      question.find((node) => node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "允许").props.onPress();
    });
    expect(onStop).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith(card.id);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onPermission).toHaveBeenCalledWith(expect.objectContaining({ label: "允许" }));
  });

  it.each((["ios", "android"] as const).flatMap((os) => [300, 340].flatMap((width) => [1, 1.8].flatMap((scale) => (["zh", "en"] as const).map((language) => [os, width, scale, language] as const)))))
  ("fits every request kind's controls on %s at %ipt, scale %f, %s", async (os, width, textScale, language) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    for (const kind of KINDS) {
      const card = kindCard(kind);
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(TasksTypographyScale, { factor: textScale, children: React.createElement(DetailActionBar, {
          card, theme: THEME as never, language, strings: BOARD_STRINGS[language].sidebar,
          controlsOnly: true, stop: { phase: "idle", onPress() {} }, onOpen() {}, onClose() {},
          permissionButtons: permissionButtons(card.permission!, language, true), onPermission() {},
        }) }));
      });
      const controls = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "detail-question-controls");
      const frames = await settleHostLayout(controls, { width, textScale });
      expect(overflows(frames, textScale, controls())).toEqual([]);
      // Stop, Open and Close: the request's answers are not in this row. An unknown request's "Answer" opens the tab instead.
      expect(hostChildren(controls()).map((node) => node.props.testID)).toEqual(kind === "other" ? ["detail-bar-stop", "detail-bar-close"] : ["detail-bar-stop", "detail-bar-open", "detail-bar-close"]);
      await act(async () => renderer!.unmount());
      renderer = null;
    }
  });

  it("does not reserve an empty controls row when only the question is actionable", async () => {
    const card = { ...question(), stoppable: false };
    await act(async () => { renderer = TestRenderer.create(phoneCard(card, "zh", { onOpen: undefined, onStop: undefined })); });
    expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-actions")).toHaveLength(0);
    expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-question-actions")).toHaveLength(1);
  });

  it.each(["zh", "en"] as const)("places phone controls above the labelled question divider in %s", async (language) => {
    const card = choice()();
    await act(async () => { renderer = TestRenderer.create(phoneCard(card, language, { onOpen() {} })); });
    const nodes = renderer!.root.findAll((node) => typeof node.type === "string");
    const controls = nodes.find((node) => node.props.testID === "task-card-actions")!;
    const question = nodes.find((node) => node.props.testID === "task-card-permission")!;
    expect(nodes.indexOf(controls)).toBeLessThan(nodes.indexOf(question));
    const divider = question.find((node) => typeof node.type === "string" && node.props.testID === "task-card-question-divider");
    expect(labelsOf(divider).map((node) => node.children.join(""))).toContain(language === "zh" ? "待回答" : "Awaiting answer");
    expect(question.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-question-actions")).toHaveLength(1);
  });

  it.each((["ios", "android"] as const).flatMap((os) => [300, 340].flatMap((width) => [1, 1.8].flatMap((scale) => (["zh", "en"] as const).map((language) => [os, width, scale, language] as const)))))
  ("fits the non-compact question controls on %s at %ipt, scale %f, %s", async (os, width, textScale, language) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const card = choice()();
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(TasksTypographyScale, { factor: textScale, children: phoneCard(card, language, {
        compact: false, onOpen() {}, permissionButtons: permissionButtons(card.permission!, language, true),
      }) }));
    });
    const controls = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-control-row");
    const frames = await settleHostLayout(controls, { width, textScale });
    expect(overflows(frames, textScale, controls())).toEqual([]);
    expect(controls().findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-stop")).toHaveLength(1);
    expect(controls().findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-open-tab")).toHaveLength(1);
  });

  it.each((["question", "plan"] as const).flatMap((kind) => [true, false].flatMap((compact) => WIDTHS.flatMap((width) => TEXT_SCALES.flatMap((scale) => (["zh", "en"] as const).map((language) => [kind, compact, width, scale, language] as const))))))
  ("centers a %s divider's label and wait between its lines (compact %s) at %ipt, scale %f, %s", async (kind, compact, width, textScale, language) => {
    const card = kindCard(kind);
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(TasksTypographyScale, { factor: textScale, children: phoneCard(card, language, {
        compact, onOpen() {}, permissionButtons: permissionButtons(card.permission!, language, true),
      }) }));
    });
    const divider = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-question-divider");
    const frames = await settleHostLayout(divider, { width, textScale });
    expect(overflows(frames, textScale, divider())).toEqual([]);
    const parts = hostChildren(divider());
    const box = frames.get(divider())!;
    const label = labelsOf(divider()).find((node) => node.children.join("") === (kind === "plan" ? (language === "zh" ? "待确认" : "Awaiting review") : (language === "zh" ? "待回答" : "Awaiting answer")))!;
    const wait = divider().find((node) => typeof node.type === "string" && node.props.testID === "task-card-footer");
    expect(wait.props.testID).toBe("task-card-footer");
    expect(labelsOf(parts[1]!).map((node) => node.children.join(""))).toContain("·");
    // Equal lines center the label and wait together.
    expect(frames.get(parts[0]!)!.width).toBeCloseTo(frames.get(parts[2]!)!.width, 0);
    expect(frames.get(parts[0]!)!.left).toBeCloseTo(box.left, 0);
    expect(frames.get(label)!.left).toBeLessThan(frames.get(wait)!.left);
    expect(frames.get(parts[2]!)!.left + frames.get(parts[2]!)!.width).toBeCloseTo(box.left + box.width, 0);
    // Only the clock and the length: the hover hint and a screen reader say it waits.
    const waitText = labelsOf(wait);
    expect(waitText.map((node) => node.children.join("")).join("")).toMatch(/^\d+(s|m|h)( \d+m)?$/);
    expect(waitText[0]!.props.accessibilityLabel).toMatch(language === "zh" ? /^已等待 / : /^Waiting for /);
  });

  it.each(KINDS.filter((kind) => kind !== "other").flatMap((kind) => [true, false].flatMap((compact) => (["zh", "en"] as const).map((language) => [kind, compact, language] as const))))
  ("keeps a block's row gap above and below a %s divider (compact %s, %s)", async (kind, compact, language) => {
    const card = kindCard(kind);
    await act(async () => {
      renderer = TestRenderer.create(phoneCard(card, language, { compact, onOpen() {}, permissionButtons: permissionButtons(card.permission!, language, true) }));
    });
    const byId = (id: string) => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
    const frames = await settleHostLayout(() => byId(`task-card-${card.id}`), { width: 340, textScale: 1 });
    const above = frames.get(byId(compact ? "task-card-actions" : "task-card-control-row"))!;
    const divider = frames.get(byId("task-card-question-divider"))!;
    const question = byId("task-card-permission");
    const title = frames.get(question.find((node) => typeof node.type === "string" && node.props.numberOfLines === 2))!;
    const gap = compact ? 12 : 10;
    expect(divider.top - (above.top + above.height)).toBeCloseTo(gap, 0);
    expect(title.top - (divider.top + divider.height)).toBeCloseTo(gap, 0);
  });

  it.each([true, false].flatMap((compact) => ["允许", "拒绝"].map((answer) => [compact, answer] as const)))(
    "submits %s compact confirmation answer %s without opening the task tab",
    async (compact, answer) => {
      const fake = createFakePaseo();
      const card = choice()();
      const onOpen = vi.fn();
      let submission: Promise<void> | undefined;
      await act(async () => {
        renderer = TestRenderer.create(phoneCard(card, "zh", {
          compact, onOpen,
          onPermission(given, button) {
            submission = respondToPermission(fake.paseo, given.id, button, given.permission!.requestId);
          },
        }));
      });
      const block = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-permission");
      expect(labelsOf(block).map((node) => node.children.join("")).join("")).toContain(card.permission!.summary);
      const button = renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === answer);
      await act(async () => { button.props.onPress(); await submission; });
      expect(fake.permissionResponses).toEqual([{
        agentId: card.id, requestId: card.permission!.requestId,
        response: { behavior: "allow", updatedInput: { answers: { "Question 1": answer } } },
      }]);
      expect(onOpen).not.toHaveBeenCalled();
    },
  );

  // A tool's Allow and Deny answer the request in place, from under its divider, on a phone or a desktop card.
  it.each([true, false].flatMap((compact) => (["allow", "deny"] as const).map((behavior) => [compact, behavior] as const)))(
    "answers a tool permission's %s card %s in place, from under its divider, without opening the task tab",
    async (compact, behavior) => {
      const fake = createFakePaseo();
      const card = sample("sample-input");
      const onOpen = vi.fn();
      const onStop = vi.fn();
      let submission: Promise<void> | undefined;
      await act(async () => {
        renderer = TestRenderer.create(phoneCard(card, "zh", {
          compact, onOpen, onStop,
          onPermission(given, button) {
            submission = respondToPermission(fake.paseo, given.id, button, given.permission!.requestId);
          },
        }));
      });
      const nodes = renderer!.root.findAll((node) => typeof node.type === "string");
      const block = nodes.find((node) => node.props.testID === "task-card-permission")!;
      const divider = block.find((node) => typeof node.type === "string" && node.props.testID === "task-card-question-divider");
      const answers = block.find((node) => typeof node.type === "string" && node.props.testID === (compact ? "task-card-question-actions" : "task-card-answer-actions"));
      expect(nodes.indexOf(divider)).toBeLessThan(nodes.indexOf(answers));
      // The task's controls sit above the request, never among its answers.
      const controls = nodes.find((node) => node.props.testID === (compact ? "task-card-actions" : "task-card-control-row"))!;
      expect(nodes.indexOf(controls)).toBeLessThan(nodes.indexOf(block));
      expect(answers.findAll((node) => typeof node.type === "string" && (node.props.testID === "task-card-stop" || node.props.testID === "task-card-open-tab"))).toHaveLength(0);
      const label = behavior === "allow" ? "允许" : "拒绝";
      const button = answers.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
      await act(async () => { button.props.onPress(); await submission; });
      expect(fake.permissionResponses).toEqual([{
        agentId: card.id, requestId: card.permission!.requestId,
        response: behavior === "allow" ? { behavior: "allow" } : { behavior: "deny", message: "Denied by user" },
      }]);
      expect(onOpen).not.toHaveBeenCalled();
      expect(onStop).not.toHaveBeenCalled();
    },
  );

  // Every request kind takes the same section; its divider says what it waits for.
  it.each([true, false].flatMap((compact) => (["zh", "en"] as const).flatMap((language) => KINDS.map((kind) => [compact, language, kind] as const))))(
    "labels the request divider by what it waits for (compact %s, %s, %s)",
    async (compact, language, kind) => {
      const card = kindCard(kind);
      const onPermission = vi.fn();
      await act(async () => {
        renderer = TestRenderer.create(phoneCard(card, language, { compact, onOpen() {}, onPermission, permissionButtons: permissionButtons(card.permission!, language, true) }));
      });
      const strings = cardStrings(language);
      const divider = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-question-divider");
      const label = { tool: strings.awaitingApproval, mode: strings.awaitingApproval, plan: strings.awaitingReview, "plan-resume": strings.awaitingReview, question: strings.awaitingAnswer, other: strings.awaitingAnswer }[kind];
      const shown = labelsOf(divider).map((node) => node.children.join(""));
      expect(shown).toContain(label);
      for (const other of [strings.awaitingAnswer, strings.awaitingApproval, strings.awaitingReview].filter((text) => text !== label)) expect(shown).not.toContain(other);
      // The divider names it: no icon beside the request's text, and a plan reads as one, not as its tool's name.
      const block = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-permission");
      const text = block.find((node) => typeof node.type === "string" && node.props.numberOfLines === 2);
      expect(text.parent!.findAll((node) => (node.type as unknown) === "Icon")).toHaveLength(0);
      if (kind === "plan" || kind === "plan-resume") expect(labelsOf(text).map((node) => node.children.join(""))).toContain(strings.planRequest);
      expect(labelsOf(block).map((node) => node.children.join(""))).not.toContain("ExitPlanMode");
      // Its answers sit under the divider; the task's controls (Stop, and Open but beside "Answer") above it.
      const nodes = renderer!.root.findAll((node) => typeof node.type === "string");
      const answers = block.find((node) => typeof node.type === "string" && node.props.testID === (compact ? "task-card-question-actions" : "task-card-answer-actions"));
      expect(nodes.indexOf(divider)).toBeLessThan(nodes.indexOf(answers));
      const labels = answers.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button").map((node) => node.props.accessibilityLabel);
      expect(labels).toEqual(ANSWERS[kind][language]);
      const controls = nodes.find((node) => node.props.testID === (compact ? "task-card-actions" : "task-card-control-row"))!;
      expect(nodes.indexOf(controls)).toBeLessThan(nodes.indexOf(block));
      expect(controls.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-open-tab")).toHaveLength(kind === "other" ? 0 : 1);
      expect(controls.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-stop")).toHaveLength(1);
      expect(answers.findAll((node) => typeof node.type === "string" && (node.props.testID === "task-card-stop" || node.props.testID === "task-card-open-tab"))).toHaveLength(0);
      // Each answer is the request's own.
      const first = answers.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === labels[0]);
      await act(async () => first.props.onPress());
      expect(onPermission).toHaveBeenCalledWith(card, expect.objectContaining({ label: labels[0] }));
    },
  );

  // A real ExitPlanMode's choices answer it in place with the action each one names, on a phone or a desktop card.
  it.each([true, false].flatMap((compact) => [["拒绝", { behavior: "deny", selectedActionId: "reject", message: "Denied by user" }], ["实施", { behavior: "allow", selectedActionId: "implement" }], ["Implement with Bypass", { behavior: "allow", selectedActionId: "implement_resume" }]].map(([label, response]) => [compact, label, response] as const)))(
    "answers a real ExitPlanMode from its %s card's %s in place, without opening the tab or stopping",
    async (compact, label, response) => {
      const fake = createFakePaseo();
      const card = kindCard("plan-resume");
      const onOpen = vi.fn();
      const onStop = vi.fn();
      let submission: Promise<void> | undefined;
      await act(async () => {
        renderer = TestRenderer.create(phoneCard(card, "zh", {
          compact, onOpen, onStop, permissionButtons: permissionButtons(card.permission!, "zh", true),
          onPermission(given, button) { submission = respondToPermission(fake.paseo, given.id, button, given.permission!.requestId); },
        }));
      });
      const answers = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === (compact ? "task-card-question-actions" : "task-card-answer-actions"));
      const button = answers.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
      await act(async () => { button.props.onPress(); await submission; });
      expect(fake.permissionResponses).toEqual([{ agentId: card.id, requestId: "permission-exit-plan", response }]);
      expect(onOpen).not.toHaveBeenCalled();
      expect(onStop).not.toHaveBeenCalled();
    },
  );

  // A host that cannot answer (checking, unreachable) disables every request's in-place answers,
  // on the card and in the details, but not the ones that open the tab or the question form.
  it.each(KINDS.flatMap((kind) => (["phone", "card", "details"] as const).map((surface) => [kind, surface] as const)))(
    "disables a %s request's in-place answers on the %s while the host is unavailable",
    async (kind, surface) => {
      const card: TaskCard = { ...kindCard(kind), availability: unavailableTask({ code: "host_unavailable", detail: null }) };
      const buttons = permissionButtons(card.permission!, "zh", true);
      await act(async () => {
        renderer = TestRenderer.create(surface === "details"
          ? React.createElement(TaskDetailCards, { card, theme: THEME as never, language: "zh", strings: BOARD_STRINGS.zh.sidebar, now: NOW, touch: true, tabs: true, onSheetClose() {}, stop: { phase: "idle", onPress() {} }, onOpen() {}, onPermission() {}, permissionButtons: buttons })
          : phoneCard(card, "zh", { compact: surface === "phone", onOpen() {}, onPermission() {}, permissionButtons: buttons }));
      });
      const id = surface === "details" ? "detail-permission-actions" : surface === "phone" ? "task-card-question-actions" : "task-card-answer-actions";
      const answers = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
      const pressables = answers.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "button");
      expect(pressables.map((node) => node.props.accessibilityLabel)).toEqual(buttons.map((button) => button.label));
      expect(pressables.map((node) => node.props.disabled === true)).toEqual(buttons.map((button) => button.kind === "respond"));
    },
  );

  // An unknown request's "Answer" opens the tab, as it always did, from under its divider.
  it.each([true, false])("opens the tab from an unknown request's Answer (compact %s)", async (compact) => {
    const card = kindCard("other");
    const onPermission = vi.fn();
    await act(async () => {
      renderer = TestRenderer.create(phoneCard(card, "zh", { compact, onOpen() {}, onPermission, permissionButtons: permissionButtons(card.permission!, "zh", true) }));
    });
    const answers = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === (compact ? "task-card-question-actions" : "task-card-answer-actions"));
    await act(async () => answers.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "去回答").props.onPress());
    expect(onPermission).toHaveBeenCalledWith(card, expect.objectContaining({ kind: "open" }));
  });

  // Baseline: a question's phone Stop menu keeps its alignment (to Stop's right edge); every other request kind's matches it.
  it.each([...KINDS, "running"] as const)("keeps the phone Stop menu's alignment for a %s card", async (kind) => {
    const card = kind === "running" ? sample("sample-running") : kindCard(kind);
    await act(async () => {
      renderer = TestRenderer.create(phoneCard(card, "zh", { onOpen() {}, permissionButtons: card.permission ? permissionButtons(card.permission, "zh", true) : [] }));
    });
    const stops = renderer!.root.findAll((node) => typeof node.type === "function" && "menuLeft" in node.props && "hug" in node.props);
    expect(stops).toHaveLength(1);
    expect(stops[0]!.props.menuLeft).toBe(kind === "running");
  });

  it.each(KINDS.flatMap((kind) => (["sidebar", "sheet"] as const).map((surface) => [kind, surface] as const)))(
    "draws a %s request's section under a rule in the %s, its answers inside it and no bottom bar",
    async (kind, surface) => {
      const card = kindCard(kind);
      const buttons = permissionButtons(card.permission!, "zh", true);
      const onPermission = vi.fn();
      const onOpen = vi.fn();
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(TaskDetailCards, {
          card, theme: THEME as never, language: "zh", strings: BOARD_STRINGS.zh.sidebar,
          now: NOW, touch: true, tabs: true, actions: surface === "sheet" ? false : undefined,
          questionActionsInHeader: surface === "sheet", onSheetClose() {},
          stop: { phase: "idle", onPress() {} }, onOpen, onPermission, permissionButtons: buttons,
        }));
      });
      const nodes = renderer!.root.findAll((node) => typeof node.type === "string");
      const section = nodes.find((node) => node.props.testID === "detail-question-section")!;
      expect(Object.assign({}, ...[section.props.style].flat(Infinity).filter(Boolean)).borderTopWidth).toBe(0.5);
      expect(nodes.filter((node) => node.props.testID === "detail-action-bar")).toHaveLength(0);
      const controls = nodes.find((node) => node.props.testID === "detail-question-controls")!;
      expect(nodes.indexOf(controls)).toBeLessThan(nodes.indexOf(section));
      expect(controls.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button").map((node) => node.props.testID)).toEqual(kind === "other" ? ["detail-bar-stop", "detail-bar-close"] : ["detail-bar-stop", "detail-bar-open", "detail-bar-close"]);
      const answers = section.find((node) => typeof node.type === "string" && node.props.testID === "detail-permission-actions");
      const pressables = answers.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button");
      expect(pressables.map((node) => node.props.accessibilityLabel)).toEqual(buttons.map((button) => button.label));
      if (kind === "plan" || kind === "plan-resume") expect(labelsOf(section).map((node) => node.children.join(""))).toContain("计划");
      for (const [index, pressable] of pressables.entries()) {
        await act(async () => pressable.props.onPress());
        expect(onPermission).toHaveBeenLastCalledWith(buttons[index]);
      }
      expect(onOpen).not.toHaveBeenCalled();
    },
  );

  it.each(["zh", "en"] as const)("stacks long written answers with full labels at 300pt, scale 1.8 in %s", async (language) => {
    const item = CASES.find((entry) => entry.name === "the widest CJK options beside Stop and Open")!;
    await settle(item, language, 300, 1.8);
    const frames = await settleHostLayout(questionRow, { width: 300, textScale: 1.8, wrapText: true, wordWrap: true });
    expect(overflows(frames, 1.8, questionRow())).toEqual([]);
    const buttons = hostChildren(questionRow());
    const labels = labelsOf(questionRow());
    expect(labels.map((text) => text.children.join(""))).toEqual([...WIDE_CJK]);
    for (const [index, button] of buttons.entries()) {
      const frame = frames.get(button)!;
      expect(frame.width).toBeCloseTo(frames.get(questionRow())!.width, 0);
      if (index) expect(frame.top).toBeGreaterThan(frames.get(buttons[index - 1]!)!.top + frames.get(buttons[index - 1]!)!.height);
      expect(labels[index]!.props.numberOfLines).toBeUndefined();
      const labelFrame = frames.get(labels[index]!)!;
      const lines = wrapLines(labels[index]!.children.join(""), 12, labelFrame.width, 1.8);
      expect(labelFrame.height).toBeGreaterThanOrEqual(lines.length * 15 - 0.5);
    }
  });

  it.each([240, 300, 340].flatMap((width) => [1, 1.35, 1.8].flatMap((scale) => (["zh", "en"] as const).map((language) => [width, scale, language] as const))))(
    "overlays sidebar undo to the left of Open without resizing the title at %ipt, scale %f, %s",
    async (width, textScale, language) => {
      const child = { ...sample("sample-running").children[0]!, title: language === "zh" ? "非常长的子任务标题用于验证排版和按钮位置" : "A very long subtask title for layout and button placement" };
      const control = createTitleUpdateControl(async () => ({ state: "done", title: child.title, previousTitle: "Previous" }), undefined, async () => ({ ok: true, error: null }));
      control.start(child.id);
      await vi.waitFor(() => expect(control.read(child.id).state).toBe("done"));
      control.showUndo(child.id);
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(TasksTypographyScale, {
          factor: textScale,
          children: React.createElement(SubtaskRow, { child, tokens: taskTokens(THEME), theme: THEME, language, touch: true, backdrop: THEME.colors.surface0, openLabel: "Open", onPress() {}, onOpen() {}, titleUpdates: control, animated: false }),
        }));
      });
      const host = (id: string) => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
      const content = () => host(`subtask-content-${child.id}`);
      const frames = await settleHostLayout(content, { width });
      const undo = frames.get(host(`task-title-undo-${child.id}`))!;
      const open = frames.get(host(`subtask-open-${child.id}`))!;
      const title = frames.get(host(`subtask-title-${child.id}`))!;
      const titleWidth = title.width;
      const fade = frames.get(host(`task-title-undo-fade-${child.id}`))!;
      const meta = frames.get(host(`subtask-meta-${child.id}`))!;
      expect(fade.top).toBeCloseTo(title.top, 0);
      expect(fade.top + fade.height).toBeLessThanOrEqual(meta.top + 0.5);
      expect(undo.left + undo.width).toBeLessThanOrEqual(open.left);
      expect(undo.top + undo.height / 2).toBeCloseTo(open.top + open.height / 2, 0);
      await act(async () => control.undoTitle(child.id));
      const after = await settleHostLayout(content, { width });
      expect(after.get(host(`subtask-title-${child.id}`))!.width).toBeCloseTo(titleWidth, 0);
    },
  );
  it.each([240, 300, 340].flatMap((width) => [1, 1.8].flatMap((scale) => (["zh", "en"] as const).map((language) => [width, scale, language] as const))))(
    "overlays card undo and its fade without changing the title width at %ipt, scale %f, %s",
    async (width, textScale, language) => {
      const card = { ...sample("sample-running"), title: language === "zh" ? "很长的任务标题用于验证自动更新后的按钮和渐变显示" : "A long task title to verify the undo button and fading" };
      const control = createTitleUpdateControl(async () => ({ state: "done", title: card.title, previousTitle: "Previous" }), undefined, async () => ({ ok: true, error: null }));
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(TasksTypographyScale, { factor: textScale, children: phoneCard(card, language, { titleUpdates: control, animated: false }) }));
      });
      const host = (id: string) => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
      const row = () => host("task-card-title-row");
      const before = await settleHostLayout(row, { width });
      const titleWidth = before.get(host("task-card-title"))!.width;
      await act(async () => { control.start(card.id); await Promise.resolve(); });
      const after = await settleHostLayout(row, { width });
      const undo = after.get(host(`task-title-undo-${card.id}`))!;
      expect(after.get(host("task-card-title"))!.width).toBeCloseTo(titleWidth, 0);
      expect(undo.left + undo.width).toBeCloseTo(width + 6, 0);
      expect(after.has(host(`task-title-undo-fade-${card.id}`))).toBe(true);
      await act(async () => control.undoTitle(card.id));
    },
  );
  for (const item of CASES) {
    describe(item.name, () => {
      it.each(WIDTHS.flatMap((width) => TEXT_SCALES.flatMap((scale) => (["zh", "en"] as const).map((language) => [width, scale, language] as const))))(
        "fits a %ipt card at text scale %f in %s",
        async (width, textScale, language) => {
          const frames = await settle(item, language, width, textScale);
          expect(overflows(frames, textScale)).toEqual([]);
          // At the default text size the labels all show on the reported phone's width and wider.
          // Any request's answers, a tool's Allow and Deny as a plan's choices or a question's options, take their own row.
          const kind = item.card().permission?.kind;
          if (kind) {
            const answerFrames = await settleHostLayout(questionRow, { width, textScale, wrapText: item.wrap });
            expect(overflows(answerFrames, textScale, questionRow())).toEqual([]);
          }
          if (textScale === 1 && width >= (item.fullFrom?.[language] ?? 340)) {
            const shown = kind ? labelsOf(questionRow()) : labelsOf(row());
            const expected = kind === "question" ? item.expected[language].filter((label) => label !== "停止" && label !== "Stop")
              : kind ? item.expected[language].filter((label) => !CONTROL_LABELS.has(label)) : item.expected[language];
            expect(shown.map((text) => text.children.join(""))).toEqual(expected);
            // Any other request's Stop and Open keep the bar above its divider.
            if (kind && kind !== "question") expect(labelsOf(row()).map((text) => text.children.join(""))).toEqual(item.expected[language].filter((label) => CONTROL_LABELS.has(label)));
          }
        },
      );
    });
  }

  // A scheduled task's card holds its rows below the title in a group of their own (the ticket's tail).
  it.each(WIDTHS.flatMap((width) => TEXT_SCALES.flatMap((scale) => (["zh", "en"] as const).map((language) => [width, scale, language] as const))))(
    "fits Allow, Deny and Stop on a scheduled card laid out whole at %ipt, text scale %f, %s",
    async (width, textScale, language) => {
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(TasksTypographyScale, { factor: textScale, children: phoneCard({ ...sample("sample-input"), scheduled: true }, language) }));
      });
      const card = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-sample-input");
      const frames = await settleHostLayout(card, { width, textScale });
      expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-ticket-band")).toHaveLength(1);
      expect(overflows(frames, textScale)).toEqual([]);
      const box = frames.get(card())!;
      // A tool permission's Stop bar and its answers under the divider both stay inside the ticket.
      for (const bar of [frames.get(row())!, frames.get(questionRow())!]) {
        expect(bar.left).toBeGreaterThanOrEqual(box.left);
        expect(bar.left + bar.width).toBeLessThanOrEqual(box.left + box.width);
      }
      expect(overflows(frames, textScale, questionRow())).toEqual([]);
    },
  );

  it.each(["zh", "en"] as const)("puts a real ExitPlanMode's three choices in pairs in %s, with Stop and Open above", async (language) => {
    const plan = kindCard("plan-resume");
    await act(async () => { renderer = TestRenderer.create(phoneCard(plan, language, { onOpen() {}, permissionButtons: permissionButtons(plan.permission!, language, true) })); });
    const card = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === `task-card-${plan.id}`);
    const frames = await settleHostLayout(card, { width: 340, textScale: 1 });
    const answers = frames.get(questionRow())!;
    const choices = actionButtons(questionRow()).map((node) => frames.get(node)!);
    expect(choices).toHaveLength(3);
    expect(actionButtons(questionRow()).map((node) => node.props.accessibilityLabel)).toEqual(ANSWERS["plan-resume"][language]);
    expect(choices[0]!.left).toBeCloseTo(answers.left, 0);
    expect(choices[0]!.top).toBeCloseTo(choices[1]!.top, 0);
    expect(choices[2]!.top).toBeGreaterThan(choices[1]!.top + choices[1]!.height);
    expect(labelsOf(questionRow()).map((text) => text.children.join(""))).toEqual(ANSWERS["plan-resume"][language]);
    const [stop, open] = hostChildren(row()).map((node) => frames.get(node)!);
    const divider = frames.get(renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-question-divider"))!;
    expect(divider.top).toBeGreaterThan(Math.max(stop!.top + stop!.height, open!.top + open!.height));
    expect(divider.top + divider.height).toBeLessThan(choices[0]!.top);
  });

  // Short Allow and Deny labels still fit side by side on a narrow card.
  it.each((["tool", "mode"] as const).flatMap((kind) => [true, false].flatMap((compact) => [240, 300].map((width) => [kind, compact, width] as const))))(
    "keeps a %s request's answers on one filled row (compact %s) at %ipt, text scale 1.8",
    async (kind, compact, width) => {
      const card = kindCard(kind);
      await act(async () => { renderer = TestRenderer.create(phoneCard(card, "en", { compact, onOpen() {}, permissionButtons: permissionButtons(card.permission!, "en", true) })); });
      const id = compact ? "task-card-question-actions" : "task-card-answer-actions";
      const answers = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
      const frames = await settleHostLayout(() => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === `task-card-${card.id}`), { width, textScale: 1.8, wrapText: true, wordWrap: true });
      const tops = hostChildren(answers()).map((node) => frames.get(node)!.top);
      expect(new Set(tops.map((top) => Math.round(top))).size).toBe(1);
      expect(unevenLines(frames, answers())).toEqual([]);
      expect(overflows(frames, 1.8, answers())).toEqual([]);
      expect(Object.assign({}, ...[answers().props.style].flat(Infinity).filter(Boolean)).flexDirection).toBe("row");
    },
  );

  it.each([true, false])("fits all three actions or separates them as width changes (compact %s)", async (compact) => {
    const card = choice(["按此方案执行", "先不要改"])();
    await act(async () => { renderer = TestRenderer.create(phoneCard(card, "zh", { compact, onOpen() {}, permissionButtons: permissionButtons(card.permission!, "zh", true) })); });
    const id = compact ? "task-card-question-actions" : "task-card-answer-actions";
    const answers = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
    for (const [width, mode] of [[600, "all"], [300, "all"], [240, "pair"], [190, "pair"], [120, "stack"], [300, "all"], [190, "pair"], [600, "all"]] as const) {
      // The frame drawn at the new width before the row hears of it: never overlapping or past the card.
      expect(collisions(measureHostTree(answers(), { width, textScale: 1, wrapText: true, wordWrap: true }), answers())).toEqual([]);
      const frames = await settleHostLayout(answers, { width, textScale: 1, wrapText: true, wordWrap: true });
      expect(unevenLines(frames, answers())).toEqual([]);
      const children = actionButtons(answers());
      expect(children).toHaveLength(3);
      expect(labelsOf(answers()).map((node) => node.children.join(""))).toEqual(["按此方案执行", "先不要改", "查看问题"]);
      const [first, second, view] = children.map((button) => frames.get(button)!);
      const rowFrame = frames.get(answers())!;
      expect(overflows(frames, 1, answers())).toEqual([]);
      expect(first!.left).toBeCloseTo(rowFrame.left, 0);
      if (mode === "stack") {
        expect(second!.top).toBeGreaterThan(first!.top + first!.height);
        expect(first!.width).toBeCloseTo(rowFrame.width, 0);
        expect(second!.width).toBeCloseTo(rowFrame.width, 0);
      } else {
        expect(second!.top).toBeCloseTo(first!.top, 0);
        if (mode === "pair") expect(second!.left + second!.width).toBeCloseTo(rowFrame.left + rowFrame.width, 0);
      }
      if (mode === "all") {
        expect(view!.top).toBeCloseTo(first!.top, 0);
        expect(view!.left + view!.width).toBeCloseTo(rowFrame.left + rowFrame.width, 0);
      } else {
        expect(view!.top).toBeGreaterThan(second!.top + second!.height);
        expect(view!.width).toBeCloseTo(rowFrame.width, 0);
      }
    }
  });

  // A lane's card scrolled back into view mounts again, its labels' widths already known.
  const REMOUNT_LABELS = [["允许", "拒绝"], ["按此方案执行", "先不要改"], [...WIDE_CJK], [...WIDE_LATIN]] as const;
  it.each([true, false].flatMap((compact) => [300, 340, 390, 600].flatMap((width) => TEXT_SCALES.flatMap((scale) => (["zh", "en"] as const).flatMap((language) => REMOUNT_LABELS.map((_, set) => [compact, width, scale, language, set] as const))))))
  ("remounts two options and View questions apart from its first frame, as they settled and in one commit when they fit one line (compact %s, %ipt, scale %f, %s, labels %i)", async (compact, width, textScale, language, set) => {
    const labels = REMOUNT_LABELS[set]!;
    const card = choice([labels[0], labels[1]])();
    const options = { width, textScale, wrapText: true, wordWrap: true };
    const id = compact ? "task-card-question-actions" : "task-card-answer-actions";
    const answers = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
    const mount = (shown: TaskCard, onRender?: () => void) => {
      const element = phoneCard(shown, language, { compact, onOpen() {}, permissionButtons: permissionButtons(shown.permission!, language, true) });
      return TestRenderer.create(onRender ? React.createElement(React.Profiler, { id: "card", onRender }, element) : element);
    };
    await act(async () => { renderer = mount(card); });
    const before = await settleHostLayout(answers, options);
    const settled = actionButtons(answers()).map((button) => before.get(button)!);
    await act(async () => renderer!.unmount());
    let commits = 0;
    await act(async () => { renderer = mount({ ...card, id: "another-question" }, () => { commits++; }); });
    const mounted = commits;
    expect(mounted).toBeGreaterThan(0);
    // Its first frame, before any layout reaches the row: always apart and inside the card.
    const first = measureHostTree(answers(), options);
    expect(collisions(first, answers())).toEqual([]);
    expect(wrapping(answers())).toEqual([]);
    const firstFrames = actionButtons(answers()).map((button) => first.get(button)!);
    const frames = await settleHostLayout(answers, options);
    const buttons = actionButtons(answers());
    expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual([labels[0], labels[1], language === "zh" ? "查看问题" : "View questions"]);
    expect(buttons.map((button) => frames.get(button)!)).toEqual(settled);
    expect(collisions(frames, answers())).toEqual([]);
    expect(unevenLines(frames, answers())).toEqual([]);
    expect(overflows(frames, textScale, answers())).toEqual([]);
    expect(wrapping(answers())).toEqual([]);
    const lines = buttonLines(frames, answers());
    if (width === 600 && textScale === 1) expect(lines).toHaveLength(1);
    if (lines.length === 1) {
      // With its labels' widths known, one line is drawn whole from the first frame, and the mount is its only commit.
      expect(firstFrames).toEqual(settled);
      expect(commits - mounted).toBe(0);
    } else {
      // Separating them waits for the row's width: one more commit, after its first onLayout.
      expect(commits - mounted).toBeGreaterThan(0);
    }
    // View questions takes the last line alone once all three do not fit; the options pair up above it or take a line each.
    const order = lines.map((line) => line.map(({ node }) => buttons.indexOf(node)));
    expect([[[0, 1, 2]], [[0, 1], [2]], [[0], [1], [2]]]).toContainEqual(order);
  });

  // Label widths are kept by text and type, not by the card's width: a card
  // narrowed (a rotated phone, a split screen, a resized sidebar) or another
  // mounting at that width starts from widths measured on a wider card.
  const NARROWED = [...REMOUNT_LABELS.map((labels) => ({ name: labels.join(" / "), card: choice([labels[0], labels[1]]) })), { name: "Allow / Deny", card: () => kindCard("tool") }, { name: "a plan's three choices", card: () => kindCard("plan-resume") }];
  it.each([true, false].flatMap((compact) => [240, 300, 340].flatMap((width) => TEXT_SCALES.flatMap((scale) => (["zh", "en"] as const).flatMap((language) => NARROWED.map((item) => [compact, width, scale, language, item.name] as const))))))
  ("keeps answers measured at 600pt inside a narrower card from the first frame, and whole once its width arrives (compact %s, %ipt, scale %f, %s, %s)", async (compact, width, textScale, language, name) => {
    const card = NARROWED.find((item) => item.name === name)!.card();
    const wide = { width: 600, textScale, wrapText: true, wordWrap: true };
    const narrow = { ...wide, width };
    const id = compact ? "task-card-question-actions" : "task-card-answer-actions";
    const answers = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
    const mount = (shown: TaskCard) => TestRenderer.create(phoneCard(shown, language, { compact, onOpen() {}, permissionButtons: permissionButtons(shown.permission!, language, true) }));
    // Before the row hears of its width, it is only kept inside the card with its buttons apart: a label may wrap tight for that frame.
    const apart = (frames: Map<ReactTestInstance, Frame>) => {
      expect(wrapping(answers())).toEqual([]);
      expect(collisions(frames, answers())).toEqual([]);
    };
    const whole = (frames: Map<ReactTestInstance, Frame>) => {
      apart(frames);
      expect(overflows(frames, textScale, answers())).toEqual([]);
      for (const button of actionButtons(answers())) for (const label of labelsOf(button)) {
        const box = frames.get(button)!;
        const frame = frames.get(label)!;
        expect(frame.left).toBeGreaterThanOrEqual(box.left - 0.5);
        expect(frame.left + frame.width).toBeLessThanOrEqual(box.left + box.width + 0.5);
      }
      expect(unevenLines(frames, answers())).toEqual([]);
    };
    const positions = (frames: Map<ReactTestInstance, Frame>) => actionButtons(answers()).map((button) => frames.get(button)!);
    await act(async () => { renderer = mount(card); });
    whole(await settleHostLayout(answers, wide));
    await act(async () => renderer!.unmount());
    // Another card mounting at the narrow width, all it knows from 600pt.
    await act(async () => { renderer = mount({ ...card, id: "another-request" }); });
    apart(measureHostTree(answers(), narrow));
    whole(await settleHostLayout(answers, narrow));
    // The same card widened and narrowed again: each frame before the row hears of the change.
    apart(measureHostTree(answers(), wide));
    whole(await settleHostLayout(answers, wide));
    apart(measureHostTree(answers(), narrow));
    const narrowFrames = await settleHostLayout(answers, narrow);
    whole(narrowFrames);
    const settled = positions(narrowFrames);
    await act(async () => renderer!.unmount());
    // A card mounting once another has settled at the narrow width: apart from its first frame, and as that one once its width arrives.
    await act(async () => { renderer = mount({ ...card, id: "third-request" }); });
    const first = measureHostTree(answers(), narrow);
    apart(first);
    const frames = await settleHostLayout(answers, narrow);
    whole(frames);
    expect(positions(frames)).toEqual(settled);
    if (buttonLines(frames, answers()).length === 1) expect(positions(first)).toEqual(settled);
    const buttons = actionButtons(answers());
    const order = buttonLines(frames, answers()).map((line) => line.map(({ node }) => buttons.indexOf(node)));
    if (card.permission?.kind === "question") expect([[[0, 1, 2]], [[0, 1], [2]], [[0], [1], [2]]]).toContainEqual(order);
  });

  it.each([true, false])("fills the row when View questions is the only action (compact %s)", async (compact) => {
    const card = question();
    const buttons = permissionButtons(card.permission!, "zh", true);
    expect(buttons.map((button) => button.kind)).toEqual(["question"]);
    await act(async () => { renderer = TestRenderer.create(phoneCard(card, "zh", { compact, permissionButtons: buttons })); });
    const id = compact ? "task-card-question-actions" : "task-card-answer-actions";
    const row = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
    const frames = await settleHostLayout(row, { width: 240, textScale: 1, wrapText: true });
    const button = frames.get(actionButtons(row())[0]!)!;
    expect(button.left).toBeCloseTo(frames.get(row())!.left, 0);
    expect(button.width).toBeCloseTo(frames.get(row())!.width, 0);
  });

  it.each([true, false].flatMap((compact) => [240, 300, 600].flatMap((width) => [1, 1.8].flatMap((scale) => (["zh", "en"] as const).map((language) => [compact, width, scale, language] as const)))))
  ("fills the answer area (compact %s, %ipt, scale %f, %s)", async (compact, width, textScale, language) => {
    const card = choice(["按此方案执行", "先不要改"])();
    await act(async () => { renderer = TestRenderer.create(phoneCard(card, language, { compact, onOpen() {}, permissionButtons: permissionButtons(card.permission!, language, true) })); });
    const byId = (id: string) => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
    const frames = await settleHostLayout(() => byId(`task-card-${card.id}`), { width, textScale, wrapText: true, wordWrap: true });
    const row = byId(compact ? "task-card-question-actions" : "task-card-answer-actions");
    const area = frames.get(row)!;
    const divider = frames.get(byId("task-card-question-divider"))!;
    expect(area.left).toBeCloseTo(divider.left, 0);
    expect(area.width).toBeCloseTo(divider.width, 0);
    const buttons = actionButtons(row).map((button) => frames.get(button)!);
    if (width === 600 && textScale === 1) expect(new Set(buttons.map((button) => Math.round(button.top))).size).toBe(1);
    for (const top of new Set(buttons.map((button) => Math.round(button.top)))) {
      const line = buttons.filter((button) => Math.round(button.top) === top);
      expect(line[0]!.left).toBeCloseTo(area.left, 0);
      expect(line.at(-1)!.left + line.at(-1)!.width).toBeCloseTo(area.left + area.width, 0);
    }
    expect(unevenLines(frames, row)).toEqual([]);
    expect(overflows(frames, textScale, row)).toEqual([]);
  });

  it.each([true, false].flatMap((compact) => [240, 600].flatMap((width) => [1, 1.8].flatMap((scale) => (["zh", "en"] as const).map((language) => [compact, width, scale, language] as const)))))
  ("lays out four answers and View questions in order (compact %s, %ipt, scale %f, %s)", async (compact, width, textScale, language) => {
    const card = kindCard("plan-resume");
    const planButtons = permissionButtons(card.permission!, language, true);
    const view = permissionButtons(choice()().permission!, language, true).find((button) => button.kind === "question")!;
    const buttons = [...planButtons, { ...planButtons[0]!, key: "fourth", label: language === "zh" ? "第四项" : "Fourth" }, view];
    const onPermission = vi.fn();
    await act(async () => { renderer = TestRenderer.create(phoneCard(card, language, { compact, onPermission, permissionButtons: buttons })); });
    const id = compact ? "task-card-question-actions" : "task-card-answer-actions";
    const row = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
    const root = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === `task-card-${card.id}`);
    const frames = await settleHostLayout(root, { width, textScale, wrapText: true, wordWrap: true });
    const divider = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-question-divider");
    expect(frames.get(row())!.width).toBeCloseTo(frames.get(divider)!.width, 0);
    const children = actionButtons(row());
    expect(children.map((button) => button.props.accessibilityLabel)).toEqual(buttons.map((button) => button.label));
    const tops = children.map((button) => Math.round(frames.get(button)!.top));
    for (const top of new Set(tops)) {
      const line = children.filter((_, index) => tops[index] === top).map((button) => frames.get(button)!);
      expect(line.length).toBeLessThanOrEqual(2);
      expect(line[0]!.left).toBeCloseTo(frames.get(row())!.left, 0);
      expect(line.at(-1)!.left + line.at(-1)!.width).toBeCloseTo(frames.get(row())!.left + frames.get(row())!.width, 0);
    }
    expect(tops[4]!).toBeGreaterThan(tops[3]!);
    expect(overflows(frames, textScale, row())).toEqual([]);
    for (const [index, button] of children.entries()) {
      await act(async () => button.props.onPress());
      expect(onPermission).toHaveBeenLastCalledWith(card, buttons[index]);
    }
  });

  const answerCases = ["tool", "mode", "plan", "plan-resume", "question", "question-long", "view-only", "other", "four-actions"] as const;
  it.each((["ios", "android"] as const).flatMap((os) => [true, false].flatMap((compact) => [200, 240, 300, 387, 600].flatMap((width) => TEXT_SCALES.flatMap((scale) => (["zh", "en"] as const).flatMap((language) => answerCases.map((kind) => [os, compact, width, scale, language, kind] as const)))))))
  ("fits %s card answers (compact %s, %ipt, scale %f, %s, %s)", async (os, compact, width, textScale, language, kind) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const card = kind === "question-long" ? choice(language === "zh" ? [...WIDE_CJK] : [...WIDE_LATIN])()
      : kind === "view-only" ? question() : kind === "four-actions" ? kindCard("plan-resume") : kindCard(kind);
    const original = permissionButtons(card.permission!, language, true);
    const buttons = kind === "four-actions" ? [...original, { ...original[0]!, key: "fourth", label: language === "zh" ? "第四项" : "Fourth" }] : original;
    const onPermission = vi.fn();
    await act(async () => { renderer = TestRenderer.create(phoneCard(card, language, { compact, onOpen() {}, onPermission, permissionButtons: buttons })); });
    const byId = (id: string) => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
    const frames = await settleHostLayout(() => byId(`task-card-${card.id}`), { width, textScale, wrapText: true, wordWrap: true });
    const row = byId(compact ? "task-card-question-actions" : "task-card-answer-actions");
    const area = frames.get(row)!;
    const children = actionButtons(row);
    expect(children.map((button) => button.props.accessibilityLabel)).toEqual(buttons.map((button) => button.label));
    expect(area.width).toBeCloseTo(frames.get(byId("task-card-question-divider"))!.width, 0);
    const tops = children.map((button) => Math.round(frames.get(button)!.top));
    for (const top of new Set(tops)) {
      const line = children.filter((_, index) => tops[index] === top).map((button) => frames.get(button)!);
      expect(line.length).toBeLessThanOrEqual(kind === "question" || kind === "question-long" ? 3 : 2);
      expect(line[0]!.left).toBeCloseTo(area.left, 0);
      expect(line.at(-1)!.left + line.at(-1)!.width).toBeCloseTo(area.left + area.width, 0);
    }
    expect(unevenLines(frames, row)).toEqual([]);
    expect(collisions(frames, row)).toEqual([]);
    expect(wrapping(row)).toEqual([]);
    for (const [index, button] of children.entries()) {
      const box = frames.get(button)!;
      const label = labelsOf(button).find((node) => node.children.join("") === buttons[index]!.label);
      expect(label).toBeDefined();
      const frame = frames.get(label!)!;
      const style = Object.assign({}, ...[label!.props.style].flat(Infinity).filter(Boolean)) as { fontSize: number; lineHeight?: number };
      const lines = wrapLines(buttons[index]!.label, style.fontSize, frame.width, textScale);
      expect(label!.props.numberOfLines).toBeUndefined();
      expect(frame.height).toBeGreaterThanOrEqual(lines.length * (style.lineHeight ?? Math.ceil(style.fontSize * 1.25)) - 0.5);
      expect(frame.left).toBeGreaterThanOrEqual(box.left - 0.5);
      expect(frame.left + frame.width).toBeLessThanOrEqual(box.left + box.width + 0.5);
      expect(frame.top + frame.height).toBeLessThanOrEqual(box.top + box.height + 0.5);
      if (os === "ios" && compact && width === 300 && textScale === 1 && language === "zh") {
        await act(async () => button.props.onPress());
        expect(onPermission).toHaveBeenLastCalledWith(card, buttons[index]);
      }
    }
  });

  // A plan's two Implement choices share the Check, so their words are all
  // that tells them apart. On every surface, width, text size and language,
  // each one's label box, as native Yoga lays it out with word wrapping
  // (`wrapLines`), holds its whole label in whole words, inside its button:
  // nothing is cut to "Implement…", so the two never read alike.
  it.each((["phone", "card", "details"] as const).flatMap((surface) => [240, 300, 322, 340, 387].flatMap((width) => TEXT_SCALES.flatMap((textScale) => (["zh", "en"] as const).map((language) => [surface, width, textScale, language] as const)))))(
    "shows both Implement choices in full, in whole words, on the %s at %ipt, text scale %f, %s",
    async (surface, width, textScale, language) => {
      const plan = kindCard("plan-resume");
      const buttons = permissionButtons(plan.permission!, language, true);
      await act(async () => {
        // The system text size scales every label in the layout (`textScale`), as on a device.
        renderer = TestRenderer.create(surface === "details"
          ? React.createElement(TaskDetailCards, { card: plan, theme: THEME as never, language, strings: BOARD_STRINGS[language].sidebar, now: NOW, touch: true, tabs: true, onSheetClose() {}, stop: { phase: "idle", onPress() {} }, onOpen() {}, onPermission() {}, permissionButtons: buttons })
          : phoneCard(plan, language, { compact: surface === "phone", onOpen() {}, permissionButtons: buttons }));
      });
      const byId = (id: string) => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
      const rootId = surface === "details" ? "detail-permission" : `task-card-${plan.id}`;
      const rowId = surface === "details" ? "detail-permission-actions" : surface === "phone" ? "task-card-question-actions" : "task-card-answer-actions";
      const frames = await settleHostLayout(() => byId(rootId), { width, textScale, wrapText: true, wordWrap: true });
      const row = byId(rowId);
      const box = frames.get(byId(rootId))!;
      const visible = new Map<string, string[]>();
      for (const button of actionButtons(row)) {
        const label = String(button.props.accessibilityLabel);
        const frame = frames.get(button)!;
        // Every answer stays inside the card or panel.
        expect(frame.left).toBeGreaterThanOrEqual(box.left - 0.5);
        expect(frame.left + frame.width).toBeLessThanOrEqual(box.left + box.width + 0.5);
        if (!label.startsWith("Implement") && label !== "实施") continue;
        const text = labelsOf(button).find((node) => node.children.join("") === label);
        // Never folded to its icon alone.
        expect(text, `${label} folded`).toBeDefined();
        expect(text!.props.ellipsizeMode).toBeUndefined();
        const textFrame = frames.get(text!)!;
        const style = Object.assign({}, ...[text!.props.style].flat(Infinity).filter(Boolean)) as { fontSize: number; lineHeight?: number };
        const lineHeight = style.lineHeight ?? Math.ceil(style.fontSize * 1.25);
        const lines = wrapLines(label, style.fontSize, textFrame.width, textScale);
        if (text!.props.numberOfLines === 1) expect(lines).toHaveLength(1);
        // The box is tall enough for those lines, and they all sit inside the button.
        expect(textFrame.height).toBeGreaterThanOrEqual(lines.length * lineHeight - 0.5);
        expect(textFrame.left + textFrame.width).toBeLessThanOrEqual(frame.left + frame.width + 0.5);
        expect(textFrame.top + textFrame.height).toBeLessThanOrEqual(frame.top + frame.height + 0.5);
        // Whole words: the lines put back together are the label, no word split across two.
        expect(lines.flatMap((line) => line.split(/\s+/))).toEqual(label.split(/\s+/));
        visible.set(label, lines);
      }
      // Both drawn, and they read differently.
      const shown = [...visible.values()].map((lines) => lines.join("\n"));
      expect(shown).toHaveLength(2);
      expect(new Set(shown).size).toBe(2);
    },
  );

  // "View plan" shares the plan title's row: it keeps its whole label inside the card, and the title takes what is left.
  it.each((["phone", "card", "details"] as const).flatMap((surface) => [240, 300, 340, 387].flatMap((width) => TEXT_SCALES.flatMap((textScale) => (["zh", "en"] as const).map((language) => [surface, width, textScale, language] as const)))))(
    "keeps View plan whole beside the plan's title on the %s at %ipt, text scale %f, %s",
    async (surface, width, textScale, language) => {
      const plan = kindCard("plan");
      const buttons = permissionButtons(plan.permission!, language, true);
      await act(async () => {
        renderer = TestRenderer.create(surface === "details"
          ? React.createElement(TaskDetailCards, { card: plan, theme: THEME as never, language, strings: BOARD_STRINGS[language].sidebar, now: NOW, touch: true, tabs: true, onSheetClose() {}, stop: { phase: "idle", onPress() {} }, onOpen() {}, onPermission() {}, permissionButtons: buttons })
          : phoneCard(plan, language, { compact: surface === "phone", onOpen() {}, permissionButtons: buttons }));
      });
      const byId = (id: string) => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
      const rootId = surface === "details" ? "detail-permission" : `task-card-${plan.id}`;
      const frames = await settleHostLayout(() => byId(rootId), { width, textScale, wrapText: true, wordWrap: true });
      const box = frames.get(byId(rootId))!;
      const view = byId(surface === "details" ? "detail-view-plan" : "task-card-view-plan");
      const frame = frames.get(view)!;
      expect(frame.left).toBeGreaterThanOrEqual(box.left - 0.5);
      expect(frame.left + frame.width).toBeLessThanOrEqual(box.left + box.width + 0.5);
      const label = labelsOf(view).find((node) => node.children.join("") === cardStrings(language).viewPlan)!;
      const labelFrame = frames.get(label)!;
      const fontSize = (Object.assign({}, ...[label.props.style].flat(Infinity).filter(Boolean)) as { fontSize: number }).fontSize;
      // Whole, on one line, inside its button.
      expect(labelFrame.width).toBeGreaterThanOrEqual(estimateTextWidth(cardStrings(language).viewPlan, fontSize) * textScale - 0.5);
      expect(labelFrame.left + labelFrame.width).toBeLessThanOrEqual(frame.left + frame.width + 0.5);
      // The title sits before it, on the same row, and keeps some width.
      let row = view.parent!;
      while (typeof row.type !== "string") row = row.parent!;
      const title = hostChildren(row).find((node) => node.props.numberOfLines === 2)!;
      expect(frames.get(title)!.top).toBeLessThan(frame.top + frame.height);
      expect(frames.get(title)!.left + frames.get(title)!.width).toBeLessThanOrEqual(frame.left + 0.5);
      expect(frames.get(title)!.width).toBeGreaterThan(40);
    },
  );

  it.each(["zh", "en"] as const)("shares a tool permission's answer row between Allow and Deny, with Stop and Open on the bar above in %s", async (language) => {
    await act(async () => { renderer = TestRenderer.create(phoneCard(sample("sample-input"), language, { onOpen() {} })); });
    const card = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-sample-input");
    const frames = await settleHostLayout(card, { width: 340, textScale: 1 });
    const box = frames.get(card())!;
    const answers = frames.get(questionRow())!;
    expect(answers.left).toBeGreaterThan(box.left);
    expect(answers.left + answers.width).toBeLessThan(box.left + box.width);
    const [allow, deny] = hostChildren(questionRow()).map((node) => frames.get(node)!);
    if (language === "zh") expect(Math.abs(allow!.width - deny!.width)).toBeLessThanOrEqual(0.5);
    expect(allow!.left).toBeCloseTo(answers.left, 0);
    expect(deny!.left + deny!.width).toBeCloseTo(answers.left + answers.width, 0);
    // Stop hugs its label beside Open, which takes the rest, as on a question's card.
    const [stop, open] = hostChildren(row()).map((node) => frames.get(node)!);
    expect(stop!.width).toBeLessThan(open!.width);
    const divider = frames.get(renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-question-divider"))!;
    expect(divider.top).toBeGreaterThan(stop!.top + stop!.height);
    expect(divider.top + divider.height).toBeLessThan(allow!.top);
  });

  it.each(["zh", "en"] as const)("centers the visible Open label and arrow in %s", async (language) => {
    const item = CASES.find((entry) => entry.name === "a running Stop beside Open tab")!;
    const frames = await settle(item, language, 340, 1);
    const button = row().find((node) => typeof node.type === "string" && node.props.testID === "task-card-open-tab");
    const label = labelsOf(button)[0]!;
    const arrow = button.find((node) => (node.type as unknown) === "Icon" && node.props.name === "ArrowUpRight");
    const box = frames.get(button)!;
    const text = frames.get(label)!;
    const icon = frames.get(arrow)!;
    // The Lucide stroke reaches column 18 of the 24-unit icon box.
    const left = text.left - box.left;
    const right = box.left + box.width - (icon.left + icon.width * 18 / 24);
    expect(Math.abs(left - right)).toBeLessThan(1);
  });

  it.each(["zh", "en"] as const)("centers the visible Open and Answer actions in the detail bar in %s", async (language) => {
    for (const id of ["sample-running", "sample-question"]) {
      const card = sample(id);
      const buttons = card.permission ? permissionButtons(card.permission, language) : [];
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(DetailActionBar, {
          card, theme: THEME as never, language, strings: BOARD_STRINGS[language].sidebar,
          onOpen() {}, onPermission() {}, permissionButtons: buttons,
        }));
      });
      const bar = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "detail-action-bar");
      const frames = await settleHostLayout(bar, { width: 340 });
      const label = id === "sample-running" ? cardStrings(language).openTab : buttons.find((button) => button.kind === "open")!.label;
      const button = bar().find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === label);
      const text = frames.get(labelsOf(button)[0]!)!;
      const arrow = button.find((node) => (node.type as unknown) === "Icon" && node.props.name === "ArrowUpRight");
      const icon = frames.get(arrow)!;
      const box = frames.get(button)!;
      expect(Math.abs((text.left - box.left) - (box.left + box.width - icon.left - icon.width * 18 / 24))).toBeLessThan(1);
      await act(async () => renderer!.unmount());
      renderer = null;
    }
  });

  it.each([240, 300, 340].flatMap((width) => [1, 1.35, 1.8].flatMap((scale) => [WIDE_CJK, WIDE_LATIN, ["允许", "拒绝"] as const].map((labels) => [width, scale, labels] as const))))(
    "wraps a question's written options whole inside the details' request at %ipt, text scale %f: %j",
    async (width, textScale, labels) => {
      const card = choice([labels[0], labels[1]])();
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(TasksTypographyScale, { factor: textScale, children: React.createElement(TaskDetailCards, {
          card, theme: THEME as never, language: "zh", strings: BOARD_STRINGS.zh.sidebar, now: NOW, touch: true,
          permissionButtons: permissionButtons(card.permission!, "zh"), onPermission() {},
        }) }));
      });
      const block = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "detail-permission-buttons");
      const frames = await settleHostLayout(block, { width, textScale, wrapText: true });
      const box = frames.get(block())!;
      const items = block().findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button");
      expect(items.map((node) => node.props.accessibilityLabel)).toEqual([...labels]);
      for (const item of items) {
        const frame = frames.get(item)!;
        expect(frame.left).toBeGreaterThanOrEqual(box.left - 0.5);
        expect(frame.left + frame.width).toBeLessThanOrEqual(box.left + box.width + 0.5);
        for (const text of labelsOf(item)) {
          const textFrame = frames.get(text)!;
          const fontSize = (Object.assign({}, ...[text.props.style].flat(Infinity).filter(Boolean)) as { fontSize?: number }).fontSize ?? 14;
          const lines = Math.round(textFrame.height / Math.ceil(fontSize * 1.25));
          expect(textFrame.width * lines).toBeGreaterThanOrEqual(estimateTextWidth(text.children.join(""), fontSize) * textScale - 0.5);
          expect(textFrame.left + textFrame.width).toBeLessThanOrEqual(frame.left + frame.width + 0.5);
          expect(textFrame.top + textFrame.height).toBeLessThanOrEqual(frame.top + frame.height + 0.5);
        }
      }
    },
  );

  it.each((["ios", "android"] as const).flatMap((os) => [300, 340, 500].flatMap((width) => [1, 1.35, 1.8].flatMap((scale) => [false, true].flatMap((closes) => [WIDE_CJK, WIDE_LATIN, ["允许", "拒绝"] as const].map((labels) => [os, width, scale, closes, labels] as const))))))(
    "wraps a question's written options whole inside the sheet bar on %s at %ipt, text scale %f, close %s: %j",
    async (os, width, textScale, closes, labels) => {
      (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
      const card = choice([labels[0], labels[1]])();
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(TasksTypographyScale, { factor: textScale, children: React.createElement(DetailActionBar, {
          card, theme: THEME as never, language: "zh", strings: BOARD_STRINGS.zh.sidebar,
          sidebar: true, smallTablet: true, onOpen() {}, ...(closes ? { onClose() {} } : null), onPermission() {},
          stop: { phase: "idle", onPress() {} }, permissionButtons: permissionButtons(card.permission!, "zh", true),
        }) }));
      });
      const bar = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "detail-action-bar");
      const frames = await settleHostLayout(bar, { width, textScale, wrapText: true });
      const box = frames.get(bar())!;
      const items = bar().findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button");
      expect(items.slice(0, 2).map((node) => node.props.accessibilityLabel)).toEqual([...labels]);
      for (const item of items) {
        const frame = frames.get(item)!;
        expect(frame.left).toBeGreaterThanOrEqual(box.left - 0.5);
        expect(frame.left + frame.width).toBeLessThanOrEqual(box.left + box.width + 0.5);
        for (const text of labelsOf(item)) {
          const textFrame = frames.get(text)!;
          const fontSize = (Object.assign({}, ...[text.props.style].flat(Infinity).filter(Boolean)) as { fontSize?: number }).fontSize ?? 14;
          const lines = text.props.numberOfLines === undefined ? Math.round(textFrame.height / Math.ceil(fontSize * 1.25)) : 1;
          expect(textFrame.width * lines).toBeGreaterThanOrEqual(estimateTextWidth(text.children.join(""), fontSize) * textScale - 0.5);
          expect(textFrame.left + textFrame.width).toBeLessThanOrEqual(frame.left + frame.width + 0.5);
          expect(textFrame.top + textFrame.height).toBeLessThanOrEqual(frame.top + frame.height + 0.5);
        }
      }
    },
  );

  it.each((["ios", "android"] as const).flatMap((os) => [300, 340, 500].flatMap((width) => [1, 1.35, 1.8].flatMap((scale) => (["zh", "en"] as const).flatMap((language) => ["sample-running", "sample-input"].map((id) => [os, width, scale, language, id] as const))))))(
    "fits the sheet's close action on %s at %ipt, text scale %f, %s, %s",
    async (os, width, textScale, language, id) => {
      (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
      const card = sample(id);
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(TasksTypographyScale, { factor: textScale, children: React.createElement(DetailActionBar, {
          card, theme: THEME as never, language, strings: BOARD_STRINGS[language].sidebar,
          sidebar: true, smallTablet: true, onOpen() {}, onClose() {}, onPermission() {},
          stop: { phase: "idle", onPress() {} }, permissionButtons: card.permission ? permissionButtons(card.permission, language) : [],
        }) }));
      });
      const bar = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "detail-action-bar");
      const frames = await settleHostLayout(bar, { width, textScale });
      const box = frames.get(bar())!;
      const items = bar().findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button");
      expect(items.at(-1)!.props.testID).toBe("detail-bar-close");
      const close = frames.get(items.at(-1)!)!;
      const open = frames.get(items.find((node) => node.props.testID === "detail-bar-open")!)!;
      expect(close.left + close.width).toBeCloseTo(box.left + box.width - 12, 0);
      const stop = items.find((node) => node.props.testID === "detail-bar-stop");
      if (id === "sample-running" && width === 500 && textScale === 1 && stop) expect(frames.get(stop)!.left - box.left).toBeCloseTo(box.left + box.width - close.left - close.width, 0);
      if (close.width > Math.round(36 * textScale) + 1) expect(open.width / close.width).toBeCloseTo(3, 1);
      for (const item of items) {
        const frame = frames.get(item)!;
        expect(item.props.hitSlop).toBe(4);
        expect(frame.width + 8).toBeGreaterThanOrEqual(44);
        expect(frame.height + 8).toBeGreaterThanOrEqual(44);
        expect(frame.left).toBeGreaterThanOrEqual(box.left - 0.5);
        expect(frame.left + frame.width).toBeLessThanOrEqual(box.left + box.width + 0.5);
        for (const text of labelsOf(item)) {
          const textFrame = frames.get(text)!;
          const fontSize = (Object.assign({}, ...[text.props.style].flat(Infinity).filter(Boolean)) as { fontSize?: number }).fontSize ?? 14;
          expect(textFrame.width).toBeGreaterThanOrEqual(estimateTextWidth(text.children.join(""), fontSize) * textScale - 0.5);
          expect(textFrame.left + textFrame.width).toBeLessThanOrEqual(frame.left + frame.width + 0.5);
        }
      }
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = frames.get(items[i]!)!;
        const b = frames.get(items[j]!)!;
        const overlapX = a.left - 4 < b.left + b.width + 4 - 0.01 && b.left - 4 < a.left + a.width + 4 - 0.01;
        const overlapY = a.top - 4 < b.top + b.height + 4 - 0.01 && b.top - 4 < a.top + a.height + 4 - 0.01;
        expect(overlapX && overlapY, `${items[i]!.props.testID} ${JSON.stringify(a)} vs ${items[j]!.props.testID} ${JSON.stringify(b)}`).toBe(false);
      }
    },
  );

  it("keeps the sheet close action when the task has no other actions", async () => {
    const onClose = vi.fn();
    const card = { ...sample("sample-running"), stoppable: false, subagent: { subtitle: null }, parent: null };
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(DetailActionBar, {
        card, theme: THEME as never, language: "en", strings: BOARD_STRINGS.en.sidebar, onClose,
      }));
    });
    const close = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "detail-bar-close");
    act(() => close.props.onPress());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("gives a card that mounts after another its buttons' widths at once, with no second layout pass", async () => {
    const card = sample("sample-running");
    await act(async () => { renderer = TestRenderer.create(phoneCard(card, "en", { onOpen: () => {} })); });
    await settleHostLayout(row, { width: 340 });
    const widths = () => hostChildren(row()).map((item) => (Object.assign({}, ...[item.props.style].flat(Infinity).filter(Boolean)) as { minWidth?: number }).minWidth ?? null);
    const settled = widths();
    expect(settled.every((width) => typeof width === "number" && width > 0)).toBe(true);
    await act(async () => renderer!.unmount());
    // Another card with the same buttons: drawn at its measured widths before any layout reaches it.
    await act(async () => { renderer = TestRenderer.create(phoneCard({ ...card, id: "another-running" }, "en", { onOpen: () => {} })); });
    expect(widths()).toEqual(settled);
  });
});
