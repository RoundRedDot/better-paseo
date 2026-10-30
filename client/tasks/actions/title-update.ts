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
/** Status asks, a second apart, before a followed job counts as not started. */
const ATTACH_ASKS = 5;
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
  /** Jobs the board follows without a click: they fail silently. */
  const quiet = new Set<string>();
  /** Status asks left for each job the board is waiting to see start. */
  const asksLeft = new Map<string, number>();
  let revealing: ReadonlySet<string> = new Set();
  const set = (id: string, state: TitleUpdateState) => {
    states.set(id, state);
    if ((state.state === "error" || state.state === "idle") && revealing.has(id)) {
      const next = new Set(revealing);
      next.delete(id);
      revealing = next;
    }
    for (const listener of listeners) listener();
  };
  const control = {
    /** The card keeps its place until its final title has been displayed. Stable between chunks. */
    revealing: () => revealing,
    finishReveal(agentId: string) {
      if (!revealing.has(agentId)) return;
      const next = new Set(revealing);
      next.delete(agentId);
      revealing = next;
      for (const listener of listeners) listener();
    },
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
      // A click on a job the board only follows makes its outcome the user's.
      quiet.delete(agentId);
      if (states.get(agentId)?.state === "running") return;
      revealing = new Set(revealing).add(agentId);
      set(agentId, RUNNING);
      follow(agentId, false);
    },
    /**
     * Follows a job the daemon started on its own (a title from the first
     * message) as `start` does, with the same sweep and the card held in place.
     * Asks a few times, since the daemon starts it a moment after the turn
     * starts; a job that is not running by then, or that fails, leaves the
     * card as it was. Another call while it waits starts the asks over.
     */
    attach(agentId: string) {
      if (states.get(agentId)?.state === "running") return;
      const waiting = asksLeft.has(agentId);
      asksLeft.set(agentId, ATTACH_ASKS);
      if (!waiting) follow(agentId, true);
    },
  };

  function follow(agentId: string, attach: boolean) {
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
      let result: TitleUpdateState = IDLE;
      if (attach) {
        try {
          for (;;) {
            asksLeft.set(agentId, asksLeft.get(agentId)! - 1);
            result = await call({ agentId, action: "status" });
            if (result.state === "running" || asksLeft.get(agentId)! <= 0) break;
            await pause();
          }
        } catch {
          result = IDLE;
        } finally {
          asksLeft.delete(agentId);
        }
        // Only a running job is this one: a settled result is an earlier job's.
        if (result.state !== "running" || states.get(agentId)?.state === "running") return;
        quiet.add(agentId);
        revealing = new Set(revealing).add(agentId);
        set(agentId, RUNNING);
      }
      try {
        if (!attach) result = await call({ agentId, action: interrupted.has(agentId) ? "status" : "start" });
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
        if (result.state === "done") set(agentId, result);
        else if (quiet.has(agentId)) set(agentId, IDLE);
        else if (result.state === "idle") set(agentId, { state: "error", error: "The title generation task was lost. Please retry." });
        else set(agentId, result);
      } catch (error) {
        if (quiet.has(agentId)) {
          set(agentId, IDLE);
          return;
        }
        interrupted.add(agentId);
        set(agentId, { state: "error", error: `Status unavailable; the task may still be running. Retry to reconnect. ${error instanceof Error ? error.message : String(error)}` });
      } finally {
        quiet.delete(agentId);
        unwatch?.();
      }
    })();
  }
  return control;
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
