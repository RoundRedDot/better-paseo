import { useCallback, useSyncExternalStore } from "react";
import type { DetailsApi, DetailsForm, DetailsState, Detent } from "./contracts";
import { getBlock, getBlockList } from "./block-registry";
import { orderBlocks } from "./navigation";

export const MARKER_LINGER_MS = 1200;

const CLOSED: DetailsState = { openId: null, form: "drawer", detent: "fit", fullscreen: false, lingerId: null };

interface AgentDetailsStore {
  state: DetailsState;
  lingerUntil: number;
  lingerTimer: ReturnType<typeof setTimeout> | null;
  navigableOverrides: Map<string, boolean>;
  listeners: Set<() => void>;
  markerListeners: Map<string, Set<() => void>>;
}

const stores = new Map<string, AgentDetailsStore>();

function storeFor(agentId: string): AgentDetailsStore {
  let store = stores.get(agentId);
  if (!store) {
    store = {
      state: CLOSED,
      lingerUntil: 0,
      lingerTimer: null,
      navigableOverrides: new Map(),
      listeners: new Set(),
      markerListeners: new Map(),
    };
    stores.set(agentId, store);
  }
  return store;
}

function markerFrom(state: DetailsState, id: string, now: number, lingerUntil: number): "off" | "on" | "linger" {
  if (state.openId === id) return "on";
  return state.lingerId === id && now < lingerUntil ? "linger" : "off";
}

function notifyMarker(store: AgentDetailsStore, id: string): void {
  store.markerListeners.get(id)?.forEach((listener) => listener());
}

function updateState(agentId: string, next: DetailsState, nextLingerUntil: number): void {
  const store = storeFor(agentId);
  const previous = store.state;
  const previousUntil = store.lingerUntil;
  if (
    previous.openId === next.openId && previous.form === next.form && previous.detent === next.detent &&
    previous.fullscreen === next.fullscreen && previous.lingerId === next.lingerId &&
    previousUntil === nextLingerUntil
  ) return;

  store.state = next;
  store.lingerUntil = nextLingerUntil;
  store.listeners.forEach((listener) => listener());

  const changedIds = new Set<string>();
  [previous.openId, next.openId, previous.lingerId, next.lingerId].forEach((id) => {
    if (id !== null) changedIds.add(id);
  });
  changedIds.forEach((id) => {
    const openChanged = previous.openId !== next.openId && (previous.openId === id || next.openId === id);
    const lingerChanged = previous.lingerId !== next.lingerId && (previous.lingerId === id || next.lingerId === id);
    const lingerDeadlineChanged = previous.lingerId === id && next.lingerId === id && previousUntil !== nextLingerUntil;
    if (openChanged || lingerChanged || lingerDeadlineChanged) notifyMarker(store, id);
  });
}

function clearLingerTimer(store: AgentDetailsStore): void {
  if (store.lingerTimer !== null) clearTimeout(store.lingerTimer);
  store.lingerTimer = null;
}

function scheduleLinger(agentId: string, id: string, until: number): void {
  const store = storeFor(agentId);
  clearLingerTimer(store);
  store.lingerTimer = setTimeout(() => {
    store.lingerTimer = null;
    if (store.state.lingerId !== id) return;
    updateState(agentId, { ...store.state, lingerId: null }, 0);
  }, Math.max(0, until - Date.now()));
}

function setNavigationOverride(agentId: string, id: string, value: boolean | undefined): void {
  if (value === undefined) return;
  storeFor(agentId).navigableOverrides.set(id, value);
}

function step(agentId: string, direction: -1 | 1): void {
  const store = storeFor(agentId);
  const currentId = store.state.openId;
  if (currentId === null) return;
  const entries = orderBlocks(getBlockList(agentId)).filter((entry) => {
    if (!entry.hasBody) return false;
    return store.navigableOverrides.get(entry.id) ?? entry.navigable;
  });
  const currentIndex = entries.findIndex((entry) => entry.id === currentId);
  if (currentIndex < 0) return;
  const target = entries[currentIndex + direction];
  if (target) detailsApi.open(agentId, target.id);
}

