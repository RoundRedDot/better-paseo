import React, { useCallback, useLayoutEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "./theme-tokens";
import type { ToolCallView } from "../tools/classify";
import { RunningDot } from "../ui/running-dot";
import { useAgent } from "@getpaseo/plugin/client";
import { toolPermissionTargets, toolRollupFailed } from "../tools/group";

/** Cards remain in their original host slots; this button only shares disclosure. */
export function ToolRollup({ calls, expanded, onExpandedChange, tokens, compact }: {
  calls: readonly ToolCallView[];
  expanded: boolean;
  onExpandedChange(value: boolean): void;
  tokens: ExtendedThemeTokens;
  compact: boolean;
}) {
  const running = calls.filter((call) => call.status === "running").length;
  const failed = calls.filter(toolRollupFailed).length;
  const title = `Called ${calls.length} ${calls.length === 1 ? "tool" : "tools"}`;
  const label = [title, ...(running ? [`${running} running`] : []), ...(failed ? [`${failed} failed`] : [])].join(" · ");
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ expanded }}
    aria-expanded={expanded}
    onPress={() => onExpandedChange(!expanded)}
    style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: compact ? 44 : 28 }}
  >
    <View style={{ width: 16, alignItems: "center" }}>
      {running ? <RunningDot color={tokens.accent} /> : <Icon name={failed ? "CircleAlert" : "Wrench"} size={14} color={failed ? tokens.danger : tokens.foregroundMuted} />}
    </View>
    <Text style={{ color: failed ? tokens.danger : tokens.foregroundMuted, fontFamily: tokens.fontUi, fontSize: 13, flexShrink: 1 }}>{label}</Text>
    <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={tokens.foregroundMuted} />
  </Pressable>;
}

/** Keep only cards owning live controls visible, without changing run membership. */
export function ToolRollupControls({ view, onChange }: { view: ToolCallView; onChange(active: boolean): void }) {
  const active = useRef(new Set<string>());
  const update = useCallback((id: string, waiting: boolean) => {
    if (waiting) active.current.add(id); else active.current.delete(id);
    onChange(active.current.size > 0);
  }, [onChange]);
  return toolPermissionTargets(view).map((id) => <ActiveToolControls key={id} agentId={id} onChange={update} />);
}

function ActiveToolControls({ agentId, onChange }: { agentId: string; onChange(id: string, active: boolean): void }) {
  const waiting = useAgent(agentId, (agent) => agent.attentionReason === "permission");
  useLayoutEffect(() => {
    // PermissionActions/PermissionQuestionForm also allow an unknown snapshot
    // (stillWaiting(undefined)); use exactly their existing waiting rule.
    onChange(agentId, waiting !== false);
    return () => onChange(agentId, false);
  }, [agentId, waiting, onChange]);
  return null;
}
