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
import { estimateTextWidth, hostChildren, settleHostLayout, wrapLines, type Frame } from "./helpers/yoga-host-layout";
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

  it.each(["zh", "en"] as const)("truncates the widest written options on a 300pt card at text scale 1.8 in %s, folding Stop and Open first", async (language) => {
    const item = CASES.find((entry) => entry.name === "the widest CJK options beside Stop and Open")!;
    const frames = await settle(item, language, 300, 1.8);
    expect(overflows(frames, 1.8)).toEqual([]);
    const answerFrames = await settleHostLayout(questionRow, { width: 300, textScale: 1.8, wrapText: true });
    expect(overflows(answerFrames, 1.8, questionRow())).toEqual([]);
    const labels = labelsOf(questionRow());
    expect(labels.map((text) => text.children.join(""))).toEqual([...WIDE_CJK]);
    for (const text of labels) {
      expect(text.props).toMatchObject({ numberOfLines: 1, ellipsizeMode: "tail" });
      expect(answerFrames.get(text)!.height).toBeLessThan(20);
      expect(answerFrames.get(text)!.width).toBeLessThan(estimateTextWidth(text.children.join(""), 12) * 1.8);
    }
    const answers = hostChildren(questionRow()).slice(0, 2).map((node) => answerFrames.get(node)!);
    expect(answers[0]!.width).toBeCloseTo(answers[1]!.width, 0);
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

  // On the reported 340pt phone a real ExitPlanMode's three choices fit side by
  // side in Chinese, Reject folded to its X; in English the two Implement labels
  // do not fit beside each other, so the choices stack, each across the row with
  // its whole label. Stop and Open stay on the bar above the divider.
  it.each([["zh", "row"], ["en", "stack"]] as const)("lays a real ExitPlanMode's three choices out in %s as a %s, with Stop and Open on the bar above", async (language, arrangement) => {
    const plan = kindCard("plan-resume");
    await act(async () => { renderer = TestRenderer.create(phoneCard(plan, language, { onOpen() {}, permissionButtons: permissionButtons(plan.permission!, language, true) })); });
    const card = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === `task-card-${plan.id}`);
    const frames = await settleHostLayout(card, { width: 340, textScale: 1 });
    const answers = frames.get(questionRow())!;
    const choices = hostChildren(questionRow()).map((node) => frames.get(node)!);
    expect(choices).toHaveLength(3);
    expect(hostChildren(questionRow()).map((node) => node.props.accessibilityLabel)).toEqual(ANSWERS["plan-resume"][language]);
    if (arrangement === "row") {
      // Side by side, in the request's order, filling the row together.
      expect(choices[0]!.left).toBeCloseTo(answers.left, 0);
      for (const [index, choice] of choices.entries()) {
        expect(choice.top).toBeCloseTo(choices[0]!.top, 0);
        if (index > 0) expect(choice.left).toBeGreaterThan(choices[index - 1]!.left + choices[index - 1]!.width);
      }
      expect(choices[2]!.left + choices[2]!.width).toBeCloseTo(answers.left + answers.width, 0);
      // Reject folds to its X first (its label still read out); both Implement choices keep their words.
      expect(labelsOf(questionRow()).map((text) => text.children.join(""))).toEqual(ANSWERS["plan-resume"][language].slice(1));
    } else {
      // One under another, in the request's order, each as wide as the row, every label drawn.
      for (const [index, choice] of choices.entries()) {
        expect(choice.left).toBeCloseTo(answers.left, 0);
        expect(choice.width).toBeCloseTo(answers.width, 0);
        if (index > 0) expect(choice.top).toBeGreaterThan(choices[index - 1]!.top + choices[index - 1]!.height);
      }
      expect(labelsOf(questionRow()).map((text) => text.children.join(""))).toEqual(ANSWERS["plan-resume"][language]);
    }
    const [stop, open] = hostChildren(row()).map((node) => frames.get(node)!);
    const divider = frames.get(renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-question-divider"))!;
    expect(divider.top).toBeGreaterThan(Math.max(stop!.top + stop!.height, open!.top + open!.height));
    expect(divider.top + divider.height).toBeLessThan(choices[0]!.top);
  });

  // Only an ambiguous set stacks: a tool's Allow and Deny, a two-choice plan
  // and a question's written options keep their one row on the narrowest card.
  it.each((["tool", "plan", "mode", "question"] as const).flatMap((kind) => [true, false].map((compact) => [kind, compact] as const)))(
    "keeps a %s request's answers on one row (compact %s) at 240pt, text scale 1.8",
    async (kind, compact) => {
      const card = kindCard(kind);
      await act(async () => { renderer = TestRenderer.create(phoneCard(card, "en", { compact, onOpen() {}, permissionButtons: permissionButtons(card.permission!, "en", true) })); });
      const id = compact ? "task-card-question-actions" : "task-card-answer-actions";
      const answers = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
      const frames = await settleHostLayout(() => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === `task-card-${card.id}`), { width: 240, textScale: 1.8, wrapText: true, wordWrap: true });
      const tops = hostChildren(answers()).map((node) => frames.get(node)!.top);
      expect(new Set(tops.map((top) => Math.round(top))).size).toBe(1);
      expect(Object.assign({}, ...[answers().props.style].flat(Infinity).filter(Boolean)).flexDirection).toBe("row");
    },
  );

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
      for (const button of hostChildren(row)) {
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
