import React from "react";
import { expect, it, vi } from "vitest";
import type { ToolCallView } from "../../client/tools/classify";
import { hostStacksRows, noteRowGap, resetHostRowGap } from "../../client/host-row-gap";
import {
  hasEntryAfter, nextEntryIsRow, registerTimelineEntry, useHasEntryAfter, useNextEntryIsRow, useTimelineEntry, useTimelineToolGroup, type ViewBox,
} from "../../client/timeline-order";

const regroupProbe = vi.hoisted(() => ({ read: undefined as ((entries: readonly object[]) => void) | undefined }));
vi.mock("../../client/tools/group", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../client/tools/group")>();
  return {
    ...original,
    groupAdjacentTools: <T extends { tool?: ToolCallView }>(entries: readonly T[]) => {
      regroupProbe.read?.(entries);
      return original.groupAdjacentTools(entries);
    },
  };
});

function observeTimestamps(entries: readonly object[], onRead: () => void): void {
  for (const entry of entries) {
    const at = Reflect.get(entry, "at");
    Object.defineProperty(entry, "at", { configurable: true, get: () => { onRead(); return at; } });
  }
}

await import("./helpers/quiet-renderer");
const { act, create } = await import("react-test-renderer");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Snapshot = ReturnType<typeof useTimelineToolGroup>;

interface ToolRow {
  key: string;
  callId: string;
  at: number;
  path?: string;
  settled?: boolean;
  stamp?: number;
  box?: ViewBox;
  measure?: () => ViewBox;
  output?: string;
}

