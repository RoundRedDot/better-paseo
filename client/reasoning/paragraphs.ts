/**
 * Splits a section body so a very long paragraph can be shown clamped
 * (plan §3.4 item 4): more than about 600 characters shows six lines and an
 * "expand" control. The decision is by character count, never by measuring
 * layout, so it costs nothing per frame and cannot shift after first paint.
 *
 * Only plain paragraphs are clamped. Lists, quotes, tables, headings and
 * fenced code keep their Markdown block whole (code collapses through the
 * Markdown renderer instead), so the body is cut into runs: consecutive
 * blocks that need no clamp stay together in one run and render as one
 * Markdown document, which keeps loose lists and fences intact.
 */

export const LONG_PARAGRAPH_CHARS = 600;
export const CLAMPED_LINES = 4;

export interface BodyRun {
  /** Offset of the run in the body: a stable key while the body grows. */
  offset: number;
  text: string;
  /** A single plain paragraph over the threshold. */
  long: boolean;
}

const NOT_PROSE = /^ {0,3}(?:[-*+][ \t]|\d+[.)][ \t]|>|#{1,6}[ \t]|\||`{3,}|~{3,})|^(?: {4}|\t)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

interface Block {
  offset: number;
  text: string;
}

/** Blank-line separated blocks; blank lines inside a fence do not split. */
function blocks(body: string): Block[] {
  const result: Block[] = [];
  let fence: string | null = null;
  let blockStart = -1;
  let lineStart = 0;
  while (lineStart <= body.length) {
    let lineEnd = body.indexOf("\n", lineStart);
    if (lineEnd < 0) lineEnd = body.length;
    const line = body.slice(lineStart, lineEnd);
    const blank = fence === null && line.trim() === "";
    if (blank) {
      if (blockStart >= 0) {
        result.push({ offset: blockStart, text: body.slice(blockStart, lineStart - 1) });
        blockStart = -1;
      }
    } else {
      if (blockStart < 0) blockStart = lineStart;
      const marker = FENCE.exec(line)?.[1];
      if (marker) {
        if (fence === null) fence = marker.charAt(0).repeat(marker.length);
        else if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, "") === "") {
          fence = null;
        }
      }
    }
    if (lineEnd === body.length) break;
    lineStart = lineEnd + 1;
  }
  if (blockStart >= 0) result.push({ offset: blockStart, text: body.slice(blockStart) });
  return result;
}

export function isLongParagraph(text: string): boolean {
  return text.length > LONG_PARAGRAPH_CHARS && !NOT_PROSE.test(text);
}

/** The body as runs; a body with no long paragraph is one run. */
export function splitBodyRuns(body: string): BodyRun[] {
  const parts = blocks(body);
  if (!parts.some((part) => isLongParagraph(part.text))) {
    return body ? [{ offset: 0, text: body, long: false }] : [];
  }
  const runs: BodyRun[] = [];
  let pending: Block | null = null;
  const flush = (end: number): void => {
    if (!pending) return;
    runs.push({ offset: pending.offset, text: body.slice(pending.offset, end).trimEnd(), long: false });
    pending = null;
  };
  for (const part of parts) {
    if (isLongParagraph(part.text)) {
      flush(part.offset);
      runs.push({ offset: part.offset, text: part.text, long: true });
    } else if (!pending) {
      pending = part;
    }
  }
  flush(body.length);
  return runs;
}
