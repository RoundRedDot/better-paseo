import React, { createElement, useContext } from "react";
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
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { resetSafeInsets } from "../../client/details/shell/safe-area";
import { resetSideWidth } from "../../client/details/shell/side-panel";
import { registerHostList, resetTimelineSync, syncDelta } from "../../client/details/shell/timeline-sync";
import { hasActiveDetailsKeyboard } from "../../client/details/keyboard";
import { useDetailsBodyScroll, type DetailsBodyReport } from "../../client/details/shell/body-handover";

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
    render: () => createElement(Probe, { id }),
    copies: () => [{ id: "copy", label: "Copy output", icon: "Copy", text: `text of ${id}` }],
    ...patch,
  };
}

// Web: every host node is this element; the layer binds Escape on its window.
const web = {
  keydown: [] as ((event: unknown) => void)[],
  openPreviews: [] as unknown[],
  hidden: false,
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
  it("opens at the content's height when it fits, with no full detent", () => {
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 266);
    const style = flat(byTestId(renderer, "details-drawer")!.props.style);
    expect(style.maxHeight).toBe(462);
    expect(style.height).toBeUndefined();
    expect(seen.shell!.toggleFullscreen).toBeUndefined();
    expect(seen.actions!.maximizable).toBe(false);
  });

  it("offers full once the content passes 0.58 of the height, and goes there", () => {
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

  it("has the handle's tap switch between fit and full", () => {
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 462);
    act(() => byTestId(renderer, "details-handle")!.props.onPress());
    expect(fake.api.setDetent).toHaveBeenLastCalledWith(AGENT, "full");
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

  it("stays at fit with no full detent, whatever the pull up", () => {
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-drawer", 266);
    dragHeader(-120, -1);
    expect(fake.api.setDetent).not.toHaveBeenCalled();
    expect(fake.box.state.detent).toBe("fit");
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

describe("floating panel", () => {
  // 1194 tall, insets 47 / 34, 12 above the bottom: 1101 available, a fit cap of 551, full at 1077.
  it("opens at min(content, 0.5 × available) and goes full at available − 24", () => {
    screen.width = 834;
    screen.height = 1194;
    const renderer = render(slot());
    open("a");
    layOut(renderer, "details-floating", 300);
    expect(flat(byTestId(renderer, "details-floating")!.props.style).maxHeight).toBe(551);
    expect(seen.shell!.toggleFullscreen).toBeUndefined();
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
    const panel = byTestId(renderer, "details-drawer")!.props as Record<string, (...args: unknown[]) => unknown>;
    const pull = () => {
      panel.onStartShouldSetPanResponderCapture!(event(100, 400));
      return panel.onMoveShouldSetPanResponderCapture!(event(100, 440));
    };
    act(() => seen.body!.scrolled(120));
    expect(pull()).toBe(false);
    act(() => seen.body!.scrolled(0));
    expect(pull()).toBe(true);
    // Upwards it stays the body's scroll.
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
