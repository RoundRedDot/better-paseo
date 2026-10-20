import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Glyph } from "./glyph";
import { usePaseo } from "@getpaseo/plugin/client";
import { surfaceProps } from "./view-props";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { ToolbarItem } from "../ui/toolbar-button";
import { FooterDetails, useFooterDetailsWidth } from "./footer-details";
import { useCopy } from "../ui/use-copy";
import {
  AgentDivider, AgentErrorLine, AgentIdentityStrip, AgentMarkdown, AgentSection, useCardMobile, useLiveAgent, type AgentField,
} from "./agent-card-content";
import { SendAgentPromptView, AgentOperationView, PermissionActions, PermissionQuestionForm, PermissionRequest, PermissionRequestId } from "./agent-operation-views";
import { readPermissionRequest, type AgentStatusData } from "../tools/agent-status";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { ProviderLogo } from "./provider-logo";
import { useFooterModel, useProviderMode } from "../state/footer-model";
import { selectableSurface } from "./selection";
import { selectionSurface } from "./selection-actions";
import type {
  PaseoCreateAgentData,
  PaseoGetActivityData,
  PaseoListProvidersData,
  PaseoListModelsData,
  PaseoToolData,
} from "../../shared/contracts";

interface PaseoToolCalloutProps {
  data: PaseoToolData;
  tokens: ExtendedThemeTokens;
  raw?: boolean;
  compact?: boolean;
  /** The host's error for a failed call, drawn as the card's first line. */
  error?: string;
}

/**
 * The body of a Paseo agent tool call. It draws no frame, header or
 * disclosure of its own (plan §3.3 item 5): it sits inside the tool card,
 * whose header already names the call and whose open state decides whether
 * this is mounted at all.
 */
