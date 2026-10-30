/**
 * Wall-clock marks for one load of this plugin: when the bundle was
 * compiled and run, when `contribute` ran, when the Tasks chunk was asked
 * for, arrived and ran, and when the first chat row and the Tasks sidebar
 * row drew. Each mark keeps its first time only; a mark costs one
 * `Date.now()`.
 *
 * The marks live on the JS runtime's global so the install build's entry
 * (`scripts/build-client.mjs`) can set the first ones before this bundle
 * exists; each evaluation of that entry starts a fresh record. `/bc-perf
 * dump` ships them with its snapshot, and a bench build sends them on its
 * own (`scheduleLoadTraceDump`).
 */
export const LOAD_MARKS_GLOBAL = "__bcLoadMarks";

export type LoadMarks = Record<string, number>;

function record(): LoadMarks {
  const global = globalThis as Record<string, unknown>;
  let marks = global[LOAD_MARKS_GLOBAL] as LoadMarks | undefined;
  if (!marks || typeof marks !== "object") {
    marks = {};
    global[LOAD_MARKS_GLOBAL] = marks;
  }
  return marks;
}

/** Notes `name` at `now`, unless it was noted already in this load. */
export function loadMark(name: string, now: number = Date.now()): void {
  const marks = record();
  if (!(name in marks)) marks[name] = now;
}

/** A copy of this load's marks. */
export function loadMarks(): LoadMarks {
  return { ...record() };
}

/** Starts a fresh record (tests). */
export function resetLoadMarks(): void {
  (globalThis as Record<string, unknown>)[LOAD_MARKS_GLOBAL] = {};
}
