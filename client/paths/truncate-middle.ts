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
