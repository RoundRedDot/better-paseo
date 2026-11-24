/**
 * The native details body's text size controls, for the toolbar above it.
 *
 * The body owns the pinch (`pinch-zoom.ts`): its coalesced steps, the size
 * still waiting to be laid out and the iOS text limit. The toolbar is drawn
 * beside the body, not inside it, so the body publishes those controls here
 * and the toolbar reads them. A block switch mounts the next body before the
 * last lets go; the newest one wins.
 */
import { useEffect, useRef, useState } from "react";
export interface ZoomControlsState {
  /** The size the toolbar shows: a pending step, else the size drawn now. */
  size: number;
  canDecrease: boolean;
  canIncrease: boolean;
}

export interface ZoomControls extends ZoomControlsState {
  step(direction: -1 | 1): void;
  reset(): void;
  /** Brings up the body's text size badge, with its − / + and Reset. */
  showBadge(): void;
}

export interface DetailsZoomControls {
  read(): ZoomControls | null;
  subscribe(listener: () => void): () => void;
  /** Publishes a body's controls; returns their removal. */
  attach(owner: object): { update(controls: ZoomControls): void; detach(): void };
}

export function createZoomControls(): DetailsZoomControls {
  const listeners = new Set<() => void>();
  const owners: Array<{ owner: object; controls: ZoomControls | null }> = [];
  let snapshot: ZoomControls | null = null;
  const publish = () => {
    const latest = owners.length ? owners[owners.length - 1]!.controls : null;
    if (latest === snapshot) return;
    if (latest && snapshot && sameState(latest, snapshot)) {
      // Same numbers: keep the snapshot, so readers do not redraw, but call the newest actions.
      snapshot.step = latest.step;
      snapshot.reset = latest.reset;
      snapshot.showBadge = latest.showBadge;
      return;
    }
    snapshot = latest ? { ...latest } : null;
    Array.from(listeners).forEach((listener) => listener());
  };
  return {
    read: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    attach(owner) {
      const slot = { owner, controls: null as ZoomControls | null };
      owners.push(slot);
      return {
        update(controls) {
          slot.controls = controls;
          publish();
        },
        detach() {
          const index = owners.indexOf(slot);
          if (index >= 0) owners.splice(index, 1);
          publish();
        },
      };
    },
  };
}

function sameState(a: ZoomControlsState, b: ZoomControlsState): boolean {
  return a.size === b.size && a.canDecrease === b.canDecrease && a.canIncrease === b.canIncrease;
}

/** The body's pinch as the toolbar drives it: steps that leave the badge down. */
interface PinchControls {
  size: number;
  canDecrease: boolean;
  canIncrease: boolean;
  step(direction: -1 | 1, show?: boolean): void;
  reset(show?: boolean): void;
  showBadge(): void;
}

/** Publishes the body's pinch controls while it is mounted, each time it draws. */
export function usePublishZoomControls(controls: DetailsZoomControls | undefined, pinch: PinchControls): void {
  const [owner] = useState(() => ({}));
  const slot = useRef<ReturnType<DetailsZoomControls["attach"]> | null>(null);
  const latest = useRef(pinch);
  latest.current = pinch;
  useEffect(() => {
    if (!controls) return;
    const attached = controls.attach(owner);
    slot.current = attached;
    return () => {
      if (slot.current === attached) slot.current = null;
      attached.detach();
    };
  }, [controls, owner]);
  useEffect(() => {
    slot.current?.update({
      size: pinch.size,
      canDecrease: pinch.canDecrease,
      canIncrease: pinch.canIncrease,
      step: (direction) => latest.current.step(direction, false),
      reset: () => latest.current.reset(false),
      showBadge: () => latest.current.showBadge(),
    });
  });
}
