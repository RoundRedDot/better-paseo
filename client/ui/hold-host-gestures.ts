import { findNodeHandle, Platform, TurboModuleRegistry, type View } from "react-native";

interface GestureHandlerModule {
  handleSetJSResponder?(tag: number, blockNativeResponder: boolean): void;
  flushOperations?(): void;
}

interface FabricResponder {
  setIsJSResponder?(node: unknown, isJSResponder: boolean, blockNativeResponder: boolean): void;
}

const RELEASE_NOTHING = () => {};

/**
 * Fails the host's native pans for the held touch, the swipe that opens the
 * agent list among them, before they activate; returns what lets them go.
 * Shared by the table's hold-to-select and the phone board's lane swipe.
 *
 * Gesture Handler stops its pans when a JS responder blocks native ones, but
 * the new architecture's responder no longer passes through its hook, and it
 * is granted only on the first move, after a fast pan may have started.
 *
 * - iOS: the hold calls the module itself, and flushes the call, which is
 *   otherwise queued until Gesture Handler's next batch. Its root recogniser
 *   begins and prevents every other recogniser for this touch, the scrollers'
 *   pans included, until the touch ends.
 * - Android: the module's call crashes there (it looks up the old UIManager),
 *   so the hold makes the given view the JS responder directly. Its parents
 *   are asked not to intercept, which cancels every Gesture Handler pan and
 *   keeps the scrollers out.
 */
export function holdHostGestures(node: View | null): () => void {
  try {
    if (Platform.OS === "ios") {
      const gestures = TurboModuleRegistry.get<GestureHandlerModule & import("react-native").TurboModule>("RNGestureHandlerModule");
      gestures?.handleSetJSResponder?.(findNodeHandle(node) ?? -1, true);
      gestures?.flushOperations?.();
      return RELEASE_NOTHING;
    }
    if (Platform.OS === "android") {
      const fabric = (globalThis as { nativeFabricUIManager?: FabricResponder }).nativeFabricUIManager;
      const shadow = (node as { __internalInstanceHandle?: { stateNode?: { node?: unknown } } } | null)
        ?.__internalInstanceHandle?.stateNode?.node;
      if (!fabric?.setIsJSResponder || !shadow) return RELEASE_NOTHING;
      fabric.setIsJSResponder(shadow, true, true);
      return () => {
        try {
          fabric.setIsJSResponder?.(shadow, false, false);
        } catch {
          // The frame is gone, and its responder with it.
        }
      };
    }
  } catch {
    // A host without these keeps its pans; the touch still follows the finger until one starts.
  }
  return RELEASE_NOTHING;
}
