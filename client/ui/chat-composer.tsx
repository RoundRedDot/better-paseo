import { createContext } from "react";
import type { PluginTimelineItemProps as SdkTimelineItemProps } from "@getpaseo/plugin/client";

/** Host-owned draft editing, supplied by the composer-enabled Paseo host. */
export interface ChatComposer {
  appendText(text: string): boolean;
}

// The published 0.11.2 SDK predates this host prop. Keep the capability optional
// until the SDK release includes it; a host without it exposes no add action.
export type ComposerTimelineItemProps<Data = unknown> = SdkTimelineItemProps<Data> & {
  composer?: ChatComposer;
};

export const ChatComposerContext = createContext<ChatComposer | undefined>(undefined);

export function quoteCell(text: string): string {
  return text.split("\n").map((line) => line.trim() ? `> ${line}` : ">").join("\n") + "\n\n";
}
