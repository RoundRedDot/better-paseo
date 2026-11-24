/**
 * An opened work step pins its row under the details toolbar while its
 * output scrolls past, until the step ends.
 *
 * The host's sticky header follows the timeline, not the details panel, and
 * a released Paseo has none, so the panel's body drives this itself. On a
 * phone the row moves down by a transform on the native driver (no frame
 * waits for JS), clamped to the step: at rest it is 0, pinned it is the
 * scroll past the step's top, and at the step's end its bottom meets the end,
 * so the next step pushes it out. On the web the browser pins it
 * (`position: sticky`), held to the step's box the same way; the body is its
 * nearest scroller (`HoverPreviewBody`'s `stickySteps`). Either way the row
 * stays in the step's own view.
 *
 * Only the work steps list opts in (`StickyStepContext`); elsewhere in the
 * panel an opened row scrolls as before.
 */
import { createContext, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Animated, Platform, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { space } from "../components/theme-tokens";
import { hairline } from "../ui/tokens/platform";

/** The details body's scroll, as an opened step reads it. */
export interface DetailsStickySource {
  /** The body's offset: on a phone on the native driver, on the web set from its scroll events. */
  scrollY: Animated.Value;
  /** Calls `done` with the top of `node` in the scroll content's coordinates. */
  locate(node: unknown, done: (top: number) => void): void;
  /** The body's offset as JS last saw it. */
  offset(): number;
  scrollTo(top: number): void;
  /** Called when the phone body or its content changes size, and as the web body scrolls. */
  subscribe(listener: () => void): () => void;
}

export const DetailsStickySourceContext = createContext<DetailsStickySource | null>(null);

/** Set by the work steps list around each step: the step's stripe, drawn behind its pinned row. */
export const StickyStepContext = createContext<{ stripe?: string } | null>(null);

export interface StickyGeometry {
  /** The step's top in the content. */
  top: number;
  /** The step's height, row included. */
  height: number;
  /** The row's height. */
  header: number;
}

/**
 * How far the row may travel: from the step's top to the row's bottom
 * meeting the step's end. Any opened step pins, however short its output.
 */
export function stickyTravel(geometry: StickyGeometry | null): number {
  if (!geometry) return 0;
  return Math.max(0, geometry.height - geometry.header);
}

/** The row's offset for a body scrolled to `offset`, as the interpolation computes it. */
export function stickyOffset(offset: number, geometry: StickyGeometry | null): number {
  const travel = stickyTravel(geometry);
  if (!geometry || travel <= 0) return 0;
  return Math.min(travel, Math.max(0, offset - geometry.top));
}

/**
 * Whether the row is pinned under the toolbar now: the body has scrolled
 * past the step's top but not past the point where the step's end pushes the
 * row out. A step scrolled wholly above the body is not pinned.
 */
export function pinnedAt(offset: number, geometry: StickyGeometry | null): boolean {
  const travel = stickyTravel(geometry);
  if (!geometry || travel <= 0) return false;
  return offset > geometry.top + 0.5 && offset < geometry.top + travel - 0.5;
}

/** What the opened row's own toggle tells its step. */
export interface StickyStepHandle {
  /**
   * The reader is closing the step. Pinned, the row's place would scroll far
   * above the body as the output goes, so the body first scrolls to the row.
   */
  collapsing(): void;
}

export function DetailsStickyCard({ source, tokens, stripe, header, handle, children }: {
  source: DetailsStickySource;
  handle?: Ref<StickyStepHandle>;
  tokens: ExtendedThemeTokens;
  stripe?: string;
  header: ReactNode;
  children: ReactNode;
}) {
  const card = useRef<View>(null);
  const height = useRef(0);
  const headerHeight = useRef(0);
  const [geometry, setGeometry] = useState<StickyGeometry | null>(null);
  const latest = useRef(geometry);
  latest.current = geometry;

  const settle = useCallback((top: number) => {
    const next = { top, height: height.current, header: headerHeight.current };
    if (next.height <= 0 || next.header <= 0 || !Number.isFinite(top)) return;
    const prev = latest.current;
    if (prev && Math.abs(prev.top - next.top) < 0.5 && Math.abs(prev.height - next.height) < 0.5
      && Math.abs(prev.header - next.header) < 0.5) return;
    // Read at once by the web fill, in the same scroll event.
    latest.current = next;
    setGeometry(next);
  }, []);
  const relocate = useCallback(() => {
    const node = card.current;
    if (node) source.locate(node, settle);
  }, [source, settle]);
  useEffect(() => source.subscribe(relocate), [source, relocate]);
  // The web does not move the row by `scrollY`: React Native Web's Animated
  // applies a value through a React render that lands after the frame has
  // painted, and even a scroll event's own write trails the compositor, which
  // draws a fast scroll ahead of the page. The row trailed each scroll and,
  // scrolled fast, left the body's top. The browser pins it instead
  // (`position: sticky`), held to the step by its own box. Only the fill
  // follows the scroll event: it changes as the row starts or stops pinning.
  const web = Platform.OS === "web";
  const fillNode = useRef<View>(null);
  const showFill = useCallback(() => {
    const fill = fillNode.current as unknown as { style?: CSSStyleDeclaration } | null;
    if (fill?.style) fill.style.opacity = String(Math.min(1, stickyOffset(source.offset(), latest.current)));
  }, [source]);
  // After `relocate`: a scroll that moved the step's top is read from the new top.
  useEffect(() => (web ? source.subscribe(showFill) : undefined), [web, source, showFill]);
  useLayoutEffect(() => { if (web) showFill(); }, [web, showFill, geometry]);
  // Only the reader closing a pinned row moves the body: unmounting for any
  // other reason (another block, the panel closing) leaves its scroll alone.
  // The rows above do not change, so the row's top stays valid once the
  // output has gone.
  useImperativeHandle(handle, () => ({
    collapsing() {
      const last = latest.current;
      if (last && pinnedAt(source.offset(), last)) source.scrollTo(last.top);
    },
  }), [source]);

  const onCardLayout = useCallback((event: LayoutChangeEvent) => {
    height.current = event.nativeEvent.layout.height;
    relocate();
  }, [relocate]);
  const onHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    headerHeight.current = event.nativeEvent.layout.height;
    relocate();
  }, [relocate]);

  const travel = stickyTravel(geometry);
  const top = geometry?.top ?? 0;
  // Always an animated node: under Fabric a view whose animated transform is
  // swapped for a static one keeps its last position.
  const translateY = useMemo(() => source.scrollY.interpolate(travel > 0
    ? { inputRange: [top, top + travel], outputRange: [0, travel], extrapolate: "clamp" }
    : { inputRange: [0, 1], outputRange: [0, 0], extrapolate: "clamp" }), [source, top, travel]);
  // The fill and the rule come with the first point of travel: at rest the row looks as before.
  const pinned = useMemo(() => translateY.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }), [translateY]);
  // The web's fill is left to `showFill`: a style React never changes is not written back.
  const rowMotion = web ? styles.webSticky : { transform: [{ translateY }] };
  const fillMotion = web ? styles.fillAtRest : { opacity: pinned };

  return (
    <View ref={card} testID="work-step-sticky" collapsable={false} onLayout={onCardLayout}>
      <Animated.View testID="work-step-sticky-row" onLayout={onHeaderLayout}
        style={[styles.header, rowMotion]}>
        <Animated.View ref={fillNode} pointerEvents="none" testID="work-step-sticky-fill"
          style={[styles.fill, { backgroundColor: tokens.surface0 }, fillMotion]}>
          {stripe ? <View style={[StyleSheet.absoluteFill, { backgroundColor: stripe }]} /> : null}
          <View style={[styles.rule, hairline(tokens.platform, "bottom"), { backgroundColor: tokens.v2.border }]} />
        </Animated.View>
        {header}
      </Animated.View>
      <StickyStepContext.Provider value={null}>{children}</StickyStepContext.Provider>
    </View>
  );
}