async function mountTools(agentId: string, rows: ToolRow[]) {
  const snapshots = new Map<string, Snapshot>();
  function Tool({ row }: { row: ToolRow }) {
    const box = row.box;
    const measure = row.measure;
    const view = React.useMemo(() => ({
      current: measure ? { getBoundingClientRect: measure } : box && { getBoundingClientRect: () => box },
    }), [box, measure]);
    const tool = React.useMemo<ToolCallView>(() => ({
      id: row.callId, callId: row.callId, title: row.callId, tool: row.path ? "read" : "shell",
      filePath: row.path, status: row.settled ? "completed" : "running", output: row.output,
    }), [row]);
    snapshots.set(row.key, useTimelineToolGroup(agentId, row.at, tool, row.settled, view, true, row.stamp));
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  const elements = (items: ToolRow[]) => React.createElement(React.Fragment, null,
    ...items.map((row) => React.createElement(Tool, { key: row.key, row })));
  await act(async () => { renderer = create(elements(rows)); });
  return { snapshots, update: (items: ToolRow[]) => renderer.update(elements(items)), unmount: () => renderer.unmount() };
}

it("uses the last copy of a merged run and the first strictly later kind in both panes", async () => {
  const agent = "neighbours-panes";
  const box = (left: number, top: number) => ({ left, top, width: 500, height: 40 });
  const { snapshots, unmount } = await mountTools(agent, [
    { key: "tail-right", callId: "tail", path: "a.ts", at: 30, stamp: 20, box: box(600, 200) },
    { key: "head-left", callId: "head", path: "a.ts", at: 10, box: box(0, 100) },
    { key: "head-right", callId: "head", path: "a.ts", at: 10, box: box(600, 100) },
    { key: "tail-left", callId: "tail", path: "a.ts", at: 20, box: box(0, 200) },
  ]);
  let forgetPrompt!: () => void;
  let forgetThought!: () => void;
  let forgetNotice!: () => void;
  let forgetEarlier!: () => void;
  const expectBoth = (anythingBelow: boolean, rowBelow: boolean) => {
    for (const key of ["head-left", "head-right"]) {
      expect(snapshots.get(key)).toMatchObject({ anythingBelow, rowBelow });
      expect(snapshots.get(key)?.group?.map((tool) => tool.callId)).toEqual(["head", "tail"]);
    }
    expect(snapshots.get("tail-right")?.group).toBeNull();
  };
  try {
    await act(async () => { forgetEarlier = registerTimelineEntry(agent, 25, "reply"); });
    expectBoth(false, false);
    await act(async () => {
      forgetNotice = registerTimelineEntry(agent, 40, "notice");
      forgetThought = registerTimelineEntry(agent, 40, "thought");
      forgetPrompt = registerTimelineEntry(agent, 40, "prompt");
    });
    expectBoth(true, false);
    await act(async () => forgetPrompt());
    expectBoth(true, true);
  } finally {
    await act(async () => { unmount(); forgetEarlier?.(); forgetNotice?.(); forgetThought?.(); forgetPrompt?.(); });
  }
});

it("counts an unkeyed tool after a merged run in the same millisecond", async () => {
  const agent = "neighbours-merged-tie";
  const { snapshots, unmount } = await mountTools(agent, [
    { key: "head", callId: "head", path: "a.ts", at: 10 },
    { key: "tail", callId: "tail", path: "a.ts", at: 10 },
  ]);
  let forget!: () => void;
  try {
    expect(snapshots.get("head")).toMatchObject({ anythingBelow: false, rowBelow: false });
    await act(async () => { forget = registerTimelineEntry(agent, 10, "tool"); });
    expect(snapshots.get("head")).toMatchObject({ anythingBelow: true, rowBelow: false });
  } finally {
    await act(async () => { unmount(); forget?.(); });
  }
});

it.each([false, true])("considers a same-time settled thought below a settled call (settled=%s)", async (settled) => {
  const agent = `neighbours-settled-${settled}`;
  const forget = registerTimelineEntry(agent, 10, "thought", "thought", () => ({ left: 0, top: 100, width: 500, height: 40 }));
  const { snapshots, unmount } = await mountTools(agent, [
    { key: "tool", callId: "tool", settled, at: 10, box: { left: 0, top: 20, width: 500, height: 40 } },
  ]);
  try {
    expect(snapshots.get("tool")).toMatchObject({ anythingBelow: settled, rowBelow: false });
  } finally {
    await act(async () => { unmount(); forget(); });
  }
});

it("orders a settled and a still-running call in the same millisecond by their views", async () => {
  const box = (top: number): ViewBox => ({ left: 0, top, width: 500, height: 40 });
  const { snapshots, unmount } = await mountTools("neighbours-mixed-status", [
    { key: "settled", callId: "settled", settled: true, at: 10, box: box(20) },
    { key: "running", callId: "running", at: 10, box: box(80) },
  ]);
  try {
    expect(snapshots.get("settled")).toMatchObject({ anythingBelow: true, rowBelow: false });
    expect(snapshots.get("running")).toMatchObject({ anythingBelow: false, rowBelow: false });
  } finally {
    await act(async () => unmount());
  }
});

it("reads timestamps linearly after sorting many standalone runs", async () => {
  const count = 128;
  let reads = 0;
  let regroups = 0;
  regroupProbe.read = (entries) => {
    regroups++;
    // Start at grouping, after the sort. Counting reads rejects either full
    // scan without depending on hardware speed or a production counter.
    observeTimestamps(entries, () => { reads++; });
  };
  let unmount: (() => void) | undefined;
  try {
    const mounted = await mountTools("neighbours-scan-budget", Array.from({ length: count }, (_, index) => ({
      key: `call-${index}`, callId: `call-${index}`, at: index,
    })));
    unmount = mounted.unmount;
    expect(mounted.snapshots.size).toBe(count);
    expect(regroups).toBe(1);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThan(12 * count);
  } finally {
    regroupProbe.read = undefined;
    await act(async () => unmount?.());
  }
});

it("reuses indexed positions across separate neighbour lookups", async () => {
  const agent = "lookup-scan-budget";
  const count = 128;
  let reads = 0;
  regroupProbe.read = (entries) => observeTimestamps(entries, () => { reads++; });
  const forget = Array.from({ length: count }, (_, index) => registerTimelineEntry(agent, index, "thought"));
  let mounted: Awaited<ReturnType<typeof mountTools>> | undefined;
  try {
    mounted = await mountTools(agent, [{ key: "tool", callId: "tool", at: count }]);
    nextEntryIsRow(agent, 0, "thought");
    reads = 0;
    for (let index = 0; index < count; index++) {
      expect(hasEntryAfter(agent, index, "thought")).toBe(true);
      expect(nextEntryIsRow(agent, index, "thought")).toBe(true);
    }
    expect(reads).toBeLessThan(12 * count);
  } finally {
    regroupProbe.read = undefined;
    await act(async () => { mounted?.unmount(); for (const remove of forget) remove(); });
  }
});

it("rechecks placement on rerender without remeasuring every tied item for every reader", async () => {
  const agent = "lookup-render-tie";
  const count = 24;
  const snapshots = new Map<number, boolean>();
  let placed = false;
  let measures = 0;
  const forget = Array.from({ length: count }, (_, index) => registerTimelineEntry(agent, 10, "thought", `thought-${index}`, () => {
    measures++;
    if (index === count - 1 && !placed) return null;
    return { left: 0, top: index * 100, width: 500, height: 40 };
  }));
  function Reader({ index }: { index: number }) {
    snapshots.set(index, useHasEntryAfter(agent, 10, "thought", `thought-${index}`));
    return null;
  }
  const readers = () => React.createElement(React.Fragment, null,
    ...Array.from({ length: count }, (_, index) => React.createElement(Reader, { key: index, index })));
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(readers()); });
    expect(snapshots.get(count - 1)).toBe(true);
    measures = 0;
    await act(async () => { renderer.update(readers()); });
    expect(measures).toBeLessThan(4 * count);

    // A hidden view can become measurable without any entry mounting or leaving.
    placed = true;
    await act(async () => { renderer.update(readers()); });
    expect(snapshots.get(count - 1)).toBe(false);
    expect(snapshots.get(0)).toBe(true);
  } finally {
    await act(async () => { renderer?.unmount(); for (const remove of forget) remove(); });
  }
});

