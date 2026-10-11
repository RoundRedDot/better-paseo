/**
 * Finds the real structure in a reasoning stream (plan §3.4 item 1, BC-02).
 *
 * Two shapes carry steps of their own and are drawn as sections:
 *
 * - Codex reasoning summaries: each step opens with a standalone `**Title**`
 *   line. One such line is enough; text before the first title becomes an
 *   untitled intro.
 * - Markdown documents with at least two headings of one level.
 *
 * Everything else is prose and is never split: Claude's thinking is one run
 * of paragraphs, and an ordered list stays a list for the Markdown renderer
 * rather than being promoted to numbered steps.
 *
 * Reasoning text only ever grows while it streams, so `createReasoningSegmenter`
 * scans just the newly completed lines on each update. The unterminated last
 * line is re-read every time (the one-line lookback): it may be a title whose
 * closing `**` has not arrived yet, and is held back until the line settles.
 */

export interface ReasoningSection {
  /** The step's title, without its markers. Null for the intro before the first title. */
  title: string | null;
  /** The step's Markdown body, without the title line and surrounding blank lines. */
  body: string;
}

export type ReasoningSegmentation =
  | {
      kind: "sections";
      /** In order; an untitled intro, when present, comes first. */
      sections: readonly ReasoningSection[];
      /** Titled sections only: what the header counts as steps. */
      steps: number;
    }
  | { kind: "prose"; body: string };

export interface SegmentOptions {
  /**
   * The text may still grow. Its unterminated last line is then provisional:
   * a line that could still become a `**Title**` is withheld from every body
   * instead of flashing as literal asterisks.
   */
  streaming?: boolean;
}

interface Mark {
  kind: "bold" | "heading";
  /** Heading level 1-6; 0 for bold titles. */
  level: number;
  title: string;
  /** Offset of the title line's first character. */
  start: number;
  /** Offset just past the title line (after its newline, or the text's end). */
  end: number;
}

interface Fence {
  char: string;
  length: number;
}

// Hermes (D9): plain function-scoped regexes, no `v` flag, no lookbehind needed.
const BOLD_TITLE = /^ {0,3}\*\*([^*\n]+)\*\*[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
/** A line that could still turn into a bold title once more text arrives. */
const BOLD_PREFIX = /^ {0,3}\*{1,2}[^*\n]*\*{0,2}[ \t]*$/;

function readMark(line: string, start: number, end: number): Mark | null {
  const bold = BOLD_TITLE.exec(line);
  if (bold) {
    const title = (bold[1] ?? "").trim();
    return title ? { kind: "bold", level: 0, title, start, end } : null;
  }
  const heading = HEADING.exec(line);
  if (heading) {
    const title = (heading[2] ?? "").trim();
    return title ? { kind: "heading", level: (heading[1] ?? "#").length, title, start, end } : null;
  }
  return null;
}

/** The fence a line opens, or null. */
function openFence(line: string): Fence | null {
  const match = FENCE_OPEN.exec(line);
  if (!match) return null;
  const run = match[1] ?? "";
  const char = run.charAt(0);
  // A backtick fence's info string may not contain backticks (CommonMark).
  if (char === "`" && line.slice(line.indexOf(run) + run.length).includes("`")) return null;
  return { char, length: run.length };
}

function closesFence(line: string, fence: Fence): boolean {
  const trimmed = line.trim();
  if (trimmed.length < fence.length || line.length - line.trimStart().length > 3) return false;
  for (let index = 0; index < trimmed.length; index++) {
    if (trimmed.charAt(index) !== fence.char) return false;
  }
  return true;
}

/** Drops blank lines before the body and whitespace after it, keeping indentation. */
function tidy(body: string): string {
  let start = 0;
  for (let index = 0; index < body.length; index++) {
    const char = body.charAt(index);
    if (char === "\n") start = index + 1;
    else if (char !== " " && char !== "\t" && char !== "\r") break;
  }
  let end = body.length;
  while (end > start && /\s/.test(body.charAt(end - 1))) end--;
  return start === 0 && end === body.length ? body : body.slice(start, end);
}

/** Pure: which marks split the text, or null for prose. */
function chooseBoundaries(marks: readonly Mark[]): Mark[] | null {
  const bold = marks.filter((mark) => mark.kind === "bold");
  if (bold.length > 0) return bold;
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const mark of marks) counts[mark.level] = (counts[mark.level] ?? 0) + 1;
  for (let level = 1; level <= 6; level++) {
    if ((counts[level] ?? 0) >= 2) return marks.filter((mark) => mark.level === level);
  }
  return null;
}

