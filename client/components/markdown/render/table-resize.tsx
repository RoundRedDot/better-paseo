import React, { useLayoutEffect, useRef } from "react";
import { View } from "react-native";

export function bindTableResize(node: HTMLElement, current: { current: { width: number; minWidth: number; onResize(width: number): void } }): () => void {
  const doc = node.ownerDocument;
  let drag: { pointer: number; x: number; width: number } | null = null;
  const down = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || drag) return;
    event.preventDefault();
    event.stopPropagation();
    drag = { pointer: event.pointerId, x: event.clientX, width: current.current.width };
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", up);
    doc.addEventListener("pointercancel", up);
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    event.preventDefault();
    current.current.onResize(Math.max(current.current.minWidth, drag.width + event.clientX - drag.x));
  };
  const up = (event: PointerEvent) => {
    if (drag?.pointer !== event.pointerId) return;
    drag = null;
    doc.removeEventListener("pointermove", move);
    doc.removeEventListener("pointerup", up);
    doc.removeEventListener("pointercancel", up);
  };
  const suppress = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
  node.addEventListener("pointerdown", down);
  node.addEventListener("click", suppress);
  node.addEventListener("dblclick", suppress);
  return () => {
    node.removeEventListener("pointerdown", down);
    node.removeEventListener("click", suppress);
    node.removeEventListener("dblclick", suppress);
    doc.removeEventListener("pointermove", move);
    doc.removeEventListener("pointerup", up);
    doc.removeEventListener("pointercancel", up);
  };
}

export function TableResizeHandle({ left, width, minWidth, color, onResize }: {
  left: number; width: number; minWidth: number; color: string; onResize(width: number): void;
}) {
  const ref = useRef<View>(null);
  const current = useRef({ width, minWidth, onResize });
  current.current = { width, minWidth, onResize };
  useLayoutEffect(() => {
    const node = ref.current as unknown as HTMLElement | null;
    return node ? bindTableResize(node, current) : undefined;
  }, []);
  return <View ref={ref} testID="markdown-table-resize" style={{
    position: "absolute", left: left - 6, top: 0, bottom: 0, width: 12,
    cursor: "col-resize", alignItems: "center",
  } as never}>
    <View testID="markdown-table-resize-indicator" pointerEvents="none"
      style={{ position: "absolute", top: 8, width: 3, height: 16, borderRadius: 2, backgroundColor: color }} />
  </View>;
}
