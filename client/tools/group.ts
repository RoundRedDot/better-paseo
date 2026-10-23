import type { ToolCallView } from "./classify";
import { summarizeTool, type ToolSummary } from "./summarize";
import type { ToolRollupPosition } from "../state/tool-rollup-order";
import { readPermissionRequest } from "./agent-status";

/** Category and result never affect membership; source identity is required. */
export function canRollupTool(view: ToolCallView): boolean {
  return Boolean(view.callId);
}

/** These are the two ToolBody paths that render answer/permission controls. */
export function toolPermissionTargets(view: ToolCallView): string[] {
  const status = view.agentStatus;
  const notification = status?.status === "needs permission" && readPermissionRequest(status.body)?.requestId
    ? [status.agentId] : [];
  const list = view.paseo?.agentOperation?.permissions?.filter((entry) => entry.requestId).map((entry) => entry.agentId) ?? [];
  return [...new Set([...notification, ...list])];
}

/** File operations share a header only when both the operation and path match. */
export function toolGroupKey(view: ToolCallView | undefined): string | undefined {
  if (!view?.callId || !view.filePath) return undefined;
  if (view.tool !== "read" && view.tool !== "write" && view.tool !== "edit") return undefined;
  return JSON.stringify([view.tool, view.filePath]);
}

/** Input is in timeline order; a non-file entry always ends the current run. */
export function groupAdjacentTools<T extends { tool?: ToolCallView; rollup?: ToolRollupPosition | null }>(
  entries: readonly T[],
): Map<T, readonly ToolCallView[] | null> {
  const result = new Map<T, readonly ToolCallView[] | null>();
  let run: T[] = [];
  let key: string | undefined;
  const flush = () => {
    const calls = run.map((entry) => entry.tool!);
    run.forEach((entry, index) => result.set(entry, index === 0 ? calls : null));
    run = [];
  };
  for (const entry of entries) {
    if (entry.rollup !== undefined) {
      flush();
      key = undefined;
      if (entry.tool) result.set(entry, [entry.tool]);
      continue;
    }
    const nextKey = toolGroupKey(entry.tool);
    if (!nextKey || nextKey !== key) flush();
    key = nextKey;
    if (entry.tool) run.push(entry);
    if (!nextKey) flush();
  }
  flush();
  // Source adjacency is authoritative, even when native text isn't mounted in
  // our registry or React Native mounts an inverted window newest-first.
  const ordered = entries.filter((entry) => entry.rollup && entry.tool && canRollupTool(entry.tool))
    .sort((a, b) => a.rollup!.order - b.rollup!.order);
  run = [];
  for (const entry of ordered) {
    if (run.length && entry.rollup!.previous !== run[run.length - 1]!.tool!.callId) flush();
    run.push(entry);
  }
  flush();
  return result;
}

/**
 * A call's views are immutable, and a streaming result replaces only the
 * newest member's; the rest of the run keeps its parsed diffs.
 */
const summaries = new WeakMap<ToolCallView, ToolSummary>();

export function summarizeToolCall(view: ToolCallView): ToolSummary {
  let summary = summaries.get(view);
  if (!summary) {
    summary = summarizeTool(view);
    summaries.set(view, summary);
  }
  return summary;
}

/** Counts are cumulative operation counts, not a net diff of the final file. */
export function summarizeToolGroup(calls: readonly ToolCallView[]): ToolSummary {
  const first = calls[0]!;
  if (calls.length === 1) return summarizeTool(first);
  const summaries = calls.map(summarizeToolCall);
  const failure = summaries.find((summary) => summary.tone === "danger");
  const meta: string[] = [];
  if (first.tool === "edit") {
    let added = 0;
    let removed = 0;
    let hasCounts = false;
    for (const summary of summaries) {
      const match = /^\+(\d+) \u2212(\d+)$/.exec(summary.meta[0] ?? "");
      if (!match) continue;
      hasCounts = true;
      added += Number(match[1]);
      removed += Number(match[2]);
    }
    if (hasCounts) meta.push(`+${added} −${removed}`);
  }
  return {
    ...summaries[0]!,
    meta,
    tone: failure ? "danger" : "default",
    errorLine: failure?.errorLine,
  };
}
