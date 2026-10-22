/**
 * The block details panel (docs/prototypes/block-details-sheet.md): the open
 * block's preview drawn as a bottom drawer (phone), a floating bottom panel
 * (tablet) or a right-hand side panel (wide windows), chosen by the window.
 *
 * The content is the same tree the hover preview draws, the row's own
 * `render()`, here inside the details chrome (`PreviewChromeContext`), with
 * the shell's window actions, line wrap and remount memory
 * (`PreviewActionsContext`), and the header's controls (`DetailsShellContext`).
 *
 * iOS and Android draw every form inside React Native's own `Modal`, the only
 * layer a plugin can raise above the timeline; web draws a non-modal popover
 * over the window (`web-layer.ts`).
 *
 * A form change keeps the block, its scroll and its wrap: the old form fades
 * out over 120 ms and the new one in over 160 ms. A lease handover (the row
 * drawing the shell scrolled out of the list) brings the panel back as it
 * was, without an entrance.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Modal, Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import type { ExtendedThemeTokens } from "../../components/theme-tokens";
import { DetailsShellContext, type BlockEntry, type Detent, type DetailsForm, type DetailsShellValue, type DetailsZoom } from "../contracts";
import { useBlock, useBlockList } from "../block-registry";
import { detailsApi, useDetails } from "../details-store";
import { floatingWidth } from "../layout-model";
import { swipeDecision } from "../gesture-model";
import { HoverPreviewContext, PreviewActionsContext, PreviewChromeContext, usePanelWrap, type PreviewActions } from "../../ui/hover-preview";
import { PathContext, usePathContextValue } from "../../ui/path-text";
import { TimelineProseContext } from "../../components/markdown/markdown-view";
import { TextZoomContext } from "../../ui/text-zoom";
import { updateEnhancerPreferences, useEnhancerPreferences } from "../../preferences";
import { forgetPreview, holdPreview, recallPreview, rememberPreview, PREVIEW_HANDOVER_MS, type PreviewMemory } from "../../ui/preview-memory";
import { useInputCapabilities } from "../../ui/use-input-capabilities";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { holdHostGestures } from "../../ui/hold-host-gestures";
import { useListScrollLock } from "../../ui/scroll-anchor";
import { revealPathRpc } from "../../../shared/file-rpc";
import { DETAILS_MOTION, animate } from "./motion";
import { OVERDRAG, panelResponder, type DragTarget } from "./gestures";
import { useSafeInsets } from "./safe-area";
import { useDetailsLayout } from "./use-details-layout";
import { bindDetailsLayer, layerTakesKey, webBodyAtTop } from "./web-layer";
import { bindDetailsKeys, registerDetailsKeyboardActions } from "../keyboard";
import { useCopy } from "../../ui/use-copy";
import { canProbeOlder, noteNavigation, stepDetails, syncTimeline, useHostList } from "./timeline-sync";
import { DetailsBodyContext, createBodyScroll } from "./body-handover";
import { BottomDrawer } from "./bottom-drawer";
import { FloatingPanel } from "./floating-panel";
import { SidePanel, sideWidth } from "./side-panel";
import type { Entrance } from "./bottom-panel";

/** Where the open block sits among the navigable blocks: 1-based, 0 when it is not one. */
export function navigationOf(list: readonly BlockEntry[], id: string): { index: number; count: number; first: string | null } {
  const navigable = list.filter((entry) => entry.navigable && entry.hasBody);
  const at = navigable.findIndex((entry) => entry.id === id);
  return { index: at + 1, count: navigable.length, first: navigable[0]?.id ?? null };
}

// The block each agent's shell draws, and until when a handover may take it over without an entrance.
const shown = new Map<string, { id: string; until: number | null }>();

function takesOver(agentId: string, id: string): boolean {
  const last = shown.get(agentId);
  return Boolean(last && last.id === id && (last.until === null || Date.now() <= last.until));
}

// The open panel's ‹ › with their slide, per agent, for keys and other callers.
const steppers = new Map<string, (direction: -1 | 1) => void>();

/**
 * Steps the agent's open panel to the previous or next block, with the
 * panel's slide when one is drawn (web keys, slice E). Without a drawn panel
 * it steps the store, probing for older rows at the oldest known block.
 */
