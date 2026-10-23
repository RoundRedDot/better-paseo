import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import {
  AgentCode, AgentDivider, AgentErrorLine, AgentIdentityStrip, AgentMarkdown, AgentNote, AgentSection,
  useCardMobile, useLiveAgent, type AgentField,
} from "./agent-card-content";
import { space, type ExtendedThemeTokens } from "./theme-tokens";
import { MarkdownView } from "./markdown/markdown-view";
import { blockProseBase } from "../ui/tokens/typography";
import { readPermission, type PermissionQuestion } from "../tools/agent-status";
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
    {data.permissions ? <PermissionList permissions={data.permissions} tokens={tokens} mobile={mobile} /> : null}
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

/** Each waiting request in full, read-only: Paseo takes the answer in the asking agent's chat. */
function PermissionList({ permissions, tokens, mobile }: {
  permissions: NonNullable<PaseoAgentOperationData["permissions"]>; tokens: ExtendedThemeTokens; mobile: boolean;
}) {
  if (permissions.length === 0) return <Text style={[styles.empty, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>No pending permissions</Text>;
  return <View>{permissions.map((entry, index) => {
    const request = readPermission(entry.request ?? { title: entry.title, description: entry.description }, entry.requestId);
    return <View key={`${entry.agentId}:${entry.requestId}`} style={[styles.pending,
      index > 0 && { borderTopWidth: 1, borderTopColor: tokens.border }]}>
      <PermissionRequest testID={`permission-${entry.requestId}`} title={request.title ?? entry.title} agentId={entry.agentId}
        description={request.description} command={request.command} plan={request.plan} question={Boolean(request.questions)}
        tokens={tokens} mobile={mobile} />
      {request.questions ? <PermissionQuestions questions={request.questions} tokens={tokens} mobile={mobile} /> : null}
      <PermissionAnswerNote tokens={tokens} />
      <PermissionRequestId requestId={entry.requestId} tokens={tokens} />
    </View>;
  })}</View>;
}

/**
 * Where a request is answered. The card only shows it: Paseo draws its own
 * form in the asking agent's chat, so there is one answer and one place for it.
 */
export function PermissionAnswerNote({ tokens }: { tokens: ExtendedThemeTokens }) {
  return <AgentNote testID="permission-answer-note" text="Answer it in the agent's own chat" tokens={tokens} />;
}

/** The request ID is for support and logs: one quiet line, its middle elided, copied whole. */
export function PermissionRequestId({ requestId, tokens }: { requestId: string; tokens: ExtendedThemeTokens }) {
  return <View testID="permission-request-id" style={styles.requestRow}>
    <Text style={[styles.requestLabel, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>Request</Text>
    <Text selectable numberOfLines={1} ellipsizeMode="middle"
      style={[styles.requestId, { color: tokens.foregroundMuted, fontFamily: tokens.fontMono }]}>{requestId}</Text>
  </View>;
}

/** One request: what it wants to do, for which agent; the request ID trails the card. */
export function PermissionRequest({ testID, title, agentId, description, command, plan, question, tokens, mobile = false }: {
  testID?: string; title?: string; agentId?: string; requestId?: string; description?: string; command?: string; plan?: string;
  question?: boolean; tokens: ExtendedThemeTokens; mobile?: boolean;
}) {
  const live = useLiveAgent(agentId);
  return <View testID={testID} style={styles.request}>
    <View style={styles.permissionHead}>
      <Icon name={question ? "MessageCircleQuestion" : "ShieldAlert"} size={14} color={tokens.warning} />
      {title ? <Text selectable style={[styles.permissionTitle, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>{title}</Text> : null}
      {agentId ? <Text selectable numberOfLines={1} style={[styles.permissionAgent, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
        {live.title ?? shortAgentId(agentId)}</Text> : null}
    </View>
    {description ? <AgentMarkdown text={description} tokens={tokens} mobile={mobile} /> : null}
    {command ? <AgentCode text={command} tokens={tokens} /> : null}
    {plan ? <AgentMarkdown text={plan} tokens={tokens} mobile={mobile} /> : null}
  </View>;
}

/**
 * A question request as Paseo's question form lays it out: each question,
 * then its options as radio or check rows. Read-only: the answer belongs to
 * the form in the asking agent's chat.
 */
export function PermissionQuestions({ questions, tokens, mobile }: {
  questions: PermissionQuestion[]; tokens: ExtendedThemeTokens; mobile: boolean;
}) {
  const prose = { color: tokens.foreground, fontFamily: tokens.fontUi };
  const muted = { color: tokens.foregroundMuted, fontFamily: tokens.fontUi };
  return <View testID="permission-questions" style={styles.questions}>
    {questions.map((question, index) => {
      const mode = question.options.length === 0 ? "Free text" : question.multiSelect ? "Select multiple" : "Select one";
      return <View key={index} testID={`permission-question-${index}`} style={[styles.question,
        index > 0 && { borderTopWidth: 1, borderTopColor: tokens.border, paddingTop: space.md }]}>
        <View style={styles.questionMeta}>
          {questions.length > 1 ? <Text style={[styles.questionHeader, prose]}>{`${index + 1}/${questions.length}`}</Text> : null}
          {question.header && !/^Question \d+$/.test(question.header) ? <Text style={[styles.questionHeader, prose]}>{question.header}</Text> : null}
          <Text style={[styles.questionMode, muted]}>{mode}</Text>
        </View>
        <MarkdownView text={question.question} tokens={tokens} variant="document" compact={mobile} size={blockProseBase(tokens.typography)} />
        {question.options.length ? <View style={styles.options}>
          {question.options.map((option, optionIndex) => <View key={optionIndex} testID={`permission-option-${index}-${optionIndex}`}
            style={[styles.option, mobile && styles.optionMobile, { borderColor: tokens.border }]}>
            <View style={styles.optionMark}>
              <Icon name={question.multiSelect ? "Square" : "Circle"} size={16} color={tokens.foregroundMuted} />
            </View>
            <View style={styles.optionText}>
              <Text selectable style={[styles.optionLabel, prose]}>{option.label}</Text>
              {option.description ? <Text selectable style={[styles.optionDescription, muted]}>{option.description}</Text> : null}
            </View>
          </View>)}
        </View> : null}
      </View>;
    })}
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
  request: { gap: 6, minWidth: 0 },
  pending: { gap: space.sm, paddingVertical: space.sm, minWidth: 0 },
  permissionHead: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  permissionTitle: { fontSize: 13, lineHeight: 18, fontWeight: "600", flexShrink: 1 },
  permissionAgent: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 },
  requestRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  requestLabel: { fontSize: 11, lineHeight: 16, flexShrink: 0 },
  requestId: { flex: 1, minWidth: 0, fontSize: 11, lineHeight: 16 },
  questions: { gap: space.md, minWidth: 0 },
  question: { gap: space.sm, minWidth: 0 },
  questionMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.sm, rowGap: 2 },
  questionHeader: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  questionMode: { fontSize: 12, lineHeight: 16 },
  options: { gap: 6 },
  option: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, paddingVertical: 7, paddingHorizontal: 10,
    borderWidth: 1, borderRadius: 8, minWidth: 0 },
  optionMobile: { paddingVertical: 11, paddingHorizontal: 12, minHeight: 44 },
  optionMark: { height: 20, justifyContent: "center" },
  optionText: { flex: 1, minWidth: 0, gap: 2 },
  optionLabel: { fontSize: 13, lineHeight: 20 },
  optionDescription: { fontSize: 12, lineHeight: 17 },
  type: { flexDirection: "row", alignItems: "center", gap: 5 },
  typeText: { fontSize: 12, lineHeight: 20, fontWeight: "500" },
  action: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 22, minWidth: 0 },
  actionTool: { fontSize: 12, lineHeight: 18, fontWeight: "500" },
  actionSummary: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 },
});
