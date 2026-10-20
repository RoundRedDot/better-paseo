import React, { useState, type ReactNode } from "react";
import { View, Text, Pressable } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Glyph } from "./glyph";
import { radiusV2, space, type ExtendedThemeTokens } from "./theme-tokens";
import { useCopy } from "../ui/use-copy";
import { useHover } from "../ui/use-hover";
import { useInputCapabilities } from "../ui/use-input-capabilities";

/** Shared hierarchy for creation and supervisor status cards. */
export function AgentCardContent({ title, agentId, state, color, testID = "create-agent", metadata, tokens, mobile, children, showAgentId = true }: {
  title: string; agentId?: string; state?: "created" | "running" | "failed" | "canceled";
  color?: string; testID?: string; metadata: ReactNode; tokens: ExtendedThemeTokens; mobile: boolean; children: ReactNode;
  showAgentId?: boolean;
}) {
  return <View style={{ gap: mobile ? space.xs : space.sm, minWidth: 0 }}>
    <Text testID={`${testID}-title`} selectable accessibilityRole="header" style={{
      fontFamily: tokens.fontUi, fontSize: mobile ? 18 : 20, lineHeight: mobile ? 26 : 28,
      fontWeight: "600", color: tokens.foreground, minWidth: 0, flexShrink: 1, marginBottom: mobile ? 0 : 4,
    }}>{title}</Text>
    <View testID={`${testID}-metadata`} style={{
      flexDirection: "row", alignItems: "center", justifyContent: "flex-start",
      flexWrap: "wrap", columnGap: space.lg, rowGap: space.xs, minWidth: 0,
    }}>
      {metadata}
      {showAgentId ? <AgentId agentId={agentId} state={state} color={color} testID={testID} tokens={tokens} mobile={mobile} /> : null}
    </View>
    {children}
  </View>;
}

/** Composer-style metadata: a semantic icon beside a quiet label. */
export function AgentCardMetadataItem({ testID, accessibilityLabel, icon, iconColor, label, tokens }: {
  testID: string; accessibilityLabel: string; icon: string; iconColor: string; label: string; tokens: ExtendedThemeTokens;
}) {
  return <View testID={testID} accessibilityLabel={accessibilityLabel}
    style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0, maxWidth: "100%", flexShrink: 1 }}>
    <Icon name={icon} size={16} color={iconColor} />
    <Text selectable style={{ fontSize: tokens.typography.block.meta.size,
      fontFamily: tokens.fontUi, color: tokens.foregroundMuted, flexShrink: 1 }}>{label}</Text>
  </View>;
}

/** The entire ID is one copy target; touch keeps its affordance visible. */
function AgentId({ agentId, tokens, mobile, state, color = tokens.success, testID = "create-agent" }: {
  agentId?: string; tokens: ExtendedThemeTokens; mobile: boolean;
  state?: "created" | "running" | "failed" | "canceled";
  color?: string; testID?: string;
}) {
  const label = agentId ?? (state === "failed" ? "Creation failed" : state === "canceled" ? "Creation canceled" :
    state === "running" ? "running" : "Agent ID unavailable");
  const markColor = !agentId && state === "failed" ? tokens.danger : !agentId ? tokens.foregroundMuted : color;
  const { copied, copy } = useCopy();
  const { hovered, hoverProps } = useHover();
  const [focused, setFocused] = useState(false);
  const capabilities = useInputCapabilities();
  const showCopy = !capabilities.hover || hovered || focused || copied;
  return (
    <Pressable testID={`${testID}-id`} accessibilityRole={agentId ? "button" : undefined}
      accessibilityLabel={agentId ? `Copy agent ID ${agentId}` : label}
      disabled={!agentId} hitSlop={mobile ? 10 : 0} {...hoverProps}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPress={() => { if (agentId) void copy(agentId, { label: "Copy agent ID" }); }}
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs, maxWidth: "100%", minWidth: 0,
        width: mobile && agentId ? "100%" : undefined,
        minHeight: mobile ? 24 : capabilities.touch ? 44 : 24, paddingVertical: 3, borderRadius: radiusV2.block }}>
      {agentId && state === "created" ? <Glyph name="CheckCircle" size={11} color={markColor} /> : <Icon name={agentId ? "Bot" : state === "failed" ? "CircleX" : "CircleHelp"} size={11} color={markColor} />}
      <Text style={{ fontSize: tokens.typography.block.meta.size, fontFamily: tokens.fontUi,
        color: markColor, fontWeight: "600", flexShrink: 1, minWidth: 0 }}>{label}</Text>
      {agentId ? <View testID={`${testID}-copy-icon`} style={{ opacity: showCopy ? 1 : 0 }}>
        <Glyph name={copied ? "Check" : "Copy"} size={14} color={markColor} />
      </View> : null}
    </Pressable>
  );
}