export function stepOpenDetails(agentId: string, direction: -1 | 1): void {
  const step = steppers.get(agentId);
  if (step) step(direction);
  else void stepDetails(agentId, direction);
}

/** Draws the agent's open block, and plays the panel out after it closes. */
export function DetailsShell({ agentId, tokens }: { agentId: string; tokens: ExtendedThemeTokens }) {
  const state = useDetails(agentId);
  // The block drawn while the exit plays, after the store has let go of it.
  const [lastId, setLastId] = useState<string | null>(state.openId);
  if (state.openId !== null && state.openId !== lastId) setLastId(state.openId);
  const shownId = state.openId ?? lastId;
  const entry = useBlock(agentId, shownId);
  const onExited = useCallback(() => {
    shown.delete(agentId);
    setLastId(null);
  }, [agentId]);
  if (!shownId || !entry) return null;
  return <OpenShell agentId={agentId} tokens={tokens} entry={entry} openId={state.openId} detent={state.detent} fullscreen={state.fullscreen} storeForm={state.form} onExited={onExited} />;
}

function OpenShell({ agentId, tokens, entry, openId, detent, fullscreen, storeForm, onExited }: {
  agentId: string;
  tokens: ExtendedThemeTokens;
  entry: BlockEntry;
  /** The store's open block; null once closed, while the exit plays. */
  openId: string | null;
  detent: Detent;
  fullscreen: boolean;
  storeForm: DetailsForm;
  onExited(): void;
}) {
  const leaving = openId === null;
  const capabilities = useInputCapabilities();
  const pointer = capabilities.hover;
  const reduced = useReducedMotion();
  const layerRef = useRef<View>(null);
  const anchor = useCallback(() => layerRef.current, []);
  const layout = useDetailsLayout(pointer, anchor);
  const [insets, insetProbe] = useSafeInsets();
  useHostList(agentId, anchor);
  const lockList = useListScrollLock();
  const revealPath = useRpc(revealPathRpc);
  const cwd = useRef<string | undefined>(undefined);
  const reveal = useCallback((path: string) => {
    void revealPath({ cwd: cwd.current ?? "", path }).catch(() => {});
  }, [revealPath]);
  const paths = usePathContextValue(agentId, reveal);
  cwd.current = paths.cwd;

  // A handover takes the panel over as the last holder left it: no entrance, the same scroll and wrap.
  const [quiet] = useState(() => takesOver(agentId, entry.id));
  const [remembered, setRemembered] = useState<{ id: string; memory: PreviewMemory | null }>(() => ({
    id: entry.id, memory: quiet ? recallPreview(entry.id) : null,
  }));
  const memory = remembered.id === entry.id ? remembered.memory : null;
  const [wrapOn, toggleWrap] = usePanelWrap(memory?.wrap ?? null);
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  useEffect(() => {
    const id = entry.id;
    shown.set(agentId, { id, until: null });
    const release = holdPreview(id);
    return () => {
      release();
      // Stepped away or closed: nothing to take over. Unmounted while open: a handover may.
      if (openIdRef.current !== id) forgetPreview(id);
      else if (shown.get(agentId)?.id === id) shown.set(agentId, { id, until: Date.now() + PREVIEW_HANDOVER_MS });
    };
  }, [agentId, entry.id]);
  useEffect(() => {
    rememberPreview(entry.id, { wrap: wrapOn });
  }, [entry.id, wrapOn]);

  // The form drawn, which trails the layout's by the form change's fade.
  const [form, setForm] = useState<DetailsForm>(layout.form);
  const [entrance, setEntrance] = useState<Entrance>(quiet ? "none" : "slide");
  const formFade = useRef(new Animated.Value(1)).current;
  const panelTop = useRef<number | null>(null);
  const latest = useRef({ entry, detent, fullscreen, reduced, form, leaving });
  latest.current = { entry, detent, fullscreen, reduced, form, leaving };
  useEffect(() => {
    if (layout.form === form) return;
    const next = layout.form;
    const animation = animate(formFade, 0, latest.current.reduced ? DETAILS_MOTION.reducedMs : DETAILS_MOTION.formOutMs, () => {
      const now = latest.current;
      // Full screen does not carry into or out of the side panel: it opens at its initial size.
      if (next === "side" || now.form === "side") {
        if (now.detent === "full") detailsApi.setDetent(agentId, "fit");
        if (now.fullscreen) detailsApi.setFullscreen(agentId, false);
      }
      setRemembered({ id: now.entry.id, memory: recallPreview(now.entry.id) });
      panelTop.current = null;
      setEntrance("fade");
      formFade.setValue(1);
      setForm(next);
    });
    return () => animation.stop();
  }, [agentId, layout.form, form, formFade]);
  useEffect(() => {
    if (storeForm !== form) detailsApi.setForm(agentId, form);
  }, [agentId, storeForm, form]);

  const close = useCallback(() => detailsApi.close(agentId), [agentId]);

  // ‹ › and the header swipe.
  const list = useBlockList(agentId);
  const nav = useMemo(() => navigationOf(list, entry.id), [list, entry.id]);
  useEffect(() => {
    noteNavigation(agentId, nav.first, openId);
  }, [agentId, nav.first, openId]);
  const canStep = useMemo(() => ({
    previous: nav.index > 1 || (nav.index === 1 && canProbeOlder(agentId, entry.id)),
    next: nav.index > 0 && nav.index < nav.count,
  }), [agentId, entry.id, nav.index, nav.count]);
  const slide = useRef(new Animated.Value(0)).current;
  const slideOpacity = useRef(new Animated.Value(1)).current;
  const panelWidth = form === "side" ? sideWidth(layout.stage, fullscreen)
    : form === "floating" ? floatingWidth(layout.stage.width)
      : layout.stage.width;
  const navRef = useRef({ nav, canStep, panelWidth });
  navRef.current = { nav, canStep, panelWidth };
  const slideTo = useCallback((direction: -1 | 1) => {
    const still = latest.current.reduced;
    const half = still ? DETAILS_MOTION.reducedMs / 2 : DETAILS_MOTION.swipeOutMs;
    if (!still) animate(slide, -direction * navRef.current.panelWidth * DETAILS_MOTION.swipeOut, half);
    animate(slideOpacity, 0, half, () => {
      void stepDetails(agentId, direction);
      const rest = still ? DETAILS_MOTION.reducedMs / 2 : DETAILS_MOTION.swipeMs - DETAILS_MOTION.swipeOutMs;
      slide.setValue(still ? 0 : direction * DETAILS_MOTION.swipeShift);
      animate(slide, 0, rest);
      animate(slideOpacity, 1, rest);
    });
  }, [agentId, slide, slideOpacity]);
  const step = useCallback((direction: -1 | 1) => {
    const { nav: now, canStep: can } = navRef.current;
    if (!(direction === 1 ? can.next : can.previous)) return;
    // The oldest known block: the probe scrolls for older rows, and the step lands when one mounts.
    if (direction === -1 && now.index === 1) {
      void stepDetails(agentId, -1);
      return;
    }
    slideTo(direction);
  }, [agentId, slideTo]);
  useEffect(() => {
    steppers.set(agentId, step);
    return () => {
      if (steppers.get(agentId) === step) steppers.delete(agentId);
    };
  }, [agentId, step]);
  const swipe = useMemo<DragTarget>(() => {
    const has = (travel: number) => (travel < 0 ? navRef.current.canStep.next : navRef.current.canStep.previous);
    const back = () => animate(slide, 0, DETAILS_MOTION.swipeMs);
    return {
      begin() {},
      move(travel) {
        if (latest.current.reduced) return;
        slide.setValue(has(travel) ? travel : travel * OVERDRAG);
      },
      end(travel, velocity) {
        const direction = swipeDecision(travel, velocity, navRef.current.panelWidth, has(travel));
        if (direction === 0) {
          back();
          return;
        }
        if (direction === -1 && navRef.current.nav.index === 1) {
          back();
          void stepDetails(agentId, -1);
          return;
        }
        slideTo(direction);
      },
      cancel: back,
    };
  }, [agentId, slide, slideTo]);

  // The vertical drag of a drawer or floating panel, which its frame fills.
  const dragRef = useRef<DragTarget | null>(null);
  const hold = useCallback(() => {
    const release = holdHostGestures(layerRef.current);
    lockList(true);
    return () => {
      release();
      lockList(false);
    };
  }, [lockList]);
  // Taken as the touch starts where no button inside takes it: the Modal's
  // root would take it otherwise, and never offer its moves to the header.
  const headerPan = useMemo(() => panelResponder({
    vertical: () => (latest.current.form === "side" ? null : dragRef.current),
    horizontal: () => swipe,
    hold,
    claimAtStart: () => Platform.OS !== "web",
  }), [swipe, hold]);
  const touch = capabilities.touch;

  const setDetent = useCallback((next: Detent) => {
    detailsApi.setDetent(agentId, next);
    detailsApi.setFullscreen(agentId, next === "full");
  }, [agentId]);
  // Every block can go full screen, short ones too; the side panel widens instead.
  const toggleFullscreen = useCallback(() => {
    const now = latest.current;
    if (now.form === "side") detailsApi.setFullscreen(agentId, !now.fullscreen);
    else setDetent(now.detent === "full" ? "fit" : "full");
  }, [agentId, setDetent]);
  const fullscreenOn = form === "side" ? fullscreen : detent === "full";

  // The timeline follows: on open and on each switch, once the panel's top is known.
  const pendingSync = useRef(true);
  const runSync = useCallback(() => {
    pendingSync.current = false;
    const target = latest.current.entry;
    if (!target.mounted || !target.measure) return;
    void target.measure().then((rect) => {
      const now = latest.current;
      if (!rect || now.entry.id !== target.id || now.leaving) return;
      void syncTimeline(agentId, rect, now.form === "side" ? null : panelTop.current, now.reduced);
    }).catch(() => {});
  }, [agentId]);
  useEffect(() => {
    if (leaving) return;
    if (latest.current.form === "side" || panelTop.current !== null) runSync();
    else pendingSync.current = true;
  }, [entry.id, leaving, runSync]);
  const onTop = useCallback((top: number) => {
    panelTop.current = top;
    if (pendingSync.current) runSync();
  }, [runSync]);

  const bodyScroll = useMemo(() => createBodyScroll(), []);

  // The phone drawer's text zoom: drawn live while a pinch moves, saved as it ends.
  const { detailsTextZoom } = useEnhancerPreferences();
  const [liveZoom, setLiveZoom] = useState<number | null>(null);
  const zooms = form === "drawer" && Platform.OS !== "web";
  const textZoom = zooms ? liveZoom ?? detailsTextZoom : 0;
  const zoomRef = useRef(textZoom);
  zoomRef.current = textZoom;
  const contentSize = tokens.typography.content.size;
  const codeSize = tokens.typography.mono.size;
  const zoom = useMemo<DetailsZoom | undefined>(() => (zooms ? {
    base: contentSize,
    code: codeSize,
    current: () => zoomRef.current,
    preview: setLiveZoom,
    commit(next) {
      updateEnhancerPreferences({ detailsTextZoom: next });
      setLiveZoom(null);
    },
  } : undefined), [zooms, contentSize, codeSize]);

  // Web keys while the panel is open (`keyboard.ts`): only this lease holder's
  // layer, and only while its pane is shown. ← → take the panel's own step.
  const { copy } = useCopy();
  const keys = useRef({ step, toggleWrap, toggleFullscreen, copy });
  keys.current = { step, toggleWrap, toggleFullscreen, copy };
  useEffect(() => {
    if (Platform.OS !== "web" || leaving) return;
    const unregister = registerDetailsKeyboardActions(agentId, {
      step: (direction) => keys.current.step(direction),
      toggleWrap: () => keys.current.toggleWrap(),
      toggleFullscreen: () => keys.current.toggleFullscreen(),
      copyPrimary: () => {
        const primary = latest.current.entry.copies()[0];
        if (primary?.text) void keys.current.copy(primary.text, { label: primary.label });
      },
    });
    const unbind = bindDetailsKeys(agentId, (event) => layerTakesKey(layerRef.current, event));
    return () => {
      unbind();
      unregister();
    };
  }, [agentId, leaving]);
  const bodyAtTop = useCallback(() => (Platform.OS === "web" ? webBodyAtTop(layerRef.current) : bodyScroll.atTop()), [bodyScroll]);

  const shellValue = useMemo<DetailsShellValue>(() => ({
    agentId,
    entry,
    form,
    detent,
    fullscreen: fullscreenOn,
    pointer,
    index: nav.index,
    count: nav.count,
    canStep,
    step,
    close,
    toggleFullscreen,
    headerHandlers: touch ? (headerPan.panHandlers as unknown as Record<string, unknown>) : undefined,
    zoom,
  }), [agentId, entry, form, detent, fullscreenOn, pointer, nav.index, nav.count, canStep, step, close, toggleFullscreen, touch, headerPan, zoom]);
  const actions = useMemo<PreviewActions>(() => ({
    maximizable: true,
    maximized: fullscreenOn,
    maximize: toggleFullscreen,
    close,
    popped: false,
    memoryKey: entry.id,
    remembered: memory,
    fill: true,
    wrap: { on: wrapOn, toggle: toggleWrap, tokens },
  }), [toggleFullscreen, fullscreenOn, close, entry.id, memory, wrapOn, toggleWrap, tokens]);

  const content = (
    <DetailsShellContext.Provider value={shellValue}>
      <PreviewChromeContext.Provider value="details">
        <HoverPreviewContext.Provider value>
          <PathContext.Provider value={paths}>
            <PreviewActionsContext.Provider value={actions}>
              <DetailsBodyContext.Provider value={bodyScroll}>
                <TimelineProseContext.Provider value={form === "drawer"}>
                  <TextZoomContext.Provider value={textZoom}>
                    <Animated.View testID="details-content" style={[styles.content, { opacity: slideOpacity, transform: [{ translateX: slide }] }] as never}>
                      {entry.render()}
                    </Animated.View>
                  </TextZoomContext.Provider>
                </TimelineProseContext.Provider>
              </DetailsBodyContext.Provider>
            </PreviewActionsContext.Provider>
          </PathContext.Provider>
        </HoverPreviewContext.Provider>
      </PreviewChromeContext.Provider>
    </DetailsShellContext.Provider>
  );

  const frame = insets === null ? null : form === "side" ? (
    <SidePanel
      key="side"
      tokens={tokens}
      stage={layout.stage}
      insets={insets}
      reduced={reduced}
      entrance={entrance}
      leaving={leaving}
      onExited={onExited}
      wide={fullscreen}
      resizable={pointer && Platform.OS === "web"}
      onOutside={close}
    >
      {content}
    </SidePanel>
  ) : React.createElement(form === "drawer" ? BottomDrawer : FloatingPanel, {
    key: form,
    blockId: entry.id,
    body: bodyScroll,
    tokens,
    stage: layout.stage,
    insets,
    detent,
    reduced,
    entrance,
    leaving,
    onExited,
    onDetent: setDetent,
    onClose: close,
    onTop,
    dragRef,
    hold,
    bodyAtTop,
    onOutside: close,
    children: content,
  });

  const stage = (
    <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { opacity: formFade }] as never}>
      {frame}
    </Animated.View>
  );
  if (Platform.OS === "web") {
    return <WebLayer layerRef={layerRef} catches={form === "drawer"}>{stage}</WebLayer>;
  }
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <View ref={layerRef} testID="details-layer" pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {insetProbe}
        {stage}
      </View>
    </Modal>
  );
}

/**
 * The web layer: raised to the top layer over the window on mount. It lets
 * the pointer through outside the panel, except for the drawer's scrim.
 */
function WebLayer({ layerRef, catches, children }: {
  layerRef: React.RefObject<View | null>;
  catches: boolean;
  children: React.ReactNode;
}) {
  useLayoutEffect(() => bindDetailsLayer(layerRef.current), [layerRef]);
  return (
    <View ref={layerRef} testID="details-layer" pointerEvents={catches ? "auto" : "box-none"} style={styles.webLayer}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, flexShrink: 1, minHeight: 0 },
  // The popover's own UA box (margin, border, padding, background) cleared, over the whole window.
  webLayer: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    maxWidth: "none",
    maxHeight: "none",
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    overflow: "hidden",
  } as unknown as ViewStyle,
});
