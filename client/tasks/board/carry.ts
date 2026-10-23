import { useEffect, useMemo } from "react";
import { tasksSettingsSchema, type TasksSettings } from "../../../shared/tasks-settings";
import type { TasksHandle, TasksOptions, TasksSnapshot } from "../data";
import { sampleCards } from "../sample-cards";

/**
 * What the board carries across a reconnect. Paseo disposes this plugin when
 * its host disconnects (a phone's screen going off is enough) and evaluates
 * the bundle again once the host is back, so module state starts over and an
 * open board would wait on its reads again: an empty page, then breathing
 * lanes, then cards. The JS runtime's global outlives an evaluation (as in
 * `host-language.ts`), so the board keeps its last cards, its settings and its
 * session there, by host, and draws them until the fresh ones arrive.
 *
 * A plugin update evaluates another bundle in the same runtime, so what an
 * earlier evaluation left may have another shape: the settings go back
 * through their schema, the session through the params decoder
 * (`params.ts`), and a snapshot whose cards are not shaped like this
 * bundle's sample cards is dropped.
 */
const CARRY = "__betterPaseoTasksCarry";

/** Bump when the carried snapshot changes shape outside a card (lanes, workspaces, counts). */
const SNAPSHOT_VERSION = 1;

/** The snapshot's data, without the store methods: those would keep the disposed store alive. */
export type CarriedBoard = Pick<TasksSnapshot, "lanes" | "counts" | "byId" | "workspaces" | "providers" | "labels">;

interface HostCarry {
  settings?: unknown;
  session?: unknown;
  board?: { key: string; shape: string; data: CarriedBoard };
}

function hosts(): Map<string, HostCarry> {
  const holder = globalThis as Record<string, unknown>;
  const existing = holder[CARRY];
  if (existing instanceof Map) return existing as Map<string, HostCarry>;
  const created = new Map<string, HostCarry>();
  holder[CARRY] = created;
  return created;
}

function carried(hostId: string): HostCarry {
  const all = hosts();
  let entry = all.get(hostId);
  if (!entry) {
    entry = {};
    all.set(hostId, entry);
  }
  return entry;
}

/** Tests only: what every host carries, gone. */
export function forgetCarried(): void {
  delete (globalThis as Record<string, unknown>)[CARRY];
}

export function carrySettings(hostId: string, settings: TasksSettings): void {
  carried(hostId).settings = settings;
}

// One parse per carried record, so a reader sees the same object on every render.
const revivedSettings = new WeakMap<object, TasksSettings | null>();

/** The Tasks settings this host last read, if they still fit the schema. */
export function carriedSettings(hostId: string): TasksSettings | null {
  const raw = hosts().get(hostId)?.settings;
  if (!raw || typeof raw !== "object") return null;
  let settings = revivedSettings.get(raw);
  if (settings === undefined) {
    const parsed = tasksSettingsSchema.safeParse(raw);
    settings = parsed.success ? parsed.data : null;
    revivedSettings.set(raw, settings);
  }
  return settings;
}

export function carrySession(hostId: string, session: unknown): void {
  carried(hostId).session = session;
}

/** What `params.ts` last carried for this host, unchecked: it decodes it. */
export function carriedSession(hostId: string): unknown {
  return hosts().get(hostId)?.session;
}

let shape: string | null = null;

/** Every field path the sample cards fill, sorted: a card added a required field when it changes. */
export function cardShape(): string {
  if (shape !== null) return shape;
  const paths = new Set<string>([`v${SNAPSHOT_VERSION}`]);
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, `${path}[]`);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      paths.add(next);
      walk(child, next);
    }
  };
  for (const card of sampleCards(0)) walk(card, "");
  shape = [...paths].sort().join(",");
  return shape;
}

function optionsKey(options: TasksOptions): string {
  return `${options.includeDone ? "done" : "active"}:${options.doneWindow}:${options.includeArchived ? "archived" : ""}`;
}

export function carryBoard(hostId: string, options: TasksOptions, tasks: TasksSnapshot): void {
  const { lanes, counts, byId, workspaces, providers, labels } = tasks;
  carried(hostId).board = { key: optionsKey(options), shape: cardShape(), data: { lanes, counts, byId, workspaces, providers, labels } };
}

/** The cards this host's board last drew with these options, when they are shaped like this bundle's. */
export function carriedBoard(hostId: string, options: TasksOptions): CarriedBoard | null {
  const board = hosts().get(hostId)?.board;
  if (!board || board.key !== optionsKey(options) || board.shape !== cardShape()) return null;
  return board.data;
}

/**
 * The board's tasks: the store's once it is ready, and carried along for
 * the next evaluation; until then the cards this host's board last drew,
 * marked ready, so the board draws them and moves each card when the fresh
 * snapshot lands. The store's methods act on the fresh store throughout.
 */
export function useCarriedTasks(hostId: string, options: TasksOptions, live: TasksHandle): TasksHandle {
  const kept = live.ready ? null : carriedBoard(hostId, options);
  useEffect(() => {
    if (live.ready) carryBoard(hostId, options, live);
  }, [hostId, options, live]);
  return useMemo(() => (kept ? { ...live, ...kept, ready: true } : live), [kept, live]);
}
