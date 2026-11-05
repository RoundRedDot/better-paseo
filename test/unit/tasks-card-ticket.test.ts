/**
 * A scheduled task's card is a ticket: two half-circle notches cut into its
 * sides between the title and the rows below, joined by a dashed rule. The
 * card is laid out by Yoga as Fabric lays it out (`helpers/yoga-host-layout`),
 * so the notches are checked where they land, for one and two title lines,
 * a phone and a larger system font, not only in their style fields.
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
import { TaskCardView, type TaskCardViewProps } from "../../client/tasks/cards";
import { taskTokens } from "../../client/tasks/cards/tokens";
import { FOLD_TINT } from "../../client/tasks/cards/task-card";
import { TICKET_NOTCH, TICKET_RULE, dashedRule } from "../../client/tasks/cards/ticket-card-surface";
import { TasksTypographyScale } from "../../client/tasks/typography";
import { mix } from "../../client/components/theme-tokens";
import { settleHostLayout, type Frame } from "./helpers/yoga-host-layout";

const NOW = Date.parse("2026-10-20T09:00:00.000Z");
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
  colors: { ...LIGHT.colors, surface0: "#18181b", surface1: "#1f1f23", surface2: "#26262b", border: "#2e2e33", foreground: "#ececf1", foregroundMuted: "#9a9aa5" },
};
/** `rn-mock`'s hairline. */
const BORDER = 1;
const REACH = TICKET_NOTCH + BORDER;
const GUTTER = 12;

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

const scheduled = (id: string, extra: Partial<TaskCard> = {}): TaskCard => ({ ...sample(id), scheduled: true, ...extra });

function element(card: TaskCard, overrides: Partial<TaskCardViewProps> = {}, fontScale = 1): React.ReactElement {
  const props: TaskCardViewProps = {
    card,
    fields: { ...CARD_PRESETS.standard.fields, labelLimit: CARD_PRESETS.standard.labelLimit },
    theme: LIGHT as never,
    compact: false,
    permissionButtons: [],
    stopPhase: "idle",
    focused: false,
    highlighted: false,
    now: NOW,
    language: "en",
    onReveal: () => {},
    ...overrides,
  };
  return React.createElement(TasksTypographyScale, { factor: fontScale, children: React.createElement(TaskCardView, props) });
}

async function render(node: React.ReactElement): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = TestRenderer.create(node);
  });
  return renderer!;
}

const all = (root: ReactTestInstance, testID: string) => root.findAll((node) => typeof node.type === "string" && node.props.testID === testID);
const host = (root: ReactTestInstance, testID: string) => {
  const found = all(root, testID);
  if (found.length !== 1) throw new Error(`${testID}: ${found.length} hosts`);
  return found[0]!;
};
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const styleOf = (root: ReactTestInstance, testID: string) => flat(host(root, testID).props.style);

