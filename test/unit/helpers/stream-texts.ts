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