it("measures an unplaced newest tie once per regroup and retries on the next regroup", async () => {
  const agent = "neighbours-unplaced";
  const { snapshots, unmount } = await mountTools(agent, Array.from({ length: 12 }, (_, index) => ({
    key: `call-${index}`, callId: `call-${index}`, settled: true, at: 10,
    box: { left: 0, top: index * 100, width: 500, height: 40 },
  })));
  let measurements = 0;
  let placed = false;
  let forget!: () => void;
  let forgetPrompt!: () => void;
  try {
    await act(async () => {
      forget = registerTimelineEntry(agent, 10, "thought", "thought", () => {
        measurements++;
        return placed ? { left: 0, top: 20, width: 500, height: 40 } : null;
      });
    });
    expect(measurements).toBe(1);
    expect(snapshots.get("call-11")).toMatchObject({ anythingBelow: true, rowBelow: false });
    placed = true;
    await act(async () => { forgetPrompt = registerTimelineEntry(agent, 5, "prompt"); });
    expect(measurements).toBe(2);
    expect(snapshots.get("call-11")).toMatchObject({ anythingBelow: false, rowBelow: false });
  } finally {
    await act(async () => { unmount(); forget?.(); forgetPrompt?.(); });
  }
});

it("shares an unplaced tie only across snapshots notified for the same agent", async () => {
  const agent = "lookup-unplaced";
  const count = 12;
  let measures = 0;
  function Reader({ index }: { index: number }) {
    useHasEntryAfter(agent, 10, "thought", `thought-${index}`);
    return null;
  }
  const forget = Array.from({ length: count }, (_, index) => registerTimelineEntry(agent, 10, "thought", `thought-${index}`, () => {
    measures++;
    return index === count - 1 ? null : { left: 0, top: index * 100, width: 500, height: 40 };
  }));
  let renderer!: ReturnType<typeof create>;
  let forgetOther!: () => void;
  let forgetPrompt!: () => void;
  try {
    await act(async () => {
      renderer = create(React.createElement(React.Fragment, null,
        ...Array.from({ length: count }, (_, index) => React.createElement(Reader, { key: index, index }))));
    });
    measures = 0;
    await act(async () => { forgetOther = registerTimelineEntry("lookup-unrelated", 20, "reply"); });
    expect(measures).toBe(0);
    await act(async () => { forgetPrompt = registerTimelineEntry(agent, 5, "prompt"); });
    expect(measures).toBe(count);
    expect(hasEntryAfter(agent, 10, "thought", "thought-0")).toBe(true);
    expect(hasEntryAfter(agent, 10, "thought", "thought-1")).toBe(true);
    expect(measures).toBe(count + 2);
    await act(async () => forgetPrompt());
    expect(measures).toBe(2 * count + 2);
  } finally {
    await act(async () => { renderer?.unmount(); for (const remove of forget) remove(); forgetOther?.(); forgetPrompt?.(); });
  }
});

it("notifies an existing reader when its agent's last item is replaced in the same batch", async () => {
  const agent = "lookup-replacement";
  let snapshot: readonly boolean[] = [];
  function Reader() {
    snapshot = [useHasEntryAfter(agent, 10, "reply"), useNextEntryIsRow(agent, 10, "reply")];
    return null;
  }
  const forgetFirst = registerTimelineEntry(agent, 5, "prompt");
  let forgetNext!: () => void;
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(React.createElement(Reader)); });
    expect(snapshot).toEqual([false, false]);
    await act(async () => { forgetFirst(); forgetNext = registerTimelineEntry(agent, 20, "thought"); });
    expect(snapshot).toEqual([true, true]);
    await act(async () => forgetNext());
    expect(snapshot).toEqual([false, false]);
  } finally {
    await act(async () => { renderer?.unmount(); forgetFirst(); forgetNext?.(); });
  }
});

