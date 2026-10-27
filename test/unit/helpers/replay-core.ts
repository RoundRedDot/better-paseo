/**
 * The pure half of the replay harness: fixture parsing and the host's item
 * accumulation rules. No React, no DOM, so it is unit-testable and the browser
 * entry (`replay.tsx`) stays a thin driver.
 */
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export interface FixtureMeta {
  name: string;
  description: string;
  scenario: string;
}

export interface FixtureEvent {
  /** Milliseconds since the stream started. */
  t: number;
  item: AgentTimelineItem;
  mode: "append" | "replace";
}

export interface Fixture {
  meta: FixtureMeta;
  events: FixtureEvent[];
}

export function parseFixture(text: string): Fixture {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const first = lines[0] ? JSON.parse(lines[0]) : null;
  if (!first || first.kind !== "meta") throw new Error("fixture line 1 must be a meta record");
  const events = lines.slice(1).map((line, index) => {
    const record = JSON.parse(line) as Partial<FixtureEvent>;
    if (typeof record.t !== "number" || !record.item || !record.mode) {
      throw new Error(`fixture line ${index + 2} is not an event record`);
    }
    return record as FixtureEvent;
  });
  return {
    meta: { name: first.name, description: first.description, scenario: first.scenario },
    events,
  };
}

export interface StreamEntry {
  /** Stable for the life of the entry, like the host's stream item id. */
  id: string;
  source: AgentTimelineItem;
}

export type Phase = "streaming" | "complete";

/**
 * Accumulates events the way the host builds its stream: consecutive text
 * deltas of one type merge into one item, a tool call is keyed by `callId`,
 * and every update yields a new item identity so memoisation sees the change.
 */
export class StreamAccumulator {
  private entries: StreamEntry[] = [];
  private nextId = 0;

  apply(event: FixtureEvent): readonly StreamEntry[] {
    const { item, mode } = event;
    const last = this.entries[this.entries.length - 1];

    if (item.type === "assistant_message" || item.type === "reasoning") {
      if (last && last.source.type === item.type) {
        const previous = last.source as typeof item;
        const text = mode === "append" ? previous.text + item.text : item.text;
        this.replaceLast({ ...previous, ...item, text });
        return this.entries;
      }
    } else if (item.type === "tool_call") {
      const index = this.entries.findIndex(
        (entry) => entry.source.type === "tool_call" && entry.source.callId === item.callId,
      );
      if (index >= 0) {
        const existing = this.entries[index];
        if (existing) this.entries = this.withEntry(index, { id: existing.id, source: item });
        return this.entries;
      }
    } else if (item.type === "todo" && mode === "replace") {
      const index = this.findLastIndex("todo");
      if (index >= 0) {
        const existing = this.entries[index];
        if (existing) this.entries = this.withEntry(index, { id: existing.id, source: item });
        return this.entries;
      }
    }

    this.entries = [...this.entries, { id: `item-${this.nextId++}`, source: item }];
    return this.entries;
  }

  get items(): readonly StreamEntry[] {
    return this.entries;
  }

  private findLastIndex(type: AgentTimelineItem["type"]): number {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i]?.source.type === type) return i;
    }
    return -1;
  }

  private replaceLast(source: AgentTimelineItem): void {
    const index = this.entries.length - 1;
    const existing = this.entries[index];
    if (existing) this.entries = this.withEntry(index, { id: existing.id, source });
  }

  private withEntry(index: number, entry: StreamEntry): StreamEntry[] {
    const next = [...this.entries];
    next[index] = entry;
    return next;
  }
}

/**
 * The phase the host passes a transformer: text is streaming only while it is
 * the newest item of an unfinished stream, a tool call only while it runs.
 */
export function phaseFor(
  entries: readonly StreamEntry[],
  index: number,
  streamDone: boolean,
): Phase {
  if (streamDone) return "complete";
  const entry = entries[index];
  if (!entry) return "complete";
  const { source } = entry;
  if (source.type === "tool_call") return source.status === "running" ? "streaming" : "complete";
  if (source.type === "assistant_message" || source.type === "reasoning") {
    return index === entries.length - 1 ? "streaming" : "complete";
  }
  return "complete";
}
