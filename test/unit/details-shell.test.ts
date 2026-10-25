import React, { createElement, useContext, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import "./helpers/quiet-renderer";

// The block details shell (client/details/shell): the open block drawn as a
// bottom drawer, a floating bottom panel or a side panel, on native inside a
// Modal and on web in a top-layer popover. The stores are slice A's; here a
// small fake stands in for them.

const screen = vi.hoisted(() => ({ width: 390, height: 844 }));
const caps = vi.hoisted(() => ({ hover: false, touch: true }));
const motion = vi.hoisted(() => ({ reduced: false }));
const timings = vi.hoisted(() => [] as { toValue: number; duration: number; native?: boolean }[]);

vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    ...rn,
    UIManager: { hasViewManagerConfig: () => false },
    useWindowDimensions: () => ({ width: screen.width, height: screen.height, scale: 3, fontScale: 1 }),
    // Every animation lands at once, so a close or a switch completes inside `act`.
    Animated: {
      ...rn.Animated,
      timing: (value: { setValue(next: number): void }, config: { toValue: number; duration: number; useNativeDriver: boolean }) => ({
        start(done?: (result: { finished: boolean }) => void) {
          timings.push({ toValue: config.toValue, duration: config.duration, native: config.useNativeDriver });
          value.setValue(config.toValue);
          done?.({ finished: true });
        },
        stop() {},
      }),
    },
  };
});
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => motion.reduced, getReducedMotion: () => motion.reduced }));
vi.mock("../../client/ui/use-input-capabilities", () => ({
  useInputCapabilities: () => {
    const os = (globalThis as { __rnMockOS?: string }).__rnMockOS ?? "ios";
    const native = os === "ios" || os === "android";
    return { hover: caps.hover, touch: caps.touch, compact: native, native };
  },
}));
const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => {}) }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput,
    copyText: clipboard.copyText, useToast: () => ({ show: vi.fn(), error: vi.fn() }), useRevealedText: (text: string) => text };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));

type Entry = import("../../client/details/contracts").BlockEntry;
type State = import("../../client/details/contracts").DetailsState;

// Slice A's stores, as far as the shell uses them: one agent's open block and a lease queue.
const fake = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const box = {
    state: { openId: null, form: "drawer", detent: "fit", fullscreen: false, lingerId: null } as State,
    blocks: [] as Entry[],
  };
  const set = (patch: Partial<State>) => {
    box.state = { ...box.state, ...patch };
    emit();
  };
  const navigable = () => box.blocks.filter((entry) => entry.navigable && entry.hasBody);
  const api = {
    open: vi.fn((_agent: string, id: string, options?: { detent?: "fit" | "full" }) => set({ openId: id, detent: options?.detent ?? "fit", fullscreen: false })),
    close: vi.fn(() => set({ openId: null, lingerId: box.state.openId })),
    step: vi.fn((_agent: string, direction: -1 | 1) => {
      const list = navigable();
      const at = list.findIndex((entry) => entry.id === box.state.openId);
      const next = list[at + direction];
      if (next) set({ openId: next.id });
    }),
    setDetent: vi.fn((_agent: string, detent: "fit" | "full") => set({ detent })),
    setFullscreen: vi.fn((_agent: string, fullscreen: boolean) => set({ fullscreen })),
    setForm: vi.fn((_agent: string, form: State["form"]) => set({ form })),
  };
  const queue: { key: string; listeners: Set<() => void> }[] = [];
  const claim = vi.fn((_agent: string, key: string) => {
    const lease = { key, listeners: new Set<() => void>() };
    queue.push(lease);
    return {
      held: () => queue[0] === lease,
      release() {
        const at = queue.indexOf(lease);
        if (at < 0) return;
        queue.splice(at, 1);
        queue.forEach((other) => other.listeners.forEach((listener) => listener()));
      },
      subscribe(listener: () => void) {
        lease.listeners.add(listener);
        return () => lease.listeners.delete(listener);
      },
    };
  });
  return {
    box, api, claim, queue, emit, set,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      box.state = { openId: null, form: "drawer", detent: "fit", fullscreen: false, lingerId: null };
      box.blocks = [];
      queue.length = 0;
    },
  };
});

vi.mock("../../client/details/details-store", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    detailsApi: fake.api,
    useDetails: () => useSyncExternalStore(fake.subscribe, () => fake.box.state, () => fake.box.state),
    useMarkerPhase: () => "off",
    claimHostLease: fake.claim,
  };
});
vi.mock("../../client/details/block-registry", async () => {
  const { useSyncExternalStore } = await import("react");
  const find = (id: string | null) => (id === null ? null : fake.box.blocks.find((entry) => entry.id === id) ?? null);
  return {
    registerBlock: () => ({ update() {}, release() {} }),
    setOrderShift: vi.fn(),
    useBlockList: () => useSyncExternalStore(fake.subscribe, () => fake.box.blocks, () => fake.box.blocks),
    useBlock: (_agent: string, id: string | null) => useSyncExternalStore(fake.subscribe, () => find(id), () => find(id)),
    getBlock: (_agent: string, id: string) => find(id),
  };
});

import { buildThemeTokens } from "../../client/components/theme-tokens";
import { DetailsHostSlot } from "../../client/details/shell/details-host-slot";
import { DetailsShellContext, type DetailsShellValue } from "../../client/details/contracts";
import { HoverPreviewContext, PreviewActionsContext, PreviewChromeContext, type PreviewActions } from "../../client/ui/hover-preview";
import { getEnhancerPreferences, resetEnhancerPreferences, subscribeEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { TextZoomContext } from "../../client/ui/text-zoom";
import { resetSafeInsets } from "../../client/details/shell/safe-area";
import { resetSideWidth } from "../../client/details/shell/side-panel";
import { registerHostList, resetTimelineSync, syncDelta } from "../../client/details/shell/timeline-sync";
import { hasActiveDetailsKeyboard } from "../../client/details/keyboard";
import { useDetailsBodyScroll, type DetailsBodyReport } from "../../client/details/shell/body-handover";
import { claimContentTouch, contentOwnsTouch, resetContentTouches } from "../../client/details/touch-claim";
import { CONTENT_HOLD_MS } from "../../client/details/shell/gestures";
import { HoverPreviewBody } from "../../client/ui/hover-preview";
import { useLineSelection } from "../../client/ui/line-selection";
import { MarkdownView } from "../../client/components/markdown/markdown-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
const AGENT = "agent-1";

// What the open block's content sees of the shell.
const seen = {
  shell: null as DetailsShellValue | null,
  actions: null as PreviewActions | null,
  chrome: "",
  inPreview: false,
  body: undefined as DetailsBodyReport | undefined,
};
function Probe({ id }: { id: string }) {
  seen.shell = useContext(DetailsShellContext);
  seen.actions = useContext(PreviewActionsContext);
  seen.chrome = useContext(PreviewChromeContext);
  seen.inPreview = useContext(HoverPreviewContext);
  seen.body = useDetailsBodyScroll();
  return createElement("Text", { testID: `content-${id}` }, id);
}

function block(id: string, at: number, patch: Partial<Entry> = {}): Entry {
  return {
    id, agentId: AGENT, at, kind: "tool", seq: at, navigable: true, hasBody: true, mounted: true,
    title: id, titleMono: false, subtitle: [], icon: "Terminal", readsImage: false,
    // In the details body, as a block's preview draws itself.
    render: () => createElement(HoverPreviewBody, null, createElement(Probe, { id })),
    copies: () => [{ id: "copy", label: "Copy output", icon: "Copy", text: `text of ${id}` }],
    ...patch,
  };
}

// Web: every host node is this element; the layer binds Escape on its window.
const web = {
  keydown: [] as ((event: unknown) => void)[],
  openPreviews: [] as unknown[],
  hidden: false,
  /** Where a native body was scrolled to. */
  scrolls: [] as number[],
  /** Where it was sent gliding. */
  glides: [] as number[],
  row: 0,
};
const fakeDocument = {
  addEventListener: (type: string, listener: (event: unknown) => void) => {
    if (type === "keydown") web.keydown.push(listener);
  },
  removeEventListener: (type: string, listener: (event: unknown) => void) => {
    if (type === "keydown") web.keydown = web.keydown.filter((entry) => entry !== listener);
  },
  getSelection: () => ({ isCollapsed: true }),
  defaultView: { getComputedStyle: () => ({ overflowX: "visible", overflowY: "visible" }) },
  querySelectorAll: () => web.openPreviews,
};
function fakeElement(): unknown {
  const view = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === "keydown") web.keydown.push(listener);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === "keydown") web.keydown = web.keydown.filter((entry) => entry !== listener);
    },
    getComputedStyle: () => ({ overflowY: "visible" }),
  };
  const doc = { defaultView: view, querySelectorAll: () => web.openPreviews, addEventListener() {}, removeEventListener() {} };
  return {
    setAttribute() {}, style: {}, ownerDocument: doc, parentElement: null,
    showPopover() {}, hidePopover() {}, getClientRects: () => (web.hidden ? [] : [1]), contains: () => false,
    querySelector: () => null, addEventListener() {}, removeEventListener() {},
    measureInWindow: (done: (...box: number[]) => void) => done(0, 300, 390, 28),
    // A phone body's place: 300 tall from 400 down, as the gutter in it.
    measure: (done: (...box: number[]) => void) => done(0, 0, 390, 300, 0, 400),
    scrollTo: (to: { y: number; animated?: boolean }) => { (to.animated ? web.glides : web.scrolls).push(to.y); },
    scrollToEnd() {},
    // A table's rows, measured in their frame: 30 apart.
    measureLayout: (_node: unknown, done: (left: number, top: number) => void) => done(0, (web.row++ % 3) * 30),
  };
}

