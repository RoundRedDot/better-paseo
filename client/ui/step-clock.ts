/**
 * One wall-clock step timer per period, shared by every looping indicator on native.
 *
 * Many Android devices redraw the whole window for any changed view. A native-driver
 * `Animated.loop` changes its view on every vsync, so a running ring or dot kept an
 * otherwise idle app repainting at full frame rate: 61 fps on a 2268x2440 foldable
 * with the Tasks sidebar entry running. A step changes the view only on its boundary.
 *
 * Steps come from `Date.now()`, so indicators mounted at different times stay in phase,
 * the way the host's status ring clock does (`components/status-ring/clock.ts`).
 */

type StepListener = (step: number) => void;

interface StepClock {
  listeners: Set<StepListener>;
  timer: ReturnType<typeof setTimeout> | null;
  step: number;
}

const clocks = new Map<string, StepClock>();

/** The step `nowMs` falls in, for `steps` equal steps per `periodMs`. */
export function stepAt(nowMs: number, periodMs: number, steps: number): number {
  return Math.floor(((nowMs % periodMs) * steps) / periodMs);
}

function schedule(clock: StepClock, periodMs: number, steps: number): void {
  const stepMs = periodMs / steps;
  // Wake on the next boundary rather than polling inside a step.
  const delay = Math.max(1, Math.ceil(stepMs - (Date.now() % stepMs)));
  clock.timer = setTimeout(() => {
    const next = stepAt(Date.now(), periodMs, steps);
    if (next !== clock.step) {
      clock.step = next;
      for (const listener of clock.listeners) listener(next);
    }
    schedule(clock, periodMs, steps);
  }, delay);
}

/** Calls `listener` with the current step now and on every step change; the returned function lets go once. */
export function holdStepClock(periodMs: number, steps: number, listener: StepListener): () => void {
  const key = `${periodMs}/${steps}`;
  let clock = clocks.get(key);
  if (!clock) {
    clock = { listeners: new Set(), timer: null, step: stepAt(Date.now(), periodMs, steps) };
    clocks.set(key, clock);
  }
  clock.listeners.add(listener);
  listener(stepAt(Date.now(), periodMs, steps));
  if (!clock.timer) schedule(clock, periodMs, steps);

  const held = clock;
  let holding = true;
  return () => {
    if (!holding) return;
    holding = false;
    held.listeners.delete(listener);
    if (held.listeners.size > 0) return;
    if (held.timer) clearTimeout(held.timer);
    held.timer = null;
    clocks.delete(key);
  };
}

/** Step clocks running right now; for tests. */
export function activeStepClocks(): number {
  return clocks.size;
}
