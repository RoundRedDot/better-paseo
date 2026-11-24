/**
 * Tool calls the timeline does not draw (`transform.ts` drops them), which
 * the standard level's work card leaves out of its count and its list too.
 */
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { isTaskEcho } from "./task-notification";

/** Codex polling a terminal it names nothing about. */
function isEmptyTerminalPoll(detail: unknown): boolean {
  const plain = detail as { type?: unknown; label?: unknown; text?: unknown };
  return plain.type === "plain_text" && !plain.label && !plain.text;
}

/** A task notification that only repeats its command's row, or an empty terminal poll. */
export function isUndrawnCall(item: Pick<ToolCallTimelineItem, "name" | "status" | "detail" | "metadata">): boolean {
  if (item.name === "task_notification") return isTaskEcho(item.detail as Record<string, unknown>, item.metadata);
  return item.name === "terminal" && item.status === "completed" && isEmptyTerminalPoll(item.detail);
}
