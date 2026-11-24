/**
 * An opened work step pins its row under the details toolbar while its output
 * scrolls past, driven by the details body's own scroll (`sticky-step.tsx`),
 * on a stock host as well: the host's sticky header follows the timeline.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
    TextInput: rn.TextInput,
    ScrollView: rn.ScrollView,
    FlatList: rn.ScrollView,
    Modal: rn.View,
    copyText: () => Promise.resolve(true),
    useToast: () => ({ show() {}, error() {}, success() {} }),
  };
});
vi.mock("../../client/ui/legacy-host-entry", () => ({ LEGACY_HOST_ENTRY: { useRevealedText: (text: string) => text } }));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
  usePaseo: () => ({}),
  useSettings: () => ({ data: undefined, status: "loading" }),
}));

import {
  createNativeStickySource, createWebStickySource, DetailsStickyCard, DetailsStickySourceContext, pinnedAt,
  StickyStepContext, stickyOffset, stickyTravel, type DetailsStickySource, type StickyStepHandle,
} from "../../client/details/sticky-step";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { ToolCallout } from "../../client/components/tool-callouts";
import { classifyTool } from "../../client/tools/classify";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tokens = buildThemeTokens({
  surface0: "#0f1115", surface1: "#16191f", surface2: "#1d2128", border: "#2a2f37", foreground: "#e6e8eb",
  foregroundMuted: "#9aa1ab", accent: "#4f8cff", accentForeground: "#ffffff", statusSuccess: "#4cb782",
  statusWarning: "#d9a53f", statusDanger: "#e5484d",
});

type Range = { inputRange: number[]; outputRange: number[]; extrapolate?: string };

/** A source whose offset is an interpolation recorder. */
function fakeSource(options: { top?: number; offset?: number } = {}) {
  const ranges: Range[] = [];
  const node = (): { interpolate(range: Range): unknown } => ({
    interpolate(range: Range) {
      ranges.push(range);
      return node();
    },
  });
  const listeners = new Set<() => void>();
  const state = { top: options.top ?? 100, offset: options.offset ?? 0 };
  const scrollTo = vi.fn();
  const source = {
    scrollY: node(),
    locate: vi.fn((_node: unknown, done: (top: number) => void) => done(state.top)),
    offset: () => state.offset,
    scrollTo,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  } as unknown as DetailsStickySource;
  const changed = () => act(() => Array.from(listeners).forEach((listener) => listener()));
  return { source, ranges, state, scrollTo, changed, listeners };
}

const mounted: ReactTestRenderer[] = [];
function mount(element: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(element, { createNodeMock: () => ({}) }); });
  mounted.push(renderer);
  return renderer;
}

function host(renderer: ReactTestRenderer, id: string) {
  return renderer.root.findAll((node) => typeof node.type === "string" && node.props.testID === id)[0];
}

function layout(renderer: ReactTestRenderer, id: string, height: number) {
  act(() => host(renderer, id)!.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } }));
}

afterEach(() => {
  act(() => mounted.splice(0).forEach((renderer) => renderer.unmount()));
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  vi.unstubAllGlobals();
});

describe("sticky step geometry", () => {
  const geometry = { top: 100, height: 1000, header: 28 };

  it("travels from the step's top until the row meets the step's end", () => {
    expect(stickyTravel(geometry)).toBe(972);
    expect(stickyOffset(50, geometry)).toBe(0);
    expect(stickyOffset(100, geometry)).toBe(0);
    expect(stickyOffset(400, geometry)).toBe(300);
    expect(stickyOffset(1072, geometry)).toBe(972);
    expect(stickyOffset(5000, geometry)).toBe(972);
  });

  it("pins a short step too, until its end pushes the row out", () => {
    // A two-line output under a 28 row: no share of the body is required.
    const short = { top: 100, height: 60, header: 28 };
    expect(stickyTravel(short)).toBe(32);
    expect(stickyOffset(110, short)).toBe(10);
    expect(stickyOffset(200, short)).toBe(32);
    expect(stickyTravel(null)).toBe(0);
    expect(stickyOffset(400, null)).toBe(0);
  });

  it("calls a row pinned only while it sits under the toolbar", () => {
    expect(pinnedAt(100, geometry)).toBe(false);
    expect(pinnedAt(100.4, geometry)).toBe(false);
    expect(pinnedAt(101, geometry)).toBe(true);
    expect(pinnedAt(1071, geometry)).toBe(true);
    // Scrolled past the step's end: the row has gone above the body with it.
    expect(pinnedAt(1072, geometry)).toBe(false);
    expect(pinnedAt(5000, geometry)).toBe(false);
    expect(pinnedAt(400, null)).toBe(false);
  });
});

