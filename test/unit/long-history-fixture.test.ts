import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFixture, StreamAccumulator } from "../../.showcase/replay-core";
import { longHistoryFixture } from "../fixtures/streams/generate-history-long-load.mjs";

describe("long history benchmark fixture", () => {
  it("is deterministic and retains the incident's projected size and delayed tool updates", () => {
    const source = longHistoryFixture();
    expect(readFileSync(new URL("../fixtures/streams/history-long-load.jsonl", import.meta.url), "utf8")).toBe(source);
    const fixture = parseFixture(source);
    const accumulator = new StreamAccumulator();
    for (const event of fixture.events) accumulator.apply(event);
    expect(accumulator.items).toHaveLength(810);
    const counts = accumulator.items.reduce<Record<string, number>>((counts, row) => {
      counts[row.source.type] = (counts[row.source.type] ?? 0) + 1;
      return counts;
    }, {});
    expect(counts).toEqual({ user_message: 12, reasoning: 260, tool_call: 398, assistant_message: 140 });
    expect(Math.max(...accumulator.items.map((row) => "text" in row.source && typeof row.source.text === "string" ? row.source.text.length : 0))).toBe(59_427);
    expect(fixture.events.slice(-398).every((event) => event.item.type === "tool_call" && event.item.status === "completed")).toBe(true);
  });
});
