import { useSyncExternalStore } from "react";

/**
 * Whether the host stacks plugin rows itself.
 *
 * Paseo up to 0.11.2 hangs 16pt under every plugin item, so a tool or thought
 * row takes 12 of it back (`ROW_GAP_COMPENSATION`). A host that treats rows
 * projected from tool calls, thoughts and checklists as its own tool sequence
 * (getpaseo/paseo#6602) puts nothing between them, and the same 12 pulls each
 * row into the one above. The renderer gets no host version, so the plugin
 * reads the answer off the screen: the space between two rows drawn one under
 * the other is the host's gap plus the margin the upper row took.
 *
 * A row that gives up 12 sits 4 above the next on a spacing host and 12 into
 * it on a stacking one; a row that keeps its gap sits 16 and 0 away. Anything
 * else (a native item between them, a row mid-animation) answers nothing and
 * the next pair is asked. The first answer holds for the life of the app: the
 * layout is the app's, the same for every host and chat it shows.
 */
const SPACING_GAPS = [16, 4];
const STACKING_GAPS = [0, -12];
const TOLERANCE = 1;

let stacked: boolean | null = null;
const listeners = new Set<() => void>();

/** True for a stacking host, false for a spacing one, null when `gap` tells neither. */
export function classifyRowGap(gap: number): boolean | null {
  const near = (values: number[]) => values.some((value) => Math.abs(gap - value) <= TOLERANCE);
  if (near(STACKING_GAPS)) return true;
  if (near(SPACING_GAPS)) return false;
  return null;
}

/** Null until a pair of rows has been measured. */
export function hostStacksRows(): boolean | null {
  return stacked;
}

/** Records the space measured between two rows; ignored once the host is known. */
export function noteRowGap(gap: number): void {
  if (stacked !== null) return;
  const answer = classifyRowGap(gap);
  if (answer === null) return;
  stacked = answer;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Until measured, the host is taken to space rows, as every released Paseo does. */
export function useHostStacksRows(): boolean {
  return useSyncExternalStore(subscribe, () => stacked === true, () => stacked === true);
}

/** Tests only: forget the measured answer. */
export function resetHostRowGap(): void {
  stacked = null;
}
