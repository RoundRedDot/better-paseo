import { useEffect, useState } from "react";
import { useReducedMotion } from "../../ui/use-reduced-motion";

export const REVEAL_TICK_MS = 30;
/** Each tick shows this share of what is left: fast at first, easing into the last characters. */
const EASE = 12;

/** The text shown one tick later on the way to `target`, by code point so no character splits. */
export function revealStep(shown: string, target: string): string {
  const have = Array.from(shown).length;
  const want = Array.from(target);
  return want.slice(0, have + Math.max(1, Math.ceil((want.length - have) / EASE))).join("");
}

/**
 * A generated title typed out as it streams in. Providers send a title in
 * a few large chunks, often one, so each chunk's new characters come in over
 * a few hundred milliseconds rather than all at once. Text that does not
 * continue what is shown starts over from nothing while `streaming`; outside
 * a stream (a manual rename, reduced motion) the title shows at once, though
 * a reveal already under way finishes.
 */
export function useRevealedTitle(target: string, streaming: boolean, animated = true): string {
  const reduced = useReducedMotion();
  const [state, setState] = useState({ shown: target, typing: false });
  const continues = target.startsWith(state.shown);
  const active = animated && !reduced && (streaming || (state.typing && continues));
  // Decided in render, so a snap never shows the old text for a frame.
  const shown = !active ? target : continues ? state.shown : "";
  useEffect(() => {
    if (!active || shown === target) {
      if (state.shown !== target || state.typing) setState({ shown: target, typing: false });
      return;
    }
    const timer = setTimeout(() => setState({ shown: revealStep(shown, target), typing: true }), REVEAL_TICK_MS);
    return () => clearTimeout(timer);
  }, [active, shown, target, state]);
  return shown;
}
