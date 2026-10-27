import { useMemo, useSyncExternalStore } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import type { PaseoApi } from "@getpaseo/client";
import { titleUpdateRpc, type TitleUpdateState } from "../../../shared/title-generation";

const IDLE: TitleUpdateState = { state: "idle" };
const RUNNING: TitleUpdateState = { state: "running" };
type Call = (input: { agentId: string; action: "start" | "status" }) => Promise<TitleUpdateState>;

export function createTitleUpdateControl(call: Call) {
  const states = new Map<string, TitleUpdateState>();
  const listeners = new Set<() => void>();
  const interrupted = new Set<string>();
  const set = (id: string, state: TitleUpdateState) => {
    states.set(id, state);
    for (const listener of listeners) listener();
  };
  return {
    dismiss(agentId: string) {
      if (states.get(agentId)?.state === "error") set(agentId, IDLE);
    },
    read: (id: string) => states.get(id) ?? IDLE,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start(agentId: string) {
      if (states.get(agentId)?.state === "running") return;
      set(agentId, RUNNING);
      void (async () => {
        try {
          let result = await call({ agentId, action: interrupted.has(agentId) ? "status" : "start" });
          let failures = 0;
          while (result.state === "running") {
            await new Promise((resolve) => setTimeout(resolve, 1000));
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
        }
      })();
    },
  };
}
export type TitleUpdateControl = ReturnType<typeof createTitleUpdateControl>;

// Keep an in-flight action across board remounts, independently for each host API.
const controls = new WeakMap<PaseoApi, TitleUpdateControl>();
export function useTitleUpdateControl(paseo: PaseoApi): TitleUpdateControl {
  const call = useRpc(titleUpdateRpc);
  return useMemo(() => {
    const existing = controls.get(paseo);
    if (existing) return existing;
    const control = createTitleUpdateControl(call);
    controls.set(paseo, control);
    return control;
  }, [paseo, call]);
}

const noSubscribe = () => () => {};
export function useTitleUpdateState(control: TitleUpdateControl | undefined, agentId: string): TitleUpdateState {
  const snapshot = () => control?.read(agentId) ?? IDLE;
  return useSyncExternalStore(control?.subscribe ?? noSubscribe, snapshot, snapshot);
}
