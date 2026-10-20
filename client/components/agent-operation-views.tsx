import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import {
  AgentCode, AgentDivider, AgentErrorLine, AgentIdentityStrip, AgentMarkdown, AgentNote, AgentSection,
  useCardMobile, useLiveAgent, type AgentField,
} from "./agent-card-content";
import { space, type ExtendedThemeTokens } from "./theme-tokens";
import { shortAgentId } from "../tools/agent-row";
import type { PaseoAgentOperationData, PaseoSendAgentPromptData } from "../../shared/contracts";
import type { ToolCallView } from "../tools/classify";

interface Appearance { tokens: ExtendedThemeTokens; raw?: boolean; compact?: boolean; error?: string }

const DISPATCH_STATE = { sending: "sending", sent: "sent", failed: "failed", canceled: "canceled", unconfirmed: "not confirmed" };

export function SendAgentPromptView({ data, tokens, raw = false, compact = false, error }: Appearance & { data: PaseoSendAgentPromptData }) {
  const mobile = useCardMobile(compact);
  const live = useLiveAgent(data.agentId);
  const fields: AgentField[] = data.sessionMode ? [{ key: "mode", icon: "Shield", label: data.sessionMode }] : [];
  const state = data.agentStatus ?? live.status;
  return <View testID="send-agent-prompt" style={styles.card}>
    <AgentIdentityStrip testID="send-agent-prompt" provider={live.provider} fields={fields} state={state ?? DISPATCH_STATE[data.state]}
      agentId={data.agentId} tokens={tokens} mobile={mobile} />
    <AgentDivider tokens={tokens} />
    {data.state === "failed" && error ? <AgentErrorLine text={firstLine(error)} tokens={tokens} /> : null}
    {raw ? <AgentMarkdown text={JSON.stringify({ arguments: data.arguments, result: data.result }, null, 2)} tokens={tokens} raw mobile={mobile} /> :
      <AgentSection label="Prompt" tokens={tokens}><AgentMarkdown text={data.prompt} tokens={tokens} mobile={mobile} /></AgentSection>}
    {!raw && data.guidance ? <AgentNote testID="send-agent-prompt-guidance" text={data.guidance} tokens={tokens} /> : null}
  </View>;
}

