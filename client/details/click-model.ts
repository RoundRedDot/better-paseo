import type { DetailsForm, RowPressAction } from "./contracts";

export interface RowPressInput {
  pointer: boolean;
  hasBody: boolean;
  readsImage: boolean;
  isCurrent: boolean;
  /** The open panel's form; null when none is open. */
  form: DetailsForm | null;
}

/**
 * Decide the row-body action from the design's click table. A pointer click
 * always expands the row in place, as before block details: the panel opens
 * on purpose, from the hover preview's "Open in panel" or the row menu's
 * "Open details". A tap opens the drawer or panel.
 */
export function rowPressAction(input: RowPressInput): RowPressAction {
  if (!input.hasBody) return "none";
  if (input.pointer) return "expand";

  if (input.isCurrent) return input.form !== "drawer" ? "close" : "none";
  if (input.readsImage) return "viewer";
  return "details";
}
