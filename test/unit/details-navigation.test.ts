import { describe, expect, it } from "vitest";
import type { BlockEntry } from "../../client/details/contracts";
import { indexOf, neighbour, orderBlocks, rememberBlockMeasurement } from "../../client/details/navigation";

function entry(id: string, options: Partial<BlockEntry> = {}): BlockEntry {
  return {
    id,
    agentId: "nav-agent",
    at: 1,
    kind: "tool",
    seq: 0,
    navigable: true,
    hasBody: true,
    mounted: true,
    title: id,
    titleMono: false,
    subtitle: [],
    icon: "file",
    readsImage: false,
    render: () => null,
    copies: () => [],
    ...options,
  };
}

describe("block ordering", () => {
  it("orders by timestamp, kind, and sequence", () => {
    const late = entry("late", { at: 20, seq: 0 });
    const tool2 = entry("tool-2", { at: 10, seq: 2 });
    const thought = entry("thought", { at: 10, kind: "thought", seq: 9 });
    const tool1 = entry("tool-1", { at: 10, seq: 1 });
    expect(orderBlocks([late, tool2, thought, tool1]).map((block) => block.id))
      .toEqual(["thought", "tool-1", "tool-2", "late"]);
  });

  it("uses cached measured top for timestamps within one millisecond", () => {
    const lower = entry("lower", { at: 10, kind: "thought", seq: 0 });
    const upper = entry("upper", { at: 11, kind: "tool", seq: 1 });
    rememberBlockMeasurement(lower, { top: 200, height: 10 });
    rememberBlockMeasurement(upper, { top: 100, height: 10 });
    expect(orderBlocks([lower, upper]).map((block) => block.id)).toEqual(["upper", "lower"]);
  });

  it("falls back to kind order and then seq when measurements are not both available", () => {
    const tool = entry("tool", { at: 10, kind: "tool", seq: 0 });
    const thought = entry("thought", { at: 11, kind: "thought", seq: 8 });
    expect(orderBlocks([tool, thought]).map((block) => block.id)).toEqual(["thought", "tool"]);
  });
});

describe("navigable sequence", () => {
  const list = [
    entry("one", { seq: 1 }),
    entry("merged-member", { seq: 2, navigable: false }),
    entry("inert", { seq: 3, hasBody: false }),
    entry("two", { seq: 4 }),
  ];

  it("steps over non-navigable and bodiless entries", () => {
    expect(neighbour(list, "one", 1)?.id).toBe("two");
    expect(neighbour(list, "two", -1)?.id).toBe("one");
    expect(neighbour(list, "one", -1)).toBeNull();
    expect(neighbour(list, "inert", 1)).toBeNull();
  });

  it("reports a one-based index and navigable count", () => {
    expect(indexOf(list, "one")).toEqual({ index: 1, count: 2 });
    expect(indexOf(list, "two")).toEqual({ index: 2, count: 2 });
    expect(indexOf(list, "inert")).toEqual({ index: 0, count: 2 });
  });
});