describe("scheduled task card: surface", () => {
  it("leaves ordinary and provider-subagent cards whole", async () => {
    const tokens = taskTokens(LIGHT as never);
    for (const card of [sample("sample-running"), sample("sample-child-1"), { ...sample("sample-child-1"), subagent: { subtitle: "general-purpose", type: "general-purpose" } }]) {
      const tree = await render(element(card));
      expect(all(tree.root, "task-card-ticket-upper")).toHaveLength(0);
      expect(all(tree.root, "task-card-ticket-band")).toHaveLength(0);
      expect(styleOf(tree.root, `task-card-${card.id}`)).toMatchObject({ backgroundColor: tokens.card.background, boxShadow: tokens.card.shadow });
      await act(async () => renderer!.unmount());
      renderer = null;
    }
  });

  it.each([["light", LIGHT], ["dark", DARK]] as const)("draws the %s ticket from its sections, the holes left open", async (_name, theme) => {
    const tokens = taskTokens(theme as never);
    const card = scheduled("sample-running");
    const tree = await render(element(card, { theme: theme as never }));
    // The card itself paints nothing; its sections do.
    expect(styleOf(tree.root, `task-card-${card.id}`)).toMatchObject({ backgroundColor: "transparent", borderColor: "transparent", boxShadow: "none" });
    for (const part of ["task-card-ticket-head-surface", "task-card-ticket-tail-surface"]) {
      expect(styleOf(tree.root, part)).toMatchObject({ backgroundColor: tokens.card.background, borderColor: tokens.card.border, borderWidth: BORDER, borderStyle: "solid", borderRadius: 8, boxShadow: tokens.card.shadow });
    }
    expect(styleOf(tree.root, "task-card-ticket-band-fill")).toMatchObject({ backgroundColor: tokens.card.background });
    for (const side of ["left", "right"] as const) {
      // A ring of the card's fill round each hole: its inside is transparent, so the board shows through.
      const fill = styleOf(tree.root, `task-card-ticket-fill-${side}`);
      expect(fill.borderColor).toBe(tokens.card.background);
      expect(fill.backgroundColor).toBeUndefined();
      expect((fill.width as number) / 2 - (fill.borderWidth as number)).toBeCloseTo(TICKET_NOTCH + BORDER / 2);
      const arc = styleOf(tree.root, `task-card-ticket-arc-${side}`);
      expect(arc).toMatchObject({ width: REACH * 2, height: REACH * 2, borderRadius: REACH, borderWidth: BORDER, borderColor: tokens.card.border, boxShadow: undefined });
      expect(arc.backgroundColor).toBeUndefined();
      expect(styleOf(tree.root, `task-card-ticket-notch-${side}`)).toMatchObject({ width: REACH, height: REACH * 2, overflow: "hidden" });
    }
    const rule = styleOf(tree.root, "task-card-ticket-rule");
    expect(rule).toMatchObject({ height: TICKET_RULE.width, ...dashedRule(tokens.card.buttonBorder) });
    expect(String(rule.experimental_backgroundImage)).toContain(`${TICKET_RULE.dash}px, transparent ${TICKET_RULE.dash}px, transparent ${TICKET_RULE.dash + TICKET_RULE.gap}px`);
    expect(rule).toMatchObject({ experimental_backgroundSize: `${TICKET_RULE.dash + TICKET_RULE.gap}px 100%`, experimental_backgroundRepeat: "repeat-x" });
    // Neither the surface nor its parts take a touch or a screen reader's focus.
    for (const part of ["task-card-ticket-head", "task-card-ticket-band", "task-card-ticket-tail"]) {
      expect(host(tree.root, part).props.pointerEvents).toBe("none");
      expect(host(tree.root, part).props.importantForAccessibility).toBe("no-hide-descendants");
    }
  });

  it.each([["light", LIGHT], ["dark", DARK]] as const)("keeps chosen, highlighted, failed, hover and focus looks on the %s ticket", async (_name, theme) => {
    const tokens = taskTokens(theme as never);
    const base = scheduled("sample-running");
    const tree = await render(element(base, { theme: theme as never }));
    const parts = ["task-card-ticket-head-surface", "task-card-ticket-tail-surface"];
    for (const state of [
      { card: base, props: { current: true }, backgroundColor: tokens.card.current, borderColor: tokens.card.currentBorder },
      { card: base, props: { highlighted: true }, backgroundColor: tokens.card.highlight, borderColor: tokens.accent },
      { card: { ...base, status: "failed" as const }, props: {}, backgroundColor: tokens.card.failed, borderColor: tokens.card.failedBorder },
      { card: { ...base, status: "failed" as const }, props: { current: true }, backgroundColor: tokens.card.current, borderColor: tokens.card.currentBorder },
    ]) {
      await act(async () => tree.update(element(state.card, { theme: theme as never, ...state.props })));
      for (const part of parts) expect(styleOf(tree.root, part)).toMatchObject({ backgroundColor: state.backgroundColor, borderColor: state.borderColor });
      expect(styleOf(tree.root, "task-card-ticket-band-fill").backgroundColor).toBe(state.backgroundColor);
      for (const side of ["left", "right"]) {
        expect(styleOf(tree.root, `task-card-ticket-fill-${side}`).borderColor).toBe(state.backgroundColor);
        expect(styleOf(tree.root, `task-card-ticket-arc-${side}`).borderColor).toBe(state.borderColor);
      }
      // A tinted card's rule takes its tinted border.
      expect(styleOf(tree.root, "task-card-ticket-rule")).toMatchObject(dashedRule(state.borderColor));
    }
    // Native keyboard focus is a ring outside the card: round each notch it is the same ring inside the hole.
    await act(async () => tree.update(element(base, { theme: theme as never, focused: true })));
    const ring = `0px 0px 0px 1px ${tokens.foregroundMuted}`;
    for (const part of parts) expect(String(styleOf(tree.root, part).boxShadow)).toContain(ring);
    for (const side of ["left", "right"]) expect(styleOf(tree.root, `task-card-ticket-arc-${side}`).boxShadow).toBe(`inset ${ring}`);
    // Hover deepens every section's shadow together.
    await act(async () => tree.update(element(base, { theme: theme as never })));
    await act(async () => host(tree.root, `task-card-${base.id}`).props.onPressIn());
    for (const part of parts) expect(styleOf(tree.root, part).boxShadow).toBe(tokens.card.shadowHover);
    for (const side of ["left", "right"]) expect(styleOf(tree.root, `task-card-ticket-arc-${side}`).boxShadow).toBeUndefined();
  });

  it("folds an unavailable ticket's corner over its head and keeps the dot on the flap", async () => {
    const tokens = taskTokens(LIGHT as never);
    const card = scheduled("sample-child-1", { availability: { issue: { code: "workspace_unavailable", detail: null }, blocked: {} } as TaskCard["availability"] });
    const tree = await render(element(card, { hostId: "host-1" }));
    // One cut surface: the head's, ended flat above the band.
    expect(all(tree.root, "task-card-cut-surface")).toHaveLength(1);
    expect(all(tree.root, "task-card-ticket-head-surface")).toHaveLength(0);
    expect(styleOf(tree.root, "task-card-cut-body").bottom).toBe(-(8 + 2));
    expect(styleOf(tree.root, "task-card-fold").backgroundColor).toBe(mix(tokens.card.background, tokens.foreground, FOLD_TINT.light));
    expect(all(tree.root, "task-card-ticket-band")).toHaveLength(1);
    expect(all(tree.root, "task-card-ticket-tail")).toHaveLength(1);
    expect(all(tree.root, "task-card-subtask-mark")).toHaveLength(1);
    expect(all(tree.root, "task-availability-corner-hit")).toHaveLength(1);
  });

  it.each([["light", LIGHT], ["dark", DARK]] as const)("keeps a stub below a %s title with nothing under it, its rows mounted as rows come and go", async (_name, theme) => {
    const tokens = taskTokens(theme as never);
    const card = scheduled("sample-running");
    const tree = await render(element(card, { theme: theme as never, fields: BARE }));
    const titleRow = host(tree.root, "task-card-title-row");
    for (const row of ["task-card-pills", "task-card-footer", "task-card-actions"]) expect(all(tree.root, row)).toHaveLength(0);
    expect(styleOf(tree.root, "task-card-ticket-stub")).toEqual({ height: 10 });
    expect(styleOf(tree.root, `task-card-${card.id}`)).toMatchObject({ backgroundColor: "transparent", borderColor: "transparent", boxShadow: "none" });
    expect(styleOf(tree.root, "task-card-ticket-tail-surface")).toMatchObject({ backgroundColor: tokens.card.background, borderColor: tokens.card.border, boxShadow: tokens.card.shadow });
    expect(styleOf(tree.root, "task-card-ticket-rule")).toMatchObject(dashedRule(tokens.card.buttonBorder));
    // A row below the title takes the stub's place; the same rows stay mounted either way.
    await act(async () => tree.update(element(card, { theme: theme as never })));
    expect(all(tree.root, "task-card-ticket-stub")).toHaveLength(0);
    expect(all(tree.root, "task-card-ticket-band")).toHaveLength(1);
    expect(host(tree.root, "task-card-title-row")).toBe(titleRow);
    await act(async () => tree.update(element(card, { theme: theme as never, fields: BARE })));
    expect(all(tree.root, "task-card-ticket-stub")).toHaveLength(1);
    expect(host(tree.root, "task-card-title-row")).toBe(titleRow);
    // An ordinary card with the same fields has no stub and stays whole.
    await act(async () => tree.update(element(sample("sample-running"), { theme: theme as never, fields: BARE })));
    expect(all(tree.root, "task-card-ticket-stub")).toHaveLength(0);
    expect(styleOf(tree.root, "task-card-sample-running")).toMatchObject({ backgroundColor: tokens.card.background, borderColor: tokens.card.border, boxShadow: tokens.card.shadow });
  });
});