const mounted: ReactTestRenderer[] = [];
function render(element: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element, { createNodeMock: () => fakeElement() });
  });
  mounted.push(renderer);
  return renderer;
}

function slot(key = "item-1") {
  return createElement(DetailsHostSlot, { key, agentId: AGENT, itemKey: key, tokens, compact: true });
}

function byTestId(renderer: ReactTestRenderer, id: string): ReactTestInstance | null {
  return renderer.root.findAll((node) => node.props.testID === id && typeof node.type === "string")[0] ?? null;
}

function flat(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return typeof style === "object" ? (style as Record<string, unknown>) : {};
}

function value(of: unknown): unknown {
  return of && typeof of === "object" && "__value" in of ? (of as { __value: number }).__value : of;
}

function layOut(renderer: ReactTestRenderer, id: string, height: number) {
  const node = byTestId(renderer, id)!;
  act(() => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: screen.width, height } } }));
}

function open(id: string, options?: { detent?: "fit" | "full" }) {
  act(() => fake.api.open(AGENT, id, options));
}

/** Web on a desktop: the keyboard module binds on this document. */
function webDesktop() {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  screen.width = 1440;
  screen.height = 900;
  caps.hover = true;
  caps.touch = false;
  Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true, writable: true });
  return {
    press(key: string, modifiers: { metaKey?: boolean } = {}) {
      const target = { closest: () => null, isContentEditable: false, parentElement: null, style: {}, scrollWidth: 0, clientWidth: 0 };
      const keyEvent = {
        key, target, isComposing: false, defaultPrevented: false, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false,
        ...modifiers,
        preventDefault() { keyEvent.defaultPrevented = true; },
        stopPropagation() {},
        stopImmediatePropagation() {},
      };
      act(() => web.keydown.slice().forEach((listener) => listener(keyEvent)));
      return keyEvent;
    },
  };
}

const event = (pageX: number, pageY: number, timestamp = 0) => ({ nativeEvent: { pageX, pageY, timestamp } });

/**
 * A drag on the header from (100, 500) by `dy`, timed so the finger moves at
 * `vy` px/ms (2 s when 0). `reported` is the PanResponder's own velocity at
 * release, which the panel no longer trusts.
 */
function dragHeader(dy: number, vy: number, reported = vy): boolean {
  const handlers = seen.shell!.headerHandlers as Record<string, (...args: unknown[]) => unknown>;
  const ms = vy === 0 ? 2000 : Math.max(1, Math.abs(dy / vy));
  let claimed = false;
  act(() => {
    handlers.onStartShouldSetPanResponderCapture!(event(100, 500, 1000));
    claimed = Boolean(handlers.onMoveShouldSetPanResponder!(event(100, 500 + dy, 1000 + ms)));
    if (!claimed) return;
    handlers.onPanResponderGrant!(event(100, 500 + dy, 1000 + ms), {});
    handlers.onPanResponderMove!(event(100, 500 + dy, 1000 + ms), {});
    handlers.onPanResponderRelease!(event(100, 500 + dy, 1000 + ms), { vx: 0, vy: reported });
  });
  return claimed;
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetEnhancerPreferences();
  updateEnhancerPreferences({ blockDetails: true });
  resetSafeInsets({ top: 47, bottom: 34 });
  resetSideWidth();
  resetTimelineSync();
  screen.width = 390;
  screen.height = 844;
  caps.hover = false;
  caps.touch = true;
  motion.reduced = false;
  web.keydown = [];
  web.openPreviews = [];
  web.hidden = false;
  web.scrolls = [];
  web.glides = [];
  resetContentTouches();
  timings.length = 0;
  seen.shell = null;
  seen.actions = null;
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
  fake.box.blocks = [block("a", 1), block("b", 2), block("c", 3)];
});
afterEach(() => {
  act(() => mounted.splice(0).forEach((renderer) => renderer.unmount()));
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  vi.useRealTimers();
});

describe("DetailsHostSlot", () => {
  it("draws nothing and claims no lease with block details off", () => {
    updateEnhancerPreferences({ blockDetails: false });
    fake.set({ openId: "a" });
    const renderer = render(slot());
    expect(renderer.toJSON()).toBeNull();
    expect(fake.claim).not.toHaveBeenCalled();
  });

  it("draws the shell only in the slot that holds the lease", () => {
    const renderer = render(createElement("View", null, slot("one"), slot("two")));
    open("b");
    expect(renderer.root.findAll((node) => (node.type as unknown) === "Modal")).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.props.testID === "content-b" && (node.type as unknown) === "Text")).toHaveLength(1);
  });

  it("wraps the block in the details chrome, the shell's actions and the header's controls", () => {
    render(slot());
    open("b");
    expect(seen.chrome).toBe("details");
    expect(seen.inPreview).toBe(true);
    expect(seen.actions).toMatchObject({ memoryKey: "b", fill: true, popped: false });
    expect(seen.actions!.wrap?.on).toBe(true);
    expect(seen.shell).toMatchObject({ agentId: AGENT, form: "drawer", detent: "fit", index: 2, count: 3, pointer: false });
    expect(seen.shell!.canStep).toEqual({ previous: true, next: true });
    expect(seen.shell!.entry.id).toBe("b");
    expect(seen.shell!.headerHandlers).toBeDefined();
  });

  it("steps with › and ‹ through the store, and counts only navigable blocks", () => {
    fake.box.blocks = [block("a", 1), block("inert", 2, { hasBody: false }), block("b", 3), block("code", 4, { navigable: false })];
    render(slot());
    open("b");
    expect(seen.shell).toMatchObject({ index: 2, count: 2 });
    expect(seen.shell!.canStep.next).toBe(false);
    act(() => seen.shell!.step(1));
    expect(fake.api.step).not.toHaveBeenCalled();
    act(() => seen.shell!.step(-1));
    expect(fake.api.step).toHaveBeenCalledWith(AGENT, -1);
    expect(seen.shell!.entry.id).toBe("a");
  });
});

describe("form", () => {
  it.each([
    { os: "ios", width: 390, height: 844, hover: false, form: "drawer" },
    { os: "ios", width: 834, height: 1194, hover: false, form: "floating" },
    { os: "ios", width: 1194, height: 834, hover: false, form: "side" },
    { os: "web", width: 1440, height: 900, hover: true, form: "side" },
  ])("$width×$height draws the $form", ({ os, width, height, hover, form }) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    screen.width = width;
    screen.height = height;
    caps.hover = hover;
    caps.touch = !hover;
    const renderer = render(slot());
    open("a");
    expect(byTestId(renderer, `details-${form}`)).not.toBeNull();
    expect(seen.shell!.form).toBe(form);
    expect(fake.box.state.form).toBe(form);
  });

  it("keeps the block, its wrap and its memory across a form change after the resize settles", () => {
    vi.useFakeTimers();
    const renderer = render(slot());
    open("b");
    act(() => seen.actions!.wrap!.toggle());
    expect(seen.actions!.wrap!.on).toBe(false);
    screen.width = 834;
    screen.height = 1194;
    act(() => renderer.update(slot()));
    // Still the drawer while the window may be moving.
    act(() => { vi.advanceTimersByTime(100); });
    expect(byTestId(renderer, "details-drawer")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(60); });
    expect(byTestId(renderer, "details-floating")).not.toBeNull();
    expect(byTestId(renderer, "details-drawer")).toBeNull();
    expect(seen.shell!.entry.id).toBe("b");
    expect(seen.actions!.wrap!.on).toBe(false);
    expect(seen.actions!.remembered).not.toBeNull();
  });

  it("drops full screen when the drawer turns into the side panel", () => {
    vi.useFakeTimers();
    const renderer = render(slot());
    open("b", { detent: "full" });
    screen.width = 1194;
    screen.height = 834;
    act(() => renderer.update(slot()));
    act(() => { vi.advanceTimersByTime(200); });
    expect(byTestId(renderer, "details-side")).not.toBeNull();
    expect(fake.api.setDetent).toHaveBeenCalledWith(AGENT, "fit");
  });
});

