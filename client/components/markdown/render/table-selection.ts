import { Platform } from "react-native";

export const TABLE_CELL_TEST_ID = "markdown-table-cell";

/** Use the same cell highlight and copy menu as a native double tap. */
export function bindTableCellSelection(node: unknown, select: (key: string, text: string) => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const frame = node as HTMLElement | null;
  if (!frame) return () => {};
  const selectCell = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const cell = (event.target as Element).closest(`[data-testid="${TABLE_CELL_TEST_ID}"]`);
    if (!cell || !frame.contains(cell)) return;
    const key = cell.getAttribute("data-table-cell-key");
    const text = cell.getAttribute("data-table-cell-text");
    if (!key || !text) return;
    // Drop the browser's word highlight so only the shared cell fill remains.
    frame.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
    select(key, text);
    event.preventDefault();
    event.stopPropagation();
  };
  frame.addEventListener("dblclick", selectCell);
  return () => frame.removeEventListener("dblclick", selectCell);
}
