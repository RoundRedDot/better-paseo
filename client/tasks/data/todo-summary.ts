import { useEffect, useSyncExternalStore } from "react";
import type { PaseoApi, PaseoAgentTimelineHandle } from "@getpaseo/client";

import type { TodoTask } from "../../state/todo-timeline";

export interface TodoSummary { completed: number; total: number; items: readonly TodoTask[] }

type Timeline = Pick<PaseoAgentTimelineHandle, "refetch" | "subscribe">;
type Api = { agents: { ref(id: string): { timeline: Timeline } } };
type Cursor = NonNullable<Parameters<Timeline["refetch"]>[0]>["cursor"];
type Todo = { type: "todo"; items: readonly TodoTask[] };

export function summarizeTodo(item: Todo): TodoSummary | null {
  if (!item.items.length) return null;
  return { completed: item.items.filter((entry) => entry.completed).length, total: item.items.length, items: item.items };
}

export function createTodoSummaryStore(api: Api) {
  const entries = new Map<string, { value: TodoSummary | null; listeners: Set<() => void>; release?: () => void; revision: number; watchers: number }>();
  const entryFor = (id: string) => {
    let entry = entries.get(id);
    if (!entry) { entry = { value: null, listeners: new Set(), revision: 0, watchers: 0 }; entries.set(id, entry); }
    return entry;
  };
  const set = (id: string, value: TodoSummary | null) => {
    const entry = entryFor(id);
    if (entry.value === null && value === null) return;
    if (entry.value && value && JSON.stringify(entry.value.items) === JSON.stringify(value.items)) return;
    entry.value = value;
    for (const listener of entry.listeners) listener();
  };
  return {
    read: (id: string) => entryFor(id).value,
    subscribe(id: string, listener: () => void) {
      const entry = entryFor(id);
      entry.listeners.add(listener);
      return () => { entry.listeners.delete(listener); };
    },
    watch(id: string) {
      const entry = entryFor(id);
      entry.watchers += 1;
      if (entry.release) return () => { if (--entry.watchers === 0) { entry.release?.(); entry.release = undefined; } };
      const timeline = api.agents.ref(id).timeline;
      let active = true;
      let request = 0;
      const refresh = async () => {
        const ticket = ++request;
        const revision = entry.revision;
        let cursor: Cursor;
        for (let pageNumber = 0; pageNumber < 25 && active; pageNumber += 1) {
          const page = await timeline.refetch({ direction: cursor ? "before" : "tail", projection: "projected", limit: 40, ...(cursor ? { cursor } : {}) });
          if (!active || ticket !== request || entry.revision !== revision || page.error || page.reset && cursor) return;
          const row = [...page.entries].reverse().find((candidate) => candidate.item.type === "todo");
          if (row?.item.type === "todo") { set(id, summarizeTodo(row.item)); return; }
          if (!page.hasOlder) { set(id, null); return; }
          if (!page.startCursor || cursor && (cursor.epoch !== page.startCursor.epoch || page.startCursor.seq >= cursor.seq)) return;
          cursor = page.startCursor;
        }
        if (active && ticket === request && entry.revision === revision) set(id, null);
      };
      const subscription = timeline.subscribe((update) => {
        if (update.event.type === "subscription_restored" || update.event.type === "replacement") {
          void refresh().catch(() => {});
          return;
        }
        if (update.event.type !== "timeline" || update.event.item.type !== "todo") return;
        entry.revision += 1;
        set(id, summarizeTodo(update.event.item));
      });
      entry.release = () => { active = false; subscription(); };
      void subscription.ready.then(refresh).catch(() => {});
      return () => { if (--entry.watchers === 0) { entry.release?.(); entry.release = undefined; } };
    },
  };
}

const stores = new WeakMap<object, ReturnType<typeof createTodoSummaryStore>>();
const emptySubscribe = () => () => {};
const emptyRead = () => null;

export function useTodoSummary(api: PaseoApi | undefined, id: string, enabled: boolean, watch = true): TodoSummary | null {
  let store = api && stores.get(api);
  if (api && !store) { store = createTodoSummaryStore(api); stores.set(api, store); }
  const summary = useSyncExternalStore(store && enabled ? (listener) => store.subscribe(id, listener) : emptySubscribe,
    store && enabled ? () => store.read(id) : emptyRead, emptyRead);
  useEffect(() => store && enabled && watch ? store.watch(id) : undefined, [store, id, enabled, watch]);
  return summary;
}
