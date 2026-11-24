/**
 * The markdown-bearing texts of the stream fixtures: every assistant reply and
 * every reasoning item, accumulated the way the host merges deltas (a new item
 * of a text type starts after any event of another type).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const STREAMS_DIR = path.resolve(__dirname, "../../fixtures/streams");

export interface StreamText {
  fixture: string;
  kind: "assistant_message" | "reasoning";
  /** Index of the item among the fixture's text items. */
  index: number;
  /** The deltas in arrival order; joined they give `text`. */
  deltas: string[];
  text: string;
}

export function fixtureNames(): string[] {
  return readdirSync(STREAMS_DIR)
    .filter((file) => file.endsWith(".jsonl"))
    .map((file) => file.replace(/\.jsonl$/, ""))
    .sort();
}

export function streamTexts(fixture: string): StreamText[] {
  const lines = readFileSync(path.join(STREAMS_DIR, `${fixture}.jsonl`), "utf8").split("\n");
  const out: StreamText[] = [];
  let current: StreamText | null = null;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const event = JSON.parse(line) as { item?: { type: string; text?: string } };
    const item = event.item;
    if (!item) continue;
    if (item.type === "assistant_message" || item.type === "reasoning") {
      if (current === null || current.kind !== item.type) {
        current = { fixture, kind: item.type, index: out.length, deltas: [], text: "" };
        out.push(current);
      }
      current.deltas.push(item.text ?? "");
      current.text += item.text ?? "";
    } else {
      current = null;
    }
  }
  return out;
}

/** List items and sections the shortened long-history reply keeps. */
const LONG_REPLY_ITEMS = 40;
const LONG_REPLY_SECTIONS = 4;

/**
 * The long reply of `history-long-load` with the same shape and fewer
 * repeats: the whole opening paragraph, the first list items, the first
 * sections and the cut-off last section. Every boundary of the original
 * (paragraph to list, list to heading, section to section, a reply that ends
 * mid-paragraph) is still there. The 244-item list is one block until it
 * ends, so sweeping it character by character costs time quadratic in its
 * length while each further item only repeats the one before.
 */
function shortenLongHistoryReply(text: string): string {
  const listStart = text.indexOf("- Synthetic item 0:");
  const sections: number[] = [];
  for (let at = text.indexOf("## Synthetic section"); at !== -1; at = text.indexOf("## Synthetic section", at + 1)) {
    sections.push(at);
  }
  const lastSection = sections[sections.length - 1];
  if (listStart === -1 || lastSection === undefined || sections.length <= LONG_REPLY_SECTIONS + 1) {
    throw new Error("history-long-load: the long reply no longer has the expected shape");
  }
  const items = text.slice(listStart, sections[0]).split(/(?<=\n)/);
  if (items.length <= LONG_REPLY_ITEMS) throw new Error("history-long-load: the long reply's list is shorter than expected");
  return text.slice(0, listStart)
    + items.slice(0, LONG_REPLY_ITEMS).join("")
    + "\n"
    + text.slice(sections[0], sections[LONG_REPLY_SECTIONS])
    + text.slice(lastSection);
}

/**
 * The texts the exhaustive prefix sweeps feed character by character: every
 * non-empty text once (a fixture repeating a text adds nothing), with the
 * long-history reply shortened.
 */
export function sweepTexts(): StreamText[] {
  const seen = new Set<string>();
  const out: StreamText[] = [];
  let shortened = false;
  for (const fixture of fixtureNames()) {
    for (const item of streamTexts(fixture)) {
      if (item.text.trim() === "" || seen.has(item.text)) continue;
      seen.add(item.text);
      if (fixture === "history-long-load" && item.text.length > 50_000) {
        const text = shortenLongHistoryReply(item.text);
        out.push({ ...item, deltas: [text], text });
        shortened = true;
      } else {
        out.push(item);
      }
    }
  }
  if (!shortened) throw new Error("history-long-load: the long reply is missing");
  return out;
}
