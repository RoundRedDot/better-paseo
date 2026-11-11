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
const questionRow = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-question-actions");

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
  // The reported phone: a waiting tool permission, no Open tab.
  { name: "Allow, Deny and Stop", card: () => sample("sample-input"), expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "Allow, Deny, Stop and the Open square", card: () => sample("sample-input"), props: { onOpen: () => {} }, expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "Allow, Deny and an armed Stop", card: () => sample("sample-input"), props: { stopPhase: confirming }, expected: { zh: ["允许", "拒绝", "确认停止"], en: ["Allow", "Deny", "Confirm stop"] } },
  { name: "Allow, Deny and a parent's Stop", card: parentAsking, expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "Allow, Deny and a parent's Stop with its menu open", card: parentAsking, openMenu: true, expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
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
  it.each(["sidebar", "sheet"] as const)("places controls before the question on the %s and preserves each action", async (surface) => {
    const card = choice()();
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
  ("fits question controls on %s at %ipt, scale %f, %s", async (os, width, textScale, language) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const card = choice()();
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
    expect(hostChildren(controls())).toHaveLength(3);
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
          if (item.card().permission?.kind === "question") {
            const answerFrames = await settleHostLayout(questionRow, { width, textScale, wrapText: item.wrap });
            expect(overflows(answerFrames, textScale, questionRow())).toEqual([]);
          }
          if (textScale === 1 && width >= 340) {
            const shown = item.card().permission?.kind === "question" ? labelsOf(questionRow()) : labelsOf(row());
            const expected = item.card().permission?.kind === "question" ? item.expected[language].filter((label) => label !== "停止" && label !== "Stop") : item.expected[language];
            expect(shown.map((text) => text.children.join(""))).toEqual(expected);
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
      const bar = frames.get(row())!;
      expect(bar.left).toBeGreaterThanOrEqual(box.left);
      expect(bar.left + bar.width).toBeLessThanOrEqual(box.left + box.width);
    },
  );

  it("shares the reported phone's row between Allow, Deny and Stop instead of giving Stop all of it", async () => {
    const frames = await settle(CASES[0]!, "zh", 340, 1);
    const [allow, deny, stop] = hostChildren(row()).map((node) => frames.get(node)!);
    // The three grow from their labels by the same share, so none takes the whole row.
    expect(stop!.width).toBeLessThan(340 / 2);
    expect(Math.abs(allow!.width - deny!.width)).toBeLessThanOrEqual(0.5);
    expect(stop!.left + stop!.width).toBeCloseTo(340, 0);
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