export function AgentOperationView({ data, tokens, raw = false, compact = false, error }: Appearance & { data: PaseoAgentOperationData }) {
  const mobile = useCardMobile(compact);
  const live = useLiveAgent(data.agentId);
  const fact = (label: string) => data.facts.find((entry) => entry.label === label)?.value;
  const fields: AgentField[] = [];
  const model = fact("Model") ?? live.model;
  if (model) fields.push({ key: "model", icon: "Cpu", label: model });
  const mode = fact("Mode");
  if (mode) fields.push({ key: "mode", icon: "SlidersHorizontal", label: mode });
  const cwd = fact("Directory");
  if (cwd) fields.push({ key: "cwd", icon: "Folder", label: shortenHome(cwd) });
  const updates = fact("Updates");
  const extra = data.facts.filter((entry) => !["Provider", "Model", "Directory", "Mode", "Updates"].includes(entry.label));
  const listing = data.agents !== undefined || data.permissions !== undefined;
  return <View testID="agent-operation" style={styles.card}>
    {data.agentId ? <AgentIdentityStrip testID="agent-operation" provider={fact("Provider") ?? live.provider} fields={fields}
      state={data.agentStatus ?? live.status} agentId={data.agentId} tokens={tokens} mobile={mobile} /> : null}
    {data.agentId && (raw || error || extra.length || data.content || listing) ? <AgentDivider tokens={tokens} /> : null}
    {error ? <AgentErrorLine text={firstLine(error)} tokens={tokens} /> : null}
    {raw ? <AgentMarkdown text={JSON.stringify({ arguments: data.arguments, result: data.result }, null, 2)} tokens={tokens} raw mobile={mobile} /> : <>
    {extra.length ? <View style={styles.facts}>{extra.map((entry) => <Text key={entry.label} selectable
      style={[styles.fact, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>{entry.label}
      <Text style={{ color: tokens.foreground }}>{`  ${entry.value}`}</Text></Text>)}</View> : null}
    {data.agents ? <AgentList agents={data.agents} tokens={tokens} mobile={mobile} /> : null}
    {data.permissions ? <PermissionList permissions={data.permissions} tokens={tokens} /> : null}
    {data.content ? <AgentSection label={updates ? `${updates} update${updates === "1" ? "" : "s"}` : undefined} tokens={tokens}>
      <AgentMarkdown text={data.content} tokens={tokens} mobile={mobile} /></AgentSection> : null}
    </>}
  </View>;
}

/** A compact two-line list: title and short ID, then the identity strip. */
function AgentList({ agents, tokens, mobile }: { agents: NonNullable<PaseoAgentOperationData["agents"]>; tokens: ExtendedThemeTokens; mobile: boolean }) {
  if (agents.length === 0) return <Text style={[styles.empty, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>No agents returned</Text>;
  return <View>{agents.map((agent, index) => <View key={agent.id} testID={`agent-list-${agent.id}`}
    style={[styles.listItem, index > 0 && { borderTopWidth: 1, borderTopColor: tokens.border }]}>
    <Text selectable numberOfLines={1} style={[styles.listTitle, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>{agent.title}</Text>
    <AgentIdentityStrip testID={`agent-list-${agent.id}`} provider={agent.provider} state={agent.status}
      fields={agent.cwd ? [{ key: "cwd", icon: "Folder", label: shortenHome(agent.cwd) }] : []}
      agentId={agent.id} tokens={tokens} mobile={mobile} />
  </View>)}</View>;
}

function PermissionList({ permissions, tokens }: { permissions: NonNullable<PaseoAgentOperationData["permissions"]>; tokens: ExtendedThemeTokens }) {
  if (permissions.length === 0) return <Text style={[styles.empty, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>No pending permissions</Text>;
  return <View style={{ gap: space.sm }}>{permissions.map((request) => <PermissionRequest key={`${request.agentId}:${request.requestId}`}
    testID={`permission-${request.requestId}`} title={request.title} agentId={request.agentId} requestId={request.requestId}
    description={request.description} tokens={tokens} />)}</View>;
}

/** One request: what it wants to run, for which agent, under which request ID. */
export function PermissionRequest({ testID, title, agentId, requestId, description, command, tokens }: {
  testID?: string; title?: string; agentId?: string; requestId?: string; description?: string; command?: string;
  tokens: ExtendedThemeTokens;
}) {
  const live = useLiveAgent(agentId);
  return <View testID={testID} style={{ gap: 6 }}>
    <View style={styles.permissionHead}>
      <Icon name="ShieldAlert" size={14} color={tokens.warning} />
      {title ? <Text selectable style={[styles.listTitle, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>{title}</Text> : null}
      {agentId ? <Text selectable numberOfLines={1} style={[styles.permissionAgent, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
        {live.title ?? shortAgentId(agentId)}</Text> : <View style={{ flex: 1 }} />}
      {requestId ? <Text selectable style={[styles.requestId, { color: tokens.foregroundMuted, fontFamily: tokens.fontMono }]}>{requestId}</Text> : null}
    </View>
    {description ? <AgentMarkdown text={description} tokens={tokens} mobile={false} /> : null}
    {command ? <AgentCode text={command} tokens={tokens} /> : null}
  </View>;
}


/** Provider-native Task/Agent calls have session IDs, not Paseo agent IDs. */
export function SubAgentView({ data, tokens, raw = false, compact = false }: Appearance & { data: ToolCallView }) {
  const mobile = useCardMobile(compact);
  const agent = data.subAgent!;
  const state = data.status === "failed" ? "failed" : data.status === "running" ? "running" : data.status;
  return <View testID="sub-agent" style={styles.card}>
    <AgentIdentityStrip testID="sub-agent" tokens={tokens} mobile={mobile} state={state}
      leading={agent.subAgentType ? <View style={styles.type}>
        <Icon name="Workflow" size={12} color={tokens.foregroundMuted} />
        <Text style={[styles.typeText, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>{agent.subAgentType}</Text>
      </View> : undefined} />
    {raw || agent.prompt || agent.actions?.length || agent.log ? <AgentDivider tokens={tokens} /> : null}
    {raw ? <AgentMarkdown text={JSON.stringify(agent, null, 2)} tokens={tokens} raw mobile={mobile} /> : <>
    {agent.prompt ? <AgentSection label="Prompt" tokens={tokens}><AgentMarkdown text={agent.prompt} tokens={tokens} mobile={mobile} /></AgentSection> : null}
    {agent.actions?.length ? <AgentSection label="Actions" tokens={tokens}>
      {agent.actions.map((action) => <View key={action.index} style={styles.action}>
        <Text style={[styles.actionTool, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>{action.toolName}</Text>
        {action.summary ? <Text selectable numberOfLines={1} style={[styles.actionSummary, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
          {action.summary}</Text> : null}
      </View>)}
    </AgentSection> : null}
    {agent.log ? <AgentSection label="Result" tokens={tokens}><AgentMarkdown text={agent.log} tokens={tokens} mobile={mobile} /></AgentSection> : null}
    </>}
  </View>;
}

/** `$HOME` reads as `~`. */
export function shortenHome(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? text;
}

const styles = StyleSheet.create({
  card: { gap: space.sm, minWidth: 0 },
  facts: { gap: 2 },
  fact: { fontSize: 12, lineHeight: 18 },
  empty: { fontSize: 12, lineHeight: 18 },
  listItem: { paddingVertical: 6, gap: 2 },
  listTitle: { fontSize: 13, lineHeight: 18, fontWeight: "500", flexShrink: 1 },
  permissionHead: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  permissionAgent: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 },
  requestId: { fontSize: 11, lineHeight: 16 },
  type: { flexDirection: "row", alignItems: "center", gap: 5 },
  typeText: { fontSize: 12, lineHeight: 20, fontWeight: "500" },
  action: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 22, minWidth: 0 },
  actionTool: { fontSize: 12, lineHeight: 18, fontWeight: "500" },
  actionSummary: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 },
});
