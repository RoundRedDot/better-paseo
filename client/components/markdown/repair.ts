/**
 * Streaming repair for the tail block (plan §3.1 item 4).
 *
 * Only the block still being written is repaired, and only while the reply
 * streams; a finished message is never touched. `remend` closes unfinished
 * inline syntax (`**bold`, `` `code ``, `~~del`, links as text only, setext
 * underlines); the handlers below cover what it leaves alone, so a block
 * keeps the shape it will end with instead of flipping between plain text and
 * markup while it grows:
 *
 * | tail | repair |
 * |---|---|
 * | a line holding only a list marker (`-`, `1.`), a heading's `#` run, the start of a rule or emphasis run (`--`, `**`), a lone `|` or `$`, or a fence's first one or two backticks | the line is held back until it has content |
 * | a single table row (`\| a \| b`) | a delimiter row is added, so it draws as a table header |
 * | a table header and half a delimiter row (`\|--`) | the delimiter is completed to the header's width |
 * | an emphasis or code marker with nothing after it (`text **`) | the marker is held back |
 * | `[label]` at the very end, not yet followed by `(` | its label, like the rest of a link in text-only mode |
 *
 * KaTeX completion is off (plan D6: `$$ … $$` is a math block of its own, and
 * a single `$` is usually money), and so are `singleTilde` and
 * `comparisonOperators`, which would rewrite what the author wrote.
 */
import remend, { isWithinCodeBlock, type RemendHandler } from "remend";

const LONE_MARKER_RE = /^[ \t]*(?:[-*+_$|]|[-*_]{2}|\d{1,9}[.)]|#{1,6}|`{1,2}|~{1,2})[ \t]*$/;
const ROW_RE = /^ {0,3}\|/;
const DELIMITER_RE = /^ {0,3}\|?[ \t]*:?-*:?[ \t]*(?:\|[ \t]*:?-*:?[ \t]*)*\|?[ \t]*$/;
const DELIMITER_CELL_RE = /^:?-+:?$/;

function lastLineStart(text: string): number {
  return text.lastIndexOf("\n") + 1;
}

/** The cells of a pipe row; outer pipes optional, `\|` is not a separator. */
function rowCells(line: string): string[] {
  const body = line.trim();
  const cells: string[] = [];
  let buffer = "";
  let index = body.startsWith("|") ? 1 : 0;
  for (; index < body.length; index++) {
    const ch = body[index] ?? "";
    if (ch === "\\" && body[index + 1] === "|") {
      buffer += "\\|";
      index++;
      continue;
    }
    if (ch === "|") {
      cells.push(buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  if (buffer.trim() !== "") cells.push(buffer);
  return cells;
}

function delimiterFor(width: number, typed: string[] = []): string {
  const cells: string[] = [];
  for (let column = 0; column < width; column++) {
    const cell = (typed[column] ?? "").trim();
    cells.push(DELIMITER_CELL_RE.test(cell) ? cell : "---");
  }
  return `| ${cells.join(" | ")} |`;
}

const holdLoneMarker: RemendHandler = {
  name: "bc-hold-lone-marker",
  // Before the built-ins: a lone `*` or backtick must not be "completed".
  priority: -1,
  handle(text) {
    const start = lastLineStart(text);
    const line = text.slice(start);
    if (!LONE_MARKER_RE.test(line) || isWithinCodeBlock(text, start)) return text;
    return text.slice(0, start);
  },
};

const tableHeader: RemendHandler = {
  name: "bc-table-header",
  priority: 110,
  handle(input) {
    // A row that just got its newline is still the last row.
    const text = input.endsWith("\n") && !input.endsWith("\n\n") ? input.slice(0, -1) : input;
    const start = lastLineStart(text);
    const line = text.slice(start);
    if (!ROW_RE.test(line) || isWithinCodeBlock(text, start)) return input;

    const before = start > 0 ? text.slice(0, start - 1) : "";
    const previousStart = lastLineStart(before);
    const previous = start > 0 ? before.slice(previousStart) : "";
    const twoBack = previousStart > 0 ? lastLineStart(before.slice(0, previousStart - 1)) : -1;
    const lineTwoBack = twoBack >= 0 ? before.slice(twoBack, previousStart - 1) : "";

    // A header row on its own: give it the delimiter it is about to get.
    if (!ROW_RE.test(previous)) {
      const width = rowCells(line).length;
      if (width === 0) return input;
      return `${text}\n${delimiterFor(width)}`;
    }

    // Header plus a delimiter still being typed: finish the delimiter.
    if (DELIMITER_RE.test(line) && !ROW_RE.test(lineTwoBack)) {
      const width = rowCells(previous).length;
      if (width === 0) return input;
      return `${text.slice(0, start)}${delimiterFor(width, rowCells(line))}`;
    }
    return input;
  },
};

// An emphasis or code marker that has nothing after it yet. remend completes
// `**b` but leaves `**` alone, which would show the markers for a frame.
const DANGLING_MARKER_RE = /(^|[ \t(])(?:\*{1,3}|_{1,3}|~{1,2}|`{1,2})$/;
// `[label]` at the very end may still become a link; until then, its label.
const TRAILING_LABEL_RE = /\[([^\[\]\n]{2,})\]$/;

const holdDanglingSyntax: RemendHandler = {
  name: "bc-hold-dangling-syntax",
  priority: 120,
  handle(text) {
    const start = lastLineStart(text);
    if (isWithinCodeBlock(text, text.length)) return text;
    const marker = DANGLING_MARKER_RE.exec(text.slice(start));
    if (marker !== null) return text.slice(0, start + marker.index + (marker[1] ?? "").length);
    const label = TRAILING_LABEL_RE.exec(text.slice(start));
    if (label !== null) {
      return `${text.slice(0, start + label.index)}${label[1] ?? ""}`;
    }
    return text;
  },
};

const OPTIONS = {
  katex: false,
  inlineKatex: false,
  linkMode: "text-only" as const,
  singleTilde: false,
  comparisonOperators: false,
  handlers: [holdLoneMarker, tableHeader, holdDanglingSyntax],
};

/** The tail block as it should be drawn while it is still being written. */
export function repairTail(raw: string): string {
  return remend(raw, OPTIONS);
}
