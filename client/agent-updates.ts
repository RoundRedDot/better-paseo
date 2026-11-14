import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { agentUpdatesRpc, retainAgentUpdates, type AgentUpdates } from "../shared/agent-updates";

const empty: AgentUpdates = { state: "idle", entries: [], error: null };
const hosts = new Map<string, AgentUpdates>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function apply(hostId: string, result: AgentUpdates) {
  hosts.set(hostId, retainAgentUpdates(hosts.get(hostId) ?? empty, result));
  for (const listener of listeners) listener();
}
export function resetAgentUpdatesForTests() { hosts.clear(); }
export function useAgentUpdates(hostId: string, visible = true) {
  const check = useRpc(agentUpdatesRpc);
  const latest = useRef(check);
  latest.current = check;
  const state = useSyncExternalStore(subscribe, () => hosts.get(hostId) ?? empty, () => empty);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await latest.current({ action: "status" });
        if (!active) return;
        apply(hostId, result);
        timer = setTimeout(() => void refresh(), result.state === "checking" ? 2000 : 30_000);
      } catch {
        if (!active) return;
        apply(hostId, { ...(hosts.get(hostId) ?? empty), state: "failed", error: "status_failed" });
        timer = setTimeout(() => void refresh(), 30_000);
      }
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [hostId, visible]);
  async function run() {
    apply(hostId, { ...(hosts.get(hostId) ?? empty), state: "checking", error: null });
    try { apply(hostId, await latest.current({ action: "check" })); }
    catch { apply(hostId, { ...(hosts.get(hostId) ?? empty), state: "failed", error: "check_failed" }); }
  }
  return { state, run };
}