describe("DetailsStickyCard", () => {
  const card = (source: DetailsStickySource, stripe?: string, handle?: React.Ref<StickyStepHandle>) => React.createElement(DetailsStickyCard, {
    source, tokens, stripe, handle, header: React.createElement("Row"), children: React.createElement("Output"),
  });
  const travelRanges = (ranges: Range[]) => ranges.filter((range) => range.outputRange[1] !== 1);

  it("binds the row to the body's offset, clamped to the step", () => {
    const fake = fakeSource({ top: 100 });
    const renderer = mount(card(fake.source));
    const row = host(renderer, "work-step-sticky-row")!;
    // Before it is measured the row is bound, at 0.
    expect(fake.ranges[0]).toEqual({ inputRange: [0, 1], outputRange: [0, 0], extrapolate: "clamp" });
    expect(row.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ transform: [{ translateY: expect.anything() }] })]));
    layout(renderer, "work-step-sticky-row", 28);
    layout(renderer, "work-step-sticky", 1000);
    expect(travelRanges(fake.ranges).at(-1)).toEqual({ inputRange: [100, 1072], outputRange: [0, 972], extrapolate: "clamp" });
    // The fill and rule come with the first point of travel.
    expect(fake.ranges.at(-1)).toEqual({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" });
    // Another step opening above moves this one: it is located again.
    fake.state.top = 160;
    fake.changed();
    expect(travelRanges(fake.ranges).at(-1)).toEqual({ inputRange: [160, 1132], outputRange: [0, 972], extrapolate: "clamp" });
  });

  it("pins a short step whose output scrolls under the toolbar", () => {
    const fake = fakeSource({ top: 100 });
    const renderer = mount(card(fake.source));
    layout(renderer, "work-step-sticky-row", 28);
    layout(renderer, "work-step-sticky", 60);
    expect(travelRanges(fake.ranges).at(-1)).toEqual({ inputRange: [100, 132], outputRange: [0, 32], extrapolate: "clamp" });
  });

  it("draws the step's stripe over the panel surface behind a pinned row", () => {
    const fake = fakeSource();
    const renderer = mount(card(fake.source, "rgba(1, 2, 3, 0.04)"));
    const fill = host(renderer, "work-step-sticky-fill")!;
    expect(fill.props.pointerEvents).toBe("none");
    expect(fill.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: tokens.surface0 })]));
    const colours = fill.findAll((node) => typeof node.type === "string").map((node) => JSON.stringify(node.props.style));
    expect(colours.some((style) => style.includes("rgba(1, 2, 3, 0.04)"))).toBe(true);
  });

  it.each(["web", "ios", "android"])("on %s brings the body back to a pinned row the reader closes", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const fake = fakeSource({ top: 100, offset: 500 });
    const handle = React.createRef<StickyStepHandle>();
    const renderer = mount(card(fake.source, undefined, handle));
    layout(renderer, "work-step-sticky-row", 28);
    layout(renderer, "work-step-sticky", 1000);
    act(() => handle.current!.collapsing());
    expect(fake.scrollTo.mock.calls).toEqual([[100]]);
  });

  it.each([
    ["at rest above the step's top", 40],
    ["scrolled past the step's end", 1500],
  ])("leaves the body alone for a row closed %s", (_case, offset) => {
    const fake = fakeSource({ top: 100, offset });
    const handle = React.createRef<StickyStepHandle>();
    const renderer = mount(card(fake.source, undefined, handle));
    layout(renderer, "work-step-sticky-row", 28);
    layout(renderer, "work-step-sticky", 1000);
    act(() => handle.current!.collapsing());
    expect(fake.scrollTo).not.toHaveBeenCalled();
  });

  it("leaves the body alone when a pinned step unmounts for another block or a closed panel", () => {
    const fake = fakeSource({ top: 100, offset: 500 });
    const renderer = mount(card(fake.source));
    layout(renderer, "work-step-sticky-row", 28);
    layout(renderer, "work-step-sticky", 1000);
    act(() => renderer.unmount());
    mounted.splice(mounted.indexOf(renderer), 1);
    expect(fake.scrollTo).not.toHaveBeenCalled();
    expect(fake.listeners.size).toBe(0);
  });
});

