/**
 * Offline replay harness: a miniature Paseo host driving this plugin's real
 * transformers and renderers from a recorded stream.
 *
 * It plays a fixture (see `replay-core.ts` for the schema), accumulates items
 * the way the host does, runs the plugin's own transformers with the phase the
 * host would pass, renders the result through the plugin's own renderers, and
 * leaves `window.__replayResult` holding the `__bcPerf` snapshot.
 *
 * Query string: `fixture` (name under /fixtures), `speed` (1 = recorded timing,
 * 0 = as fast as the page can render), `host` (`current` re-creates the theme
 * and re-parses the data on every render like Paseo 0.11.2; `cached` keeps both
 * stable like the planned host fix).
 *
 * Not simulated: the host's reveal cadence for reasoning text
 * (`useRevealedText` returns the text as is) and host-native rendering of
 * items the plugin declines (drawn as a plain placeholder row).
 */
import React, { memo, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { View, Text } from "react-native";
import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

import contribute from "../index.client";
import {
  StreamAccumulator,
  parseFixture,
  phaseFor,
  type Fixture,
  type Phase,
  type StreamEntry,
} from "./replay-core";

const DARK: PluginTheme["colors"] = {
  surface0: "#0f0f11",
  surface1: "#17171a",
  surface2: "#1f1f23",
  border: "#2a2a30",
  foreground: "#f2f3f5",
  foregroundMuted: "#a3a6ad",
  accent: "#7aa2f7",
  accentForeground: "#0f0f11",
  statusSuccess: "#4cb782",
  statusWarning: "#d9a53f",
  statusDanger: "#f2555a",
};

type HostMode = "current" | "cached";

interface Transformer {
  itemType: string;
  transform(input: { item: AgentTimelineItem; phase: Phase }): {
    items: Array<{ type: "plugin"; kind: string; version: number; data: unknown }>;
  } | undefined;
}

interface Renderer {
  kind: string;
  version: number;
  schema: { safeParse(value: unknown): { success: boolean; data?: unknown } };
  Component: React.ComponentType<PluginTimelineItemProps>;
}

/** Captures what `contribute` registers, the way the host's plugin registry would. */
function captureContributions() {
  const transformers: Transformer[] = [];
  const renderers: Renderer[] = [];
  const noop = () => {};
  const client = new Proxy(
    {
      addTimelineTransformer(contribution: {
        query: { itemType: string };
        transform: Transformer["transform"];
      }) {
        transformers.push({ itemType: contribution.query.itemType, transform: contribution.transform });
        return noop;
      },
      addTimelineRenderer(contribution: Renderer) {
        renderers.push(contribution);
        return noop;
      },
    },
    { get: (target, key) => (key in target ? Reflect.get(target, key) : () => noop) },
  ) as unknown as PluginClientContext;
  contribute(client);
  return { transformers, renderers };
}

type Row =
  | { id: string; kind: "plugin"; itemKind: string; version: number; data: unknown; at: Date }
  | { id: string; kind: "host"; text: string };

const EPOCH = new Date("2026-01-01T00:00:00Z");

interface TransformStats {
  count: number;
  totalMs: number;
  maxMs: number;
}

function hostText(item: AgentTimelineItem): string {
  return "text" in item && typeof item.text === "string" ? item.text : item.type;
}

function mount(fixture: Fixture, speed: number, hostMode: HostMode) {
  const { transformers, renderers } = captureContributions();
  const stats: TransformStats = { count: 0, totalMs: 0, maxMs: 0 };

  // Like the host's projection cache: a source item and phase transform once.
  const projection = new WeakMap<object, Map<Phase, Row[]>>();
  function project(entry: StreamEntry, phase: Phase, at: Date): Row[] {
    let byPhase = projection.get(entry.source);
    if (!byPhase) {
      byPhase = new Map();
      projection.set(entry.source, byPhase);
    }
    const cached = byPhase.get(phase);
    if (cached) return cached;
    const started = performance.now();
    const matched = transformers.filter((t) => t.itemType === entry.source.type);
    let result: ReturnType<Transformer["transform"]>;
    for (const transformer of matched) {
      result = transformer.transform({ item: entry.source, phase });
      if (result) break;
    }
    const elapsed = performance.now() - started;
    stats.count += 1;
    stats.totalMs += elapsed;
    if (elapsed > stats.maxMs) stats.maxMs = elapsed;
    const rows: Row[] = result
      ? result.items.map((item, index) => ({
          id: `${entry.id}/${index}`,
          kind: "plugin" as const,
          itemKind: item.kind,
          version: item.version,
          data: item.data,
          at,
        }))
      : [{ id: entry.id, kind: "host" as const, text: hostText(entry.source) }];
    byPhase.set(phase, rows);
    return rows;
  }

  function toRows(entries: readonly StreamEntry[], done: boolean): Row[] {
    return entries.flatMap((entry, index) =>
      project(entry, phaseFor(entries, index, done), new Date(EPOCH.getTime() + index * 1000)),
    );
  }

  const cachedTheme: PluginTheme = { colors: DARK };
  const parseCache = new WeakMap<object, unknown>();
  const host = { id: "replay", label: "Replay" };
  const layout = { compact: false, platform: "web" as const };

  // Host-side view of each row render: a render whose data is the same object
  // as the previous one is wasted work (the row was not the one that changed).
  const lastData = new Map<string, unknown>();
  const hostRows: Record<string, { active: number; inactive: number }> = {};

  function PluginRowBody({ row, renderer }: { row: Extract<Row, { kind: "plugin" }>; renderer: Renderer }) {
    const bucket = (hostRows[row.itemKind] ??= { active: 0, inactive: 0 });
    if (lastData.get(row.id) === row.data) bucket.inactive += 1;
    else bucket.active += 1;
    lastData.set(row.id, row.data);
    // Paseo 0.11.2 builds a fresh theme and re-parses on every render of a row.
    const theme = hostMode === "current" ? { colors: { ...DARK } } : cachedTheme;
    let data: unknown;
    if (hostMode === "current") {
      data = renderer.schema.safeParse(row.data).data;
    } else {
      const key = row.data as object;
      if (!parseCache.has(key)) parseCache.set(key, renderer.schema.safeParse(row.data).data);
      data = parseCache.get(key);
    }
    const Component = renderer.Component;
    return (
      <Component
        agentId="replay-agent"
        theme={theme}
        host={host}
        layout={layout}
        timestamp={row.at}
        item={{ type: "plugin", kind: row.itemKind, version: row.version, data }}
      />
    );
  }
  const MemoPluginRowBody = memo(PluginRowBody);

  function Row({ row }: { row: Row }) {
    if (row.kind === "host") {
      return <Text style={{ color: DARK.foregroundMuted, paddingVertical: 4 }}>{row.text}</Text>;
    }
    const renderer = renderers.find((r) => r.kind === row.itemKind && r.version === row.version);
    if (!renderer) return <Text>Plugin timeline item unavailable.</Text>;
    const Body = hostMode === "cached" ? MemoPluginRowBody : PluginRowBody;
    return (
      <View style={{ paddingVertical: 6 }}>
        <Body row={row} renderer={renderer} />
      </View>
    );
  }

  let setRows: (rows: Row[]) => void = () => {};
  function Timeline() {
    const [rows, set] = useState<Row[]>([]);
    useEffect(() => {
      setRows = set;
    }, []);
    return (
      <View style={{ width: 720, padding: 16, backgroundColor: DARK.surface0 }}>
        {rows.map((row) => (
          <Row key={row.id} row={row} />
        ))}
      </View>
    );
  }

  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Timeline />));

  async function collect(): Promise<void> {
    (window as { gc?: () => void }).gc?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    (window as { gc?: () => void }).gc?.();
  }

  async function play() {
    const accumulator = new StreamAccumulator();
    const started = performance.now();
    for (const event of fixture.events) {
      if (speed > 0) {
        const due = started + event.t / speed;
        for (let wait = due - performance.now(); wait > 0; wait = due - performance.now()) {
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const entries = accumulator.apply(event);
      flushSync(() => setRows(toRows(entries, false)));
    }
    const streamMs = performance.now() - started;
    const streamHostRows = JSON.parse(JSON.stringify(hostRows));
    const streamingSnapshot = window.__bcPerf!.snapshot();
    // End of file: every item becomes phase complete.
    flushSync(() => setRows(toRows(accumulator.items, true)));
    await new Promise((resolve) => setTimeout(resolve, 600));
    const settled = window.__bcPerf!.snapshot();
    // Idle window: nothing is streaming, so animations and frames should be quiet.
    window.__bcPerf!.reset();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const idle = window.__bcPerf!.snapshot();
    await collect();
    const heapAfter = heapBytes();
    return { streamMs, streamingSnapshot, settled, idle, rows: accumulator.items.length, streamHostRows, heapAfter };
  }

  return { play, stats, hostRows };
}

function heapBytes(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize : null;
}

declare global {
  interface Window {
    __bcPerf?: import("../client/debug/perf").BcPerfHandle;
    __err?: string[];
    __replayResult?: unknown;
    __replayDone?: boolean;
  }
}

async function main() {
  const params = new URLSearchParams(location.search);
  const name = params.get("fixture");
  const speed = Number(params.get("speed") ?? "1");
  const hostMode: HostMode = params.get("host") === "cached" ? "cached" : "current";
  if (!name) throw new Error("missing ?fixture=");

  const fixture = parseFixture(await (await fetch(`/fixtures/${name}.jsonl`)).text());
  window.__bcPerf!.enable();
  window.__bcPerf!.reset();
  const { play, stats, hostRows } = mount(fixture, speed, hostMode);
  await new Promise((resolve) => setTimeout(resolve, 100));
  (window as { gc?: () => void }).gc?.();
  const heapBefore = heapBytes();
  window.__bcPerf!.reset();
  const outcome = await play();
  window.__replayResult = {
    fixture: fixture.meta,
    events: fixture.events.length,
    speed,
    hostMode,
    nodeEnv: process.env.NODE_ENV,
    userAgent: navigator.userAgent,
    streamMs: Math.round(outcome.streamMs),
    rows: outcome.rows,
    harnessTransform: stats,
    streaming: outcome.streamingSnapshot,
    settled: outcome.settled,
    idle: outcome.idle,
    heapBefore,
    heapAfter: outcome.heapAfter,
    hostRowsStreaming: outcome.streamHostRows,
    hostRowsTotal: hostRows,
    errors: window.__err ?? [],
  };
  window.__replayDone = true;
}

main().catch((error) => {
  window.__replayResult = { error: String(error?.stack ?? error), errors: window.__err ?? [] };
  window.__replayDone = true;
});
