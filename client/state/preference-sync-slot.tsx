import { memo, useEffect, useRef, useSyncExternalStore } from "react";
import { settingsRpc } from "@getpaseo/plugin";
import { useSettings, type PluginClientContext } from "@getpaseo/plugin/client";
import { PREFERENCES_SETTINGS, preferencesSchema } from "../../shared/preferences-settings";
import {
  DEFAULT_PREFERENCES,
  applyStoredPreferences,
  legacyLocalPreferences,
  markLegacyMigrated,
  setPreferencePersister,
  storedPart,
} from "../preferences";
import { createPreferenceSync, type RemoteActions, type RemoteSettings, type SyncStatus } from "./preference-sync";

/** The one sync for this client bundle, wired to the in-memory store. */
export const preferenceSync = createPreferenceSync({
  apply: applyStoredPreferences,
  defaults: () => storedPart(DEFAULT_PREFERENCES),
  legacy: legacyLocalPreferences,
  markMigrated: markLegacyMigrated,
});
setPreferencePersister((values) => preferenceSync.request(values));

/** One read of the daemon's record through the settings RPC; null if unusable. */
async function readRecord(client: Pick<PluginClientContext, "rpc">): Promise<RemoteSettings | null> {
  const result: unknown = await client.rpc(settingsRpc(PREFERENCES_SETTINGS.id).read, {});
  if (!result || typeof result !== "object") return null;
  const read = result as { status?: unknown; revision?: unknown; values?: unknown; error?: unknown };
  if (typeof read.revision !== "string") return null;
  if (read.status === "ready") {
    return { status: "ready", values: preferencesSchema.parse(read.values ?? {}), revision: read.revision };
  }
  if (read.status === "invalid") return { status: "invalid", error: String(read.error ?? ""), revision: read.revision };
  return null;
}

/**
 * Reads the daemon's record once, from `contribute()`, so the store holds it
 * before the first row mounts the settings hook below. Without it iOS and
 * Android (no `localStorage`) project the first timeline with the defaults,
 * then re-register their transformers and project it again when a row's hook
 * answers. The same settings RPC the hook calls; the hook and
 * `watchPreferenceChanges` stay the ongoing sync. Returns the cancel for the
 * cleanup.
 */
export function readPreferencesAtStartup(client: Pick<PluginClientContext, "rpc">): () => void {
  let live = true;
  // Sent now: an async function runs to its first await, and a synchronous throw becomes a rejection.
  readRecord(client)
    .then((state) => {
      if (live && state) preferenceSync.prime(state);
    })
    .catch(() => {
      // The settings hook reads again once a row mounts.
    });
  return () => {
    live = false;
  };
}

// The settings hooks mounted now: the leading row's and the settings page's.
let mountedHooks = 0;
// The daemon changed the record while no hook was mounted. The host's cached
// copy is then stale and the host does not read it again when a hook mounts
// (`refetchOnMount: false`), so the next hook reads it before it reports.
let hookCacheStale = false;
let refreshing = false;
const refreshListeners = new Set<() => void>();
function subscribeRefresh(listener: () => void) {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}
const isRefreshing = () => refreshing;

/**
 * Keeps the store in step with the daemon while no settings hook is mounted:
 * with General → Enable Better Paseo chat off, no plugin row mounts the hook,
 * and the settings page mounts it only while open. Listens for the host's
 * `plugin_settings_changed` push, which the daemon sends to every client, and
 * reads the record again. While a hook is mounted the host reads it for that
 * hook. Lives for the plugin's whole load. Returns the cleanup.
 */
export function watchPreferenceChanges(client: Pick<PluginClientContext, "paseo" | "rpc">): () => void {
  let live = true;
  const observation = client.paseo.observeEvents(["status.plugin_settings_changed"]);
  const unsubscribe = observation.subscribe({
    snapshot() {},
    update(message) {
      if (message.type !== "status") return;
      const { status, settingsId } = message.payload;
      if (status !== "plugin_settings_changed" || settingsId !== PREFERENCES_SETTINGS.id) return;
      if (mountedHooks > 0) return;
      hookCacheStale = true;
      readRecord(client).then(
        (state) => {
          if (live && state) preferenceSync.report(state);
        },
        () => {
          // The next hook to mount reads the record (`hookCacheStale`).
        },
      );
    },
  });
  return () => {
    live = false;
    unsubscribe();
    void observation.release();
  };
}

