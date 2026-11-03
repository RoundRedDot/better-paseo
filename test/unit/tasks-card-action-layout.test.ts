/**
 * A phone card's action bar, laid out by Yoga as Fabric lays it out on a
 * phone (`helpers/yoga-host-layout`), with each label's measured width fed
 * back through `onLayout` until the row settles. Every button must stay
 * inside the card, with its whole label. On a phone, Stop beside Allow and
 * Deny ran past the card and the screen; these cases fit when `onLayout`
 * widths are fed by hand.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

vi.hoisted(() => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock("react-native", async () => import("./helpers/rn-mock"));
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
import { permissionButtons } from "../../client/tasks/actions";
import { TaskCardView, type TaskCardViewProps } from "../../client/tasks/cards";
import { SubtaskRow } from "../../client/tasks/cards/subtask-row";
import { taskTokens } from "../../client/tasks/cards/tokens";
import { createTitleUpdateControl } from "../../client/tasks/actions/title-update";
import { TasksTypographyScale } from "../../client/tasks/typography";
import { cardStrings } from "../../client/tasks/cards/strings";
import { estimateTextWidth, hostChildren, settleHostLayout, type Frame } from "./helpers/yoga-host-layout";

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
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
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

interface Case {
  name: string;
  card: () => TaskCard;
  props?: Partial<TaskCardViewProps>;
  /** The labels the row draws once settled, zh then en, when nothing has folded. */
  expected: Record<Language, string[]>;
  /** Press the parent Stop's chevron so its menu is open. */
  openMenu?: boolean;
}

const confirming: StopPhase = "confirming";
const CASES: Case[] = [
  // The reported phone: a waiting tool permission, no Open tab.
  { name: "Allow, Deny and Stop", card: () => sample("sample-input"), expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "Allow, Deny, Stop and the Open square", card: () => sample("sample-input"), props: { onOpen: () => {} }, expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "Allow, Deny and an armed Stop", card: () => sample("sample-input"), props: { stopPhase: confirming }, expected: { zh: ["允许", "拒绝", "确认停止"], en: ["Allow", "Deny", "Confirm stop"] } },
  { name: "Allow, Deny and a parent's Stop", card: parentAsking, expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "Allow, Deny and a parent's Stop with its menu open", card: parentAsking, openMenu: true, expected: { zh: ["允许", "拒绝", "停止"], en: ["Allow", "Deny", "Stop"] } },
  { name: "Answer beside a hugging Stop", card: question, props: { onOpen: () => {} }, expected: { zh: ["去回答", "停止"], en: ["Answer", "Stop"] } },
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
  return settleHostLayout(row, { width, textScale });
}

/** What runs out of the card or loses part of a label; empty when the row fits. */
function overflows(frames: Map<ReactTestInstance, Frame>, textScale: number): string[] {
  const bar = row();
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
      // A drawn label is whole and within its own button.
      if (textFrame.width < estimateTextWidth(words, fontSize) * textScale - 0.5) problems.push(`"${words}" cut to ${textFrame.width}`);
      if (textFrame.left + textFrame.width > frame.left + frame.width + 0.5) problems.push(`"${words}" ends past ${name}`);
    }
  }
  return problems;
}

describe("phone card action bar under native (Yoga) layout", () => {
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
      expect(undo.left + undo.width).toBeCloseTo(width, 0);
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
          if (textScale === 1 && width >= 340) {
            expect(labelsOf(row()).map((text) => text.children.join(""))).toEqual(item.expected[language]);
          }
        },
      );
    });
  }

  it("shares the reported phone's row between Allow, Deny and Stop instead of giving Stop all of it", async () => {
    const frames = await settle(CASES[0]!, "zh", 340, 1);
    const [allow, deny, stop] = hostChildren(row()).map((node) => frames.get(node)!);
    // The three grow from their labels by the same share, so none takes the whole row.
    expect(stop!.width).toBeLessThan(340 / 2);
    expect(Math.abs(allow!.width - deny!.width)).toBeLessThanOrEqual(0.5);
    expect(stop!.left + stop!.width).toBeCloseTo(340, 0);
  });
});