/**
 * The phone body's side: its offset on the native driver, positions measured
 * against its content view, and the sizes it reports.
 */
export function createNativeStickySource(scroller: {
  content(): unknown;
  offset(): number;
  scrollTo(top: number): void;
}): DetailsStickySource & { laidOut(height: number): void; changed(): void } {
  const listeners = new Set<() => void>();
  let viewport = 0;
  const changed = () => Array.from(listeners).forEach((listener) => listener());
  return {
    scrollY: new Animated.Value(0),
    locate(node, done) {
      const content = scroller.content();
      const target = node as { measureLayout?(relative: unknown, success: (x: number, y: number) => void, fail?: () => void): void } | null;
      if (!content || !target?.measureLayout) return;
      target.measureLayout(content, (_x, y) => done(y), () => {});
    },
    offset: () => scroller.offset(),
    scrollTo: (top) => scroller.scrollTo(top),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    laidOut(height) {
      if (height === viewport) return;
      viewport = height;
      changed();
    },
    changed,
  };
}

/** The web body's side: a DOM element that scrolls; positions read from its boxes. */
export function createWebStickySource(element: () => HTMLElement | null): DetailsStickySource & { bind(): () => void } {
  const listeners = new Set<() => void>();
  const scrollY = new Animated.Value(0);
  const changed = () => Array.from(listeners).forEach((listener) => listener());
  return {
    scrollY,
    locate(node, done) {
      const body = element();
      const target = node as HTMLElement | null;
      if (!body || !target?.getBoundingClientRect) return;
      done(target.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientTop + body.scrollTop);
    },
    offset: () => element()?.scrollTop ?? 0,
    scrollTo(top) {
      const body = element();
      if (body) body.scrollTop = top;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    bind() {
      const body = element();
      if (!body?.addEventListener) return () => {};
      const onScroll = () => {
        scrollY.setValue(body.scrollTop);
        changed();
      };
      // A step's own size comes from its layout; what sits above a pinned
      // step is out of view and cannot change without a scroll first.
      body.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return () => body.removeEventListener("scroll", onScroll);
    },
  };
}

const styles = StyleSheet.create({
  // Over the output that scrolls under it.
  header: { zIndex: 1 },
  // As wide as the step's stripe: the cell pads its content by `space.md`.
  fill: { position: "absolute", top: 0, bottom: 0, left: -space.md, right: -space.md },
  rule: { position: "absolute", left: 0, right: 0, bottom: 0 },
  fillAtRest: { opacity: 0 },
  // Web only: pinned to the nearest scroller's top, which is the details body.
  webSticky: { position: "sticky", top: 0 } as unknown as ViewStyle,
});
