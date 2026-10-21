import type { TasksLanguage } from "../i18n";
import type { TaskCard } from "../model";
import { formatCost, formatRelative, formatTokens, since } from "./format";
import { cardStrings } from "./strings";

/** What the details cards (`detail-cards.tsx`) show, as pure functions for the tests. */

/** At most this many subtasks are listed; the rest are counted. */
export const SUBTASK_ROWS = 5;

/** A wide (CJK) character takes about two Latin ones. */
function charWidth(char: string): number {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(char) ? 2 : 1;
}

function textWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

/** The middle of `text` cut to `budget` columns: 40% of the head and 60% of the tail around "…". */
function middle(text: string, budget: number): string {
  const chars = [...text];
  const room = Math.max(2, budget - 1);
  const head = Math.floor(room * 0.4);
  const tail = room - head;
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - tail).join("")}`;
}

/**
 * A path on one line of `budget` columns: whole when it fits, else "…/" and
 * as many trailing segments as fit. The last segment always shows, cut in
 * its middle when it alone is too long.
 */
export function shortenPath(path: string, budget: number): string {
  if (textWidth(path) <= budget) return path;
  const segments = path.split("/").filter((segment, index) => segment !== "" || index === 0);
  const last = segments.pop() ?? path;
  if (textWidth(`…/${last}`) > budget) return `…/${middle(last, budget - 2)}`;
  let tail = last;
  for (let index = segments.length - 1; index >= 0; index--) {
    const next = `${segments[index]}/${tail}`;
    if (textWidth(`…/${next}`) > budget) break;
    tail = next;
  }
  return `…/${tail}`;
}

/** Ahead/behind and uncommitted changes beside the branch; a clean, level branch says nothing. */
export function branchHint(git: TaskCard["location"]["git"]): { sync: string | null; dirty: boolean } {
  const ahead = git?.ahead ?? 0;
  const behind = git?.behind ?? 0;
  return { sync: ahead !== 0 || behind !== 0 ? `↑${ahead} ↓${behind}` : null, dirty: git?.dirty === true };
}

export interface UsageRow {
  key: string;
  icon: string;
  label: string;
  value: string;
  hint?: string;
}

/** The usage rows, in order; pure for the tests. */
export function usageRows(card: TaskCard, language: TasksLanguage): UsageRow[] {
  const strings = cardStrings(language).details;
  const rows: UsageRow[] = [];
  const usage = card.usage;
  if (usage?.inputTokens != null) {
    const cached = usage.cachedInputTokens ? strings.cachedHint(formatTokens(usage.cachedInputTokens)) : undefined;
    rows.push({ key: "input", icon: "ArrowDownToLine", label: strings.input, value: formatTokens(usage.inputTokens), hint: cached });
  }
  if (usage?.outputTokens != null) rows.push({ key: "output", icon: "ArrowUpFromLine", label: strings.output, value: formatTokens(usage.outputTokens) });
  if (usage?.totalCostUsd != null) rows.push({ key: "cost", icon: "CircleDollarSign", label: strings.cost, value: formatCost(usage.totalCostUsd) });
  return rows;
}

/**
 * The card's footnote: when it was created, then when it was last updated.
 * "Updated" shows only once it differs from "Created" and no turn is running.
 */
export function timingLine(card: TaskCard, now: number, language: TasksLanguage): string | null {
  const strings = cardStrings(language).details;
  const created = since(card.timing.createdAt, now);
  if (created === null) return null;
  const parts = [strings.createdAgo(formatRelative(created, language))];
  const updated = since(card.timing.updatedAt, now);
  if (updated !== null && card.status !== "running" && created - updated >= 60_000) parts.push(strings.updatedAgo(formatRelative(updated, language)));
  return parts.join(" · ");
}
