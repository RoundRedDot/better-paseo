import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { hasUpdate, updateCheckRpc } from "../../../shared/update-check";

const updates = new Map<string, boolean>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function apply(hostId: string, value: boolean) {
  if ((updates.get(hostId) ?? false) === value) return;
  updates.set(hostId, value);
  for (const listener of listeners) listener();
}

/** Only an open desktop board observes its host's update status. */
export function useUpdateIndicator(hostId: string, visible: boolean): boolean {
  const check = useRpc(updateCheckRpc);
  const latest = useRef(check);
  latest.current = check;
  const update = useSyncExternalStore(subscribe, () => updates.get(hostId) ?? false, () => false);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await latest.current({ action: "status" });
        if (!active) return;
        apply(hostId, hasUpdate(result));
        timer = setTimeout(() => void refresh(), result.state === "checking" ? 2000 : 30_000);
      } catch {
        if (!active) return;
        apply(hostId, false);
        timer = setTimeout(() => void refresh(), 30_000);
      }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [hostId, visible]);
  return update;
}
