import React from "react";
import { StyleSheet } from "react-native";
import { useAgent } from "@getpaseo/plugin/client";
import { RowText } from "../ui/disclosure-header";
import type { ToolSummary } from "../tools/summarize";
import type { ExtendedThemeTokens } from "./theme-tokens";

/**
 * The agent a row names, by title. A call that carried only an ID asks the
 * host for the title; until one arrives the row shows the short ID in mono.
 */
export function useAgentRowTarget(summary: ToolSummary): { text?: string; isId: boolean } {
  const id = summary.agent?.targetIsId ? summary.agent.id ?? "" : "";
  const title = useAgent(id, (agent) => agent.title) ?? null;
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
