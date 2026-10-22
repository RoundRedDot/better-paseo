/**
 * The window the panel draws in, and the form it takes there (design 5.1).
 * The stage follows the window at once, so a panel never sits outside it;
 * the form is chosen again only once the window has held its size for
 * 150 ms, so dragging a window's edge does not flip it between forms.
 *
 * The host's left sidebar narrows the room beside a side panel. A plugin
 * cannot read its width; on web the timeline's own scroller starts where it
 * ends, so its left edge stands in for it. Elsewhere it counts as 0.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";
import type { DetailsForm } from "../contracts";
import { detailsForm } from "../layout-model";
import { DETAILS_MOTION } from "./motion";
import { nearestScroller } from "./web-layer";

export interface DetailsLayout {
  stage: { width: number; height: number };
  form: DetailsForm;
}

export function useDetailsLayout(pointer: boolean, anchor: () => unknown): DetailsLayout {
  const { width, height } = useWindowDimensions();
  const [settled, setSettled] = useState({ width, height });
  const [sidebar, setSidebar] = useState(0);
  useEffect(() => {
    if (settled.width === width && settled.height === height) return;
    const timer = setTimeout(() => setSettled({ width, height }), DETAILS_MOTION.resizeSettleMs);
    return () => clearTimeout(timer);
  }, [width, height, settled.width, settled.height]);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const left = nearestScroller(anchorRef.current())?.getBoundingClientRect().left;
    setSidebar(typeof left === "number" && Number.isFinite(left) ? Math.max(0, Math.round(left)) : 0);
  }, [settled.width, settled.height]);
  // The current form widens each boundary by the 16 band, so it is the previous choice's input.
  const current = useRef<DetailsForm | null>(null);
  const form = useMemo(() => {
    const next = detailsForm({ width: settled.width, height: settled.height, sidebar, pointer }, current.current);
    current.current = next;
    return next;
  }, [settled.width, settled.height, sidebar, pointer]);
  return { stage: { width, height }, form };
}
