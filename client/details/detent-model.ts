import { SHEET } from "../tasks/board/sidebar-model";
import type { Detent } from "./contracts";

export function detentHeights(content: number, available: number): { fit: number; full: number | null } {
  const fit = Math.min(content, SHEET.half * available);
  return {
    fit,
    full: content > SHEET.half * available ? available - SHEET.fullGap : null,
  };
}

/** Down is positive; from fit a downward release closes, while full first returns to fit. */
export function releaseDetent(detent: Detent, dy: number, velocity: number): Detent | "closed" {
  const down = dy > SHEET.distance || velocity > SHEET.flick;
  const up = dy < -SHEET.distance || velocity < -SHEET.flick;

  if (detent === "fit") return down ? "closed" : up ? "full" : "fit";
  if (down && velocity > 1.2) return "closed";
  return down ? "fit" : "full";
}

/** Dampen displacement beyond an end detent; an available next detent stays direct. */
export function dampOverdrag(distance: number, hasFurtherDetent: boolean): number {
  return hasFurtherDetent ? distance : distance * 0.3;
}

export function settleMs(distance: number, velocity: number): number {
  const speed = Math.abs(velocity);
  const remaining = speed === 0 ? 240 : distance / speed;
  return Math.max(160, Math.min(240, remaining));
}
