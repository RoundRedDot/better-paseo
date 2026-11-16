import { useEffect, useRef, useState } from "react";
import {
  advanceTextReveal,
  beginTextReveal,
  completeTextReveal,
  isTextRevealPacingSupported,
  isTextRevealSettled,
  nextTextRevealFrame,
  retargetTextReveal,
  type TextRevealState,
  visibleRevealedText,
} from "./text-reveal";

/**
 * Paced reveal for streaming text, the same as the host's own.
 *
 * Ported from Paseo's `useRevealedText` (packages/app/src/hooks/use-revealed-text.ts,
 * Apache License 2.0; see `text-reveal`). The host used to hand it to plugins
 * through the `client/react-native` entry, which Paseo 0.16 deprecates and
 * removes after 2027-04-20; its replacement, the `StreamedText` component, does
 * not give back the revealed string the renderers segment and parse as Markdown.
 *
 * Like the host's, it settles a finished text in a passive effect, so a longer
 * "complete" text shows one commit late; callers that must not lag pass a
 * constant and draw the text themselves.
 */
export function useRevealedText(text: string, phase: "streaming" | "complete"): string {
  const pacingSupported = isTextRevealPacingSupported();
  const stateRef = useRef<TextRevealState>(beginTextReveal(text));
  const [, forceRender] = useState(0);
  const frameRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef<number | null>(null);

  stateRef.current = retargetTextReveal(stateRef.current, text);

  useEffect(() => {
    const settle = () => {
      lastFrameAtRef.current = null;
      const next = completeTextReveal(stateRef.current);
      if (next !== stateRef.current) {
        stateRef.current = next;
        forceRender((tick) => tick + 1);
      }
    };

    if (!pacingSupported || phase !== "streaming") {
      settle();
      return;
    }
    if (isTextRevealSettled(stateRef.current)) {
      lastFrameAtRef.current = null;
      return;
    }
    if (typeof requestAnimationFrame !== "function") {
      settle();
      return;
    }

    const tick = (timestamp: number) => {
      frameRef.current = null;
      const frame = nextTextRevealFrame(lastFrameAtRef.current, timestamp);
      if (!frame) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      lastFrameAtRef.current = frame.frameAtMs;
      const next = advanceTextReveal(stateRef.current, frame.elapsedMs);
      if (next !== stateRef.current) {
        stateRef.current = next;
        forceRender((count) => count + 1);
      }
      if (!isTextRevealSettled(stateRef.current)) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [text, pacingSupported, phase]);

  return pacingSupported ? visibleRevealedText(stateRef.current, { streaming: phase === "streaming" }) : text;
}