export const detailsApi: DetailsApi = {
  open(agentId, id, options) {
    const store = storeFor(agentId);
    const previous = store.state;
    setNavigationOverride(agentId, id, options?.navigable);

    if (previous.openId === id) {
      updateState(agentId, {
        ...previous,
        form: options?.form ?? previous.form,
        detent: options?.detent ?? previous.detent,
      }, store.lingerUntil);
      return;
    }

    let lingerId = previous.lingerId;
    let lingerUntil = store.lingerUntil;
    let replaceLinger = false;
    if (previous.openId !== null) {
      lingerId = previous.openId;
      lingerUntil = Date.now() + MARKER_LINGER_MS;
      replaceLinger = true;
    } else if (previous.lingerId === id) {
      lingerId = null;
      lingerUntil = 0;
      clearLingerTimer(store);
    }

    updateState(agentId, {
      ...previous,
      openId: id,
      form: options?.form ?? previous.form,
      detent: options?.detent ?? (previous.openId === null ? "fit" : previous.detent),
      fullscreen: previous.openId === null ? false : previous.fullscreen,
      lingerId,
    }, lingerUntil);
    if (replaceLinger && lingerId !== null) scheduleLinger(agentId, lingerId, lingerUntil);
    if (previous.openId !== id) getBlock(agentId, id)?.onOpen?.();
  },

  close(agentId) {
    const store = storeFor(agentId);
    const previous = store.state;
    if (previous.openId === null) return;
    const lingerUntil = Date.now() + MARKER_LINGER_MS;
    updateState(agentId, { ...previous, openId: null, lingerId: previous.openId }, lingerUntil);
    scheduleLinger(agentId, previous.openId, lingerUntil);
  },

  step,

  setDetent(agentId, detent: Detent) {
    const store = storeFor(agentId);
    updateState(agentId, { ...store.state, detent }, store.lingerUntil);
  },

  setFullscreen(agentId, on) {
    const store = storeFor(agentId);
    updateState(agentId, { ...store.state, fullscreen: on }, store.lingerUntil);
  },

  setForm(agentId, form: DetailsForm) {
    const store = storeFor(agentId);
    updateState(agentId, { ...store.state, form }, store.lingerUntil);
  },
};

function subscribeDetails(agentId: string, listener: () => void): () => void {
  const listeners = storeFor(agentId).listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function subscribeMarker(agentId: string, id: string, listener: () => void): () => void {
  const store = storeFor(agentId);
  let listeners = store.markerListeners.get(id);
  if (!listeners) {
    listeners = new Set();
    store.markerListeners.set(id, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) store.markerListeners.delete(id);
  };
}

export function useDetails(agentId: string): DetailsState {
  const subscribe = useCallback((listener: () => void) => subscribeDetails(agentId, listener), [agentId]);
  const snapshot = useCallback(() => stores.get(agentId)?.state ?? CLOSED, [agentId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The current row stays on; the last row lingers for 1.2 seconds after close or switch. */
export function useMarkerPhase(agentId: string, id: string): "off" | "on" | "linger" {
  const subscribe = useCallback((listener: () => void) => subscribeMarker(agentId, id, listener), [agentId, id]);
  const snapshot = useCallback(() => {
    const store = stores.get(agentId);
    return store ? markerFrom(store.state, id, Date.now(), store.lingerUntil) : "off";
  }, [agentId, id]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

interface LeaseClaim {
  slotKey: string;
  active: boolean;
}

interface HostLease {
  claims: LeaseClaim[];
  listeners: Set<() => void>;
}

const hostLeases = new Map<string, HostLease>();

function leaseFor(agentId: string): HostLease {
  let lease = hostLeases.get(agentId);
  if (!lease) {
    lease = { claims: [], listeners: new Set() };
    hostLeases.set(agentId, lease);
  }
  return lease;
}

/** The first mounted host slot owns the shell until it releases the lease. */
export function claimHostLease(
  agentId: string,
  slotKey: string,
): { held(): boolean; release(): void; subscribe(listener: () => void): () => void } {
  const lease = leaseFor(agentId);
  const claim: LeaseClaim = { slotKey, active: true };
  const wasUnclaimed = lease.claims.length === 0;
  lease.claims.push(claim);
  if (wasUnclaimed) lease.listeners.forEach((listener) => listener());

  return {
    held: () => claim.active && lease.claims[0] === claim,
    release() {
      if (!claim.active) return;
      claim.active = false;
      const wasHolder = lease.claims[0] === claim;
      const index = lease.claims.indexOf(claim);
      if (index >= 0) lease.claims.splice(index, 1);
      if (wasHolder) lease.listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      lease.listeners.add(listener);
      return () => lease.listeners.delete(listener);
    },
  };
}
