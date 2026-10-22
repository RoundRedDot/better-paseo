import type { DetailsForm, RowPressAction } from "./contracts";

export type RowClickSetting = "details" | "expand";

export interface RowPressInput {
  pointer: boolean;
  rowClick: RowClickSetting;
  modifier: boolean;
  hasBody: boolean;
  readsImage: boolean;
  isCurrent: boolean;
  /** The open panel's form; null when none is open. */
  form: DetailsForm | null;
}

/** Decide the row-body action from the design's click table. */
export function rowPressAction(input: RowPressInput): RowPressAction {
  if (!input.hasBody) return "none";

  if (input.isCurrent) {
    return input.pointer || input.form !== "drawer" ? "close" : "none";
  }

  if (input.readsImage) return "viewer";
  if (!input.pointer) return "details";

  const setting = input.modifier
    ? input.rowClick === "details" ? "expand" : "details"
    : input.rowClick;
  return setting;
}
