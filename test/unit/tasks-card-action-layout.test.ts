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
import { estimateTextWidth, hostChildren, settleHostLayout, type Frame } from "./helpers/yoga-host-layout";
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
 * The sample tool permission as another request kind. A plan, a mode change
 * or an unknown request keeps its block and the phone's one-row bar; only a
 * question and a tool permission take the request section.
 */
function asKind(card: TaskCard, kind: "plan" | "mode" | "other"): TaskCard {
  return {
    ...card,
    permission: { ...card.permission!, kind, actions: kind === "plan" ? [{ id: "implement", label: "Implement", behavior: "allow", variant: "primary" }, { id: "reject", label: "Reject", behavior: "deny", variant: null }] : [] },
  };
}
const modeInput = () => asKind(sample("sample-input"), "mode");
const modeParentAsking = () => asKind(parentAsking(), "mode");

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
}

const confirming: StopPhase = "confirming";
const WIDE_CJK = ["从现在持续观察一小时再说", "回看最近一小时的日志即可"] as const;
const WIDE_LATIN = ["Use the existing schema!", "Rebuild it from scratch."] as const;
const CASES: Case[] = [
  // The reported phone's one-row bar, as a mode request keeps it: Allow, Deny and Stop, no Open tab.
  { name: "Allow, Deny and Stop", card: modeInput, expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "Allow, Deny, Stop and the Open square", card: modeInput, props: { onOpen: () => {} }, expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "Allow, Deny and an armed Stop", card: modeInput, props: { stopPhase: confirming }, expected: { zh: ["允许", "拒绝", "确认停止"], en: ["Allow", "Deny", "Confirm stop"] } },
  { name: "Allow, Deny and a parent's Stop", card: modeParentAsking, expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "Allow, Deny and a parent's Stop with its menu open", card: modeParentAsking, openMenu: true, expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "a plan's Implement, Reject and Stop", card: () => asKind(sample("sample-input"), "plan"), expected: { zh: ["实施", "拒绝", "停止"], en: ["Implement", "Reject", "Stop"] } },
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
  ("fits question and tool permission controls on %s at %ipt, scale %f, %s", async (os, width, textScale, language) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    for (const card of [choice()(), sample("sample-input")]) {
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
      // Stop, Open and Close: the request's answers are not in this row.
      expect(hostChildren(controls()).map((node) => node.props.testID)).toEqual(["detail-bar-stop", "detail-bar-open", "detail-bar-close"]);
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

  it.each([true, false].flatMap((compact) => WIDTHS.flatMap((width) => TEXT_SCALES.flatMap((scale) => (["zh", "en"] as const).map((language) => [compact, width, scale, language] as const)))))
  ("centers the question divider's label and wait between its lines (compact %s) at %ipt, scale %f, %s", async (compact, width, textScale, language) => {
    const card = choice()();
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
    const label = labelsOf(divider()).find((node) => node.children.join("") === (language === "zh" ? "待回答" : "Awaiting answer"))!;
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

  it.each([true, false].flatMap((compact) => (["zh", "en"] as const).map((language) => [compact, language] as const)))
  ("keeps a block's row gap above and below the question divider (compact %s, %s)", async (compact, language) => {
    const card = choice()();
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

  it.each([true, false].flatMap((compact) => (["zh", "en"] as const).flatMap((language) => (["tool", "question"] as const).map((kind) => [compact, language, kind] as const))))(
    "labels the divider by what the request waits for (compact %s, %s, %s)",
    async (compact, language, kind) => {
      const card = kind === "question" ? choice()() : sample("sample-input");
      await act(async () => {
        renderer = TestRenderer.create(phoneCard(card, language, { compact, onOpen() {}, permissionButtons: permissionButtons(card.permission!, language, true) }));
      });
      const strings = cardStrings(language);
      const divider = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-question-divider");
      const shown = labelsOf(divider).map((node) => node.children.join(""));
      expect(shown).toContain(kind === "tool" ? strings.awaitingApproval : strings.awaitingAnswer);
      expect(shown).not.toContain(kind === "tool" ? strings.awaitingAnswer : strings.awaitingApproval);
      const block = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-permission");
      const text = block.find((node) => typeof node.type === "string" && node.props.numberOfLines === 2);
      expect(text.parent!.findAll((node) => (node.type as unknown) === "Icon")).toHaveLength(0);
    },
  );

  // Baseline: a plan, a mode change or an unknown request keeps its block, its icon and the bars it had.
  it.each([true, false].flatMap((compact) => (["plan", "mode", "other"] as const).map((kind) => [compact, kind] as const)))(
    "keeps a request's block and bar on the card (compact %s, %s)",
    async (compact, kind) => {
      const card = asKind(sample("sample-input"), kind);
      const onPermission = vi.fn();
      await act(async () => {
        renderer = TestRenderer.create(phoneCard(card, "zh", { compact, onOpen() {}, onPermission, permissionButtons: permissionButtons(card.permission!, "zh", true) }));
      });
      const all = (id: string) => renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === id);
      expect(all("task-card-question-divider")).toHaveLength(0);
      expect(all("task-card-question-actions")).toHaveLength(0);
      const block = all("task-card-permission")[0]!;
      expect(block.findAll((node) => (node.type as unknown) === "Icon").map((node) => node.props.name)).toContain({ plan: "ListChecks", mode: "ShieldCheck", other: "MessageCircleQuestion" }[kind]);
      const labels = { plan: ["实施", "拒绝"], mode: ["允许", "拒绝"], other: ["去回答"] }[kind];
      // A phone keeps them on its one bar with Stop; a desktop card on the answer row inside the block, with the wait.
      const bar = compact ? all("task-card-actions")[0]! : all("task-card-answer-actions")[0]!;
      expect(bar.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button").map((node) => node.props.accessibilityLabel).slice(0, labels.length)).toEqual(labels);
      if (compact) {
        expect(all("task-card-actions")[0]!.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-stop")).toHaveLength(1);
        expect(all("task-card-open-tab")).toHaveLength(kind === "other" ? 0 : 1);
        if (kind !== "other") expect(labelsOf(all("task-card-open-tab")[0]!)).toHaveLength(0);
      } else {
        expect(all("task-card-answer-row")[0]!.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-footer")).toHaveLength(1);
      }
      const first = bar.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === labels[0]);
      await act(async () => first.props.onPress());
      expect(onPermission).toHaveBeenCalledWith(card, expect.objectContaining({ label: labels[0] }));
    },
  );

  // Baseline: a question's phone Stop menu keeps its alignment (to Stop's right edge); a tool's matches it.
  it.each(["question", "tool", "running"] as const)("keeps the phone Stop menu's alignment for a %s card", async (kind) => {
    const card = kind === "question" ? choice()() : kind === "tool" ? sample("sample-input") : sample("sample-running");
    await act(async () => {
      renderer = TestRenderer.create(phoneCard(card, "zh", { onOpen() {}, permissionButtons: card.permission ? permissionButtons(card.permission, "zh", true) : [] }));
    });
    const stops = renderer!.root.findAll((node) => typeof node.type === "function" && "menuLeft" in node.props && "hug" in node.props);
    expect(stops).toHaveLength(1);
    expect(stops[0]!.props.menuLeft).toBe(kind === "running");
  });

  it.each((["question", "tool", "plan", "mode", "other"] as const).flatMap((kind) => (["sidebar", "sheet"] as const).map((surface) => [kind, surface] as const)))(
    "answers a %s request where it did in the %s",
    async (kind, surface) => {
      const card = kind === "question" ? choice()() : kind === "tool" ? sample("sample-input") : asKind(sample("sample-input"), kind);
      const buttons = permissionButtons(card.permission!, "zh", true);
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(TaskDetailCards, {
          card, theme: THEME as never, language: "zh", strings: BOARD_STRINGS.zh.sidebar,
          now: NOW, touch: true, tabs: true, actions: surface === "sheet" ? false : undefined,
          questionActionsInHeader: surface === "sheet", onSheetClose() {},
          stop: { phase: "idle", onPress() {} }, onOpen() {}, onPermission() {}, permissionButtons: buttons,
        }));
      });
      const all = (id: string) => renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === id);
      const section = kind === "question" || kind === "tool";
      // A question and a tool permission: answers under the section's rule, controls above it, no bottom bar.
      expect(all("detail-question-section")).toHaveLength(section ? 1 : 0);
      expect(all("detail-question-controls")).toHaveLength(section ? 1 : 0);
      expect(all("detail-permission-actions")).toHaveLength(section ? 1 : 0);
      // A plan, a mode change or an unknown request: its answers in the sidebar's bottom bar; the phone sheet's board bar has them.
      expect(all("detail-action-bar")).toHaveLength(!section && surface === "sidebar" ? 1 : 0);
      if (!section && surface === "sidebar") {
        const labels = all("detail-action-bar")[0]!.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button").map((node) => node.props.accessibilityLabel);
        for (const button of buttons) expect(labels).toContain(button.label);
      }
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
          const kind = item.card().permission?.kind;
          if (kind === "question" || kind === "tool") {
            const answerFrames = await settleHostLayout(questionRow, { width, textScale, wrapText: item.wrap });
            expect(overflows(answerFrames, textScale, questionRow())).toEqual([]);
          }
          if (textScale === 1 && width >= 340) {
            const shown = kind === "question" || kind === "tool" ? labelsOf(questionRow()) : labelsOf(row());
            const expected = kind === "question" ? item.expected[language].filter((label) => label !== "停止" && label !== "Stop")
              : kind === "tool" ? item.expected[language].filter((label) => !CONTROL_LABELS.has(label)) : item.expected[language];
            expect(shown.map((text) => text.children.join(""))).toEqual(expected);
            // A tool permission's Stop and Open keep the bar above its divider.
            if (kind === "tool") expect(labelsOf(row()).map((text) => text.children.join(""))).toEqual(item.expected[language].filter((label) => CONTROL_LABELS.has(label)));
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

  it("shares a mode request's row between Allow, Deny and Stop instead of giving Stop all of it", async () => {
    const frames = await settle(CASES[0]!, "zh", 340, 1);
    const [allow, deny, stop] = hostChildren(row()).map((node) => frames.get(node)!);
    // The three grow from their labels by the same share, so none takes the whole row.
    expect(stop!.width).toBeLessThan(340 / 2);
    expect(Math.abs(allow!.width - deny!.width)).toBeLessThanOrEqual(0.5);
    expect(stop!.left + stop!.width).toBeCloseTo(340, 0);
  });

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