export function PaseoToolCallout({ data, tokens, raw = false, compact = false, error }: PaseoToolCalloutProps) {
  return (
    <View {...surfaceProps(selectionSurface)} style={styles.body}>
      {data.tool === "create_agent" && data.createAgent && (
        <CreateAgentView data={data.createAgent} tokens={tokens} raw={raw} compact={compact} error={error} />
      )}
      {data.sendAgentPrompt ? <SendAgentPromptView data={data.sendAgentPrompt} tokens={tokens} raw={raw} compact={compact} error={error} /> : null}
      {data.agentOperation ? <AgentOperationView data={data.agentOperation} tokens={tokens} raw={raw} compact={compact} error={error} /> : null}
      {data.tool === "list_providers" && data.providers && (
        <ListProvidersView data={data.providers} tokens={tokens} />
      )}
      {data.tool === "list_models" && data.models && (
        <ListModelsView data={data.models} tokens={tokens} />
      )}
      {data.tool === "get_agent_activity" && data.activity && (
        <GetActivityView data={data.activity} tokens={tokens} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10, ...selectableSurface },
});

function CreateAgentView({ data, tokens, raw, compact, error }: {
  data: PaseoCreateAgentData;
  tokens: ExtendedThemeTokens;
  raw: boolean;
  compact: boolean;
  error?: string;
}) {
  const mobile = useCardMobile(compact);
  const paseo = usePaseo();
  const live = useLiveAgent(data.agentId);
  const cwd = live.cwd ?? null;
  const { modelName, thinkingLabel } = useFooterModel(paseo, data.provider, data.model ?? null,
    data.thinkingOptionId ?? null, cwd, { requireCwd: false });
  const mode = useProviderMode(paseo, data.provider, data.modeId ?? null, cwd);
  const thinking = thinkingLabel ?? data.thinkingOptionId;
  const fields: AgentField[] = [];
  if (data.model) fields.push({ key: "model", icon: "Cpu", label: modelName ?? data.model });
  if (thinking) fields.push({ key: "thinking", icon: "Brain", label: thinking, iconColor: tokens.accent,
    accessibilityLabel: `Thinking: ${thinking}` });
  const modeLabel = mode?.label ?? data.modeId ?? "未指定";
  fields.push({ key: "permissions", icon: mode?.icon ?? "Shield", label: modeLabel,
    iconColor: modeColor(mode?.colorTier, tokens), accessibilityLabel: `Permissions: ${modeLabel}` });
  // A settled creation that returned no ID says so, rather than leaving a gap where the ID goes.
  if (data.status === "created" && !data.agentId) fields.push({ key: "missing-id", icon: "CircleHelp", label: "ID unavailable" });
  const state = data.status === "failed" || data.status === "canceled" ? undefined :
    live.status ?? (data.status === "running" ? "running" : undefined);
  return (
    <View testID="create-agent" style={{ gap: space.sm, minWidth: 0 }}>
      <AgentIdentityStrip testID="create-agent" tokens={tokens} mobile={mobile} fields={fields.slice(data.model ? 1 : 0)}
        state={state} agentId={data.agentId}
        leading={data.model ? <ModelName provider={data.provider} model={data.model} modelName={modelName}
          thinkingLabel={thinking} tokens={tokens} mobile={mobile} /> : undefined}
        provider={data.model ? undefined : data.provider} />
      <AgentDivider tokens={tokens} />
      {data.status === "failed" && error ? <AgentErrorLine text={error.split("\n")[0]!} tokens={tokens} /> : null}
      <AgentSection label={raw ? undefined : "Prompt"} tokens={tokens}>
        <AgentMarkdown text={data.initialPrompt} tokens={tokens} raw={raw} mobile={mobile} /></AgentSection>
    </View>
  );
}

/** The sender and event come from host provenance; the response never decides status. */
export function agentStatusColor(data: AgentStatusData, tokens: ExtendedThemeTokens): string {
  return data.status === "errored" ? tokens.danger : data.status === "needs permission" ? tokens.warning :
    data.status === "finished" ? tokens.success : tokens.foregroundMuted;
}

/** A child agent's notification: who sent it, then its reply, error or permission request. */
export function AgentStatusView({ data, tokens, raw = false, compact = false }: {
  data: AgentStatusData; tokens: ExtendedThemeTokens; raw?: boolean; compact?: boolean;
}) {
  const mobile = useCardMobile(compact);
  const live = useLiveAgent(data.agentId);
  const permission = !raw && data.status === "needs permission" ? readPermissionRequest(data.body) : undefined;
  const reply = permission ? permission.rest : data.body;
  const fields: AgentField[] = live.model ? [{ key: "model", icon: "Cpu", label: live.model }] : [];
  const state = data.status === "needs permission" ? "waiting" : data.status === "errored" ? "error" : live.status;
  const errorLine = !raw && data.status === "errored" ? reply.split("\n").map((line) => line.trim()).find(Boolean) : undefined;
  const rest = errorLine ? reply.slice(reply.indexOf(errorLine) + errorLine.length).trim() : reply;
  return <View testID="agent-status" style={{ gap: space.sm, minWidth: 0 }}>
    <AgentIdentityStrip testID="agent-status" provider={live.provider} fields={fields} state={state}
      agentId={data.agentId} tokens={tokens} mobile={mobile} />
    {errorLine || rest || permission ? <AgentDivider tokens={tokens} /> : null}
    {errorLine ? <AgentErrorLine text={errorLine} tokens={tokens} /> : null}
    {permission?.questions ? <PermissionQuestionForm agentId={data.agentId} requestId={permission.requestId}
      questions={permission.questions} input={permission.input} tokens={tokens} mobile={mobile} /> : null}
    {permission && !permission.questions ? <PermissionRequest testID="agent-status-permission" title={permission.title}
      description={permission.description} command={permission.command} plan={permission.plan} tokens={tokens} mobile={mobile} /> : null}
    {permission?.requestId && !permission.questions ? <PermissionActions agentId={data.agentId} requestId={permission.requestId}
      actions={permission.actions} tokens={tokens} mobile={mobile} /> : null}
    {permission?.requestId ? <PermissionRequestId requestId={permission.requestId} tokens={tokens} /> : null}
    {rest ? <AgentSection label={data.status === "finished" && !raw ? "Reply" : undefined} tokens={tokens}>
      <AgentMarkdown testID="agent-status-body" text={rest} tokens={tokens} raw={raw} mobile={mobile} /></AgentSection> : null}
  </View>;
}

/** The composer's colour for each permission tier; text stays muted like the composer. */
function modeColor(tier: string | undefined, tokens: ExtendedThemeTokens): string {
  switch (tier) {
    case "safe": return tokens.success;
    case "dangerous": return tokens.danger;
    case "planning":
    case "moderate": return tokens.accent;
    default: return tokens.foregroundMuted;
  }
}

/** Copies the model ID exactly as requested, without provider or metadata. */
function ModelName({ provider, model, modelName, thinkingLabel, tokens, mobile }: {
  provider: string;
  model: string;
  modelName: string | null;
  thinkingLabel?: string;
  tokens: ExtendedThemeTokens;
  mobile: boolean;
}) {
  const { copied, copy } = useCopy();
  const capabilities = useInputCapabilities();
  const detailsWidth = useFooterDetailsWidth();
  return (
    <View testID="create-agent-model" style={{ minWidth: 0, maxWidth: "100%", flexShrink: 1 }}>
      <ToolbarItem label={copied ? "Copied" : "Copy model name"} accessibilityLabel="Copy model name"
        tokens={tokens} align="start" onPress={() => { void copy(model, { label: "Copy model name" }); }}
        details={<FooterDetails modelId={model} modelName={modelName ?? model} thinkingLabel={thinkingLabel ?? "未指定"} tokens={tokens} />}
        detailsWidth={detailsWidth} hitSlop={mobile ? 10 : 4}
        buttonStyle={{ width: "auto", height: "auto", minHeight: mobile ? 20 : capabilities.touch ? 44 : 20,
          flexDirection: "row", gap: 5, minWidth: 0, maxWidth: "100%" }}>
        <ProviderLogo provider={provider} size={12} neutralColor={tokens.foregroundMuted} />
        <Text testID="create-agent-model-label" style={{ fontSize: 12, lineHeight: 20, fontFamily: tokens.fontUi,
          fontWeight: "500", color: tokens.foreground, flexShrink: 1, minWidth: 0 }}>{modelName ?? model}</Text>
      </ToolbarItem>
    </View>
  );
}


function ListProvidersView({
  data,
  tokens,
}: {
  data: PaseoListProvidersData;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <Text
        selectable
        style={{
          fontSize: tokens.typography.block.meta.size,
          color: tokens.foregroundMuted,
        }}
      >
        Configured agent backends discovered on local daemon:
      </Text>

      <View style={{ gap: 6 }}>
        {data.providers.map((p) => {
          const isAvail = p.status === "available";
          return (
            <View
              key={p.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 10,
                paddingVertical: 7,
                borderRadius: radiusV2.block,
                backgroundColor: tokens.v2.surface2,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ProviderLogo provider={p.id} size={15} />
                <View>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Text
                      selectable
                      style={{
                        fontSize: tokens.typography.block.meta.size,
                        fontWeight: "700",
                        color: tokens.foreground,
                      }}
                    >
                      {p.label}
                    </Text>
                    <Text
                      selectable
                      style={{
                        fontSize: tokens.typography.block.meta.size,
                        fontFamily: tokens.fontUi,
                        color: tokens.foregroundMuted,
                      }}
                    >
                      {p.id}
                    </Text>
                  </View>
                  <Text
                    selectable
                    style={{
                      fontSize: tokens.typography.block.meta.size,
                      color: tokens.foregroundMuted,
                      marginTop: 1,
                    }}
                    numberOfLines={1}
                  >
                    {p.description}
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: radiusV2.pill,
                    backgroundColor: isAvail ? tokens.success : tokens.foregroundSubtle,
                  }}
                />
                <Text
                  selectable
                  style={{
                    fontSize: tokens.typography.block.meta.size,
                    fontWeight: "600",
                    color: isAvail ? tokens.success : tokens.foregroundMuted,
                  }}
                >
                  {p.status}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ListModelsView({
  data,
  tokens,
}: {
  data: PaseoListModelsData;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <ProviderLogo provider={data.provider} size={16} showLabel />
        <Text selectable style={{ fontSize: tokens.typography.block.meta.size, color: tokens.foregroundMuted }}>
          Supported models & reasoning modes:
        </Text>
      </View>

      <View style={{ gap: 6 }}>
        {data.models.map((m) => (
          <View
            key={m.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: radiusV2.block,
              backgroundColor: tokens.v2.surface2,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text
                selectable
                style={{
                  fontSize: tokens.typography.block.meta.size,
                  fontFamily: tokens.fontUi,
                  fontWeight: "700",
                  color: tokens.foreground,
                }}
              >
                {m.id}
              </Text>
              <Text
                selectable
                style={{
                  fontSize: tokens.typography.block.meta.size,
                  color: tokens.foregroundMuted,
                }}
              >
                {m.label}
              </Text>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {m.thinkingSupport && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 3,
                    paddingHorizontal: 5,
                    paddingVertical: 1,
                    borderRadius: radiusV2.chip,
                  }}
                >
                  <Glyph name="Brain" size={10} color={tokens.accent} />
                  <Text
                    selectable
                    style={{
                      fontSize: tokens.typography.block.meta.size,
                      color: tokens.accent,
                      fontWeight: "600",
                    }}
                  >
                    Reasoning
                  </Text>
                </View>
              )}
              <Text
                selectable
                style={{
                  fontSize: tokens.typography.block.meta.size,
                  fontFamily: tokens.fontUi,
                  color: tokens.foregroundMuted,
                }}
              >
                {m.contextTokens}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function GetActivityView({
  data,
  tokens,
}: {
  data: PaseoGetActivityData;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <View style={{ gap: 6 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 6,
          borderBottomWidth: 1,
          borderBottomColor: tokens.borderSubtle,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <ProviderLogo provider={data.provider} size={14} />
          <Text
            selectable
            style={{
              fontSize: tokens.typography.block.meta.size,
              fontFamily: tokens.fontUi,
              color: tokens.foregroundMuted,
            }}
          >
            Target: {data.agentId}
          </Text>
        </View>
        <Text selectable style={{ fontSize: tokens.typography.block.meta.size, color: tokens.foregroundMuted }}>
          {data.activities.length} recent activities
        </Text>
      </View>

      {data.activities.map((act, idx) => (
        <View
          key={idx}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: space.xs,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Glyph
              name={
                act.kind === "tool" ? "Wrench" : act.kind === "thinking" ? "Brain" : "MessageSquare"
              }
              size={11}
              color={act.kind === "thinking" ? tokens.accent : tokens.accent}
            />
            <Text
              selectable
              style={{
                fontSize: tokens.typography.block.meta.size,
                color: tokens.foreground,
              }}
            >
              {act.title}
            </Text>
          </View>
          {act.elapsed && (
            <Text
              selectable
              style={{
                fontSize: tokens.typography.block.meta.size,
                fontFamily: tokens.fontUi,
                color: tokens.foregroundMuted,
              }}
            >
              {act.elapsed}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
