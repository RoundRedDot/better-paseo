/**
 * Which block the details panel shows, per agent (stub: slice A implements it).
 */
import type { DetailsApi, DetailsState } from "./contracts";

export const detailsApi: DetailsApi = {
  open() {},
  close() {},
  step() {},
  setDetent() {},
  setFullscreen() {},
  setForm() {},
};

const CLOSED: DetailsState = { openId: null, form: "drawer", detent: "fit", fullscreen: false, lingerId: null };

export function useDetails(_agentId: string): DetailsState {
  return CLOSED;
}

/** The row's marker: on while the panel shows it, linger for 1.2 s after, then off. */
export function useMarkerPhase(_agentId: string, _id: string): "off" | "on" | "linger" {
  return "off";
}

/**
 * One plugin item per agent draws the shell. The first mounted claimant holds
 * the lease; when it unmounts the next one takes it.
 */
export function claimHostLease(_agentId: string, _slotKey: string): { held(): boolean; release(): void; subscribe(listener: () => void): () => void } {
  return { held: () => false, release() {}, subscribe: () => () => {} };
}
