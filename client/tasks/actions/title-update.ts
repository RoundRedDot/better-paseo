import { useMemo, useSyncExternalStore } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import type { PaseoAgentTimelineHandle, PaseoApi } from "@getpaseo/client";
import { titleUpdateRpc, type TitleUpdateState } from "../../../shared/title-generation";

const IDLE: TitleUpdateState = { state: "idle" };
const RUNNING: TitleUpdateState = { state: "running" };
type Call = (input: { agentId: string; action: "start" | "status" }) => Promise<TitleUpdateState>;
/** Calls `onChunk` as the helper's reply streams in; returns its unsubscribe. */
type Watch = (helperId: string, onChunk: () => void) => () => void;

const POLL_MS = 1000;
const streamed = (state: TitleUpdateState | undefined) => state?.state === "running" ? state.text : undefined;

/**
 * A job's state, polled until it settles. While the helper writes the title
 * its live timeline (`watch`) asks for the status at each chunk, so the
 * text streams in; the poll stays as the fallback.
 */
export function createTitleUpdateControl(call: Call, watch?: Watch) {
  const states = new Map<string, TitleUpdateState>();
  const listeners = new Set<() => void>();
  const interrupted = new Set<string>();
  const set = (id: string, state: TitleUpdateState) => {
    states.set(id, state);
    for (const listener of listeners) listener();
  };
  return {
    /** Clears a shown error, or a result once the card shows its own title. */
    dismiss(agentId: string) {
      const state = states.get(agentId)?.state;
      if (state === "error" || state === "done") set(agentId, IDLE);
    },
    read: (id: string) => states.get(id) ?? IDLE,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start(agentId: string) {
      if (states.get(agentId)?.state === "running") return;
      set(agentId, RUNNING);
      // A chunk during a status call asks again as soon as it returns.
      let nudged = false;
      let wake: (() => void) | null = null;
      const nudge = () => {
        nudged = true;
        wake?.();
      };
      const pause = () => new Promise<void>((resolve) => {
        const timer = setTimeout(() => wake?.(), nudged ? 0 : POLL_MS);
        wake = () => {
          clearTimeout(timer);
          wake = null;
          nudged = false;
          resolve();
        };
      });
      let watching: string | null = null;
      let unwatch: (() => void) | null = null;
      void (async () => {
        try {
          let result = await call({ agentId, action: interrupted.has(agentId) ? "status" : "start" });
          let failures = 0;
          while (result.state === "running") {
            if (streamed(result) !== streamed(states.get(agentId))) set(agentId, result);
            if (watch && result.helperId && result.helperId !== watching) {
              unwatch?.();
              watching = result.helperId;
              try {
                unwatch = watch(result.helperId, nudge);
              } catch {
                unwatch = null;
              }
            }
            await pause();
            try {
              result = await call({ agentId, action: "status" });
              failures = 0;
            } catch (error) {
              failures += 1;
              if (failures >= 3) throw error;
            }
          }
          interrupted.delete(agentId);
          if (result.state === "idle") {
            set(agentId, { state: "error", error: "The title generation task was lost. Please retry." });
            return;
          }
          set(agentId, result);
        } catch (error) {
          interrupted.add(agentId);
          set(agentId, { state: "error", error: `Status unavailable; the task may still be running. Retry to reconnect. ${error instanceof Error ? error.message : String(error)}` });
        } finally {
          unwatch?.();
        }
      })();
    },
  };
}
export type TitleUpdateControl = ReturnType<typeof createTitleUpdateControl>;

// Keep an in-flight action across board remounts, independently for each host API.
const controls = new WeakMap<PaseoApi, TitleUpdateControl>();
export function useTitleUpdateControl(paseo: PaseoApi, mode: "apply" | "preview" = "apply"): TitleUpdateControl {
  const call = useRpc(titleUpdateRpc);
  return useMemo(() => {
    const existing = mode === "apply" ? controls.get(paseo) : undefined;
    if (existing) return existing;
    const control = createTitleUpdateControl((input) => call({ ...input, mode }), (helperId, onChunk) => watchReply(paseo, helperId, onChunk));
    if (mode === "apply") controls.set(paseo, control);
    return control;
  }, [paseo, call, mode]);
}

type LiveApi = { agents: { ref(id: string): { timeline: Pick<PaseoAgentTimelineHandle, "subscribe"> } } };

/** The helper's reply chunks, and a reconnect that may have missed some. */
export function watchReply(api: LiveApi, helperId: string, onChunk: () => void): () => void {
  const subscription = api.agents.ref(helperId).timeline.subscribe(({ event }) => {
    if (event.type === "subscription_restored" || (event.type === "timeline" && "item" in event && event.item.type === "assistant_message")) onChunk();
  });
  subscription.ready?.catch(() => {});
  return () => subscription();
}

const noSubscribe = () => () => {};
export function useTitleUpdateState(control: TitleUpdateControl | undefined, agentId: string): TitleUpdateState {
  const snapshot = () => control?.read(agentId) ?? IDLE;
  return useSyncExternalStore(control?.subscribe ?? noSubscribe, snapshot, snapshot);
}
