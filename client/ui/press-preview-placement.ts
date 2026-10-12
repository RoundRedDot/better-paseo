/** A box in window coordinates, as `measureInWindow` reports it. */
export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PressPreviewPlacement {
  left: number;
  width: number;
  top: number;
  maxHeight: number;
  /** Opens above the row rather than below it. */
  above: boolean;
}

export const PRESS_PREVIEW = {
  /** Between the row and the panel. */
  gap: 6,
  /** Kept clear inside the safe area. */
  margin: 8,
  /** The panel never takes more of the safe area than this. */
  ratio: 0.6,
  /** Room below the row that is enough to open downward. */
  comfort: 240,
} as const;

/**
 * Where a long-pressed row's preview goes on a phone: as wide as the row, below
 * it when there is room, else above it, inside the safe area. The direction is
 * chosen from the room alone, so measuring the panel never flips it; opening
 * above needs the panel's height to sit on the row, and until it is known the
 * panel is placed as if it filled its limit.
 *
 * `row` and `stage` are measured in the modal's window (see
 * `rowInModalWindow`), where the modal's own top-left measures `origin`; the
 * result is relative to it.
 */
/**
 * The row's box in the coordinates `measureInWindow` gives inside the modal.
 *
 * On Android `measureInWindow` subtracts the top of its window's visible
 * frame. The timeline's window keeps the status bar out of that frame, so its
 * row reads one status bar (`rowWindowTop`) higher than the screen; the
 * translucent modal's frame starts at the top of the screen, where the modal's
 * origin measures `origin.y`. On iOS both are zero.
 */
export function rowInModalWindow(
  row: WindowRect,
  origin: { x: number; y: number },
  rowWindowTop: number,
): WindowRect {
  return { ...row, y: row.y + rowWindowTop + origin.y };
}

export function pressPreviewPlacement(
  row: WindowRect,
  stage: WindowRect,
  panelHeight: number | null,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): PressPreviewPlacement {
  const { gap, margin, ratio, comfort } = PRESS_PREVIEW;
  const left = Math.max(stage.x + margin, row.x);
  const right = Math.min(stage.x + stage.width - margin, row.x + row.width);
  const below = stage.y + stage.height - margin - (row.y + row.height + gap);
  const above = row.y - gap - (stage.y + margin);
  const cap = stage.height * ratio;
  const down = below >= Math.min(cap, comfort) || below >= above;
  const maxHeight = Math.max(0, Math.min(cap, down ? below : above));
  const height = Math.min(panelHeight ?? maxHeight, maxHeight);
  return {
    left: left - origin.x,
    width: Math.max(0, right - left),
    top: (down ? row.y + row.height + gap : row.y - gap - height) - origin.y,
    maxHeight,
    above: !down,
  };
}
