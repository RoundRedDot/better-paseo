/**
 * Rendered by every plugin timeline item; the one holding the agent's lease
 * draws the details shell. The panel's state lives in the details store, not
 * in the row, so a row scrolling out of the list hands the lease, and the
 * open panel with it, to the next mounted row (`DetailsShell` takes it over
 * without an entrance).
 *
 * With block details off it draws nothing and claims nothing.
 */
import React, { useMemo, useSyncExternalStore } from "react";
import type { ExtendedThemeTokens } from "../../components/theme-tokens";
import { useEnhancerPreferences } from "../../preferences";
import { claimHostLease } from "../details-store";
import { DetailsShell } from "./details-shell";

type Lease = ReturnType<typeof claimHostLease>;

export function DetailsHostSlot(props: { agentId: string; itemKey: string; tokens: ExtendedThemeTokens; compact: boolean }) {
  const { blockDetails } = useEnhancerPreferences();
  if (!blockDetails) return null;
  return <LeasedSlot {...props} />;
}

function LeasedSlot({ agentId, itemKey, tokens }: { agentId: string; itemKey: string; tokens: ExtendedThemeTokens; compact: boolean }) {
  const held = useHostLease(agentId, itemKey);
  return held ? <DetailsShell agentId={agentId} tokens={tokens} /> : null;
}

/** Claims the agent's lease while mounted; true while this slot holds it. */
function useHostLease(agentId: string, slotKey: string): boolean {
  const store = useMemo(() => {
    let lease: Lease | null = null;
    return {
      subscribe(listener: () => void) {
        const claimed = claimHostLease(agentId, slotKey);
        lease = claimed;
        const unsubscribe = claimed.subscribe(listener);
        return () => {
          unsubscribe();
          claimed.release();
          if (lease === claimed) lease = null;
        };
      },
      read: () => lease?.held() ?? false,
    };
  }, [agentId, slotKey]);
  // The subscription's consistency check updates only the winning slot.
  // Other rows need no state update merely to remember their claim.
  return useSyncExternalStore(store.subscribe, store.read, store.read);
}
