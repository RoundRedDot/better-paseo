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
import { Platform, useWindowDimensions } from "react-native";
import type { DetailsForm } from "../contracts";
import { DETAILS_BREAKPOINTS, detailsForm } from "../layout-model";
import { DETAILS_MOTION } from "./motion";
import type { HostList } from "./timeline-sync";

export interface DetailsLayout {
  stage: { width: number; height: number; sideSpace?: number };
  form: DetailsForm;
  ready: boolean;
  left: number;
  measure(): void;
}

export function useDetailsLayout(pointer: boolean, host: HostList | null, reserveTimeline = false): DetailsLayout {
  const { width, height } = useWindowDimensions();
  const [settled, setSettled] = useState({ width, height });
  const [measurement, setMeasurement] = useState<{
    bounds: { left: number; right: number; contentRight?: number; canReserveTimeline?: boolean } | null; ready: boolean;
  }>({ bounds: null, ready: false });
  const measure = useCallback(() => {
    if (!host) return;
    void host.viewport().then((box) => {
      if (box?.left === undefined || box.right === undefined) {
        setMeasurement((current) => current.ready ? current : { ...current, ready: true });
        return;
      }
      const left = Math.max(0, Math.ceil(box.left));
      const right = Math.min(width, Math.floor(box.right));
      if (right <= left) {
        setMeasurement((current) => current.ready ? current : { ...current, ready: true });
        return;
      }
      const contentRight = box.contentRight;
      const canReserveTimeline = box.canReserveTimeline;
      setMeasurement((current) => current.ready && current.bounds?.left === left && current.bounds.right === right && current.bounds.contentRight === contentRight && current.bounds.canReserveTimeline === canReserveTimeline
        ? current : { bounds: { left, right, contentRight, canReserveTimeline }, ready: true });
    });
  }, [host, width]);
  useEffect(measure, [measure, height]);
  useEffect(() => host?.observeResize?.(measure), [host, measure]);
  useEffect(() => {
    if (settled.width === width && settled.height === height) return;
    const timer = setTimeout(() => setSettled({ width, height }), DETAILS_MOTION.resizeSettleMs);
    return () => clearTimeout(timer);
  }, [width, height, settled.width, settled.height]);
  const bounds = measurement.bounds;
  const left = Math.min(bounds?.left ?? 0, width);
  const paneWidth = Math.max(0, Math.min(bounds?.right ?? width, width) - left);
  const sidebar = width - paneWidth;
  // Work details can reserve space in the timeline; other details use its empty gutter.
  const sideSpace = Platform.OS === "web" && pointer
    ? reserveTimeline && bounds?.canReserveTimeline
      ? Math.max(0, paneWidth - 400)
      : Math.max(0, Math.floor(Math.min(bounds?.right ?? width, width) - (bounds?.contentRight ?? width)))
    : undefined;
  // The current form widens each boundary by the 16 band, so it is the previous choice's input.
  const current = useRef<DetailsForm | null>(null);
  const form = useMemo(() => {
    const next = detailsForm({ width: settled.width, height: settled.height, sidebar, pointer, sideSpace }, current.current);
    current.current = next;
    return next;
  }, [settled.width, settled.height, sidebar, pointer, sideSpace]);
  const ready = !(Platform.OS === "web" && pointer && width >= DETAILS_BREAKPOINTS.sideEnter && host) || measurement.ready;
  return { stage: { width: paneWidth, height, sideSpace }, left, form, ready, measure };
}
