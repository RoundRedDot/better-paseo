import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Modal,
  View,
  Pressable,
  Image,
  StyleSheet,
  Platform,
  PanResponder,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from "react-native";
import { Glyph } from "./glyph";
import { SafeInset } from "../ui/safe-inset";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import {
  FIT_TRANSFORM,
  fitContentSize,
  isPointInsideTransformedContent,
  panContent,
  zoomContentAtPoint,
  type ViewportPoint,
  type ViewportSize,
  type ViewportTransform,
} from "./zoom-geometry";

interface ImageViewerProps {
  open: boolean;
  onClose: () => void;
  uri: string;
  /** The file's own pixel size; null when the header could not be read. */
  width: number | null;
  height: number | null;
  label: string;
  tokens: ExtendedThemeTokens;
  /** Shows the file in the machine's own file manager. */
  onReveal?: () => void;
}

const IS_WEB = Platform.OS === "web";
/** Room left around the fitted picture so the backdrop stays a target to press. */
const GUTTER = 32;
// The host lightbox's range and step: a quarter of the fit up to eight times it.
const LIMITS = { minScale: 0.25, maxScale: 8 };
const ZOOM_STEP = 1.25;
const DOUBLE_TAP_MS = 300;
/** Movement under this many points is a press, not a drag. */
const TAP_SLOP = 4;
/** A drag at the fit this far, or this fast, closes the viewer. */
const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.8;
const BUTTON_SIZE = IS_WEB ? 24 : 32;
const GLYPH_SIZE = IS_WEB ? 14 : 18;

/**
 * The image at the size of the window, with the host lightbox's controls.
 *
 * A bare React Native modal rather than the host's: the host modal is a titled
 * sheet with padding, and a picture wants the whole screen. The host's own
 * lightbox is not exported to plugins, so this mirrors it: zoom in, zoom out
 * and reset in the corner beside close, the wheel (or a trackpad pinch) zooms
 * about the cursor, a drag pans a zoomed picture, two fingers pinch, and a
 * double press resets. The picture fits the window without growing past its
 * own pixels. A press on the backdrop, the close mark, a drag down (or up)
 * on the picture at its fit, Escape on web and the Android back button close
 * it.
 *
 * The stage sits inside the screen's safe area, so on a phone the picture and
 * the toolbar stay clear of the status bar and the Dynamic Island, whose
 * strip would otherwise sit over the close mark and swallow its presses.
 */
export function ImageViewer(props: ImageViewerProps) {
  return (
    <Modal
      visible={props.open}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
      statusBarTranslucent
    >
      {/* Mounted only while open, so every opening starts from the fit. */}
      {props.open ? <ViewerBody {...props} /> : null}
    </Modal>
  );
}

type Gesture =
  | {
      type: "drag";
      start: ViewportPoint;
      startTransform: ViewportTransform;
      moved: boolean;
      /** A vertical drag of the picture at its fit: it follows the finger and may close. */
      dismissing: boolean;
    }
  | { type: "pinch"; distance: number; midpoint: ViewportPoint };

/** Points relative to the canvas. The picture ignores touches, so the canvas is always the target. */
type Pair = [ViewportPoint, ViewportPoint];

function touchPoints(event: GestureResponderEvent): [ViewportPoint] | Pair {
  const { touches, locationX, locationY } = event.nativeEvent;
  const [a, b] = touches ?? [];
  if (a && b) return [{ x: a.locationX, y: a.locationY }, { x: b.locationX, y: b.locationY }];
  return [{ x: locationX, y: locationY }];
}

