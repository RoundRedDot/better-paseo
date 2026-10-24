/** A box from onLayout, in its parent. */
export interface Box {
  x: number;
  y: number;
  width: number;
}

/** What decides whether the filter bar's buttons keep their words. */
export interface BarBoxes {
  /** The whole row, excluding its padding and the gap between its two groups. */
  bar?: Box;
  /** The filters' group: the width the done window and the sort leave it. */
  filters: Box;
  /** The done window and the sort: at the first row's end, or wrapped below. */
  end: Box;
  /** The filter buttons before the chips, on one line. */
  controls: Box;
}

/** The gap between a button's icon and its word, which goes with the word. */
export const LABEL_GAP = 5;

/** Room the icon-only buttons keep spare before their words come back, so the bar does not flip at the edge. */
export const LABELS_SLACK = 12;

function availableFilterWidth(boxes: BarBoxes): number {
  return boxes.bar ? Math.min(boxes.filters.width, boxes.bar.width - boxes.end.width) : boxes.filters.width;
}

/**
 * Whether the filter bar's buttons draw their icons alone, from the boxes
 * laid out in the current mode. With words, they give them up once the
 * buttons overflow their group or push the done window and the sort to a row
 * of their own. Icon-only, they take them back once `labels` (every dropped
 * word and its gap; null while one is unmeasured) fits beside them with
 * LABELS_SLACK to spare.
 */
export function nextCompact(compact: boolean, boxes: BarBoxes, labels: number | null): boolean {
  // Web onLayout observes size changes, so a wrapped end can move without reporting its new y.
  const ownRow = !boxes.bar && boxes.end.y > boxes.filters.y + 1;
  const available = availableFilterWidth(boxes);
  if (!compact) return ownRow || boxes.controls.width > available + 0.5;
  if (labels === null || ownRow) return true;
  return boxes.controls.width + labels > available - LABELS_SLACK;
}

export interface BarLayout {
  compact: boolean;
  inlineLaneWidth: boolean;
}

/** Fold the lane choices first; restore the filter labels before spending spare room on them. */
export function nextBarLayout(layout: BarLayout, boxes: BarBoxes, labels: number | null, laneWidthExtra: number | null): BarLayout {
  if (layout.inlineLaneWidth) {
    return { compact: false, inlineLaneWidth: !nextCompact(false, boxes, null) };
  }
  const compact = nextCompact(layout.compact, boxes, labels);
  const inlineLaneWidth = !compact && !layout.compact && laneWidthExtra !== null
    && boxes.controls.width + Math.max(0, laneWidthExtra) <= availableFilterWidth(boxes) - LABELS_SLACK;
  return { compact, inlineLaneWidth };
}
