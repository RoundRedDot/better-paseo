import type { TaskCard } from "../model";

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

/** A property row's sizes, in px at the font scale: its icon, label column and value font. */
export interface PropertyRowSizes {
  icon: number;
  label: number;
  font: number;
}

/** A badge beside a property's value: its text, and whether an icon or a dot leads it. */
export interface PropertyBadge {
  text: string;
  lead?: boolean;
}

/** Badge text is 11px with a 14px icon-and-gap lead and 7px of padding a side (`Badge` in `detail-charts.tsx`). */
const BADGE_FONT = 11;
const BADGE_LEAD = 16;
const BADGE_PAD = 14;
/** A column of text is about this many ems wide; a wide character takes two. */
const COLUMN_EM = 0.56;

/**
 * About how wide a property row is with its value whole: the padding, icon,
 * label column and value with the gaps between them, then each badge. Two
 * rows share a line only when both fit their half of it.
 */
export function propertyRowWidth(sizes: PropertyRowSizes, value: string, badges: PropertyBadge[] = []): number {
  let width = 12 + sizes.icon + 8 + sizes.label + 8 + textWidth(value) * sizes.font * COLUMN_EM;
  for (const badge of badges) {
    width += 8 + BADGE_PAD + (badge.lead ? BADGE_LEAD : 0) + textWidth(badge.text) * BADGE_FONT * COLUMN_EM;
  }
  return Math.ceil(width);
}

/** Ahead/behind and uncommitted changes beside the branch; a clean, level branch says nothing. */
export function branchHint(git: TaskCard["location"]["git"]): { sync: string | null; dirty: boolean } {
  const ahead = git?.ahead ?? 0;
  const behind = git?.behind ?? 0;
  return { sync: ahead !== 0 || behind !== 0 ? `↑${ahead} ↓${behind}` : null, dirty: git?.dirty === true };
}