/** Every row below the title switched off, as a user can: no pills, no timer. */
const BARE = { ...CARD_PRESETS.standard.fields, provider: false, model: false, thinking: false, branch: false, folder: false, labels: false, timer: false, subtasks: false, labelLimit: CARD_PRESETS.standard.labelLimit } as TaskCardViewProps["fields"];

describe("scheduled task card: where the notches land", () => {
  const find = () => renderer!.root.find((node) => typeof node.type === "string" && String(node.props.testID).startsWith("task-card-sample-"));
  const at = (frames: Map<ReactTestInstance, Frame>, testID: string) => frames.get(host(renderer!.root, testID))!;

  const cases = [
    { name: "a desktop card with a one-line title", card: () => scheduled("sample-running", { title: "Daily check" }), compact: false, width: 320, scale: 1 },
    { name: "a desktop card with a two-line title", card: () => scheduled("sample-running", { title: "Check luoph's getpaseo/paseo pull requests every morning and send the summary" }), compact: false, width: 320, scale: 1 },
    { name: "a narrow phone card in Chinese at a larger system font", card: () => scheduled("sample-running", { title: "每日检查 luoph 的 getpaseo/paseo PR 状态并发送飞书私聊" }), compact: true, width: 300, scale: 1.3 },
    { name: "a failed card with its reason block", card: () => scheduled("sample-failed"), compact: false, width: 300, scale: 1 },
    { name: "a phone card waiting for permission", card: () => scheduled("sample-input"), compact: true, width: 340, scale: 1 },
    { name: "an unavailable card with its corner folded", card: () => scheduled("sample-child-1", { availability: { issue: { code: "workspace_unavailable", detail: null }, blocked: {} } as TaskCard["availability"] }), compact: false, width: 320, scale: 1 },
  ];

  it.each(cases)("$name", async ({ card, compact, width, scale }) => {
    await render(element(card(), { compact }, scale));
    const frames = await settleHostLayout(find, { width, textScale: scale, wrapText: true });
    const root = frames.get(find())!;
    const band = at(frames, "task-card-ticket-band");
    const centre = band.top + REACH;
    const upper = at(frames, "task-card-ticket-upper");
    const lower = at(frames, "task-card-ticket-lower");
    const firstBelow = (() => {
      for (const id of ["task-card-pills", "task-card-footer", "task-card-reason", "task-card-permission", "task-card-actions"]) {
        const found = all(renderer!.root, id);
        if (found.length) return frames.get(found[0]!)!;
      }
      throw new Error("no row below the title");
    })();
    // Halfway down the gap between the title and the first row below, never on either.
    expect(upper.top + upper.height).toBe(lower.top);
    expect(centre).toBeGreaterThan(upper.top + upper.height);
    expect(centre).toBeLessThan(firstBelow.top);
    expect(Math.abs(centre - (upper.top + upper.height + firstBelow.top) / 2)).toBeLessThanOrEqual(0.5);
    // The band spans the card's border box, edge to edge, and its holes are centred on the edges.
    expect(band.left).toBeCloseTo(root.left);
    expect(band.left + band.width).toBeCloseTo(root.left + root.width);
    const left = at(frames, "task-card-ticket-arc-left");
    const right = at(frames, "task-card-ticket-arc-right");
    expect(left.left + left.width / 2).toBeCloseTo(root.left);
    expect(right.left + right.width / 2).toBeCloseTo(root.left + root.width);
    expect(left.top + left.height / 2).toBeCloseTo(centre);
    // The head stops where the band starts and the tail starts where it ends: no overlap, no seam.
    // Folded, the head is the padding box `CutCardSurface` draws a border's width round.
    const folded = all(renderer!.root, "task-card-cut-surface").length > 0;
    const head = at(frames, "task-card-ticket-head");
    expect(head.top + head.height + (folded ? BORDER : 0)).toBeCloseTo(band.top);
    const tail = at(frames, "task-card-ticket-tail");
    expect(tail.top).toBeCloseTo(band.top + band.height);
    // The tail reaches the card's bottom border, with the shadow's room beyond it; the head its top.
    expect(tail.top + tail.height).toBeCloseTo(root.top + root.height + GUTTER);
    expect(tail.left).toBeCloseTo(root.left - GUTTER);
    expect(head.top).toBeCloseTo(folded ? root.top + BORDER : root.top - GUTTER);
    // Folded, the cut body runs past the band's top by its corner radius and 2, where its clip ends.
    if (folded) {
      const body = at(frames, "task-card-cut-body");
      expect(body.top + body.height).toBeCloseTo(band.top + 8 + 2);
    }
    // A phone's action bar stays inside the card.
    for (const bar of all(renderer!.root, "task-card-actions")) {
      const frame = frames.get(bar)!;
      expect(frame.left).toBeGreaterThanOrEqual(root.left);
      expect(frame.left + frame.width).toBeLessThanOrEqual(root.left + root.width);
    }
    // The rule joins the notches, a dash's gap clear of each.
    const rule = at(frames, "task-card-ticket-rule");
    expect(rule.left).toBeCloseTo(root.left + REACH + TICKET_RULE.inset);
    expect(rule.left + rule.width).toBeCloseTo(root.left + root.width - REACH - TICKET_RULE.inset);
    // Its half point runs from the band's centre down, starting on a device pixel.
    expect(rule.top).toBeCloseTo(centre);
    // Fabric rounds the half point to a 3x screen's pixel grid: one or two device pixels.
    expect(Math.abs(rule.height - TICKET_RULE.width)).toBeLessThanOrEqual(1 / 3 / 2 + 0.01);
  });

  const FOLDED = { availability: { issue: { code: "workspace_unavailable", detail: null }, blocked: {} } as TaskCard["availability"] };
  it.each([
    ["light", LIGHT, false, 320], ["dark", DARK, false, 320], ["light", LIGHT, true, 320], ["dark", DARK, true, 320],
    ["light", LIGHT, false, 200], ["dark", DARK, true, 200],
  ] as const)("cuts a %s ticket with only its title (folded: %s) at %ipt", async (_name, theme, folded, width) => {
    const card = scheduled("sample-child-1", { title: "\u6bcf\u65e5\u68c0\u67e5 luoph \u7684 getpaseo/paseo PR \u72b6\u6001\u5e76\u53d1\u9001\u98de\u4e66\u79c1\u804a", ...(folded ? FOLDED : {}) });
    await render(element(card, { theme: theme as never, fields: BARE }));
    const frames = await settleHostLayout(find, { width, wrapText: true });
    const root = frames.get(find())!;
    const title = at(frames, "task-card-title-row");
    const stub = at(frames, "task-card-ticket-stub");
    const band = at(frames, "task-card-ticket-band");
    const centre = band.top + REACH;
    // The stub is the title's first row gap; the notches sit halfway down it.
    expect(stub.top).toBeCloseTo(title.top + title.height);
    expect(stub.height).toBe(10);
    expect(centre).toBeCloseTo(stub.top + 5);
    expect(band.left).toBeCloseTo(root.left);
    expect(band.width).toBeCloseTo(root.width);
    // Below the band the tail keeps more than its corner radius, so its rounded bottom corners are whole.
    const tail = at(frames, "task-card-ticket-tail");
    expect(tail.top).toBeCloseTo(band.top + band.height);
    expect(root.top + root.height - tail.top).toBeGreaterThan(8);
    expect(tail.top + tail.height).toBeCloseTo(root.top + root.height + GUTTER);
    // The card grows by exactly the stub: the title's gap and the bottom padding.
    expect(root.top + root.height - (title.top + title.height)).toBeCloseTo(10 + 12 + BORDER);
    const rule = at(frames, "task-card-ticket-rule");
    expect(rule.top).toBeCloseTo(centre);
    expect(rule.left + rule.width).toBeCloseTo(root.left + root.width - REACH - TICKET_RULE.inset);
    if (folded) {
      const head = at(frames, "task-card-ticket-head");
      expect(head.top + head.height + BORDER).toBeCloseTo(band.top);
      expect(all(renderer!.root, "task-card-fold")).toHaveLength(1);
    }
  });

  it("needs no stub on a phone, whose cards always keep the model pill and the timer", async () => {
    await render(element(scheduled("sample-done"), { compact: true, fields: BARE }));
    const frames = await settleHostLayout(find, { width: 300, wrapText: true });
    expect(all(renderer!.root, "task-card-ticket-stub")).toHaveLength(0);
    const centre = at(frames, "task-card-ticket-band").top + REACH;
    const title = at(frames, "task-card-title-row");
    expect(centre).toBeCloseTo(title.top + title.height + 6);
    expect(centre).toBeLessThan(at(frames, "task-card-pills").top);
  });

  it("puts the notches at the same place as the card grows a second title line", async () => {
    const short = scheduled("sample-running", { title: "Daily check" });
    await render(element(short));
    const one = await settleHostLayout(find, { width: 320, wrapText: true });
    const top1 = at(one, "task-card-ticket-band").top;
    await act(async () => renderer!.update(element({ ...short, title: "Check luoph's getpaseo/paseo pull requests every morning and send the summary" })));
    const two = await settleHostLayout(find, { width: 320, wrapText: true });
    const title = at(two, "task-card-title");
    // One title line further down, still between the title and the pills.
    expect(at(two, "task-card-ticket-band").top - top1).toBe(title.height - at(one, "task-card-title").height);
    expect(title.height).toBeGreaterThan(at(one, "task-card-title").height);
  });
});
