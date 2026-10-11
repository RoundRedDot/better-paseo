import { useCallback, useMemo, useState } from "react";
import { noteHover } from "./use-input-capabilities";

/**
 * Hover state for a `Pressable`, on every platform.
 *
 * `Pressable`'s style callback only reports `hovered` on React Native Web;
 * `onHoverIn`/`onHoverOut` fire on web and on native pointers (iPad), so the
 * state is kept here instead. The first native hover also tells
 * `useInputCapabilities` that this device has a pointer.
 */
export function useHover(): {
  hovered: boolean;
  hoverProps: { onHoverIn(): void; onHoverOut(): void };
} {
  const [hovered, setHovered] = useState(false);
  const onHoverIn = useCallback(() => {
    noteHover();
    setHovered(true);
  }, []);
  const onHoverOut = useCallback(() => setHovered(false), []);
  const hoverProps = useMemo(() => ({ onHoverIn, onHoverOut }), [onHoverIn, onHoverOut]);
  return { hovered, hoverProps };
}
