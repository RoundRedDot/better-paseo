import { useState, useSyncExternalStore } from "react";

/**
 * The board's clock as a store, not as state: the board ticks it once a
 * second and keeps its identity, so a tick re-renders only the components
 * that read the time (a card's timer text, the details), never the lanes,
 * their lists or the cards around them.
 */
export interface TaskClock {
  /** The time of the last tick (ms). */
  now(): number;
  subscribe(listener: () => void): () => void;
}

export interface TickingClock extends TaskClock {
  /** Read the time and tell the readers. */
  tick(): void;
}

export function createTaskClock(read: () => number = Date.now): TickingClock {
  let current = read();
  const listeners = new Set<() => void>();
  return {
    now: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    tick() {
      current = read();
      for (const listener of [...listeners]) listener();
    },
  };
}

/** Where a component reads the time: a fixed instant (previews, tests), the board's clock, or neither (the time it mounted). */
export interface TimeSource {
  now?: number;
  clock?: TaskClock;
}

const NO_SUBSCRIPTION = () => () => {};

/**
 * `select(now)` from the source; the component re-renders when the selected
 * value changes, so select a string or a number (a timer's text), not a
 * fresh object.
 */
export function useTime<T>(source: TimeSource, select: (now: number) => T): T {
  const [mountedAt] = useState(() => Date.now());
  const clock = source.now === undefined ? source.clock : undefined;
  const fixed = source.now ?? mountedAt;
  const read = () => select(clock ? clock.now() : fixed);
  return useSyncExternalStore(clock ? clock.subscribe : NO_SUBSCRIPTION, read, read);
}
