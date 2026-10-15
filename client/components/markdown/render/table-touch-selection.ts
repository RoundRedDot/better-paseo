import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, type GestureResponderEvent, type ViewProps } from "react-native";
import { useScrollDismiss } from "../../../ui/scroll-anchor";

const DOUBLE_TAP_MS = 300;
const TAP_MS = 250;
const MOVE_SLOP = 8;

interface Tap { key: string; time: number; x: number; y: number }

/** Shared cell state; native recognises double taps here and web binds double clicks. */
export function useTableTouchSelection(source: string) {
  const [selected, setSelected] = useState<{ key: string; text: string } | null>(null);
  const started = useRef<Tap | null>(null);
  const previous = useRef<Tap | null>(null);
  const dismiss = useCallback(() => setSelected(null), []);
  const select = useCallback((key: string, text: string) => {
    if (text) setSelected({ key, text });
  }, []);
  useScrollDismiss(selected !== null, dismiss);
  const cancel = () => { started.current = null; previous.current = null; };
  useEffect(() => { cancel(); dismiss(); }, [source]);

  const point = (key: string, event: GestureResponderEvent): Tap => ({
    key, time: event.nativeEvent.timestamp,
    x: event.nativeEvent.pageX, y: event.nativeEvent.pageY,
  });
  const near = (a: Tap, b: Tap) => Math.hypot(a.x - b.x, a.y - b.y) <= MOVE_SLOP;
  const cellProps = (key: string, content: () => string): Pick<ViewProps,
    "onTouchStart" | "onTouchMove" | "onTouchEnd" | "onTouchCancel"> => Platform.OS === "web" ? {} : {
    onTouchStart: (event) => {
      dismiss();
      if (event.nativeEvent.touches.length !== 1) return cancel();
      started.current = point(key, event);
    },
    onTouchMove: (event) => {
      if (started.current && !near(started.current, point(key, event))) cancel();
    },
    onTouchCancel: cancel,
    onTouchEnd: (event) => {
      const start = started.current;
      started.current = null;
      const end = point(key, event);
      if (!start || start.key !== key || end.time - start.time > TAP_MS || !near(start, end)) return cancel();
      const last = previous.current;
      if (last?.key === key && end.time - last.time <= DOUBLE_TAP_MS && near(last, end)) {
        previous.current = null;
        const text = content();
        select(key, text);
      } else previous.current = end;
    },
  };
  return { selected, cellProps, dismiss, select };
}
