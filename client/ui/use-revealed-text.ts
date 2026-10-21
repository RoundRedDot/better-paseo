import * as hostReactNative from "@getpaseo/plugin/client/react-native";

type RevealedText = (text: string, phase: "streaming" | "complete") => string;

/**
 * The host's paced reveal for streaming text, where the host still exports it.
 *
 * Paseo 0.13 (getpaseo/paseo#7474) points the old `client/react-native` entry at
 * its UI runtime, which dropped `useRevealedText` for a `StreamedText` component.
 * The renderers need the revealed string itself (segmentation and Markdown work
 * on it), so a component does not replace the hook. Calling the missing hook threw
 * and the host drew "Plugin failed" for every live reply and thought; on such a
 * host the text is drawn whole instead.
 *
 * Chosen once at load, so every render calls the same hook.
 */
const hostHook: unknown = "useRevealedText" in hostReactNative ? hostReactNative.useRevealedText : undefined;

function useWholeText(text: string): string {
  return text;
}

export const useRevealedText: RevealedText = typeof hostHook === "function" ? (hostHook as RevealedText) : useWholeText;
