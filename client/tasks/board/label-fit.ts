/** A box from onLayout, in its parent. */
export interface Box {
  x: number;
  y: number;
  width: number;
}

/** What decides whether the filter bar's buttons keep their words. */
export interface BarBoxes {
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

/**
 * Whether the filter bar's buttons draw their icons alone, from the boxes
 * laid out in the current mode. With words, they give them up once the
 * buttons overflow their group or push the done window and the sort to a row
 * of their own. Icon-only, they take them back once `labels` (every dropped
 * word and its gap; null while one is unmeasured) fits beside them with
 * LABELS_SLACK to spare.
 */
export function nextCompact(compact: boolean, boxes: BarBoxes, labels: number | null): boolean {
  const ownRow = boxes.end.y > boxes.filters.y + 1;
  if (!compact) return ownRow || boxes.controls.width > boxes.filters.width + 0.5;
  if (labels === null || ownRow) return true;
  return boxes.controls.width + labels > boxes.filters.width - LABELS_SLACK;
}