function sameSection(a: ReasoningSection | undefined, title: string | null, body: string): boolean {
  return a !== undefined && a.title === title && a.body === body;
}

/**
 * Builds the result from marks. `previous` lends its section objects back
 * when a section came out identical, so memoised section views keyed on the
 * object (or its body) skip the render.
 */
function build(
  text: string,
  visibleEnd: number,
  marks: readonly Mark[],
  previous: ReasoningSegmentation | null,
): ReasoningSegmentation {
  const boundaries = chooseBoundaries(marks);
  if (!boundaries) {
    const body = tidy(text.slice(0, visibleEnd));
    if (previous && previous.kind === "prose" && previous.body === body) return previous;
    return { kind: "prose", body };
  }
  const prior = previous && previous.kind === "sections" ? previous.sections : [];
  const sections: ReasoningSection[] = [];
  const reuse = (title: string | null, body: string): void => {
    const candidate = prior[sections.length];
    sections.push(sameSection(candidate, title, body) && candidate ? candidate : { title, body });
  };
  const first = boundaries[0];
  if (first) {
    const intro = tidy(text.slice(0, first.start));
    if (intro) reuse(null, intro);
  }
  boundaries.forEach((mark, index) => {
    const next = boundaries[index + 1];
    const stop = next ? next.start : Math.max(mark.end, visibleEnd);
    reuse(mark.title, tidy(text.slice(mark.end, stop)));
  });
  if (
    previous &&
    previous.kind === "sections" &&
    previous.sections.length === sections.length &&
    previous.sections.every((section, index) => section === sections[index])
  ) {
    return previous;
  }
  return { kind: "sections", sections, steps: boundaries.length };
}

export interface ReasoningSegmenter {
  /** Segments `text`, reusing the scan of whatever prefix it shares with the last call. */
  update(text: string, options?: SegmentOptions): ReasoningSegmentation;
}

/**
 * An incremental segmenter for one growing text. Each `update` scans only
 * the lines completed since the previous call, plus the open last line. A
 * text that does not extend the previous one starts over.
 */
export function createReasoningSegmenter(): ReasoningSegmenter {
  let scanned = "";
  /** Offset of the first line not yet scanned (always a line start). */
  let scannedTo = 0;
  let fence: Fence | null = null;
  let marks: Mark[] = [];
  let lastText: string | null = null;
  let lastStreaming = false;
  let last: ReasoningSegmentation | null = null;

  function reset(): void {
    scanned = "";
    scannedTo = 0;
    fence = null;
    marks = [];
    last = null;
  }

  return {
    update(text, options) {
      const streaming = options?.streaming === true;
      if (text === lastText && streaming === lastStreaming && last) return last;
      if (!text.startsWith(scanned)) reset();

      // Complete lines since the last scan. Their classification is final.
      let lineStart = scannedTo;
      let newline = text.indexOf("\n", lineStart);
      while (newline >= 0) {
        const line = text.slice(lineStart, newline);
        if (fence) {
          if (closesFence(line, fence)) fence = null;
        } else {
          const opened = openFence(line);
          if (opened) fence = opened;
          else {
            const mark = readMark(line, lineStart, newline + 1);
            if (mark) marks.push(mark);
          }
        }
        lineStart = newline + 1;
        newline = text.indexOf("\n", lineStart);
      }
      scannedTo = lineStart;
      scanned = text.slice(0, scannedTo);

      // The open last line: provisional while streaming, final otherwise.
      let visibleEnd = text.length;
      let tailMarks: Mark[] = marks;
      const tail = text.slice(lineStart);
      if (tail && !fence) {
        if (streaming && BOLD_PREFIX.test(tail)) {
          // `**Underst` or `**Title**` with no newline yet: maybe a title,
          // maybe bold prose. Hold it back until the line ends.
          visibleEnd = lineStart;
        } else {
          const mark = readMark(tail, lineStart, text.length);
          if (mark) tailMarks = marks.concat(mark);
        }
      }

      last = build(text, visibleEnd, tailMarks, last);
      lastText = text;
      lastStreaming = streaming;
      return last;
    },
  };
}

/** One-shot segmentation. Prefer `createReasoningSegmenter` for a streaming text. */
export function segmentReasoning(text: string, options?: SegmentOptions): ReasoningSegmentation {
  return createReasoningSegmenter().update(text, options);
}

/** The segmentation as plain Markdown again, for copying the whole thought. */
export function reasoningText(segmentation: ReasoningSegmentation): string {
  if (segmentation.kind === "prose") return segmentation.body;
  return segmentation.sections
    .map((section) => (section.title ? `**${section.title}**\n\n${section.body}` : section.body))
    .join("\n\n");
}