describe("drawer", () => {
  // 844 tall, 47 top inset: 797 available, a fit cap of 462, full at 789.
  it("opens at the content's height when it fits, and still offers full", () => {
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 266);
    const style = flat(byTestId(renderer, "details-drawer")!.props.style);
    expect(style.maxHeight).toBe(462);
    expect(style.height).toBeUndefined();
    expect(seen.shell!.toggleFullscreen).toBeDefined();
    expect(seen.actions!.maximizable).toBe(true);
    // Three long unwrapped lines want the room too.
    act(() => seen.shell!.toggleFullscreen!());
    expect(fake.box.state.detent).toBe("full");
    expect(seen.shell!.fullscreen).toBe(true);
    expect(seen.actions!.maximized).toBe(true);
    expect(value(flat(byTestId(renderer, "details-drawer")!.props.style).height)).toBe(789);
    act(() => seen.shell!.toggleFullscreen!());
    expect(fake.box.state.detent).toBe("fit");
    expect(flat(byTestId(renderer, "details-drawer")!.props.style).maxHeight).toBe(462);
  });

  it("goes full when the content passes 0.58 of the height", () => {
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 462);
    expect(seen.shell!.toggleFullscreen).toBeDefined();
    act(() => seen.shell!.toggleFullscreen!());
    expect(fake.box.state.detent).toBe("full");
    expect(fake.box.state.fullscreen).toBe(true);
    expect(value(flat(byTestId(renderer, "details-drawer")!.props.style).height)).toBe(789);
    expect(seen.shell!.fullscreen).toBe(true);
    act(() => seen.shell!.toggleFullscreen!());
    expect(fake.box.state.detent).toBe("fit");
    expect(flat(byTestId(renderer, "details-drawer")!.props.style).maxHeight).toBe(462);
  });

  it("opens straight at full when asked (a code block)", () => {
    const renderer = render(slot());
    open("a", { detent: "full" });
    layOut(renderer, "details-drawer", 462);
    expect(value(flat(byTestId(renderer, "details-drawer")!.props.style).height)).toBe(789);
  });

  it.each([266, 462])("has the handle's tap switch between fit and full for content %i tall", (content) => {
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", content);
    act(() => byTestId(renderer, "details-handle")!.props.onPress());
    expect(fake.api.setDetent).toHaveBeenLastCalledWith(AGENT, "full");
    expect(value(flat(byTestId(renderer, "details-drawer")!.props.style).height)).toBe(789);
    act(() => byTestId(renderer, "details-handle")!.props.onPress());
    expect(fake.api.setDetent).toHaveBeenLastCalledWith(AGENT, "fit");
  });

  it.each([
    { from: "fit", dy: -80, vy: 0, to: "full" },
    { from: "fit", dy: -20, vy: -0.6, to: "full" },
    { from: "fit", dy: 30, vy: 0.1, to: "fit" },
    { from: "full", dy: 80, vy: 0.2, to: "fit" },
    { from: "full", dy: 30, vy: 1.4, to: "closed" },
    { from: "fit", dy: 80, vy: 0, to: "closed" },
  ] as const)("snaps a release from $from by $dy at $vy px/ms to $to", ({ from, dy, vy, to }) => {
    const renderer = render(slot());
    open("a", { detent: from });
    layOut(renderer, "details-drawer", 600);
    fake.api.setDetent.mockClear();
    expect(dragHeader(dy, vy)).toBe(true);
    if (to === "closed") {
      expect(fake.api.close).toHaveBeenCalledWith(AGENT);
      expect(byTestId(renderer, "details-drawer")).toBeNull();
    } else if (to === from) {
      expect(fake.api.setDetent).not.toHaveBeenCalled();
      expect(fake.api.close).not.toHaveBeenCalled();
    } else {
      expect(fake.api.setDetent).toHaveBeenCalledWith(AGENT, to);
    }
  });

  it("settles a slow pull down from full at fit, though the last move reads as a fling", () => {
    const renderer = render(slot());
    open("a", { detent: "full" });
    layOut(renderer, "details-drawer", 600);
    // 140 over 1.2 s, with PanResponder's two-move velocity spiking to 3 px/ms.
    expect(dragHeader(140, 140 / 1200, 3)).toBe(true);
    expect(fake.api.close).not.toHaveBeenCalled();
    expect(fake.api.setDetent).toHaveBeenCalledWith(AGENT, "fit");
  });

  it("still closes from full on a fast fling", () => {
    const renderer = render(slot());
    open("a", { detent: "full" });
    layOut(renderer, "details-drawer", 600);
    dragHeader(150, 2);
    expect(fake.api.close).toHaveBeenCalledWith(AGENT);
  });

  it("pulls short content up to full from the header", () => {
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 266);
    expect(dragHeader(-120, -1)).toBe(true);
    expect(fake.api.setDetent).toHaveBeenCalledWith(AGENT, "full");
    expect(value(flat(byTestId(renderer, "details-drawer")!.props.style).height)).toBe(789);
  });

  it("pulls short content up to full from the handle, damped past full", () => {
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 266);
    const handle = byTestId(renderer, "details-handle-zone")!.props as Record<string, (...args: unknown[]) => unknown>;
    const height = () => value(flat(byTestId(renderer, "details-drawer")!.props.style).height);
    act(() => {
      handle.onStartShouldSetPanResponderCapture!(event(100, 560, 1000));
      expect(handle.onMoveShouldSetPanResponder!(event(100, 540, 1020))).toBe(true);
      handle.onPanResponderGrant!(event(100, 540, 1020), {});
      handle.onPanResponderMove!(event(100, 400, 1100), {});
    });
    // 266 + 160 up: straight with the finger.
    expect(height()).toBe(426);
    // 266 + 623 up, 100 past full: a third of the overdrag.
    act(() => { handle.onPanResponderMove!(event(100, -63, 1300), {}); });
    expect(height()).toBe(819);
    act(() => { handle.onPanResponderRelease!(event(100, -63, 1400), { vx: 0, vy: 0 }); });
    expect(fake.api.setDetent).toHaveBeenCalledWith(AGENT, "full");
    expect(height()).toBe(789);
  });

  it("leaves a sideways drag that starts at the screen's left edge to the host", () => {
    render(slot());
    open("b");
    const handlers = seen.shell!.headerHandlers as Record<string, (...args: unknown[]) => unknown>;
    handlers.onStartShouldSetPanResponderCapture!(event(12, 500));
    expect(handlers.onMoveShouldSetPanResponder!(event(80, 502))).toBe(false);
    handlers.onStartShouldSetPanResponderCapture!(event(120, 500));
    expect(handlers.onMoveShouldSetPanResponder!(event(60, 502))).toBe(true);
  });

  it("steps on a header swipe past a quarter of the width", () => {
    render(slot());
    open("b");
    const handlers = seen.shell!.headerHandlers as Record<string, (...args: unknown[]) => unknown>;
    act(() => {
      handlers.onStartShouldSetPanResponderCapture!(event(300, 500));
      handlers.onMoveShouldSetPanResponder!(event(180, 502));
      handlers.onPanResponderGrant!(event(180, 502), {});
      handlers.onPanResponderMove!(event(180, 502), {});
      handlers.onPanResponderRelease!(event(180, 502), { vx: -0.1, vy: 0 });
    });
    expect(fake.api.step).toHaveBeenCalledWith(AGENT, 1);
    expect(seen.shell!.entry.id).toBe("c");
  });
});

describe("first open on a phone", () => {
  // Native text and images laid out while the drawer sat off the screen, under
  // JS-driven frames, stayed blank until a later layout (QA round 1, bug 1).
  it("lays the drawer out in place and unseen, then slides it up on the native driver", () => {
    const renderer = render(slot());
    open("a");
    const frame = () => flat(byTestId(renderer, "details-drawer-frame")!.props.style);
    expect(value(frame().opacity)).toBe(0);
    expect(value((frame().transform as { translateY: unknown }[])[0]!.translateY)).toBe(0);
    timings.length = 0;
    layOut(renderer, "details-drawer", 266);
    expect(value(frame().opacity)).toBe(1);
    expect(timings).toContainEqual({ toValue: 0, duration: 280, native: true });
    expect(timings.filter((timing) => !timing.native)).toEqual([]);
  });

  it("keeps the height on its own view, apart from the moving frame", () => {
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 462);
    act(() => seen.shell!.toggleFullscreen!());
    const frame = flat(byTestId(renderer, "details-drawer-frame")!.props.style);
    const box = flat(byTestId(renderer, "details-drawer")!.props.style);
    expect(frame.height).toBeUndefined();
    expect(value(box.height)).toBe(789);
    expect(box.transform).toBeUndefined();
  });

  it("moves the step's slide and the side panel on the native driver too", () => {
    render(slot());
    open("b");
    timings.length = 0;
    act(() => seen.shell!.step(1));
    expect(timings.length).toBeGreaterThan(0);
    expect(timings.every((timing) => timing.native)).toBe(true);
  });
});

describe("Android bottom inset", () => {
  it("keeps the drawer's last line above the navigation bar under edge-to-edge", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
    resetSafeInsets(null);
    const renderer = render(slot());
    open("a");
    // The probe: the stage fills the screen (844, the window too: edge to edge), the status bar pads nothing here.
    const stage = renderer.root.findAll((node) => (node.type as unknown) === "View" && node.props.pointerEvents === "none" && typeof node.props.onLayout === "function")[0]!;
    act(() => {
      stage.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
      byTestId(renderer, "details-inset-probe")!.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
    });
    const drawer = byTestId(renderer, "details-drawer")!;
    const pad = drawer.findAll((node) => (node.type as unknown) === "View" && flat(node.props.style).height === 24);
    expect(pad.length).toBe(1);
  });
});

