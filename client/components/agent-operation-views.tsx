import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePaseo } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import {
  AgentCode, AgentDivider, AgentErrorLine, AgentIdentityStrip, AgentMarkdown, AgentNote, AgentSection,
  useCardMobile, useLiveAgent, type AgentField,
} from "./agent-card-content";
import { space, withAlpha, type ExtendedThemeTokens } from "./theme-tokens";
import { MarkdownView } from "./markdown/markdown-view";
import { blockProseBase } from "../ui/tokens/typography";
import { buildPermissionAnswers, isQuestionAnswered, type PermissionAction, type PermissionQuestion } from "../tools/agent-status";
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
  return <View style={{ gap: space.md }}>{permissions.map((request) => <View key={`${request.agentId}:${request.requestId}`} style={{ gap: 6 }}>
    <PermissionRequest testID={`permission-${request.requestId}`} title={request.title} agentId={request.agentId}
      description={request.description} tokens={tokens} />
    <PermissionRequestId requestId={request.requestId} tokens={tokens} />
  </View>)}</View>;
}

type Decision = "allow" | "deny";
type Answered = { decision: Decision; label: string };

/** The host's answer for one agent's request, with the toast a failure raises. */
function useRespond(agentId: string, requestId: string) {
  const paseo = usePaseo();
  const toast = useToast();
  return useCallback((response: AgentPermissionResponse) =>
    paseo.agents.ref(agentId).respondToPermission({ requestId, response }).then(() => true, (error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
      return false;
    }), [paseo, agentId, requestId, toast]);
}
type AgentPermissionResponse = { behavior: "allow"; selectedActionId?: string; updatedInput?: Record<string, unknown> } |
  { behavior: "deny"; selectedActionId?: string; message?: string };

/** The host knows the agent and it has moved on: answered elsewhere, or closed. */
function stillWaiting(status: string | undefined): boolean {
  return status === undefined || status === "waiting";
}

