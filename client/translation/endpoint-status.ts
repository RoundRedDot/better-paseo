import { useSyncExternalStore } from "react";
import type { TranslationEndpointStatus } from "../../shared/timeline-translation";

/**
 * What one host's daemon says about its configured endpoint and saved API
 * key. The key itself never reaches the client; only whether one is saved and
 * the origin it is bound to.
 *
 * Every host has its own store, keyed by the host's `PaseoApi` (one per plugin
 * installation, so one per host): two hosts can hold the same endpoint with
 * different keys, and one host's answer must never show on another's page.
 * Within a host only the latest request publishes; a read or write started
 * earlier may answer last.
 */
export type EndpointStatusSnapshot =
  | { status: "idle" }
  | { status: "loading"; endpoint: string }
  | { status: "ready"; endpoint: string; value: TranslationEndpointStatus }
  | { status: "error"; endpoint: string; error: string };

/** How a request ended for its caller: published, failed, or overtaken by a later request. */
export type EndpointStatusOutcome =
  | { kind: "published" }
  | { kind: "failed"; error: string }
  | { kind: "superseded" };

const IDLE: EndpointStatusSnapshot = { status: "idle" };

let storeSerial = 0;

export function createEndpointStatusStore() {
  const id = `endpoint-status-${++storeSerial}`;
  let snapshot: EndpointStatusSnapshot = IDLE;
  let latest = 0;
  /** The latest status read, repeated when a write it overtook lands. */
  let lastRead: { endpoint: string; read: () => Promise<TranslationEndpointStatus> } | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: EndpointStatusSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  async function run(
    endpoint: string,
    request: () => Promise<TranslationEndpointStatus>,
    publishError: boolean,
  ): Promise<EndpointStatusOutcome> {
    const sequence = ++latest;
    // Another endpoint's answer is not this one's: show it as loading, never as ready.
    if (snapshot.status !== "ready" || snapshot.endpoint !== endpoint) publish({ status: "loading", endpoint });
    try {
      const value = await request();
      if (sequence !== latest) return { kind: "superseded" };
      publish({ status: "ready", endpoint, value });
      return { kind: "published" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (sequence !== latest) return { kind: "failed", error: message };
      // A failed write leaves the status to the read `write` runs again.
      if (publishError) publish({ status: "error", endpoint, error: message });
      return { kind: "failed", error: message };
    }
  }

  const store = {
    id,
    snapshot: () => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Reads the status for `endpoint`. */
    read(endpoint: string, read: () => Promise<TranslationEndpointStatus>): Promise<EndpointStatusOutcome> {
      lastRead = { endpoint, read };
      return run(endpoint, read, true);
    },
    /**
     * Saves or clears the key; its answer is the status after the write. A
     * failure stays with the caller. When a later read overtook the write,
     * that read may predate it, so the latest read runs once more.
     */
    async write(endpoint: string, write: () => Promise<TranslationEndpointStatus>): Promise<EndpointStatusOutcome> {
      const outcome = await run(endpoint, write, false);
      if (outcome.kind !== "published" && lastRead) {
        const again = lastRead;
        void run(again.endpoint, again.read, true);
      }
      return outcome;
    },
    resetForTests(): void {
      latest++;
      lastRead = null;
      publish(IDLE);
    },
  };
  return store;
}

export type EndpointStatusStore = ReturnType<typeof createEndpointStatusStore>;

const stores = new WeakMap<object, EndpointStatusStore>();
/** Surfaces without a Paseo client (tests, previews) share one store. */
const NO_HOST = {};

export function endpointStatusFor(host: object | null | undefined): EndpointStatusStore {
  const key = host ?? NO_HOST;
  let store = stores.get(key);
  if (!store) stores.set(key, store = createEndpointStatusStore());
  return store;
}

export function useEndpointStatus(store: EndpointStatusStore): EndpointStatusSnapshot {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