describe("floating panel", () => {
  // 1194 tall, insets 47 / 34, 12 above the bottom: 1101 available, a fit cap of 551, full at 1077.
  it("opens at min(content, 0.5 × available) and goes full at available − 24", () => {
    screen.width = 834;
    screen.height = 1194;
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-floating", 300);
    expect(flat(byTestId(renderer, "details-floating")!.props.style).maxHeight).toBe(551);
    // Short content goes full too.
    act(() => seen.shell!.toggleFullscreen!());
    expect(value(flat(byTestId(renderer, "details-floating")!.props.style).height)).toBe(1077);
    act(() => seen.shell!.toggleFullscreen!());
    layOut(renderer, "details-floating", 551);
    act(() => seen.shell!.toggleFullscreen!());
    expect(value(flat(byTestId(renderer, "details-floating")!.props.style).height)).toBe(1077);
  });
});

describe("block switch height", () => {
  it("holds the old height at fit, then moves to the new content's over 240 ms", () => {
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 266);
    act(() => seen.body!.laidOut(200));
    act(() => seen.shell!.step(1));
    expect(seen.shell!.entry.id).toBe("b");
    expect(value(flat(byTestId(renderer, "details-drawer")!.props.style).height)).toBe(266);
    timings.length = 0;
    act(() => seen.body!.contentSized(120));
    expect(timings).toContainEqual({ toValue: 186, duration: 240, native: false });
    // Settled: the panel lays itself out again.
    const style = flat(byTestId(renderer, "details-drawer")!.props.style);
    expect(style.height).toBeUndefined();
    expect(style.maxHeight).toBe(462);
  });

  it("jumps under reduced motion", () => {
    motion.reduced = true;
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 266);
    act(() => seen.shell!.step(1));
    expect(seen.shell!.entry.id).toBe("b");
    expect(flat(byTestId(renderer, "details-drawer")!.props.style).height).toBeUndefined();
  });

  it("hands a pull down at the body's top to the drawer once the body reports", () => {
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 462);
    const panel = byTestId(renderer, "details-body")!.props as Record<string, (...args: unknown[]) => unknown>;
    const pull = () => {
      panel.onStartShouldSetPanResponderCapture!(event(100, 400));
      return panel.onMoveShouldSetPanResponderCapture!(event(100, 440));
    };
    act(() => seen.body!.scrolled(120));
    expect(pull()).toBe(false);
    act(() => seen.body!.scrolled(0));
    expect(pull()).toBe(true);
    // Upwards at its top the drawer takes it too, and scrolls the body itself.
    panel.onStartShouldSetPanResponderCapture!(event(100, 400));
    expect(panel.onMoveShouldSetPanResponderCapture!(event(100, 360))).toBe(true);
    // Scrolled down, upwards is the body's own scroll.
    act(() => seen.body!.scrolled(120));
    panel.onStartShouldSetPanResponderCapture!(event(100, 400));
    expect(panel.onMoveShouldSetPanResponderCapture!(event(100, 360))).toBe(false);
  });
});

describe("closing", () => {
  it("closes on the scrim", () => {
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 266);
    act(() => byTestId(renderer, "details-scrim")!.props.onPress());
    expect(fake.api.close).toHaveBeenCalledWith(AGENT);
    expect(renderer.root.findAll((node) => (node.type as unknown) === "Modal")).toHaveLength(0);
  });

  it("closes from the header's ×", () => {
    const renderer = render(slot());
    open("a");
    act(() => seen.shell!.close());
    expect(fake.api.close).toHaveBeenCalledWith(AGENT);
    expect(byTestId(renderer, "details-drawer")).toBeNull();
  });

  it("closes on Android's back", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
    const renderer = render(slot());
    open("a");
    act(() => renderer.root.findAll((node) => (node.type as unknown) === "Modal")[0]!.props.onRequestClose());
    expect(fake.api.close).toHaveBeenCalledWith(AGENT);
  });

  it("closes the floating panel on a tap outside it", () => {
    screen.width = 834;
    screen.height = 1194;
    const renderer = render(slot());
    open("a");
    act(() => byTestId(renderer, "details-outside")!.props.onPress());
    expect(fake.api.close).toHaveBeenCalledWith(AGENT);
  });

  it("closes on Escape on web through the panel's keys, unless a hover preview is open to take it", () => {
    const keys = webDesktop();
    const renderer = render(slot());
    open("a");
    expect(byTestId(renderer, "details-layer")!.props.pointerEvents).toBe("box-none");
    // One handler for the panel's keys, the keyboard module's.
    expect(web.keydown).toHaveLength(1);
    web.openPreviews = [{ matches: () => true, getClientRects: () => [1] }];
    const first = keys.press("Escape");
    expect(fake.api.close).not.toHaveBeenCalled();
    expect(first.defaultPrevented).toBe(false);
    // The hover preview's own handler asks, and is told to take it.
    expect(hasActiveDetailsKeyboard(first as unknown as KeyboardEvent)).toBe(false);
    web.openPreviews = [];
    const second = keys.press("Escape");
    expect(second.defaultPrevented).toBe(true);
    expect(fake.api.close).toHaveBeenCalledWith(AGENT);
    expect(web.keydown).toHaveLength(0);
  });

  it("leaves the keys alone while its pane is hidden", () => {
    const keys = webDesktop();
    render(slot());
    open("a");
    web.hidden = true;
    keys.press("Escape");
    keys.press("ArrowRight");
    expect(fake.api.close).not.toHaveBeenCalled();
    expect(fake.api.step).not.toHaveBeenCalled();
  });

  it("steps on ← → with the panel's own step, and wraps, widens and copies from the keys", async () => {
    const keys = webDesktop();
    render(slot());
    open("b");
    keys.press("ArrowRight");
    expect(fake.api.step).toHaveBeenCalledWith(AGENT, 1);
    expect(seen.shell!.entry.id).toBe("c");
    keys.press("ArrowLeft");
    expect(seen.shell!.entry.id).toBe("b");
    keys.press("w");
    expect(seen.actions!.wrap!.on).toBe(false);
    keys.press("f");
    expect(fake.box.state.fullscreen).toBe(true);
    keys.press("c", { metaKey: true });
    await act(async () => {});
    expect(clipboard.copyText).toHaveBeenCalledWith("text of b");
  });

  it("catches the pointer on the phone-width web drawer's scrim", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const renderer = render(slot());
    open("a");
    expect(byTestId(renderer, "details-layer")!.props.pointerEvents).toBe("auto");
    layOut(renderer, "details-drawer", 266);
    act(() => byTestId(renderer, "details-scrim")!.props.onPress());
    expect(fake.api.close).toHaveBeenCalledWith(AGENT);
  });
});

describe("lease handover", () => {
  it("brings the open block back in the next slot as it was", () => {
    const renderer = render(createElement("View", null, slot("one"), slot("two")));
    open("b");
    layOut(renderer, "details-drawer", 266);
    act(() => seen.actions!.wrap!.toggle());
    act(() => renderer.update(createElement("View", null, slot("two"))));
    expect(fake.queue.map((lease) => lease.key)).toEqual(["two"]);
    expect(renderer.root.findAll((node) => node.props.testID === "content-b" && (node.type as unknown) === "Text")).toHaveLength(1);
    expect(seen.shell!.entry.id).toBe("b");
    expect(seen.actions!.wrap!.on).toBe(false);
    expect(seen.actions!.remembered).not.toBeNull();
    // No entrance: the panel is there before it is measured.
    expect(value(flat(byTestId(renderer, "details-drawer-frame")!.props.style).opacity)).toBe(1);
    expect(fake.api.close).not.toHaveBeenCalled();
  });
});

describe("timeline sync", () => {
  it("scrolls the row up to 24 above the panel's top on open", async () => {
    const scroll = vi.fn((delta: number) => delta);
    registerHostList(AGENT, { viewport: async () => ({ top: 100, bottom: 800 }), scroll });
    fake.box.blocks = [block("a", 1, { measure: async () => ({ top: 600, height: 28 }) })];
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 266);
    await act(async () => {});
    // The panel's top is 844 − 266 = 578; the row's bottom 628 must come up to 554.
    expect(scroll).toHaveBeenCalledWith(74, 240);
  });

  it("leaves a row already in view, and a tombstone, alone", async () => {
    const scroll = vi.fn(() => 0);
    registerHostList(AGENT, { viewport: async () => ({ top: 100, bottom: 800 }), scroll });
    fake.box.blocks = [
      block("a", 1, { measure: async () => ({ top: 300, height: 28 }) }),
      block("b", 2, { mounted: false, measure: async () => ({ top: 700, height: 28 }) }),
    ];
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 266);
    await act(async () => {});
    open("b");
    await act(async () => {});
    expect(scroll).not.toHaveBeenCalled();
  });

  it("works out the move from the row and the band", () => {
    expect(syncDelta({ top: 300, height: 28 }, { top: 100, bottom: 578 })).toBe(0);
    expect(syncDelta({ top: 600, height: 28 }, { top: 100, bottom: 578 })).toBe(74);
    // Above the band: the content moves down.
    expect(syncDelta({ top: 60, height: 28 }, { top: 100, bottom: 578 })).toBe(-64);
    // Taller than the band: its top stays in view.
    expect(syncDelta({ top: 400, height: 900 }, { top: 100, bottom: 578 })).toBe(276);
  });

  it("probes once for older rows at the oldest known block", async () => {
    vi.useFakeTimers();
    const scroll = vi.fn((delta: number) => delta);
    registerHostList(AGENT, { viewport: async () => ({ top: 100, bottom: 800 }), scroll });
    render(slot());
    open("a");
    expect(seen.shell!.canStep.previous).toBe(true);
    await act(async () => seen.shell!.step(-1));
    expect(scroll).toHaveBeenCalledWith(-630, 0);
    // An older row mounts while the probe waits.
    act(() => {
      fake.box.blocks = [block("older", 0), ...fake.box.blocks];
      fake.emit();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(fake.api.step).toHaveBeenCalledWith(AGENT, -1);
    expect(seen.shell!.entry.id).toBe("older");
    // Back at "a", ‹ now steps to the row that mounted.
    act(() => fake.set({ openId: "a" }));
    expect(seen.shell!.canStep.previous).toBe(true);
  });
});