/**
 * Reads the daemon settings through the SDK (host-provided `useSettings`,
 * react-query underneath, so every caller shares one query and the host's
 * `plugin_settings_changed` push) and reports each state to the sync.
 * Returns the state for the settings page's own hint.
 */
export function usePreferenceSettings(): SyncStatus {
  const state = useSettings(PREFERENCES_SETTINGS);
  // The host hands out new action functions each render; the sync keeps one
  // stable object that always calls the latest.
  const latest = useRef(state);
  latest.current = state;
  const actions = useRef<RemoteActions>({
    save: (values, against) => latest.current.save(values, against),
    reset: () => latest.current.reset(),
    reload: () => latest.current.reload(),
  }).current;
  const waiting = useSyncExternalStore(subscribeRefresh, isRefreshing, isRefreshing);
  // Declared before the report below, so a stale cached record is never reported.
  useEffect(() => {
    mountedHooks++;
    if (hookCacheStale) {
      hookCacheStale = false;
      refreshing = true;
      const done = () => {
        refreshing = false;
        for (const listener of refreshListeners) listener();
      };
      void actions.reload().then(done, done);
    }
    return () => {
      mountedHooks--;
    };
  }, []);
  const remote: RemoteSettings =
    state.status === "ready"
      ? { status: "ready", values: state.values, revision: state.revision }
      : state.status === "invalid"
        ? { status: "invalid", error: state.error, revision: state.revision }
        : state.status === "error"
          ? { status: "error", error: state.error }
          : { status: "loading" };
  const revision = "revision" in remote ? remote.revision : "";
  const error = "error" in remote ? remote.error : "";
  useEffect(() => {
    // Read the flag, not `waiting`: a hook mounted in this commit may have set it.
    if (refreshing) return;
    preferenceSync.report(remote, actions);
    // `remote` is rebuilt every render; its identity is its status and revision.
  }, [remote.status, revision, error, waiting]);
  return useSyncExternalStore(preferenceSync.subscribe, preferenceSync.status, preferenceSync.status);
}

// Leader election: every renderer mounts a slot, and only the first mounted
// one runs the settings hook, so a chat of hundreds of rows reads the
// settings once instead of once per row. When the leader unmounts (its row
// scrolls out or is replaced), the next slot takes over.
let nextSlot = 0;
const slots: number[] = [];
const slotListeners = new Set<() => void>();
const leader = () => slots[0] ?? -1;
function subscribeSlots(listener: () => void) {
  slotListeners.add(listener);
  return () => {
    slotListeners.delete(listener);
  };
}
function notifySlots() {
  for (const listener of slotListeners) listener();
}

function PreferenceSyncLeader() {
  usePreferenceSettings();
  return null;
}

function PreferenceSyncSlotBody() {
  const idRef = useRef<number>(-1);
  if (idRef.current === -1) idRef.current = nextSlot++;
  useEffect(() => {
    const id = idRef.current;
    slots.push(id);
    if (slots[0] === id) notifySlots();
    return () => {
      const index = slots.indexOf(id);
      if (index >= 0) slots.splice(index, 1);
      if (index === 0) notifySlots();
    };
  }, []);
  const current = useSyncExternalStore(subscribeSlots, leader, leader);
  return current === idRef.current ? <PreferenceSyncLeader /> : null;
}

/**
 * Mount once per renderer; renders nothing but keeps the settings in sync.
 *
 * Memoised with no props, so a card's own re-render never re-renders the
 * slot — and in the leader card never re-runs `useSettings` (react-query
 * subscriptions, three RPC hooks and a schema parse) as part of that card's
 * commit (defect D6). The slot re-renders only when leadership moves, and
 * the leader child only for its own settings updates.
 */
export const PreferenceSyncSlot = memo(PreferenceSyncSlotBody);