/** "Permission allowed - by you" where the buttons were. */
function AnsweredLine({ answered, tokens }: { answered: Answered; tokens: ExtendedThemeTokens }) {
  return <View testID="permission-answered" style={styles.answered}>
    <Icon name={answered.decision === "allow" ? "ShieldCheck" : "ShieldX"} size={14}
      color={answered.decision === "allow" ? tokens.success : tokens.foregroundMuted} />
    <Text style={[styles.answeredText, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
      {`${answered.label} - by you`}</Text>
  </View>;
}

function ActionButton({ testID, label, icon, tone, busy, disabled, onPress, tokens, mobile }: {
  testID: string; label: string; icon?: string; tone: "primary" | "secondary" | "danger"; busy?: boolean; disabled?: boolean;
  onPress(): void; tokens: ExtendedThemeTokens; mobile: boolean;
}) {
  const fg = tone === "primary" ? tokens.v2.surface0 : tone === "danger" ? tokens.danger : tokens.foreground;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={busy || disabled}
    accessibilityState={{ disabled: busy || disabled, busy }} onPress={onPress}
    style={[styles.button, mobile && styles.buttonMobile, {
      backgroundColor: tone === "primary" ? tokens.foreground : tokens.v2.surface0,
      borderColor: tone === "primary" ? tokens.foreground : tone === "danger" ? withAlpha(tokens.danger, 0.4) : tokens.border,
      opacity: busy || disabled ? 0.5 : 1 }]}>
    {icon ? <Icon name={icon} size={mobile ? 14 : 12} color={fg} /> : null}
    <Text numberOfLines={1} style={[styles.buttonText, mobile && styles.buttonTextMobile, { color: fg, fontFamily: tokens.fontUi }]}>{label}</Text>
  </Pressable>;
}

const DEFAULT_ACTIONS: PermissionAction[] = [
  { id: "accept", label: "Allow", behavior: "allow", variant: "primary" },
  { id: "reject", label: "Deny", behavior: "deny", variant: "secondary" },
];

/**
 * Allow and Deny, or the provider's own buttons, through the same host call
 * Paseo's own permission UI makes. Once answered the buttons give way to the
 * decision; a request the agent no longer waits on shows none.
 */
export function PermissionActions({ agentId, requestId, actions, tokens, mobile }: {
  agentId: string; requestId: string; actions?: PermissionAction[]; tokens: ExtendedThemeTokens; mobile: boolean;
}) {
  const live = useLiveAgent(agentId);
  const respond = useRespond(agentId, requestId);
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState<Answered>();
  const custom = Boolean(actions?.length);
  // Allow first: the primary decision leads, a deny follows.
  const ordered = [...(actions ?? DEFAULT_ACTIONS)].sort((a, b) => (a.behavior === "allow" ? 0 : 1) - (b.behavior === "allow" ? 0 : 1));
  const answer = useCallback((action: PermissionAction) => {
    setBusy(true);
    // The payload Paseo's own permission UI sends.
    const select = custom ? { selectedActionId: action.id } : {};
    const response: AgentPermissionResponse = action.behavior === "allow" ? { behavior: "allow", ...select } :
      { behavior: "deny", ...select, message: "Denied by user" };
    void respond(response).then((ok) => {
      setBusy(false);
      if (ok) setAnswered({ decision: action.behavior, label: custom ? action.label :
        action.behavior === "allow" ? "Permission allowed" : "Permission denied" });
    });
  }, [respond, custom]);
  if (answered) return <AnsweredLine answered={answered} tokens={tokens} />;
  if (!stillWaiting(live.status)) return null;
  return <View testID="permission-actions" style={[styles.buttons, mobile && styles.buttonsMobile]}>
    {ordered.map((action) => <ActionButton key={action.id} testID={custom ? `permission-action-${action.id}` :
      action.behavior === "allow" ? "permission-allow" : "permission-deny"} label={action.label}
      icon={custom ? undefined : action.behavior === "allow" ? "Check" : "X"}
      tone={action.variant === "danger" ? "danger" : action.variant === "primary" || action.behavior === "allow" && !custom ? "primary" : "secondary"}
      busy={busy} onPress={() => answer(action)} tokens={tokens} mobile={mobile} />)}
  </View>;
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
 * A question request drawn as Paseo's question form: each question, its
 * options as radio or check rows, a free-text answer when the question takes
 * one, then Submit and Dismiss. Once the agent stops waiting the options stay
 * on view, read-only.
 */
export function PermissionQuestionForm({ agentId, requestId, questions, input, tokens, mobile }: {
  agentId: string; requestId?: string; questions: PermissionQuestion[]; input?: Record<string, unknown>;
  tokens: ExtendedThemeTokens; mobile: boolean;
}) {
  const live = useLiveAgent(agentId);
  const respond = useRespond(agentId, requestId ?? "");
  const [selections, setSelections] = useState<Record<number, number[]>>({});
  const [others, setOthers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<"submit" | "dismiss">();
  const [answered, setAnswered] = useState<Answered>();
  const open = Boolean(requestId) && !answered && stillWaiting(live.status);
  const complete = questions.every((question, index) => isQuestionAnswered(question, selections[index], others[index]));
  const toggle = (index: number, option: number) => {
    const question = questions[index]!;
    setSelections((prev) => {
      const current = prev[index] ?? [];
      const next = question.multiSelect ? current.includes(option) ? current.filter((value) => value !== option) : [...current, option].sort() :
        current.includes(option) ? [] : [option];
      return { ...prev, [index]: next };
    });
    // One pick replaces typed text, as in Paseo's form; several picks keep it.
    if (!question.multiSelect) setOthers((prev) => ({ ...prev, [index]: "" }));
  };
  const type = (index: number, value: string) => {
    setOthers((prev) => ({ ...prev, [index]: value }));
    if (!questions[index]!.multiSelect && value) setSelections((prev) => ({ ...prev, [index]: [] }));
  };
  const submit = () => {
    if (!complete || busy) return;
    setBusy("submit");
    void respond({ behavior: "allow", updatedInput: { ...input, answers: buildPermissionAnswers(questions, selections, others) } })
      .then((ok) => { setBusy(undefined); if (ok) setAnswered({ decision: "allow", label: "Answered" }); });
  };
  const dismiss = () => {
    if (busy) return;
    setBusy("dismiss");
    void respond({ behavior: "deny", message: "Dismissed by user" })
      .then((ok) => { setBusy(undefined); if (ok) setAnswered({ decision: "deny", label: "Dismissed" }); });
  };
  const prose = { color: tokens.foreground, fontFamily: tokens.fontUi };
  const muted = { color: tokens.foregroundMuted, fontFamily: tokens.fontUi };
  return <View testID="permission-questions" style={styles.questions}>
    {questions.map((question, index) => {
      const selected = selections[index] ?? [];
      const typed = question.options.length === 0 || question.allowOther;
      const mode = question.options.length === 0 ? "Free text" : question.multiSelect ? "Select multiple" : "Select one";
      return <View key={index} testID={`permission-question-${index}`} style={[styles.question,
        index > 0 && { borderTopWidth: 1, borderTopColor: tokens.border, paddingTop: space.md }]}>
        <View style={styles.questionMeta}>
          {questions.length > 1 ? <Text style={[styles.questionHeader, prose]}>{`${index + 1}/${questions.length}`}</Text> : null}
          {question.header && !/^Question \d+$/.test(question.header) ? <Text style={[styles.questionHeader, prose]}>{question.header}</Text> : null}
          <Text style={[styles.questionMode, muted]}>{mode}</Text>
        </View>
        <MarkdownView text={question.question} tokens={tokens} variant="document" compact={mobile} size={blockProseBase(tokens.typography)} />
        {question.options.length ? <View accessibilityRole={question.multiSelect ? undefined : "radiogroup"} style={styles.options}>
          {question.options.map((option, optionIndex) => {
            const checked = selected.includes(optionIndex);
            return <Pressable key={optionIndex} testID={`permission-option-${index}-${optionIndex}`} disabled={!open || Boolean(busy)}
              accessibilityRole={question.multiSelect ? "checkbox" : "radio"} accessibilityLabel={option.label}
              accessibilityState={{ checked, disabled: !open }} onPress={() => toggle(index, optionIndex)}
              style={[styles.option, mobile && styles.optionMobile, {
                borderColor: checked ? tokens.accent : tokens.border,
                backgroundColor: checked ? withAlpha(tokens.accent, 0.08) : "transparent" }]}>
              <View style={styles.optionMark}>
                <Icon name={question.multiSelect ? checked ? "SquareCheck" : "Square" : checked ? "CircleDot" : "Circle"}
                  size={16} color={checked ? tokens.accent : tokens.foregroundMuted} />
              </View>
              <View style={styles.optionText}>
                <Text selectable={!open} style={[styles.optionLabel, prose, checked && { fontWeight: "600" }]}>{option.label}</Text>
                {option.description ? <Text selectable={!open} style={[styles.optionDescription, muted]}>{option.description}</Text> : null}
              </View>
            </Pressable>;
          })}
        </View> : null}
        {typed && open ? <TextInput testID={`permission-other-${index}`} accessibilityLabel={`${question.header} answer`}
          value={others[index] ?? ""} onChangeText={(value: string) => type(index, value)} editable={!busy}
          placeholder={question.placeholder ?? (question.options.length ? "Other answer\u2026" : "Type your answer\u2026")}
          placeholderTextColor={tokens.foregroundSubtle} multiline={question.options.length === 0}
          onSubmitEditing={questions.length === 1 ? submit : undefined}
          style={[styles.input, mobile && styles.inputMobile, { color: tokens.foreground, fontFamily: tokens.fontUi,
            borderColor: others[index] ? tokens.accent : tokens.border, backgroundColor: tokens.v2.surface0 }]} /> : null}
      </View>;
    })}
    {answered ? <AnsweredLine answered={answered} tokens={tokens} /> : open ? <View testID="permission-actions"
      style={[styles.buttons, mobile && styles.buttonsMobile]}>
      <ActionButton testID="permission-submit" label="Submit" icon="Check" tone="primary" busy={busy === "submit"}
        disabled={!complete || busy === "dismiss"} onPress={submit} tokens={tokens} mobile={mobile} />
      <ActionButton testID="permission-dismiss" label="Dismiss" icon="X" tone="secondary" busy={busy === "dismiss"}
        disabled={busy === "submit"} onPress={dismiss} tokens={tokens} mobile={mobile} />
    </View> : null}
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
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, lineHeight: 18, minHeight: 32 },
  inputMobile: { fontSize: 15, lineHeight: 20, paddingVertical: 10, minHeight: 44 },
  type: { flexDirection: "row", alignItems: "center", gap: 5 },
  typeText: { fontSize: 12, lineHeight: 20, fontWeight: "500" },
  action: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 22, minWidth: 0 },
  actionTool: { fontSize: 12, lineHeight: 18, fontWeight: "500" },
  actionSummary: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 },
  buttons: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  buttonsMobile: { flexWrap: "nowrap" },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, height: 28,
    paddingHorizontal: 12, borderRadius: 6, borderWidth: 1 },
  buttonMobile: { flex: 1, height: 40, borderRadius: 8 },
  buttonText: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
  buttonTextMobile: { fontSize: 14, lineHeight: 18 },
  answered: { flexDirection: "row", alignItems: "center", gap: 6 },
  answeredText: { fontSize: 12, lineHeight: 18 },
});