describe("content gestures in the drawer", () => {
  type Handlers = Record<string, (...args: unknown[]) => unknown>;
  // The drawer's pull rides on the body, not the panel.
  const panelOf = (renderer: ReactTestRenderer) => byTestId(renderer, "details-body")!.props as Handlers;
  const header = () => seen.shell!.headerHandlers as Handlers;
  /** A drawer at fit over a body that reports it is at its top. */
  function atTop() {
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 462);
    act(() => seen.body!.scrolled(0));
    return renderer;
  }
  /** A body touch from (100, 400) at 1000 ms to (100 + dx, 400 + dy) at `at`: whether the drawer takes it. */
  function pull(panel: Handlers, dy: number, at = 1050, dx = 0): boolean {
    panel.onStartShouldSetPanResponderCapture!(event(100, 400, 1000));
    return Boolean(panel.onMoveShouldSetPanResponderCapture!(event(100 + dx, 400 + dy, at)));
  }

  it("moves the drawer on a pull down from an unclaimed body at its top", () => {
    const renderer = atTop();
    const panel = panelOf(renderer);
    act(() => {
      expect(pull(panel, 40)).toBe(true);
      panel.onPanResponderGrant!(event(100, 440, 1050), {});
      panel.onPanResponderMove!(event(100, 500, 1100), {});
    });
    expect(value((flat(byTestId(renderer, "details-drawer-frame")!.props.style).transform as { translateY: unknown }[])[0]!.translateY)).toBe(100);
    act(() => { panel.onPanResponderRelease!(event(100, 500, 1100), { vx: 0, vy: 0 }); });
    expect(fake.api.close).toHaveBeenCalledWith(AGENT);
  });

  it("never moves the drawer for a touch a content zone claimed, by the body or the header", () => {
    const renderer = atTop();
    const panel = panelOf(renderer);
    const release = claimContentTouch();
    expect(pull(panel, 40)).toBe(false);
    expect(pull(panel, 120, 1300)).toBe(false);
    header().onStartShouldSetPanResponderCapture!(event(200, 300, 1000));
    expect(header().onMoveShouldSetPanResponder!(event(200, 380, 1050))).toBe(false);
    header().onStartShouldSetPanResponderCapture!(event(200, 300, 1000));
    expect(header().onMoveShouldSetPanResponder!(event(80, 302, 1050))).toBe(false);
    release();
    release();
    expect(contentOwnsTouch()).toBe(false);
    expect(pull(panel, 40)).toBe(true);
  });

  it("leaves a body touch that went sideways first to the code's scroll, even if it turns down", () => {
    const renderer = atTop();
    const panel = panelOf(renderer);
    panel.onStartShouldSetPanResponderCapture!(event(100, 400, 1000));
    expect(panel.onMoveShouldSetPanResponderCapture!(event(130, 403, 1030))).toBe(false);
    expect(panel.onMoveShouldSetPanResponderCapture!(event(140, 480, 1100))).toBe(false);
  });

  it("leaves a body touch that rested before it moved to the content (a text selection)", () => {
    const renderer = atTop();
    const panel = panelOf(renderer);
    expect(pull(panel, 40, 1000 + CONTENT_HOLD_MS)).toBe(false);
    expect(pull(panel, 40, 1000 + CONTENT_HOLD_MS - 50)).toBe(true);
    // The header still drags after a rest.
    expect(dragHeader(80, 0)).toBe(true);
  });

  it("keeps the body's drags for the content after a long press, until a tap", () => {
    const renderer = atTop();
    const panel = panelOf(renderer);
    const press = (ms: number) => {
      panel.onStartShouldSetPanResponderCapture!(event(100, 400, 1000));
      panel.onTouchEndCapture!(event(102, 401, 1000 + ms));
    };
    // A long press selects a word; the next drags take its handles.
    press(600);
    expect(pull(panel, 40)).toBe(false);
    expect(pull(panel, 40)).toBe(false);
    // A tap clears the selection.
    press(80);
    expect(pull(panel, 40)).toBe(true);
  });

  /** A gutter of six 18-tall lines, inside the details body and its scroller. */
  function Gutter() {
    const contentRef = useRef(null);
    const lines = ["one", "two", "three", "four", "five", "six"];
    const tops = [0, 18, 36, 54, 72, 90];
    const selection = useLineSelection({ enabled: true, lines, tops, bottom: 108, contentRef });
    gutter.state = selection;
    return createElement("View", { ref: selection.gutterRef, testID: "gutter", ...selection.gutterProps });
  }
  const GutterBlock = () => createElement(HoverPreviewBody, null, createElement(Gutter));
  const gutter = { state: null as ReturnType<typeof useLineSelection> | null };

  it("completes a line selection after the hold, jitter and a slide down included, without moving the drawer", () => {
    vi.useFakeTimers();
    fake.box.blocks = [block("a", 1, { render: () => createElement(GutterBlock) })];
    const renderer = atTop();
    const panel = panelOf(renderer);
    const props = () => byTestId(renderer, "gutter")!.props as Handlers;
    const frame = () => flat(byTestId(renderer, "details-drawer-frame")!.props.style);
    act(() => {
      panel.onStartShouldSetPanResponderCapture!(event(20, 420, 1000));
      props().onTouchStart!(event(20, 420, 1000));
      expect(props().onStartShouldSetResponder!(event(20, 420, 1000))).toBe(true);
      props().onResponderGrant!({ nativeEvent: { locationY: 20, pageX: 20, pageY: 420, timestamp: 1000 } });
    });
    // Diagonal jitter during the hold: past the drawer's 10 px, inside the gutter's 8.
    expect(panel.onMoveShouldSetPanResponderCapture!(event(27, 427.5, 1100))).toBe(false);
    act(() => { props().onResponderMove!(event(27, 427.5, 1100)); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(gutter.state!.range).toEqual({ from: 1, to: 1 });
    expect(panel.onMoveShouldSetPanResponderCapture!(event(20, 470, 1600))).toBe(false);
    act(() => { props().onResponderMove!(event(20, 470, 1600)); });
    expect(gutter.state!.range).toEqual({ from: 1, to: 3 });
    act(() => {
      props().onResponderRelease!(event(20, 470, 1700));
      props().onTouchEnd!(event(20, 470, 1700));
    });
    expect(gutter.state!.selectedText).toBe("two\nthree\nfour");
    expect(gutter.state!.menuTop).not.toBeNull();
    expect(fake.api.close).not.toHaveBeenCalled();
    expect(fake.api.setDetent).not.toHaveBeenCalled();
    expect(value((frame().transform as { translateY: unknown }[])[0]!.translateY)).toBe(0);
    // The touch over, the body's pull is the drawer's again.
    expect(contentOwnsTouch()).toBe(false);
    expect(pull(panel, 40, 1050)).toBe(true);
  });

  it("scrolls the drawer's body while a held gutter finger is past its bottom edge", () => {
    vi.useFakeTimers();
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => { frames.length = 0; });
    fake.box.blocks = [block("a", 1, { render: () => createElement(GutterBlock) })];
    const renderer = atTop();
    const body = byTestId(renderer, "hover-preview-body")!.props as Handlers;
    act(() => {
      body.onLayout!({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 300 } } });
      body.onContentSizeChange!(390, 600);
    });
    const props = () => byTestId(renderer, "gutter")!.props as Handlers;
    act(() => {
      props().onTouchStart!(event(20, 420, 1000));
      props().onResponderGrant!({ nativeEvent: { locationY: 20, pageX: 20, pageY: 420, timestamp: 1000 } });
    });
    act(() => { vi.advanceTimersByTime(400); });
    // The body shows 400..700; the finger goes 20 past its bottom.
    act(() => { props().onResponderMove!(event(20, 720, 1600)); });
    act(() => { frames.shift()?.(); });
    act(() => { frames.shift()?.(); });
    expect(web.scrolls.length).toBe(2);
    expect(web.scrolls[1]).toBeGreaterThan(web.scrolls[0]!);
    act(() => {
      props().onResponderRelease!(event(20, 720, 1700));
      props().onTouchEnd!(event(20, 720, 1700));
    });
    expect(gutter.state!.range).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it("draws a table's held cell range and offers its copy menu without moving the drawer", () => {
    vi.useFakeTimers();
    const table = () => createElement(HoverPreviewBody, null, createElement(MarkdownView, {
      text: "| A | B |\n| --- | --- |\n| one | two |\n| three | four |", tokens, variant: "document", streaming: false,
    }));
    fake.box.blocks = [block("a", 1, { render: table })];
    const renderer = atTop();
    const panel = panelOf(renderer);
    const frame = () => renderer.root.findAll((node) => (node.type as unknown) === "View"
      && typeof node.props.onTouchStart === "function" && typeof node.props.onMoveShouldSetResponder === "function")[0]!.props as Handlers;
    const touch = (pageX: number, pageY: number, timestamp: number) => ({ nativeEvent: { pageX, pageY, timestamp, touches: [{}] } });
    const highlighted = () => renderer.root.findAll((node) => (node.type as unknown) === "Text"
      && node.props.testID === "markdown-table-cell" && flat(node.props.style).backgroundColor === tokens.accentBg).length;
    web.row = 0;
    act(() => {
      panel.onStartShouldSetPanResponderCapture!(event(10, 440, 1000));
      frame().onTouchStart!(touch(10, 440, 1000));
    });
    act(() => { vi.advanceTimersByTime(350); });
    expect(contentOwnsTouch()).toBe(true);
    expect(highlighted()).toBe(1);
    // Down across the rows, at the body's top: still the table's. Stamped as
    // a quick drag, so only the table's claim keeps it from the drawer.
    expect(panel.onMoveShouldSetPanResponderCapture!(event(10, 500, 1200))).toBe(false);
    act(() => { frame().onTouchMove!(touch(10, 500, 1500)); });
    act(() => { frame().onTouchEnd!(touch(10, 500, 1600)); });
    expect(contentOwnsTouch()).toBe(false);
    expect(highlighted()).toBeGreaterThan(1);
    expect(renderer.root.findAll((node) => (node.type as unknown) === "Pressable"
      && typeof node.props.accessibilityLabel === "string" && node.props.accessibilityLabel.startsWith("Copy selected"))).toHaveLength(1);
    expect(fake.api.close).not.toHaveBeenCalled();
    expect(fake.api.setDetent).not.toHaveBeenCalled();
  });

  it("keeps the phone body from bouncing or taking the finger at its top, and lets it scroll as usual once down", () => {
    fake.box.blocks = [block("a", 1, { render: () => createElement(HoverPreviewBody, null, createElement("Text", null, "out")) })];
    const renderer = atTop();
    const body = () => byTestId(renderer, "hover-preview-body")!.props as Record<string, unknown> & Handlers;
    expect(body()).toMatchObject({ bounces: false, disableScrollViewPanResponder: true });
    act(() => { body().onScroll!({ nativeEvent: { contentOffset: { y: 120 }, layoutMeasurement: { height: 300 }, contentSize: { height: 900 } } }); });
    expect(body()).toMatchObject({ bounces: true, disableScrollViewPanResponder: false });
    // The drawer reads the same offset: no pull from here.
    expect(pull(panelOf(renderer), 40)).toBe(false);
    act(() => { body().onScroll!({ nativeEvent: { contentOffset: { y: 0 }, layoutMeasurement: { height: 300 }, contentSize: { height: 900 } } }); });
    expect(body()).toMatchObject({ bounces: false, disableScrollViewPanResponder: true });
    expect(pull(panelOf(renderer), 40)).toBe(true);
  });
});

