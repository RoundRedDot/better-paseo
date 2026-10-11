/**
 * How long a thought took, but only when this client watched it stream
 * (plan §3.4 item 3). Nothing upstream reports a duration: the host folds a
 * thought's chunks into one item and rewrites its timestamp on every chunk,
 * so the first chunk's time is lost by the time a history row renders.
 *
 * So the card records it itself. The first render that sees the thought
 * streaming stores the host timestamp it carries (the first chunk this client
 * saw); every later render moves the end forward to the newest timestamp.
 * Both ends are host times, so the difference is free of clock skew between
 * this device and the daemon. A thought first seen complete — a reopened chat,
 * a reload — has no record and shows no duration: none is ever made up.
 *
 * Module-level, keyed like the disclosure store, so a row remounted when its
 * turn settles keeps its record. In memory only, bounded like that store.
 */

export const OBSERVED_LIMIT = 2000;

interface Observation {
  start: number;
  end: number;
}

const observations = new Map<string, Observation>();

/**
 * Records one render of the thought `key` at host time `at`. Starts a record
 * only while streaming; extends an existing one in either phase (the final
 * render after the stream ends carries the last timestamp).
 */
export function observeReasoning(key: string, streaming: boolean, at: number): void {
  if (!Number.isFinite(at)) return;
  const existing = observations.get(key);
  if (existing) {
    if (at > existing.end) existing.end = at;
    return;
  }
  if (!streaming) return;
  observations.set(key, { start: at, end: at });
  while (observations.size > OBSERVED_LIMIT) {
    const oldest = observations.keys().next().value as string;
    observations.delete(oldest);
  }
}

/** Milliseconds between the first and last observed chunk, or null if never observed. */
export function observedDurationMs(key: string): number | null {
  const record = observations.get(key);
  if (!record) return null;
  const span = record.end - record.start;
  return span > 0 ? span : null;
}

/**
 * Moves a record to the key a growing text settled on. While a thought is
 * shorter than the key's 80-character prefix its key changes with each chunk.
 */
export function carryObservation(from: string, to: string): void {
  const record = observations.get(from);
  if (!record || observations.has(to)) return;
  observations.set(to, { start: record.start, end: record.end });
}

/** Test seam. */
export function resetObservations(): void {
  observations.clear();
}