function midpoint([a, b]: Pair): ViewportPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance([a, b]: Pair): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ViewerBody({ onClose, uri, width, height, label, tokens, onReveal }: ImageViewerProps) {
  const [natural, setNatural] = useState<ViewportSize | null>(
    width && height ? { width, height } : null,
  );
  const [viewport, setViewport] = useState<ViewportSize | null>(null);
  const [transform, setTransform] = useState<ViewportTransform>(FIT_TRANSFORM);
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef<View>(null);
  // How far a dismissing drag has carried the picture; the backdrop fades with it.
  const dismissOffset = useRef(new Animated.Value(0)).current;

  // A header that gave no size still leaves the decoded image to ask.
  useEffect(() => {
    if (natural) return;
    let live = true;
    Image.getSize(
      uri,
      (w, h) => {
        if (live && w > 0 && h > 0) setNatural({ width: w, height: h });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [natural, uri]);

  const fitted = useMemo(
    () => (natural && viewport ? fitContentSize(natural, viewport, { padding: GUTTER, upscale: false }) : null),
    [natural, viewport],
  );

  // The responder and the wheel listener are made once; they read the
  // current geometry through this ref rather than a stale closure.
  const live = useRef({ transform, fitted, viewport, onClose });
  live.current = { transform: live.current.transform, fitted, viewport, onClose };

  const commit = useCallback((next: ViewportTransform) => {
    live.current.transform = next;
    setTransform(next);
  }, []);
  const reset = useCallback(() => commit(FIT_TRANSFORM), [commit]);

  useEffect(() => reset(), [fitted, reset]);

  const zoomAt = useCallback(
    (scale: number, focalPoint: ViewportPoint) => {
      const { transform: current, fitted: content, viewport: room } = live.current;
      if (!content || !room) return;
      commit(
        zoomContentAtPoint({
          transform: current,
          scale,
          focalPoint,
          fittedContent: content,
          viewport: room,
          limits: LIMITS,
        }),
      );
    },
    [commit],
  );
  const zoomFromCenter = useCallback(
    (factor: number) => {
      const room = live.current.viewport;
      if (room) zoomAt(live.current.transform.scale * factor, { x: room.width / 2, y: room.height / 2 });
    },
    [zoomAt],
  );

  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef(0);

  const responder = useMemo(() => {
    const press = (point: ViewportPoint) => {
      const { transform: current, fitted: content, viewport: room } = live.current;
      if (!content || !room) return;
      const inside = isPointInsideTransformedContent({
        point,
        transform: current,
        fittedContent: content,
        viewport: room,
      });
      if (!inside) {
        live.current.onClose();
        return;
      }
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0;
        reset();
      } else {
        lastTap.current = now;
      }
    };

    const startDrag = (point: ViewportPoint, moved: boolean) => {
      gesture.current = {
        type: "drag",
        start: point,
        startTransform: live.current.transform,
        moved,
        dismissing: false,
      };
      setDragging(live.current.transform.scale > 1);
    };

    const springBack = () => {
      Animated.spring(dismissOffset, { toValue: 0, useNativeDriver: !IS_WEB, bounciness: 0 }).start();
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const points = touchPoints(event);
        if (points.length === 2) {
          gesture.current = { type: "pinch", distance: distance(points), midpoint: midpoint(points) };
          setDragging(true);
        } else {
          startDrag(points[0], false);
        }
      },
      onPanResponderMove: (event) => {
        const { transform: current, fitted: content, viewport: room } = live.current;
        if (!content || !room) return;
        const points = touchPoints(event);
        const active = gesture.current;

        if (points.length === 2) {
          const nextMidpoint = midpoint(points);
          const nextDistance = distance(points);
          if (active?.type === "pinch" && active.distance > 0) {
            const panned = panContent({
              transform: current,
              delta: { x: nextMidpoint.x - active.midpoint.x, y: nextMidpoint.y - active.midpoint.y },
              fittedContent: content,
              viewport: room,
              limits: LIMITS,
            });
            commit(
              zoomContentAtPoint({
                transform: panned,
                scale: panned.scale * (nextDistance / active.distance),
                focalPoint: nextMidpoint,
                fittedContent: content,
                viewport: room,
                limits: LIMITS,
              }),
            );
          }
          gesture.current = { type: "pinch", distance: nextDistance, midpoint: nextMidpoint };
          setDragging(true);
          return;
        }

        // A finger lifted out of a pinch: carry on as a drag from here, never as a press.
        if (active?.type !== "drag") {
          startDrag(points[0], true);
          return;
        }
        const dx = points[0].x - active.start.x;
        const dy = points[0].y - active.start.y;
        if (!active.moved && Math.hypot(dx, dy) > TAP_SLOP) {
          active.moved = true;
          // At the fit there is nothing to pan, so a mostly vertical drag
          // carries the picture away instead, as in the system photo viewer.
          active.dismissing = active.startTransform.scale <= 1 && Math.abs(dy) > Math.abs(dx);
        }
        if (active.dismissing) {
          dismissOffset.setValue(dy);
          return;
        }
        commit(
          panContent({
            transform: active.startTransform,
            delta: { x: dx, y: dy },
            fittedContent: content,
            viewport: room,
            limits: LIMITS,
          }),
        );
      },
      onPanResponderRelease: (_event, state: PanResponderGestureState) => {
        const active = gesture.current;
        gesture.current = null;
        setDragging(false);
        if (active?.type === "drag" && active.dismissing) {
          if (Math.abs(state.dy) > DISMISS_DISTANCE || Math.abs(state.vy) > DISMISS_VELOCITY) {
            live.current.onClose();
          } else {
            springBack();
          }
          return;
        }
        if (active?.type === "drag" && !active.moved) press(active.start);
      },
      onPanResponderTerminate: () => {
        gesture.current = null;
        setDragging(false);
        springBack();
      },
    });
  }, [commit, reset, dismissOffset]);

  // The wheel, and a trackpad pinch (which arrives as a wheel with ctrlKey),
  // zoom about the cursor. React Native has no wheel event, so on web the
  // canvas's DOM node takes it directly.
  useEffect(() => {
    if (!IS_WEB) return;
    const node = canvasRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = node.getBoundingClientRect();
      const factor = Math.min(ZOOM_STEP, Math.max(1 / ZOOM_STEP, Math.exp(-event.deltaY * 0.01)));
      zoomAt(live.current.transform.scale * factor, {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    if (w > 0 && h > 0) setViewport({ width: w, height: h });
  }, []);

  let cursor = "default";
  if (transform.scale > 1) cursor = dragging ? "grabbing" : "grab";

  const actions: ToolbarAction[] = [
    {
      icon: "ZoomIn",
      label: "Zoom in",
      onPress: () => zoomFromCenter(ZOOM_STEP),
      disabled: transform.scale >= LIMITS.maxScale,
    },
    {
      icon: "ZoomOut",
      label: "Zoom out",
      onPress: () => zoomFromCenter(1 / ZOOM_STEP),
      disabled: transform.scale <= LIMITS.minScale,
    },
    { icon: "Scan", label: "Reset zoom", onPress: reset, disabled: transform.scale === 1 },
  ];
  if (onReveal) actions.push({ icon: "FolderOpen", label: "Show in file manager", onPress: onReveal });
  actions.push({ icon: "X", label: "Close the image", onPress: onClose });

  const backdropOpacity = dismissOffset.interpolate({
    inputRange: [-DISMISS_DISTANCE * 3, 0, DISMISS_DISTANCE * 3],
    outputRange: [0.2, 1, 0.2],
    extrapolate: "clamp",
  });

  return (
    <View style={styles.root}>
      <Animated.View pointerEvents="none" style={[styles.backdrop, { opacity: backdropOpacity }]} />
      <SafeInset style={styles.safe}>
        <View style={styles.stage}>
          <View
            ref={canvasRef}
            onLayout={onLayout}
            accessibilityRole="image"
            accessibilityLabel={label}
            style={[styles.canvas, IS_WEB && ({ cursor, touchAction: "none", userSelect: "none" } as never)]}
            {...responder.panHandlers}
          >
            {fitted ? (
              <Animated.View pointerEvents="none" style={{ transform: [{ translateY: dismissOffset }] }}>
                <View
                  style={{
                    width: fitted.width,
                    height: fitted.height,
                    transform: [{ translateX: transform.x }, { translateY: transform.y }, { scale: transform.scale }],
                  }}
                >
                  <Image source={{ uri }} style={styles.image} resizeMode="contain" />
                </View>
              </Animated.View>
            ) : null}
          </View>
          <View style={styles.toolbar} pointerEvents="box-none">
            {actions.map((action) => (
              <ToolbarButton key={action.label} action={action} tokens={tokens} />
            ))}
          </View>
        </View>
      </SafeInset>
    </View>
  );
}

interface ToolbarAction {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

function ToolbarButton({ action, tokens }: { action: ToolbarAction; tokens: ExtendedThemeTokens }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      disabled={action.disabled}
      onPress={action.onPress}
      hitSlop={IS_WEB ? 4 : 6}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: tokens.v2.surface2 },
        action.disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {({ hovered }: { hovered?: boolean; pressed: boolean }) => (
        <Glyph
          name={action.icon}
          size={GLYPH_SIZE}
          color={hovered && !action.disabled ? tokens.foreground : tokens.foregroundMuted}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0, 0, 0, 0.9)" },
  safe: { flex: 1 },
  stage: { flex: 1 },
  canvas: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
  toolbar: {
    position: "absolute",
    top: space.md,
    right: space.md,
    flexDirection: "row",
    gap: space.xs,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusV2.chip,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