describe("a work step's tool row", () => {
  const data = classifyTool({
    name: "Bash", status: "completed", callId: "step-1", error: null,
    detail: { type: "shell", command: "npm test", output: "line\n".repeat(40), exitCode: 0, durationMs: 1200 },
  });
  const row = (expanded: boolean, step: { stripe?: string } | null, source: DetailsStickySource | null) =>
    React.createElement(DetailsStickySourceContext.Provider, { value: source },
      React.createElement(StickyStepContext.Provider, { value: step },
        React.createElement(ToolCallout, { data, tokens, compact: true, expanded, onExpandedChange: () => {} })));

  it("pins only while opened, in the details body, inside the work steps list", () => {
    const { source } = fakeSource();
    const sticky = (element: React.ReactElement) => host(mount(element), "work-step-sticky") !== undefined;
    expect(sticky(row(true, {}, source))).toBe(true);
    expect(sticky(row(false, {}, source))).toBe(false);
    // Outside the work steps list, or outside the details body, an opened row scrolls as before.
    expect(sticky(row(true, null, source))).toBe(false);
    expect(sticky(row(true, {}, null))).toBe(false);
  });

  it.each([
    ["pinned", 500, [[100]]],
    ["scrolled past the step's end", 5000, []],
  ])("closing the row %s scrolls back to it only while it is pinned", (_case, offset, calls) => {
    const fake = fakeSource({ top: 100, offset });
    const changes: boolean[] = [];
    const renderer = mount(React.createElement(DetailsStickySourceContext.Provider, { value: fake.source },
      React.createElement(StickyStepContext.Provider, { value: {} },
        React.createElement(ToolCallout, { data, tokens, compact: true, expanded: true, onExpandedChange: (next: boolean) => changes.push(next) }))));
    layout(renderer, "work-step-sticky-row", 28);
    layout(renderer, "work-step-sticky", 1000);
    const toggle = renderer.root.findAll((node) => typeof node.type === "string" && typeof node.props.onPress === "function"
      && node.props.accessibilityState?.expanded === true)[0]!;
    act(() => toggle.props.onPress());
    expect(changes).toEqual([false]);
    expect(fake.scrollTo.mock.calls).toEqual(calls);
  });

  it("keeps the row in its tree: the row and the output stay inside the step", () => {
    const { source } = fakeSource();
    const renderer = mount(row(true, { stripe: "#123" }, source));
    const step = host(renderer, "work-step-sticky")!;
    expect(step.findAll((node) => node.props.accessibilityRole === "button" || node.props.role === "button").length).toBeGreaterThan(0);
    expect(JSON.stringify(renderer.toJSON())).toContain("npm test");
  });
});

describe("sticky sources", () => {
  it("measures a phone step against the body's content and reports size changes", () => {
    const content = { id: "content" };
    const scrollTo = vi.fn();
    const source = createNativeStickySource({ content: () => content, offset: () => 42, scrollTo });
    const listener = vi.fn();
    const remove = source.subscribe(listener);
    const measureLayout = vi.fn((relative: unknown, done: (x: number, y: number) => void) => {
      expect(relative).toBe(content);
      done(0, 320);
    });
    const done = vi.fn();
    source.locate({ measureLayout }, done);
    expect(done).toHaveBeenCalledWith(320);
    // A new body height relocates the steps; the same height again does not.
    source.laidOut(600);
    source.laidOut(600);
    source.changed();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(source.offset()).toBe(42);
    source.scrollTo(100);
    expect(scrollTo).toHaveBeenCalledWith(100);
    remove();
    source.changed();
    expect(listener).toHaveBeenCalledTimes(2);
    // No content view yet: nothing to measure against.
    const empty = createNativeStickySource({ content: () => null, offset: () => 0, scrollTo });
    empty.locate({ measureLayout }, done);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("reads a web step's place from the body's boxes and follows its scroll", () => {
    const handlers = new Map<string, () => void>();
    const body = {
      scrollTop: 250, clientTop: 0, clientHeight: 700,
      getBoundingClientRect: () => ({ top: 80 }),
      addEventListener: (type: string, handler: () => void) => handlers.set(type, handler),
      removeEventListener: (type: string) => handlers.delete(type),
    };
    const source = createWebStickySource(() => body as unknown as HTMLElement);
    const listener = vi.fn();
    source.subscribe(listener);
    const unbind = source.bind();
    expect((source.scrollY as unknown as { __value: number }).__value).toBe(250);
    const done = vi.fn();
    // 30 below the body's top while it is scrolled 250: 280 into the content.
    source.locate({ getBoundingClientRect: () => ({ top: 110 }) }, done);
    expect(done).toHaveBeenCalledWith(280);
    body.scrollTop = 400;
    handlers.get("scroll")!();
    expect((source.scrollY as unknown as { __value: number }).__value).toBe(400);
    expect(listener).toHaveBeenCalledTimes(2);
    source.scrollTo(90);
    expect(body.scrollTop).toBe(90);
    unbind();
    expect(handlers.size).toBe(0);
  });
});
