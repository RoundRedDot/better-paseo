/**
 * The one line a collapsed reasoning header shows (plan §3.4 item 3).
 *
 * | state | header |
 * |---|---|
 * | streaming, sections | `Thinking · <current section title>` |
 * | streaming, prose | `Thinking · <last complete sentence>` |
 * | done, sections | `Thought · 4 steps · 12s` |
 * | done, prose | `Thought · <first sentence> · 12s` |
 *
 * Pure, so the table is unit tested; the header component only draws it.
 */
import type { ReasoningSegmentation } from "./segment";

export interface ReasoningHeaderText {
  verb: "Thinking" | "Thought";
  /** Title or sentence; empty when there is nothing worth showing yet. */
  preview: string;
  /** Right-aligned facts: step count and observed duration. */
  meta: string[];
}

/** Only the tail is searched for the newest sentence; a header shows one line. */
const TAIL_WINDOW = 1200;
/** A preview longer than this is cut; the header truncates further to fit. */
const PREVIEW_MAX = 200;

/** Inline Markdown down to its words: what a one-line header can show. */
export function plainInline(text: string): string {
  return text
    .replace(/```[^\n]*/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string): string {
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1).trimEnd()}…` : text;
}

/** True for `.`, `!`, `?` and their full-width forms. */
function isTerminator(char: string): boolean {
  return (
    char === "." ||
    char === "!" ||
    char === "?" ||
    char === "。" ||
    char === "！" ||
    char === "？"
  );
}

/** Past the quotes, brackets and emphasis markers that close a sentence at `index`. */
function closersEnd(text: string, index: number): number {
  let next = index + 1;
  while (next < text.length && /["'\u201d\u2019)\]*_`]/.test(text.charAt(next))) next++;
  return next;
}

/** A terminator ends a sentence when whitespace or the end follows its closers. */
function endsSentence(text: string, index: number): boolean {
  if (!isTerminator(text.charAt(index))) return false;
  const char = text.charAt(index);
  // Full-width marks need no space after them.
  if (char === "。" || char === "！" || char === "？") return true;
  const next = closersEnd(text, index);
  return next >= text.length || /\s/.test(text.charAt(next));
}

/** The first sentence of the first paragraph, as plain words. */
export function firstSentence(text: string): string {
  const paragraph = text.trimStart().split(/\n\s*\n/)[0] ?? "";
  for (let index = 0; index < paragraph.length; index++) {
    if (endsSentence(paragraph, index)) {
      return clip(plainInline(paragraph.slice(0, closersEnd(paragraph, index))));
    }
  }
  return clip(plainInline(paragraph));
}

/**
 * The newest sentence that has finished, as plain words, or "" when none has.
 * The unfinished words after it are ignored, so the preview changes once per
 * sentence rather than once per chunk.
 */
export function lastCompleteSentence(text: string): string {
  const window = text.length > TAIL_WINDOW ? text.slice(-TAIL_WINDOW) : text;
  let end = -1;
  for (let index = window.length - 1; index >= 0; index--) {
    if (endsSentence(window, index)) {
      end = index;
      break;
    }
  }
  if (end < 0) return "";
  let start = 0;
  for (let index = end - 1; index >= 0; index--) {
    const char = window.charAt(index);
    if (char === "\n") {
      start = index + 1;
      break;
    }
    if (endsSentence(window, index)) {
      start = closersEnd(window, index);
      break;
    }
  }
  return clip(plainInline(window.slice(start, closersEnd(window, end))));
}

/** `12s`, `1m 05s`; null when nothing was observed. */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || !(ms > 0)) return null;
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest < 10 ? "0" : ""}${rest}s`;
}

export function reasoningHeaderText(
  segmentation: ReasoningSegmentation,
  streaming: boolean,
  durationMs: number | null,
): ReasoningHeaderText {
  const duration = formatDuration(durationMs);
  if (streaming) {
    if (segmentation.kind === "sections") {
      const sections = segmentation.sections;
      for (let index = sections.length - 1; index >= 0; index--) {
        const title = sections[index]?.title;
        if (title) return { verb: "Thinking", preview: clip(plainInline(title)), meta: [] };
      }
      // Only the intro so far: preview it like prose.
      return {
        verb: "Thinking",
        preview: lastCompleteSentence(sections[0]?.body ?? ""),
        meta: [],
      };
    }
    return { verb: "Thinking", preview: lastCompleteSentence(segmentation.body), meta: [] };
  }
  if (segmentation.kind === "sections") {
    const steps = segmentation.steps;
    const meta = [`${steps} ${steps === 1 ? "step" : "steps"}`];
    if (duration) meta.push(duration);
    return { verb: "Thought", preview: "", meta };
  }
  return {
    verb: "Thought",
    preview: firstSentence(segmentation.body),
    meta: duration ? [duration] : [],
  };
}
