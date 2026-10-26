/**
 * The window the panel draws in, and the form it takes there (design 5.1).
 * The stage follows the window at once, so a panel never sits outside it;
 * the form is chosen again only once the window has held its size for
 * 150 ms, so dragging a window's edge does not flip it between forms.
 *
 * The host list's horizontal bounds keep the panel inside its timeline pane.
 * A probe in the timeline remeasures when the pane changes independently of
 * the window (for example when the host sidebar opens).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import type { DetailsForm } from "../contracts";
import { detailsForm } from "../layout-model";
import { DETAILS_MOTION } from "./motion";
import type { HostList } from "./timeline-sync";

export interface DetailsLayout {
  stage: { width: number; height: number };
  form: DetailsForm;
  left: number;
  measure(): void;
}

export function useDetailsLayout(pointer: boolean, host: HostList | null): DetailsLayout {
  const { width, height } = useWindowDimensions();
  const [settled, setSettled] = useState({ width, height });
  const [bounds, setBounds] = useState<{ left: number; right: number } | null>(null);
  const measure = useCallback(() => {
    if (!host) return;
    void host.viewport().then((box) => {
      if (box?.left === undefined || box.right === undefined) return;
      const left = Math.max(0, Math.round(box.left));
      const right = Math.min(width, Math.round(box.right));
      if (right <= left) return;
      setBounds((current) => current?.left === left && current.right === right ? current : { left, right });
    });
  }, [host, width]);
  useEffect(measure, [measure, height]);
  useEffect(() => {
    if (settled.width === width && settled.height === height) return;
    const timer = setTimeout(() => setSettled({ width, height }), DETAILS_MOTION.resizeSettleMs);
    return () => clearTimeout(timer);
  }, [width, height, settled.width, settled.height]);
  const left = Math.min(bounds?.left ?? 0, width);
  const paneWidth = Math.max(0, Math.min(bounds?.right ?? width, width) - left);
  const sidebar = width - paneWidth;
  // The current form widens each boundary by the 16 band, so it is the previous choice's input.
  const current = useRef<DetailsForm | null>(null);
  const form = useMemo(() => {
    const next = detailsForm({ width: settled.width, height: settled.height, sidebar, pointer }, current.current);
    current.current = next;
    return next;
  }, [settled.width, settled.height, sidebar, pointer]);
  return { stage: { width: paneWidth, height }, left, form, measure };
}
