import { useCallback, type Ref } from "react";
import { Platform } from "react-native";

/**
 * The role and ref of a Pressable that acts as a button and holds controls of
 * its own: a disclosure row with its copy buttons, a path with its copy icon.
 *
 * React Native Web draws `role="button"` as a `<button>`, and HTML lets no
 * `<button>` sit inside another (React: "In HTML, <button> cannot be a
 * descendant of <button>. This will cause a hydration error."). So on web the
 * Pressable gets no role prop, which draws it as a `<div>`, and the ref gives
 * that element `role="button"` in the DOM. A screen reader still reads a
 * button; RNW's press responder reads the role from the DOM too, so Enter and
 * Space press it, and an inner button's click and keydown stop propagating
 * before they reach it. Native has no such nesting rule and keeps the prop.
 *
 * `enabled` false (an inert row) gives neither role.
 */
export function useContainerButton<T>(enabled: boolean, ref?: Ref<T>): {
  accessibilityRole: "button" | undefined;
  ref: (node: T | null) => void;
} {
  const web = Platform.OS === "web";
  const merged = useCallback(
    (node: T | null) => {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: T | null }).current = node;
      if (!web || !node) return;
      const element = node as unknown as { setAttribute?(name: string, value: string): void; removeAttribute?(name: string): void };
      if (enabled) element.setAttribute?.("role", "button");
      else element.removeAttribute?.("role");
    },
    [ref, enabled, web],
  );
  return { accessibilityRole: enabled && !web ? "button" : undefined, ref: merged };
}