describe("a phone body at its top", () => {
  type Handlers = Record<string, (...args: unknown[]) => unknown>;
  const output = () => createElement(HoverPreviewBody, null, createElement("Text", null, "output"));
  /** A drawer at fit over a real details body that has never scrolled: no onScroll, no report seeded. */
  function fresh(id: string) {
    fake.box.blocks = [block(id, 1, { render: output })];
    const renderer = render(slot());
    open(id);
    layOut(renderer, "details-drawer", 462);
    const body = () => byTestId(renderer, "hover-preview-body")!.props as Record<string, unknown> & Handlers;
    act(() => {
      body().onLayout!({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 300 } } });
      body().onContentSizeChange!(390, 900);
    });
    return { renderer, body, panel: byTestId(renderer, "details-body")!.props as Handlers };
  }

  it.each(["ios", "android"])("on %s is claimed by the drawer for a pull down without any scroll event", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const { renderer, body, panel } = fresh(`pull-${os}`);
    // At its top the body does not scroll natively, so nothing native takes the pull first.
    expect(body()).toMatchObject({ scrollEnabled: false, bounces: false, disableScrollViewPanResponder: true });
    act(() => {
      panel.onStartShouldSetPanResponderCapture!(event(100, 560, 1000));
      expect(panel.onMoveShouldSetPanResponderCapture!(event(100, 577, 1030))).toBe(true);
      panel.onPanResponderGrant!(event(100, 577, 1030), {});
      panel.onPanResponderMove!(event(100, 780, 1200), {});
    });
    expect(value((flat(byTestId(renderer, "details-drawer-frame")!.props.style).transform as { translateY: unknown }[])[0]!.translateY)).toBe(220);
    act(() => { panel.onPanResponderRelease!(event(100, 780, 1230), { vx: 0, vy: 0 }); });
    expect(fake.api.close).toHaveBeenCalledWith(AGENT);
  });

  it("scrolls the body up with the finger from its top, glides on after a fling, and then scrolls natively", () => {
    const { body, panel } = fresh("lift");
    act(() => {
      panel.onStartShouldSetPanResponderCapture!(event(100, 560, 1000));
      expect(panel.onMoveShouldSetPanResponderCapture!(event(100, 540, 1020))).toBe(true);
      panel.onPanResponderGrant!(event(100, 540, 1020), {});
      panel.onPanResponderMove!(event(100, 500, 1060), {});
      panel.onPanResponderMove!(event(100, 400, 1100), {});
    });
    expect(web.scrolls).toEqual([60, 160]);
    act(() => { panel.onPanResponderRelease!(event(100, 380, 1110), { vx: 0, vy: 0 }); });
    // About 1.6 px/ms upwards over the last 100 ms: on by 300 ms of it, within the content.
    expect(web.glides).toHaveLength(1);
    expect(web.glides[0]).toBeGreaterThan(160);
    expect(web.glides[0]).toBeLessThanOrEqual(600);
    expect(fake.api.close).not.toHaveBeenCalled();
    act(() => { body().onScroll!({ nativeEvent: { contentOffset: { y: 400 }, layoutMeasurement: { height: 300 }, contentSize: { height: 900 } } }); });
    expect(body()).toMatchObject({ scrollEnabled: true, bounces: true, disableScrollViewPanResponder: false });
    panel.onStartShouldSetPanResponderCapture!(event(100, 560, 2000));
    expect(panel.onMoveShouldSetPanResponderCapture!(event(100, 520, 2030))).toBe(false);
  });

  it("scrolls natively in the side panel, which takes no pulls", () => {
    screen.width = 1194;
    screen.height = 834;
    fake.box.blocks = [block("side-body", 1, { render: output })];
    const renderer = render(slot());
    open("side-body");
    expect(byTestId(renderer, "hover-preview-body")!.props).toMatchObject({ scrollEnabled: true, bounces: true, disableScrollViewPanResponder: false });
  });
});

/**
 * React Native's responder negotiation for one finger along one path of
 * views, root first, as ResponderEventPlugin runs it. A start asks capture
 * handlers root to leaf, then bubble handlers leaf to root. While a view
 * holds the touch, a move asks only the views above it (capture from the
 * root down to its parent, then bubble back up): views below the holder are
 * never asked. Handlers are read under both their responder and PanResponder
 * names, since the test PanResponder passes its config through.
 */
function negotiation(path: Array<Record<string, unknown>>) {
  type Fn = (...args: unknown[]) => unknown;
  const call = (node: Record<string, unknown>, name: string, ...args: unknown[]) => {
    const fn = (node[name] ?? node[name.replace("Responder", "PanResponder").replace("onResponder", "onPanResponder")]) as Fn | undefined;
    return fn?.(...args);
  };
  let holder: number | null = null;
  const transfer = (to: number, event: unknown) => {
    if (holder !== null && holder !== to) {
      if (call(path[holder]!, "onResponderTerminationRequest", event, {}) === false) {
        call(path[to]!, "onResponderReject", event, {});
        return;
      }
      call(path[holder]!, "onResponderTerminate", event, {});
    }
    holder = to;
    call(path[to]!, "onResponderGrant", event, {});
  };
  const ask = (kind: "Start" | "Move", last: number, event: unknown) => {
    for (let index = 0; index <= last; index++) {
      if (call(path[index]!, `on${kind}ShouldSetResponderCapture`, event, {})) return index;
    }
    for (let index = last; index >= 0; index--) {
      if (call(path[index]!, `on${kind}ShouldSetResponder`, event, {})) return index;
    }
    return null;
  };
  return {
    get holder() { return holder; },
    start(event: unknown) {
      holder = null;
      const to = ask("Start", path.length - 1, event);
      if (to !== null) transfer(to, event);
    },
    move(event: unknown) {
      const to = ask("Move", holder === null ? path.length - 1 : holder - 1, event);
      if (to !== null) transfer(to, event);
      if (holder !== null) call(path[holder]!, "onResponderMove", event, {});
    },
    end(event: unknown) {
      if (holder !== null) call(path[holder]!, "onResponderRelease", event, {});
      holder = null;
    },
  };
}

