import React, { createContext, useContext } from "react";
import { StyleSheet } from "react-native";
import { useAgent } from "@getpaseo/plugin/client";
import { RowText } from "../ui/disclosure-header";
import type { ToolSummary } from "../tools/summarize";
import type { ExtendedThemeTokens } from "./theme-tokens";

/**
 * False where the host provides no agent state, as on the Better Paseo
 * settings page: the host's `useAgent` throws outside a workspace panel
 * ("Plugin state hooks must run inside a workspace panel"), and the plugin
 * SDK exposes no way to ask first. The value never changes under a mounted
 * row, so the hooks a row calls stay the same from render to render.
 */
export const HostAgentStateContext = createContext(true);

function useAgentTitle(id: string): string | null {
  return useAgent(id, (agent) => agent.title) ?? null;
}

function noAgentTitle(): string | null {
  return null;
}

/**
 * The agent a row names, by title. A call that carried only an ID asks the
 * host for the title; until one arrives the row shows the short ID in mono.
 */
export function useAgentRowTarget(summary: ToolSummary): { text?: string; isId: boolean } {
  const id = summary.agent?.targetIsId ? summary.agent.id ?? "" : "";
  const lookup = useContext(HostAgentStateContext) ? useAgentTitle : noAgentTitle;
  const title = lookup(id);
  if (summary.agent?.targetIsId && title) return { text: title, isId: false };
  return { text: summary.target, isId: Boolean(summary.agent?.targetIsId) };
}

export function AgentRowTarget({ summary, tokens }: { summary: ToolSummary; tokens: ExtendedThemeTokens }) {
  const { text, isId } = useAgentRowTarget(summary);
  if (!text) return null;
  const block = tokens.typography.block;
  return (
    <RowText part="target" selectable={false} numberOfLines={1} style={[styles.target, {
      fontFamily: isId ? tokens.fontMono : tokens.fontUi,
      fontSize: isId ? block.target.size - 1 : block.target.size,
      lineHeight: block.target.lineHeight,
    }]}>{text}</RowText>
  );
}

const styles = StyleSheet.create({
  target: { flex: 1, minWidth: 0 },
});
