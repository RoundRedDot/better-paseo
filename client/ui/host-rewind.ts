import type { ComponentType } from "react";
// A namespace import: the 0.11.2 SDK types do not declare `RewindMenu`, and a
// host without it injects the module without the key.
import * as PluginReactNative from "@getpaseo/plugin/client/react-native";

export interface HostRewindMenuProps {
  /** `host.id` from the renderer's props. */
  hostId: string;
  agentId: string;
  messageId?: string;
  /** The prompt, put back in the composer after a conversation rewind. */
  text: string;
}

/**
 * The host's rewind menu, or null on a host that does not provide it (Paseo
 * 0.11.2 and earlier). The host draws the menu and owns everything behind it:
 * which modes the agent's provider supports, the rewind itself, the timeline
 * refetch and the composer restore. A plugin cannot do any of that, since the
 * SDK gives it neither the rewind call nor the provider's capabilities.
 */
export function resolveRewindMenu(runtime: unknown): ComponentType<HostRewindMenuProps> | null {
  if (runtime === null || (typeof runtime !== "object" && typeof runtime !== "function")) return null;
  // `in` first: a module namespace that lacks the export may refuse the read.
  if (!("RewindMenu" in runtime)) return null;
  const candidate = (runtime as Record<string, unknown>).RewindMenu;
  return typeof candidate === "function" ? (candidate as ComponentType<HostRewindMenuProps>) : null;
}

/** Read once: a host provides the menu for the whole session or not at all. */
export const HOST_REWIND_MENU = resolveRewindMenu(PluginReactNative);
