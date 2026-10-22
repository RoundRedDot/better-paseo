import type { DetailsForm, LayoutInput } from "./contracts";

export const DETAILS_BREAKPOINTS = {
  drawerEnter: 600,
  drawerLeave: 584,
  sideEnter: 960,
  sideLeave: 944,
  landscapeEnterHeight: 500,
  landscapeLeaveHeight: 516,
  resizeSettleMs: 150,
} as const;

export function sidePanelWidth(width: number, phoneLandscape = false): number {
  if (phoneLandscape) return 400;
  return Math.max(420, Math.min(640, width * 0.36));
}

export function floatingWidth(width: number): number {
  return Math.min(width - 32, 760);
}

function fitsSide(input: LayoutInput): boolean {
  return input.width - input.sidebar - sidePanelWidth(input.width) >= 400;
}

/** Select a details form while keeping the current form inside each 16 px band. */
export function detailsForm(input: LayoutInput, current: DetailsForm | null): DetailsForm {
  const { width, height } = input;
  if (width >= DETAILS_BREAKPOINTS.drawerEnter && height < DETAILS_BREAKPOINTS.landscapeEnterHeight) {
    return "side";
  }
  if (
    current === "side" &&
    width >= DETAILS_BREAKPOINTS.drawerEnter &&
    height < DETAILS_BREAKPOINTS.landscapeLeaveHeight
  ) {
    return "side";
  }

  if (current === null) {
    if (width < DETAILS_BREAKPOINTS.drawerEnter) return "drawer";
    if (width < DETAILS_BREAKPOINTS.sideEnter) return "floating";
    return fitsSide(input) ? "side" : "floating";
  }

  if (current === "drawer") {
    if (width < DETAILS_BREAKPOINTS.drawerEnter) return "drawer";
    if (width < DETAILS_BREAKPOINTS.sideEnter) return "floating";
    return fitsSide(input) ? "side" : "floating";
  }

  if (current === "floating") {
    if (width < DETAILS_BREAKPOINTS.drawerLeave) return "drawer";
    if (width < DETAILS_BREAKPOINTS.sideEnter) return "floating";
    return fitsSide(input) ? "side" : "floating";
  }

  if (width < DETAILS_BREAKPOINTS.drawerLeave) return "drawer";
  if (width < DETAILS_BREAKPOINTS.sideLeave) return "floating";
  return fitsSide(input) ? "side" : "floating";
}

export interface ResizeSettle {
  schedule(input: LayoutInput, current: DetailsForm | null): void;
  cancel(): void;
}

/** Debounce resize events and apply the newly selected form 150 ms after the last event. */
export function createResizeSettle(
  onSettle: (form: DetailsForm) => void,
): ResizeSettle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { input: LayoutInput; current: DetailsForm | null } | null = null;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return {
    schedule(input, current) {
      if (timer !== null) clearTimeout(timer);
      pending = { input, current };
      timer = setTimeout(() => {
        timer = null;
        const latest = pending;
        pending = null;
        if (!latest) return;
        const next = detailsForm(latest.input, latest.current);
        if (next !== latest.current) onSettle(next);
      }, DETAILS_BREAKPOINTS.resizeSettleMs);
    },
    cancel,
  };
}