describe("the pull under the Modal's own responder", () => {
  // The native details layer is a Modal, whose root takes every touch no view inside took.
  const modal = { onStartShouldSetResponder: () => true };
  const swipeDown = (touch: ReturnType<typeof negotiation>, x: number, y: number) => {
    act(() => {
      touch.start(event(x, y, 1000));
      [17, 43, 78, 122, 174, 218].forEach((dy, index) => touch.move(event(x, y + dy, 1030 + index * 30)));
      touch.end(event(x, y + 218, 1220));
    });
  };

  it.each(["ios", "android"])("on %s moves the drawer from a body at its top that never scrolled", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    fake.box.blocks = [block(`modal-${os}`, 1)];
    const renderer = render(slot());
    open(`modal-${os}`);
    layOut(renderer, "details-drawer", 462);
    const body = byTestId(renderer, "details-body")!.props as Record<string, unknown>;
    const touch = negotiation([modal, byTestId(renderer, "details-drawer")!.props, body, {}]);
    swipeDown(touch, 240, 600);
    expect(fake.api.close).toHaveBeenCalledWith(AGENT);
  });

  it("scrolls a body at its top up with the finger, under the Modal", () => {
    fake.box.blocks = [block("modal-up", 1)];
    const renderer = render(slot());
    open("modal-up");
    layOut(renderer, "details-drawer", 462);
    const scroll = byTestId(renderer, "hover-preview-body")!.props as Record<string, (...args: unknown[]) => unknown>;
    act(() => {
      scroll.onLayout!({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 300 } } });
      scroll.onContentSizeChange!(390, 900);
    });
    const touch = negotiation([modal, byTestId(renderer, "details-body")!.props, {}]);
    act(() => {
      touch.start(event(240, 600, 1000));
      touch.move(event(240, 580, 1030));
      touch.move(event(240, 480, 1100));
      touch.end(event(240, 480, 1400));
    });
    expect(web.scrolls).toEqual([20, 120]);
    expect(fake.api.close).not.toHaveBeenCalled();
  });

  it("leaves a body scrolled down to its own scroll, under the Modal", () => {
    fake.box.blocks = [block("modal-scrolled", 1)];
    const renderer = render(slot());
    open("modal-scrolled");
    layOut(renderer, "details-drawer", 462);
    act(() => seen.body!.scrolled(200));
    const touch = negotiation([modal, byTestId(renderer, "details-body")!.props, {}]);
    swipeDown(touch, 240, 600);
    expect(fake.api.close).not.toHaveBeenCalled();
  });

  it("keeps a line-number drag in the gutter that took the touch at its start", () => {
    vi.useFakeTimers();
    const gutterBlock = () => createElement(HoverPreviewBody, null, createElement(() => {
      const contentRef = useRef(null);
      const selection = useLineSelection({ enabled: true, lines: ["a", "b", "c"], tops: [0, 18, 36], bottom: 54, contentRef });
      return createElement("View", { ref: selection.gutterRef, testID: "gutter", ...selection.gutterProps });
    }));
    fake.box.blocks = [block("modal-gutter", 1, { render: gutterBlock })];
    const renderer = render(slot());
    open("modal-gutter");
    layOut(renderer, "details-drawer", 462);
    const gutter = byTestId(renderer, "gutter")!.props as Record<string, (...args: unknown[]) => unknown>;
    const touch = negotiation([modal, byTestId(renderer, "details-body")!.props, gutter]);
    act(() => { gutter.onTouchStart!(event(20, 420, 1000)); touch.start({ nativeEvent: { locationY: 20, pageX: 20, pageY: 420, timestamp: 1000 } }); });
    expect(touch.holder).toBe(2);
    act(() => { vi.advanceTimersByTime(400); });
    act(() => { touch.move(event(20, 470, 1500)); });
    expect(touch.holder).toBe(2);
    act(() => { touch.end(event(20, 470, 1600)); gutter.onTouchEnd!(event(20, 470, 1600)); });
    expect(fake.api.close).not.toHaveBeenCalled();
  });

  it("drags the drawer from the header's icon tile, where no button takes the touch", () => {
    fake.box.blocks = [block("modal-header", 1)];
    const renderer = render(slot());
    open("modal-header");
    layOut(renderer, "details-drawer", 462);
    act(() => seen.body!.scrolled(200));
    const touch = negotiation([modal, byTestId(renderer, "details-drawer")!.props, seen.shell!.headerHandlers!, {}]);
    swipeDown(touch, 40, 300);
    expect(fake.api.close).toHaveBeenCalledWith(AGENT);
  });
});

describe("iOS text after the slide in", () => {
  const mounts = { count: 0 };
  function Counted() {
    React.useEffect(() => { mounts.count += 1; }, []);
    return createElement("Text", null, "code");
  }
  const counted = () => createElement(HoverPreviewBody, null, createElement(Counted));

  it.each([
    { os: "ios", reduced: false, again: 1 },
    { os: "ios", reduced: true, again: 0 },
    { os: "android", reduced: false, again: 0 },
  ])("on $os (reduced motion $reduced) draws the content again $again time(s) once the drawer is at rest", ({ os, reduced, again }) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    motion.reduced = reduced;
    mounts.count = 0;
    // Ids no earlier test left open, which a handover would take over without a slide.
    const id = `slid-${os}-${reduced}`;
    fake.box.blocks = [block(id, 1, { render: counted }), block(`${id}-next`, 2, { render: counted })];
    const renderer = render(slot());
    open(id);
    expect(mounts.count).toBe(1);
    // The measure lands the slide, which the fake timing finishes at once.
    layOut(renderer, "details-drawer", 266);
    expect(mounts.count).toBe(1 + again);
    // A step to another block is no entrance.
    act(() => fake.api.step(AGENT, 1));
    const after = mounts.count;
    layOut(renderer, "details-drawer", 266);
    expect(mounts.count).toBe(after);
  });
});


