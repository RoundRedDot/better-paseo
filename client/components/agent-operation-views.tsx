import React, { useMemo } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useAgent } from "@getpaseo/plugin/client";
import { AgentCardContent, AgentCardMetadataItem as MetadataItem } from "./agent-card-content";
import { MarkdownView } from "./markdown/markdown-view";
import { PreviewLines } from "../ui/preview-lines";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { blockProseBase } from "../ui/tokens/typography";
import { space, type ExtendedThemeTokens } from "./theme-tokens";
import type { PaseoAgentOperationData, PaseoSendAgentPromptData } from "../../shared/contracts";
import type { ToolCallView } from "../tools/classify";

interface Appearance { tokens: ExtendedThemeTokens; raw?: boolean; compact?: boolean }

function useMobile(compact: boolean) {
  const capabilities = useInputCapabilities(compact);
  const { width } = useWindowDimensions();
  return capabilities.native || width < 600;
}

function CardText({ text, tokens, raw, mobile }: Appearance & { text: string; mobile: boolean }) {
  const lines = useMemo(() => text.split("\n"), [text]);
  return raw ? <PreviewLines text={text} lines={lines} tokens={tokens} style={{ color: tokens.foreground,
    fontFamily: tokens.fontMono, fontSize: tokens.typography.mono.size, lineHeight: tokens.typography.mono.lineHeight }} /> :
    <MarkdownView text={text} tokens={tokens} variant="document" compact={mobile} size={blockProseBase(tokens.typography)} />;
}

const DISPATCH_LABEL = { sending: "Sending prompt", sent: "Prompt sent", failed: "Send failed",
  canceled: "Send canceled", unconfirmed: "Dispatch not confirmed" };
const DISPOSITION: Record<string, string> = { turn_started: "Turn started", out_of_band: "Delivered out of band", steered: "Steered" };

export function SendAgentPromptView({ data, tokens, raw = false, compact = false }: Appearance & { data: PaseoSendAgentPromptData }) {
  const mobile = useMobile(compact);
  const title = useAgent(data.agentId ?? "", (agent) => agent.title);
  const color = data.state === "failed" ? tokens.danger : data.state === "sent" ? tokens.success :
    data.state === "sending" ? tokens.accent : tokens.foregroundMuted;
  const source = raw ? JSON.stringify({ arguments: data.arguments, result: data.result }, null, 2) : data.prompt;
  return <AgentCardContent title={title ?? "Send agent prompt"} agentId={data.agentId} tokens={tokens} mobile={mobile}
    testID="send-agent-prompt" color={tokens.foregroundMuted} metadata={<>
      <MetadataItem testID="send-agent-prompt-state" accessibilityLabel={DISPATCH_LABEL[data.state]}
        icon={data.state === "failed" ? "CircleX" : "Send"} iconColor={color} label={DISPATCH_LABEL[data.state]} tokens={tokens} />
      {data.disposition ? <MetadataItem testID="send-agent-prompt-disposition" accessibilityLabel={data.disposition}
        icon="Route" iconColor={tokens.foregroundMuted} label={DISPOSITION[data.disposition] ?? data.disposition} tokens={tokens} /> : null}
      {data.agentStatus ? <MetadataItem testID="send-agent-prompt-agent-state" accessibilityLabel={`Agent: ${data.agentStatus}`}
        icon="Bot" iconColor={tokens.foregroundMuted} label={`Agent: ${data.agentStatus}`} tokens={tokens} /> : null}
      {data.sessionMode ? <MetadataItem testID="send-agent-prompt-mode" accessibilityLabel={`Mode: ${data.sessionMode}`}
        icon="Shield" iconColor={tokens.foregroundMuted} label={data.sessionMode} tokens={tokens} /> : null}
    </>}>
    <CardText text={source} tokens={tokens} raw={raw} mobile={mobile} />
    {!raw && data.guidance ? <Text testID="send-agent-prompt-guidance" selectable style={{ color: tokens.foregroundMuted,
      fontFamily: tokens.fontUi, fontSize: tokens.typography.block.meta.size,
      lineHeight: tokens.typography.block.label.lineHeight }}>{data.guidance}</Text> : null}
  </AgentCardContent>;
}

