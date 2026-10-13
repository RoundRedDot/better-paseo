/**
 * Middle truncation that never loses the file name (plan §3.9 item 4).
 *
 * React Native's `ellipsizeMode="middle"` is not implemented on React Native
 * Web, and it cuts characters rather than segments anyway, so the same string
 * is produced here for every platform: `src/…/components/ChatView.tsx`.
 *
 * `budget` is in characters (UTF-16 code units, the unit `length` counts).
 * The file name is kept even when it alone is over budget: `…/name` is the
 * shortest output for a path.
 */
export const ELLIPSIS = "…";

export function truncateMiddle(text: string, budget: number): string {
  if (text.length <= budget) return text;
  if (!text.includes("/")) return truncateChars(text, budget);

  const segments = text.split("/");
  const name = segments[segments.length - 1] ?? "";
  // A trailing slash leaves no name to protect; cut it as plain text.
  if (!name) return truncateChars(text, budget);

  const middle = segments.slice(0, -1);
  const render = (head: string[], tail: string[]) =>
    head.length > 0 ? `${head.join("/")}/${ELLIPSIS}/${tail.join("/")}` : `${ELLIPSIS}/${tail.join("/")}`;

  // Grow from both ends in turn, the start first: the first segment says where
  // the path lives, the one beside the name says what it belongs to. Since the
  // whole text is over budget, at least one segment always stays elided.
  let head: string[] = [];
  let tail: string[] = [name];
  let lo = 0;
  let hi = middle.length - 1;
  let headOpen = true;
  let tailOpen = true;
  let headTurn = true;
  while ((headOpen || tailOpen) && lo <= hi) {
    const growHead = headTurn ? headOpen : !tailOpen;
    if (growHead) {
      const next = [...head, middle[lo] ?? ""];
      if (render(next, tail).length <= budget) {
        head = next;
        lo += 1;
      } else {
        headOpen = false;
      }
    } else {
      const next = [middle[hi] ?? "", ...tail];
      if (render(head, next).length <= budget) {
        tail = next;
        hi -= 1;
      } else {
        tailOpen = false;
      }
    }
    headTurn = !headTurn;
  }
  return render(head, tail);
}

function truncateChars(text: string, budget: number): string {
  if (budget <= 1) return ELLIPSIS;
  const keep = budget - 1;
  const front = Math.ceil(keep / 2);
  const back = keep - front;
  return `${text.slice(0, front)}${ELLIPSIS}${back > 0 ? text.slice(text.length - back) : ""}`;
}

/**
 * Like `truncateMiddle`, but the result always fits `budget`: when even
 * `…/name` is too long, the file name itself is cut in its middle, so its
 * start and its extension both stay visible (`…/very-long-na…dler.ts`). Never
 * cut at the end — a row's tail ellipsis is what used to hide the file name.
 */
export function fitMiddle(text: string, budget: number): string {
  const out = truncateMiddle(text, budget);
  if (out.length <= budget) return out;
  const slash = text.lastIndexOf("/");
  const name = slash >= 0 ? text.slice(slash + 1) : text;
  // `…/` plus at least three characters of the name, or the name alone.
  if (slash < 0 || budget < 5) return truncateChars(name || text, Math.max(1, budget));
  return `${ELLIPSIS}/${truncateChars(name, budget - 2)}`;
}

/**
 * Average advance of one monospace character, as a fraction of the font
 * size. Iosevka, typed as a custom family, is a narrow face (500/1000 em);
 * SF Mono, Menlo, Consolas and Android's monospace sit at about 0.6. An
 * unknown family gets a slightly wider guess, so a misjudged one is truncated
 * a little early rather than cut at the end by the row.
 */
export function monoAdvance(family: string | undefined): number {
  if (family && /iosevka/i.test(family)) return 0.5;
  if (!family || /ui-monospace|sf mono|menlo|monospace|consolas|courier/i.test(family)) return 0.6;
  return 0.64;
}

/**
 * Characters of a monospace path that fit in `width` points at `fontSize`.
 * One character of slack absorbs rounding and the ellipsis glyph. Null while
 * the slot has not been measured yet, so callers keep their fixed budget.
 */
export function budgetForWidth(
  width: number,
  fontSize: number,
  family: string | undefined,
): number | null {
  if (!(width > 0) || !(fontSize > 0)) return null;
  const chars = Math.floor(width / (fontSize * monoAdvance(family))) - 1;
  return Math.max(4, chars);
}

/** Fewest path characters worth showing after a secondary root's label. */
export const MIN_REST = 12;

/**
 * What `PathText` draws for a formatted path within `limit` character cells.
 *
 * `strict` (a measured slot) never exceeds `limit`, cutting the file name in
 * its middle only as a last resort. A secondary root's label is dropped first
 * whenever keeping it would shorten the file name or leave the path fewer
 * than `MIN_REST` cells. Without `strict` the fixed-budget behaviour is kept:
 * the file name is never shortened.
 */
export function shownPath(
  formatted: { displayPath: string; label: string | null; suffix: string },
  limit: number,
  strict: boolean,
): { label: string | null; text: string } {
  const { displayPath, label, suffix } = formatted;
  if (!strict) {
    if (!label) return { label: null, text: truncateMiddle(`${displayPath}${suffix}`, limit) };
    const rest = `${displayPath.slice(label.length + 1)}${suffix}`;
    return { label, text: truncateMiddle(rest, Math.max(8, limit - label.length - 1)) };
  }
  if (!label) return { label: null, text: fitMiddle(`${displayPath}${suffix}`, limit) };
  const rest = `${displayPath.slice(label.length + 1)}${suffix}`;
  const room = limit - label.length - 1;
  const name = rest.slice(rest.lastIndexOf("/") + 1);
  // `…/name` is the least a kept label must leave whole.
  const nameFits = room >= MIN_REST && `${ELLIPSIS}/${name}`.length <= room;
  if (rest.length > room && !nameFits) return { label: null, text: fitMiddle(rest, limit) };
  return { label, text: fitMiddle(rest, Math.max(1, room)) };
}
