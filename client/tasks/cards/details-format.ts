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

/** The middle of `text` cut to `budget` columns: 40% of the head and 60% of the tail around "…"; whole when it fits. */
function middle(text: string, budget: number): string {
  if (textWidth(text) <= budget) return text;
  const chars = [...text];
  const room = Math.max(2, budget - 1);
  const head = Math.floor(room * 0.4);
  const tail = room - head;
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - tail).join("")}`;
}

/** A path's segments, each with its "/" but the last. */
function pathPieces(path: string): string[] {
  const parts = path.split("/");
  return parts.map((part, index) => (index < parts.length - 1 ? `${part}/` : part));
}

/**
 * The unbreakable runs of a path as `pathText` lays it out, as widths: each
 * segment that fits a line is one run, broken after its "/". A segment longer
 * than a line runs on from the "/" before it and breaks only after its own
 * "-" (a browser keeps the letters between them together).
 */
function pathWords(path: string, columns: number): number[] {
  const words: number[] = [];
  for (const piece of pathPieces(path)) {
    const width = textWidth(piece);
    if (width <= columns) {
      words.push(width);
      continue;
    }
    const parts = piece.split("-").map((part, index, all) => (index < all.length - 1 ? `${part}-` : part));
    parts.forEach((part, index) => {
      const before = words.length - 1;
      if (index === 0 && before >= 0) words[before] = (words[before] ?? 0) + textWidth(part);
      else words.push(textWidth(part));
    });
  }
  return words;
}

/**
 * How many lines a path takes in lines of `columns`, laid out as `pathText`
 * lets it break: a run that does not fit the rest of a line moves to the
 * next; a run longer than a whole line breaks inside itself.
 */
export function pathLines(path: string, columns: number): number {
  let lines = 1;
  let used = 0;
  for (const width of pathWords(path, columns)) {
    if (used > 0 && used + width > columns) {
      lines += 1;
      used = 0;
    }
    used += width;
    while (used > columns) {
      used -= columns;
      lines += 1;
    }
  }
  return lines;
}

/**
 * A path in `lines` lines of `columns`: whole when it fits, else its head
 * ("~/workspace", "/Users") and as many trailing segments as fit around
 * "…/". The last segment always shows, cut in its middle only when it alone
 * is longer than the lines. Copying still takes the whole path.
 */
export function foldPath(path: string, columns: number, lines = 2): string {
  const fits = (text: string) => pathLines(text, columns) <= lines;
  if (fits(path)) return path;
  const segments = path.split("/");
  const last = segments.pop() ?? path;
  const head = segments.length > 2 ? segments.slice(0, 2).join("/") : null;
  const rest = head ? segments.slice(2) : segments;
  const lead = head ? `${head}/…/` : "…/";
  if (!fits(`${lead}${last}`)) return `…/${middle(last, columns * lines - 2)}`;
  let tail = last;
  for (let index = rest.length - 1; index >= 0; index--) {
    const next = `${rest[index]}/${tail}`;
    if (!fits(`${lead}${next}`)) break;
    tail = next;
  }
  return `${lead}${tail}`;
}

/**
 * A path (already folded) with the breaks `pathLines` counts on: a
 * zero-width space after each "/", a word joiner after each "-" so iOS does
 * not break "native-bridge" at its hyphen. A segment longer than a line
 * keeps neither: it follows the "/" before it on the same line and wraps
 * inside itself.
 */
export function pathText(path: string, columns: number): string {
  const pieces = pathPieces(path);
  const long = pieces.map((piece) => textWidth(piece) > columns);
  return pieces
    .map((piece, index) => {
      const text = long[index] ? piece : piece.replace(/-/g, "-\u2060");
      const breakAfter = piece.endsWith("/") && index + 1 < pieces.length && !long[index + 1];
      return breakAfter ? `${text}\u200b` : text;
    })
    .join("");
}

/** Lets a branch or a name wrap after each "/" and "-" before it wraps inside a word. */
export function breakable(text: string): string {
  return text.replace(/([/-])/g, "$1\u200b");
}

/** Ahead/behind and uncommitted changes beside the branch; a clean, level branch says nothing. */
export function branchHint(git: TaskCard["location"]["git"]): { sync: string | null; dirty: boolean } {
  const ahead = git?.ahead ?? 0;
  const behind = git?.behind ?? 0;
  return { sync: ahead !== 0 || behind !== 0 ? `↑${ahead} ↓${behind}` : null, dirty: git?.dirty === true };
}
