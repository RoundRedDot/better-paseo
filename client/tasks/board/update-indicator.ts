import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { hasUpdate, updateCheckRpc, type UpdateCheckState } from "../../../shared/update-check";
import { hasAgentUpdate } from "../../../shared/agent-updates";
import { useAgentUpdates } from "../../agent-updates";

const updates = new Map<string, boolean>();
const listeners = new Set<() => void>();

export function resetUpdateIndicatorsForTests() { updates.clear(); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function apply(hostId: string, value: boolean) {
  if ((updates.get(hostId) ?? false) === value) return;
  updates.set(hostId, value);
  for (const listener of listeners) listener();
}

export function recordPluginUpdate(hostId: string, state: UpdateCheckState) {
  if (state.state === "local" || state.state === "unsupported") return apply(hostId, false);
  if (state.state !== "done") return;
  if (state.matches) return apply(hostId, false);
  if (state.versions.status !== "available" || state.versions.current === null || state.versions.latest === null || state.versions.currentBuild === null || state.versions.latestBuild === null) return;
  apply(hostId, hasUpdate(state));
}

export function useKnownPluginUpdate(hostId: string) {
  return useSyncExternalStore(subscribe, () => updates.get(hostId) ?? false, () => false);
}

/** An open board observes the selected host on desktop and phone. */
export function useUpdateIndicator(hostId: string, visible: boolean): boolean {
  const agents = useAgentUpdates(hostId, visible);
  const check = useRpc(updateCheckRpc);
  const latest = useRef(check);
  latest.current = check;
  const update = useKnownPluginUpdate(hostId);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await latest.current({ action: "status" });
        if (!active) return;
        recordPluginUpdate(hostId, result);
        timer = setTimeout(() => void refresh(), result.state === "checking" ? 2000 : 30_000);
      } catch {
        if (!active) return;
        timer = setTimeout(() => void refresh(), 30_000);
      }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [hostId, visible]);
  return update || hasAgentUpdate(agents.state);
}
