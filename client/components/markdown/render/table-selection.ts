import { Platform } from "react-native";

export const TABLE_CELL_TEST_ID = "markdown-table-cell";

/** Select the rendered contents of one cell, including its inline runs. */
export function bindTableCellSelection(node: unknown): () => void {
  if (Platform.OS !== "web") return () => {};
  const frame = node as HTMLElement | null;
  if (!frame) return () => {};
  const selectCell = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const cell = (event.target as Element).closest(`[data-testid="${TABLE_CELL_TEST_ID}"]`);
    if (!cell || !frame.contains(cell)) return;
    const doc = frame.ownerDocument;
    const selection = doc.defaultView?.getSelection();
    if (!selection) return;
    const range = doc.createRange();
    range.selectNodeContents(cell);
    selection.removeAllRanges();
    selection.addRange(range);
    event.preventDefault();
    event.stopPropagation();
  };
  frame.addEventListener("dblclick", selectCell);
  return () => frame.removeEventListener("dblclick", selectCell);
}
