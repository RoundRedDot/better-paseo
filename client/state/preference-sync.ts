/**
 * Keeps the in-memory preference store and the daemon's settings in step
 * (S5 fix round 1, requirement §11.6). No React and no SDK here, so the
 * ordering rules are unit tested; `preference-sync-slot.tsx` feeds it the
 * `useSettings` state.
 *
 * Rules:
 * - Renderers never wait: they read the store, which starts from the web
 *   cache or the defaults, and is updated once when the settings are ready.
 * - A change the reader makes is applied locally at once and saved with the
 *   revision the settings were read at. Saves are serialised: a change made
 *   while one is in flight is sent after it, against the fresh revision.
 *   A rejected save (another client wrote first) reloads and retries, so the
 *   last writer wins, which is right for presentation choices.
 * - A daemon with no settings yet (revision "missing") receives this
 *   client's old local record once, if there is one.
 * - Unreadable settings (`invalid`) draw the defaults; a pending change then
 *   resets the stored record first, because the daemon refuses to save over
 *   a file it cannot parse. An unreachable daemon (`error`) keeps the
 *   last-known values. Both surface on the settings page.
 */
import type { StoredPreferences } from "../../shared/preferences-settings";

/** Revision of a settings file that does not exist yet (daemon store). */
export const MISSING_REVISION = "missing";
/** Consecutive failed saves before a pending change is given up. */
export const MAX_SAVE_ATTEMPTS = 3;

export type RemoteSettings =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "invalid"; error: string; revision: string }
  | { status: "ready"; values: StoredPreferences; revision: string };

export interface RemoteActions {
  save(values: StoredPreferences, revision: string): Promise<boolean>;
  reset(): Promise<boolean>;
  reload(): Promise<void>;
}

export interface SyncStatus {
  status: RemoteSettings["status"];
  error: string | null;
  /** A change has not reached the daemon yet. */
  pending: boolean;
  /** The last change was given up after repeated failures. */
  failed: boolean;
}

export interface PreferenceSyncDeps {
  apply(values: StoredPreferences): void;
  defaults(): StoredPreferences;
  /** This client's pre-daemon record, or null (see `legacyLocalPreferences`). */
  legacy(): StoredPreferences | null;
  markMigrated(): void;
}

export interface PreferenceSync {
  /** The latest `useSettings` state and its actions. Idempotent per revision. */
  report(state: RemoteSettings, actions: RemoteActions): void;
  /** A change from the reader (already applied to the store). */
  request(values: StoredPreferences): void;
  status(): SyncStatus;
  subscribe(listener: () => void): () => void;
}

export function createPreferenceSync(deps: PreferenceSyncDeps): PreferenceSync {
  let remote: RemoteSettings = { status: "loading" };
  let actions: RemoteActions | null = null;
  /** The revision a save may be sent against; null while unknown. */
  let revision: string | null = null;
  let pending: StoredPreferences | null = null;
  let inFlight = false;
  let attempts = 0;
  let failed = false;
  let lastSeen: string | null = null;
  let migrationChecked = false;
  let snapshot: SyncStatus = { status: "loading", error: null, pending: false, failed: false };
  const listeners = new Set<() => void>();

  const publish = () => {
    const next: SyncStatus = {
      status: remote.status,
      error: remote.status === "error" || remote.status === "invalid" ? remote.error : null,
      pending: pending !== null,
      failed,
    };
    if (
      next.status === snapshot.status &&
      next.error === snapshot.error &&
      next.pending === snapshot.pending &&
      next.failed === snapshot.failed
    ) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const giveUp = () => {
    pending = null;
    attempts = 0;
    failed = true;
    if (remote.status === "ready") deps.apply(remote.values);
  };

  const flush = () => {
    if (inFlight || pending === null || actions === null) return;
    const act = actions;
    if (remote.status === "invalid" && revision !== null) {
      // The daemon will not save over a record it cannot read; reset it
      // (revision-checked) and save the change once it reads as defaults.
      inFlight = true;
      revision = null;
      void act.reset().then(
        (ok) => {
          inFlight = false;
          if (!ok && ++attempts >= MAX_SAVE_ATTEMPTS) giveUp();
          publish();
          if (!ok) void act.reload();
        },
        () => {
          inFlight = false;
          publish();
        },
      );
      return;
    }
    if (remote.status !== "ready" || revision === null) return;
    const values = pending;
    const against = revision;
    inFlight = true;
    // The next revision arrives through `report` once the host has stored
    // the save; until then nothing else may be sent against the old one.
    revision = null;
    void act.save(values, against).then(
      (ok) => {
        inFlight = false;
        if (ok) {
          attempts = 0;
          failed = false;
          if (pending === values) pending = null;
          if (against === MISSING_REVISION) deps.markMigrated();
        } else if (++attempts >= MAX_SAVE_ATTEMPTS) {
          giveUp();
        } else {
          // Another client saved first: read its revision, then retry.
          void act.reload();
        }
        publish();
        flush();
      },
      () => {
        inFlight = false;
        publish();
      },
    );
  };

  return {
    report(state, nextActions) {
      actions = nextActions;
      const seen =
        state.status === "ready" || state.status === "invalid"
          ? `${state.status}:${state.revision}`
          : state.status === "error"
            ? `error:${state.error}`
            : state.status;
      if (seen === lastSeen) {
        // Same revision as before: after a failed save (reloaded, nothing
        // changed) it becomes the revision to retry against.
        if (!inFlight && revision === null && (state.status === "ready" || state.status === "invalid")) {
          revision = state.revision;
        }
        flush();
        return;
      }
      lastSeen = seen;
      remote = state;

      if (state.status === "ready") {
        revision = state.revision;
        if (!migrationChecked) {
          migrationChecked = true;
          const legacy = state.revision === MISSING_REVISION ? deps.legacy() : null;
          if (legacy) {
            deps.apply(legacy);
            if (pending === null) pending = legacy;
          } else {
            // The daemon already holds settings (or this client had none):
            // its values win and the local record is never offered.
            deps.markMigrated();
          }
        }
        // A change waiting to be saved keeps the reader's choice on screen.
        if (pending === null) deps.apply(state.values);
      } else if (state.status === "invalid") {
        revision = state.revision;
        if (pending === null) deps.apply(deps.defaults());
      } else {
        revision = null;
      }
      publish();
      flush();
    },
    request(values) {
      pending = values;
      attempts = 0;
      failed = false;
      publish();
      flush();
    },
    status: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
