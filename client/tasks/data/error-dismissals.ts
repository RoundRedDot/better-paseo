import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { tasksDismissErrorRpc, tasksErrorDismissalsRpc } from "../../../shared/tasks-rpc";
import type { TaskCard } from "../model";

type Entry = { agentId: string; error: string; dismissedAt: number };
let client: PluginClientContext | null = null;
let generation = 0;
let loading = false;
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of [...listeners]) listener(); };

export function startErrorDismissals(next: PluginClientContext): () => void {
  client = next;
  const run = ++generation;
  entries.clear();
  notify();
  loading = false;
  return () => {
    if (run !== generation) return;
    generation++;
    client = null;
    entries.clear();
    notify();
  };
}

function loadDismissals(): void {
  if (!client || loading) return;
  const current = client;
  const run = generation;
  loading = true;
  void Promise.resolve().then(() => current.rpc(tasksErrorDismissalsRpc, {})).then((result) => {
    if (run !== generation) return;
    for (const entry of result.entries) if (!entries.has(entry.agentId)) entries.set(entry.agentId, entry);
    notify();
  }).catch((error: unknown) => console.error("Could not load dismissed task errors", error));
}

function errorTime(card: TaskCard): number {
  return Math.max(0, card.errorOccurredAt ?? 0, ...[card.timing.lastUserMessageAt, card.timing.lastTurnEndedAt, card.timing.attentionAt]
    .map((time) => time ? Date.parse(time) || 0 : 0));
}

export function isErrorDismissed(card: TaskCard, entry: Entry | undefined): boolean {
  return !!entry && entry.error === card.error && errorTime(card) <= entry.dismissedAt;
}

export function useErrorDismissal(card: TaskCard): [boolean, () => Promise<void>] {
  useEffect(() => { if (card.error && !card.stoppedManually) loadDismissals(); }, [card.error, card.stoppedManually]);
  const subscribe = useCallback((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, []);
  const snapshot = useCallback(() => isErrorDismissed(card, entries.get(card.id)), [card]);
  const hidden = useSyncExternalStore(subscribe, snapshot, snapshot);
  const dismiss = useCallback(async () => {
    if (!client || !card.error) throw new Error("Could not reach the plugin server.");
    const current = client;
    const run = generation;
    const entry = await current.rpc(tasksDismissErrorRpc, { agentId: card.id, error: card.error });
    if (run !== generation) return;
    entries.set(card.id, entry);
    notify();
  }, [card]);
  return [hidden, dismiss];
}