export function AgentOperationView({ data, tokens, raw = false, compact = false }: Appearance & { data: PaseoAgentOperationData }) {
  const mobile = useMobile(compact);
  const color = data.tone === "danger" ? tokens.danger : data.tone === "success" ? tokens.success :
    data.tone === "active" ? tokens.accent : data.tone === "warning" ? tokens.warning : tokens.foregroundMuted;
  return <AgentCardContent title={data.title} agentId={data.agentId} showAgentId={Boolean(data.agentId)}
    tokens={tokens} mobile={mobile} testID="agent-operation" color={tokens.foregroundMuted}
    metadata={<MetadataItem testID="agent-operation-state" accessibilityLabel={data.label}
      icon={data.tone === "danger" ? "CircleX" : "Bot"} iconColor={color} label={data.label} tokens={tokens} />}>
    {raw ? <CardText text={JSON.stringify({ arguments: data.arguments, result: data.result }, null, 2)} tokens={tokens} raw mobile={mobile} /> : <>
      {data.facts.map((fact) => <Text key={fact.label} selectable style={{ color: tokens.foreground,
        fontFamily: tokens.fontUi, fontSize: tokens.typography.block.meta.size }}>{fact.label}: {fact.value}</Text>)}
      {data.agents?.length === 0 ? <Text style={{ color: tokens.foregroundMuted }}>No agents returned</Text> : null}
      {data.agents?.map((agent) => <AgentCardContent key={agent.id} title={agent.title} agentId={agent.id}
        testID={`agent-list-${agent.id}`} tokens={tokens} mobile={mobile} color={tokens.foregroundMuted}
        metadata={<Text selectable style={{ color: tokens.foregroundMuted }}>{[agent.provider, agent.status].filter(Boolean).join(" · ")}</Text>}>
        {agent.cwd ? <Text selectable style={{ color: tokens.foregroundMuted }}>{agent.cwd}</Text> : null}
      </AgentCardContent>)}
      {data.permissions?.length === 0 ? <Text style={{ color: tokens.foregroundMuted }}>No pending permissions</Text> : null}
      {data.permissions?.map((request) => <AgentCardContent key={`${request.agentId}:${request.requestId}`}
        title={request.title} agentId={request.agentId} tokens={tokens} mobile={mobile} testID={`permission-${request.requestId}`}
        color={tokens.foregroundMuted} metadata={<Text selectable style={{ color: tokens.foregroundMuted }}>{request.status}</Text>}>
        <Text selectable style={{ color: tokens.foregroundMuted }}>Request: {request.requestId}</Text>
        {request.description ? <CardText text={request.description} tokens={tokens} mobile={mobile} /> : null}
      </AgentCardContent>)}
      {data.content ? <CardText text={data.content} tokens={tokens} mobile={mobile} /> : null}
    </>}
  </AgentCardContent>;
}

/** Provider-native Task/Agent calls have session IDs, not Paseo agent IDs. */
export function SubAgentView({ data, tokens, raw = false, compact = false }: Appearance & { data: ToolCallView }) {
  const mobile = useMobile(compact);
  const agent = data.subAgent!;
  return <AgentCardContent title={agent.description ?? agent.subAgentType ?? "Agent task"} showAgentId={false}
    tokens={tokens} mobile={mobile} testID="sub-agent" metadata={<MetadataItem testID="sub-agent-state"
      accessibilityLabel={data.status} icon="Bot" iconColor={data.status === "failed" ? tokens.danger : tokens.foregroundMuted}
      label={[agent.subAgentType, data.status].filter(Boolean).join(" · ")} tokens={tokens} />}>
    {raw ? <CardText text={JSON.stringify(agent, null, 2)} tokens={tokens} raw mobile={mobile} /> : <View style={{ gap: space.sm }}>
      {agent.prompt ? <CardText text={agent.prompt} tokens={tokens} mobile={mobile} /> : null}
      {agent.actions?.map((action) => <Text key={action.index} selectable style={{ color: tokens.foregroundMuted }}>
        {[action.toolName, action.summary].filter(Boolean).join(" · ")}</Text>)}
      {agent.log ? <CardText text={agent.log} tokens={tokens} mobile={mobile} /> : null}
    </View>}
  </AgentCardContent>;
}