it("probes unknown host spacing once after layout effects and before the ordinary snapshots", async () => {
  const agent = "probe-one-batch";
  let measured = 0;
  let gapInLayout: boolean | null | undefined;
  let gapWhenRowAppears: boolean | null | undefined;
  function Row({ index, step }: { index: number; step: number }) {
    const view = React.useMemo(() => ({ current: { getBoundingClientRect: () => {
      measured++;
      return { left: 0, top: index * step, width: 500, height: 40 };
    } } }), [index, step]);
    useTimelineEntry(agent, index, "thought", undefined, view);
    React.useLayoutEffect(() => { gapInLayout = hostStacksRows(); }, []);
    return null;
  }
  function Reader() {
    if (useNextEntryIsRow(agent, -1, "reply")) gapWhenRowAppears = hostStacksRows();
    return null;
  }
  const reader = React.createElement(Reader, { key: "reader" });
  const rows = (n: number, step: number) => React.createElement(React.Fragment, null, reader,
    ...Array.from({ length: n }, (_, index) => React.createElement(Row, { key: index, index, step })));
  let renderer!: ReturnType<typeof create>;
  resetHostRowGap();
  try {
    await act(async () => { renderer = create(rows(128, 100)); });
    expect(measured).toBe(128);
    expect(hostStacksRows()).toBeNull();
    // New registrations use the same batch as the ordinary spacing snapshots.
    await act(async () => { renderer.unmount(); });
    measured = 0;
    await act(async () => { renderer = create(rows(0, 40)); });
    await act(async () => { renderer.update(rows(2, 40)); });
    expect(gapInLayout).toBeNull();
    expect(gapWhenRowAppears).toBe(true);
    expect(measured).toBe(2);
  } finally {
    await act(async () => renderer?.unmount());
    resetHostRowGap();
  }
});

it("samples split calls together and reuses progress for unchanged result objects", async () => {
  const agent = "split-one-sample";
  const count = 8;
  const largeOutput = "sample-output-".repeat(10_000);
  let measures = 0;
  let serializations = 0;
  const stringify = JSON.stringify;
  const spy = vi.spyOn(JSON, "stringify").mockImplementation(((value: unknown, ...args: unknown[]) => {
    if (value && typeof value === "object" && "output" in value && typeof value.output === "string" &&
      value.output.startsWith("sample-output-")) serializations++;
    return Reflect.apply(stringify, JSON, [value, ...args]);
  }) as typeof JSON.stringify);
  const rows = Array.from({ length: count }, (_, index) => [false, true].map((duplicate) => ({
    key: `${index}-${duplicate}`,
    callId: `split-${index}`,
    at: index * 2 + Number(duplicate),
    settled: true,
    output: largeOutput,
    measure: () => {
      measures++;
      // The first pair's difference rounds to exactly 1 across zero.
      const left = index === 0 ? (duplicate ? 1 : -Number.EPSILON / 4) : (duplicate ? 0.9 : -0.05);
      return { left, top: index * 100, width: duplicate ? 500.3 : 499.5, height: duplicate ? 20 : 40 };
    },
  }))).flat();
  let mounted: Awaited<ReturnType<typeof mountTools>> | undefined;
  let forget!: () => void;
  resetHostRowGap();
  noteRowGap(16);
  try {
    mounted = await mountTools(agent, rows);
    expect(measures).toBe(4 * count);
    expect(serializations).toBe(2 * count);
    expect(mounted.snapshots.get("0-false")?.copiesBelow).toBe(1);
    expect(mounted.snapshots.get("0-true")?.group).toBeNull();

    await act(async () => { forget = registerTimelineEntry(agent, -1, "prompt"); });
    expect(serializations).toBe(2 * count);
    const updated = [{ ...rows[0]!, output: `${largeOutput}more` }, ...rows.slice(1)];
    await act(async () => mounted!.update(updated));
    expect(serializations).toBe(2 * count + 1);
  } finally {
    await act(async () => { mounted?.unmount(); forget?.(); });
    spy.mockRestore();
    resetHostRowGap();
  }
});
