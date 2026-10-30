import { InteractionManager } from "react-native";
import { loadMark } from "../debug/load-marks";

/**
 * "The chat has drawn": work nobody is looking at yet waits for it, so it
 * does not compete with the first chat rows for the JS thread at startup.
 *
 * The first plugin row to mount reports itself (`noteTimelineRowShown`).
 * `afterStartup` then runs its callback `AFTER_ROW_MS` later, or
 * `MAX_WAIT_MS` after it was asked when no row shows (no chat open), and in
 * both cases after any running interaction (`InteractionManager`). It is a
 * scheduling choice, not a promise that the chat has finished drawing.
 */
export const AFTER_ROW_MS = 1_000;
export const MAX_WAIT_MS = 4_000;

let rowShownAt: number | null = null;
const rowListeners = new Set<() => void>();

/** The first chat row this plugin draws has mounted. */
export function noteTimelineRowShown(): void {
  if (rowShownAt !== null) return;
  rowShownAt = Date.now();
  loadMark("row.first", rowShownAt);
  for (const listener of [...rowListeners]) listener();
}

export interface StartupTimers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  afterInteractions(run: () => void): { cancel(): void };
}

const defaultTimers: StartupTimers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  afterInteractions: (run) => InteractionManager.runAfterInteractions(run),
};

/** Runs `run` once startup has settled (see above); returns a cancel. */
export function afterStartup(run: () => void, timers: StartupTimers = defaultTimers): () => void {
  let done = false;
  let handle: unknown = null;
  let interaction: { cancel(): void } | null = null;
  const fire = () => {
    if (done) return;
    done = true;
    stop();
    interaction = timers.afterInteractions(run);
  };
  const wait = (ms: number) => {
    if (handle !== null) timers.clearTimeout(handle);
    handle = timers.setTimeout(fire, Math.max(0, ms));
  };
  const onRow = () => wait(rowShownAt === null ? AFTER_ROW_MS : rowShownAt + AFTER_ROW_MS - Date.now());
  const stop = () => {
    rowListeners.delete(onRow);
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
  };
  if (rowShownAt !== null) onRow();
  else {
    rowListeners.add(onRow);
    wait(MAX_WAIT_MS);
  }
  return () => {
    if (!done) {
      done = true;
      stop();
    }
    interaction?.cancel();
  };
}

/** Forgets the first row (tests). */
export function resetStartupSettled(): void {
  rowShownAt = null;
  rowListeners.clear();
}
