import { describe, expect, it } from "vitest";
import {
  StreamAccumulator,
  parseFixture,
  phaseFor,
  type FixtureEvent,
} from "../../.showcase/replay-core";

const text = (type: "assistant_message" | "reasoning", chunk: string, t = 0): FixtureEvent => ({
  t,
  mode: "append",
  item: { type, text: chunk },
});

const tool = (status: "running" | "completed"): FixtureEvent => ({
  t: 0,
  mode: "replace",
  item: {
    type: "tool_call",
    callId: "c1",
    name: "bash",
    status,
    error: null,
    detail: { type: "shell", command: "ls" },
  } as FixtureEvent["item"],
});

describe("parseFixture", () => {
  it("reads the meta line and the event lines", () => {
    const fixture = parseFixture(
      [
        '{"kind":"meta","name":"n","description":"d","scenario":"s"}',
        '{"t":5,"item":{"type":"reasoning","text":"hm"},"mode":"append"}',
        "",
      ].join("\n"),
    );
    expect(fixture.meta).toEqual({ name: "n", description: "d", scenario: "s" });
    expect(fixture.events).toHaveLength(1);
  });

  it("rejects a fixture without a meta line", () => {
    expect(() => parseFixture('{"t":0,"item":{},"mode":"append"}')).toThrow(/meta/);
  });
});

describe("StreamAccumulator", () => {
  it("merges consecutive deltas of one type into one item with a new identity", () => {
    const acc = new StreamAccumulator();
    const first = acc.apply(text("reasoning", "a"))[0];
    acc.apply(text("reasoning", "b"));
    const merged = acc.items;
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(first?.id);
    expect(merged[0]?.source).not.toBe(first?.source);
    expect(merged[0]?.source).toMatchObject({ text: "ab" });
  });

  it("starts a new item of the same type after another type intervenes", () => {
    const acc = new StreamAccumulator();
    acc.apply(text("assistant_message", "one"));
    acc.apply(tool("running"));
    acc.apply(text("assistant_message", "two"));
    expect(acc.items.map((e) => e.source.type)).toEqual([
      "assistant_message",
      "tool_call",
      "assistant_message",
    ]);
  });

  it("replaces a tool call by callId in place", () => {
    const acc = new StreamAccumulator();
    acc.apply(tool("running"));
    acc.apply(text("assistant_message", "x"));
    acc.apply(tool("completed"));
    expect(acc.items).toHaveLength(2);
    expect(acc.items[0]?.source).toMatchObject({ status: "completed" });
  });
});

describe("phaseFor", () => {
  it("streams only the newest text item and running tool calls", () => {
    const acc = new StreamAccumulator();
    acc.apply(text("reasoning", "r"));
    acc.apply(text("assistant_message", "a"));
    acc.apply(tool("running"));
    const items = acc.items;
    expect(phaseFor(items, 0, false)).toBe("complete");
    expect(phaseFor(items, 1, false)).toBe("complete");
    expect(phaseFor(items, 2, false)).toBe("streaming");
    expect(phaseFor(items, 2, true)).toBe("complete");
  });
});