describe("a pinch in the phone drawer", () => {
  type Handlers = Record<string, (...args: unknown[]) => unknown>;
  const zooms: number[] = [];
  let zoomMounts = 0;
  function ZoomProbe() {
    const zoom = useContext(TextZoomContext);
    React.useEffect(() => { zoomMounts += 1; }, []);
    zooms.push(zoom);
    return createElement("Text", { testID: "zoom-probe" }, String(zoom));
  }
  const zoomed = () => createElement(HoverPreviewBody, null, createElement(ZoomProbe));
  const fingers = (...ys: number[]) => ({ nativeEvent: { pageX: 100, pageY: ys[0], timestamp: 0, touches: ys.map((pageY) => ({ pageX: 100, pageY })) } });
  /** A drawer whose body is 300 tall from 400 down, over 900 of content scrolled to `offset`. */
  function drawer(id: string, offset = 300) {
    fake.box.blocks = [block(id, 1, { render: zoomed })];
    const renderer = render(slot());
    open(id);
    layOut(renderer, "details-drawer", 462);
    const body = () => byTestId(renderer, "hover-preview-body")!.props as Record<string, unknown> & Handlers;
    const panel = () => byTestId(renderer, "details-body")!.props as Handlers;
    act(() => {
      body().onLayout!({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 300 } } });
      body().onContentSizeChange!(390, 900);
      body().onScroll!({ nativeEvent: { contentOffset: { y: offset }, layoutMeasurement: { height: 300 }, contentSize: { height: 900 } } });
    });
    const shown = () => byTestId(renderer, "zoom-probe")!.props.children as string;
    return { renderer, body, panel, shown };
  }

  beforeEach(() => {
    zooms.length = 0;
    zoomMounts = 0;
  });

  it("updates the capsule during repeated long-text steps without remounting text or notifying global readers", () => {
    vi.useFakeTimers();
    const { renderer, body, shown } = drawer("step-long");
    act(() => {
      body().onContentSizeChange!(390, 9000);
      const panel = byTestId(renderer, "details-body")!.props;
      panel.onTouchStart(fingers(500, 600));
      panel.onTouchEnd(fingers());
    });
    const mounts = zoomMounts;
    const notified = vi.fn();
    const unsubscribe = subscribeEnhancerPreferences(notified);
    try {
      for (let index = 0; index < 7; index++) {
        act(() => byTestId(renderer, "details-zoom-increase")!.props.onPress());
        act(() => { vi.advanceTimersByTime(149); });
      }
      expect(shown()).toBe("14");
      expect(zoomMounts).toBe(mounts);
      expect(notified).not.toHaveBeenCalled();
      const words = byTestId(renderer, "details-zoom-badge")!.findAll((node) => typeof node.props.children === "string").map((node) => node.props.children);
      expect(words).toContain("Text size 21");
      act(() => { vi.advanceTimersByTime(1); });
      expect(shown()).toBe("21");
      expect(zoomMounts).toBe(mounts + 1);
      expect(notified).toHaveBeenCalledTimes(1);
      act(() => byTestId(renderer, "details-zoom-reset")!.props.onPress());
      act(() => { vi.advanceTimersByTime(150); });
      const afterReset = notified.mock.calls.length;
      act(() => byTestId(renderer, "details-zoom-reset")!.props.onPress());
      act(() => { vi.advanceTimersByTime(150); });
      expect(notified).toHaveBeenCalledTimes(afterReset);
    } finally {
      unsubscribe();
    }
  });

  it("sets the text size live, keeps the line under the fingers, and saves it as they lift", () => {
    vi.useFakeTimers();
    const { renderer, body, panel, shown } = drawer("pinch");
    expect(body().scrollEnabled).toBe(true);
    act(() => { panel().onTouchStart!(fingers(500, 600)); });
    // Held still: the fingers moving apart do not scroll the body.
    expect(body().scrollEnabled).toBe(false);
    expect(byTestId(renderer, "details-zoom-badge")).not.toBeNull();
    // 100 apart to 150: the independent 14-point size becomes 21.
    act(() => { panel().onTouchMove!(fingers(475, 625)); });
    expect(shown()).toBe("21");
    expect(getEnhancerPreferences().detailsFontSize).toBe(14);
    // The midpoint, 150 into the body, was half way down the content: still there at 1350.
    act(() => { body().onContentSizeChange!(390, 1350); });
    expect(web.scrolls.at(-1)).toBe(525);
    act(() => { panel().onTouchEnd!(fingers(475)); });
    expect(getEnhancerPreferences().detailsFontSize).toBe(21);
    expect(shown()).toBe("21");
    expect(body().scrollEnabled).toBe(true);
    const words = byTestId(renderer, "details-zoom-badge")!.findAll((node) => typeof node.props.children === "string").map((node) => node.props.children);
    expect(words).toEqual(expect.arrayContaining(["Text size 21", "Reset"]));
    act(() => { (byTestId(renderer, "details-zoom-reset")!.props.onPress as () => void)(); });
    act(() => { vi.advanceTimersByTime(150); });
    expect(getEnhancerPreferences().detailsFontSize).toBe(14);
    expect(shown()).toBe("14");
    expect(byTestId(renderer, "details-zoom-badge")).not.toBeNull();
    expect(byTestId(renderer, "details-zoom-reset")).not.toBeNull();
  });

  it("lays a long body out only as the fingers lift", () => {
    const { renderer, body, panel, shown } = drawer("pinch-long", 3000);
    act(() => {
      body().onContentSizeChange!(390, 9000);
      body().onScroll!({ nativeEvent: { contentOffset: { y: 3000 }, layoutMeasurement: { height: 300 }, contentSize: { height: 9000 } } });
    });
    act(() => {
      panel().onTouchStart!(fingers(500, 600));
      panel().onTouchMove!(fingers(475, 625));
    });
    // The badge counts; the text waits.
    const words = () => byTestId(renderer, "details-zoom-badge")!.findAll((node) => typeof node.props.children === "string").map((node) => node.props.children);
    expect(words()).toContain("Text size 21");
    expect(shown()).toBe("14");
    act(() => { panel().onTouchEnd!(fingers(475)); });
    expect(shown()).toBe("21");
    // 3150 of 9000 under the midpoint: at 13500 that is 4725, 150 into the body.
    act(() => { body().onContentSizeChange!(390, 13500); });
    expect(web.scrolls.at(-1)).toBe(4575);
  });

  it("keeps the saved size within 12 and 26 points", () => {
    const { panel, shown } = drawer("pinch-far");
    act(() => {
      panel().onTouchStart!(fingers(500, 600));
      panel().onTouchMove!(fingers(300, 800));
      panel().onTouchEnd!(fingers());
    });
    expect(shown()).toBe("26");
    act(() => {
      panel().onTouchStart!(fingers(500, 600));
      panel().onTouchMove!(fingers(545, 555));
      panel().onTouchEnd!(fingers());
    });
    expect(getEnhancerPreferences().detailsFontSize).toBe(12);
    expect(shown()).toBe("12");
  });

  it("lets go of the drawer's pull once a second finger comes down", () => {
    const { renderer, panel } = drawer("pinch-pull", 0);
    act(() => {
      panel().onStartShouldSetPanResponderCapture!(event(100, 560, 1000));
      expect(panel().onMoveShouldSetPanResponderCapture!(event(100, 577, 1030))).toBe(true);
      panel().onPanResponderGrant!(event(100, 577, 1030), {});
      panel().onPanResponderMove!(event(100, 700, 1100), {});
    });
    const frame = () => value((flat(byTestId(renderer, "details-drawer-frame")!.props.style).transform as { translateY: unknown }[])[0]!.translateY);
    expect(frame()).toBeGreaterThan(0);
    act(() => {
      panel().onTouchStart!(fingers(700, 760));
      panel().onPanResponderMove!({ nativeEvent: { ...fingers(700, 760).nativeEvent, timestamp: 1150 } }, {});
    });
    // Back at rest, and the rest of the touch moves nothing.
    expect(frame()).toBe(0);
    act(() => {
      panel().onPanResponderMove!(event(100, 820, 1200), {});
      panel().onPanResponderRelease!(event(100, 820, 1230), { vx: 0, vy: 0 });
    });
    expect(frame()).toBe(0);
    expect(fake.api.close).not.toHaveBeenCalled();
  });

  it("draws the saved size in the drawer, and leaves web unchanged", () => {
    updateEnhancerPreferences({ detailsFontSize: 19 });
    const { panel, shown } = drawer("pinch-saved");
    expect(shown()).toBe("19");
    expect(panel().onTouchStart).toBeDefined();
    act(() => mounted.splice(0).forEach((renderer) => renderer.unmount()));
    webDesktop();
    fake.box.blocks = [block("pinch-side", 1, { render: zoomed })];
    const side = render(slot());
    open("pinch-side");
    expect(byTestId(side, "zoom-probe")!.props.children).toBe("0");
    expect(byTestId(side, "details-body")!.props.onTouchStart).toBeUndefined();
  });

  it.each([
    { os: "ios", width: 1194, height: 834, form: "side", hover: false },
    { os: "ios", width: 834, height: 1194, form: "floating", hover: false },
    { os: "ios", width: 1194, height: 834, form: "side", hover: true },
    { os: "android", width: 1194, height: 834, form: "side", hover: false },
    { os: "android", width: 834, height: 1194, form: "floating", hover: false },
  ])("supports saved zoom, pinch and badge controls in $os $form (hover $hover)", ({ os, width, height, form, hover }) => {
    vi.useFakeTimers();
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    screen.width = width;
    screen.height = height;
    caps.hover = hover;
    updateEnhancerPreferences({ detailsFontSize: 19 });
    const id = `tablet-pinch-${os}-${form}-${hover}`;
    fake.box.blocks = [block(id, 1, { render: zoomed })];
    const renderer = render(slot());
    open(id);
    expect(byTestId(renderer, `details-${form}`)).not.toBeNull();
    const shown = () => byTestId(renderer, "zoom-probe")!.props.children;
    const body = () => byTestId(renderer, "hover-preview-body")!.props;
    const panel = () => byTestId(renderer, "details-body")!.props;
    const press = (control: string) => {
      act(() => byTestId(renderer, `details-zoom-${control}`)!.props.onPress());
      act(() => { vi.advanceTimersByTime(150); });
    };
    expect(shown()).toBe("19");
    act(() => {
      body().onContentSizeChange(420, 900);
      body().onScroll({ nativeEvent: { contentOffset: { y: 100 }, layoutMeasurement: { height: 300 }, contentSize: { height: 900 } } });
      panel().onTouchStart(fingers(500, 600));
    });
    expect(body().scrollEnabled).toBe(false);
    expect(byTestId(renderer, "details-zoom-badge")).not.toBeNull();
    act(() => panel().onTouchMove(fingers(490, 610)));
    expect(shown()).toBe("23");
    expect(getEnhancerPreferences().detailsFontSize).toBe(19);
    act(() => panel().onTouchEnd(fingers()));
    expect(body().scrollEnabled).toBe(true);
    expect(getEnhancerPreferences().detailsFontSize).toBe(23);
    press("increase");
    expect(shown()).toBe("24");
    expect(getEnhancerPreferences().detailsFontSize).toBe(24);
    press("decrease");
    expect(shown()).toBe("23");
    expect(getEnhancerPreferences().detailsFontSize).toBe(23);
    press("reset");
    expect(shown()).toBe("14");
    expect(getEnhancerPreferences().detailsFontSize).toBe(14);
    expect(byTestId(renderer, "details-zoom-badge")).not.toBeNull();
    press("reset");
    expect(byTestId(renderer, "details-zoom-reset")).not.toBeNull();
  });

  it("keeps tablet zoom across a side-to-floating layout change", () => {
    vi.useFakeTimers();
    screen.width = 1194;
    screen.height = 834;
    fake.box.blocks = [block("tablet-rotate", 1, { render: zoomed })];
    const renderer = render(slot());
    open("tablet-rotate");
    expect(byTestId(renderer, "details-side")).not.toBeNull();
    act(() => {
      byTestId(renderer, "details-body")!.props.onTouchStart(fingers(500, 600));
      byTestId(renderer, "details-body")!.props.onTouchEnd(fingers());
    });
    act(() => byTestId(renderer, "details-zoom-increase")!.props.onPress());
    screen.width = 834;
    screen.height = 1194;
    act(() => renderer.update(slot()));
    act(() => { vi.advanceTimersByTime(150); });
    expect(byTestId(renderer, "details-floating")).not.toBeNull();
    expect(byTestId(renderer, "zoom-probe")!.props.children).toBe("15");
    expect(byTestId(renderer, "details-body")!.props.onTouchStart).toBeDefined();
    expect(getEnhancerPreferences().detailsFontSize).toBe(15);
  });
});
