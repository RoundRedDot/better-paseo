/**
 * What the standard level folds into a turn's work card instead of a row.
 *
 * A transformer sees one item and nothing of its turn. The card is drawn on
 * a completed assistant reply, after that reply has settled. A streaming
 * reply does not read the timeline again. The user message is not an anchor,
 * and the enhanced prompt bubble is not part of this fold. A turn that ends
 * with no assistant reply therefore has no card; failures, questions, plans
 * and sub-tasks stay on the list.
 *
 * Classification reads only the call's name, status, detail type, exit code
 * and path, so the transformer and the card's store agree on every call.
 */
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import type { EnhancerPreferences } from "../preferences";

export type WorkVerb = "read" | "edit" | "write" | "command";

type FoldInput = Pick<ToolCallTimelineItem, "name" | "status" | "detail">;

function pathOf(detail: FoldInput["detail"]): string | undefined {
  const path = (detail as { filePath?: unknown }).filePath;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

/** The verb a successful call folds under, or null when it keeps its own place. */
export function foldedWorkVerb(item: FoldInput): WorkVerb | null {
  if (item.status !== "completed") return null;
  // A patch names its files only inside the patch text; it keeps its row.
  if (item.name.toLowerCase() === "apply_patch") return null;
  const detail = item.detail;
  switch (detail.type) {
    case "read": return pathOf(detail) ? "read" : null;
    case "edit": return pathOf(detail) ? "edit" : null;
    case "write": return pathOf(detail) ? "write" : null;
    case "shell": return detail.exitCode === undefined || detail.exitCode === null || detail.exitCode === 0 ? "command" : null;
    default: return null;
  }
}

/** The file a folded edit or write changed. */
export function foldedFilePath(item: FoldInput): string | undefined {
  return pathOf(item.detail);
}

/**
 * Whether the standard level moves successful edits into the card. The plugin
 * has to draw the assistant reply, which is where the card sits.
 */
export function standardFoldActive(preferences: Pick<EnhancerPreferences,
  "chatEnabled" | "timelineLevel" | "assistantMarkdown">): boolean {
  return preferences.chatEnabled && preferences.timelineLevel === "standard" &&
    preferences.assistantMarkdown;
}

/** A successful edit or write the card lists in place of its row. */
export function foldsIntoFileCard(item: FoldInput): boolean {
  const verb = foldedWorkVerb(item);
  return verb === "edit" || verb === "write";
}
