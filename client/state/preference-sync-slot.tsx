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

/**
 * Reads the daemon's record once, from `contribute()`, so the store holds it
 * before the first row mounts the settings hook below. Without it iOS and
 * Android (no `localStorage`) project the first timeline with the defaults,
 * then re-register their transformers and project it again when a row's hook
 * answers. The same settings RPC the hook calls; the hook stays the ongoing
 * sync (saves, other clients' changes). Returns the cancel for the cleanup.
 */
export function readPreferencesAtStartup(client: Pick<PluginClientContext, "rpc">): () => void {
  let live = true;
  // Sent now rather than a tick later; a synchronous throw becomes a rejection.
  new Promise((resolve) => resolve(client.rpc(settingsRpc(PREFERENCES_SETTINGS.id).read, {})))
    .then((result) => {
      if (!live || !result || typeof result !== "object") return;
      const read = result as { status?: unknown; revision?: unknown; values?: unknown };
      if (read.status !== "ready" || typeof read.revision !== "string") return;
      preferenceSync.prime({ status: "ready", values: preferencesSchema.parse(read.values ?? {}), revision: read.revision });
    })
    .catch(() => {
      // The settings hook reads again once a row mounts.
    });
  return () => {
    live = false;
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
    preferenceSync.report(remote, actions);
    // `remote` is rebuilt every render; its identity is its status and revision.
  }, [remote.status, revision, error]);
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
