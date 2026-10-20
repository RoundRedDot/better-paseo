import React, { useMemo } from "react";
import { View, Text, StyleSheet, useWindowDimensions } from "react-native";
import { Glyph } from "./glyph";
import { useAgent, usePaseo } from "@getpaseo/plugin/client";
import { surfaceProps } from "./view-props";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { MarkdownView } from "./markdown/markdown-view";
import { PreviewLines } from "../ui/preview-lines";
import { ToolbarItem } from "../ui/toolbar-button";
import { FooterDetails, useFooterDetailsWidth } from "./footer-details";
import { useCopy } from "../ui/use-copy";
import { AgentCardContent, AgentCardMetadataItem as MetadataItem } from "./agent-card-content";
import { SendAgentPromptView, AgentOperationView } from "./agent-operation-views";
import { AGENT_STATUS_LABEL, AGENT_STATUS_ICON, type AgentStatusData } from "../tools/agent-status";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { blockProseBase } from "../ui/tokens/typography";
import { ProviderLogo } from "./provider-logo";
import { useFooterModel, useProviderMode } from "../state/footer-model";
import { selectableSurface } from "./selection";
import { selectionSurface } from "./selection-actions";
import type {
  PaseoToolKind,
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
}

/**
 * The body of a Paseo agent tool call. It draws no frame, header or
 * disclosure of its own (plan §3.3 item 5): it sits inside the tool card,
 * whose header already names the call and whose open state decides whether
 * this is mounted at all.
 */
export function PaseoToolCallout({ data, tokens, raw = false, compact = false }: PaseoToolCalloutProps) {
  return (
    <View {...surfaceProps(selectionSurface)} style={styles.body}>
      {data.tool === "create_agent" && data.createAgent && (
        <CreateAgentView data={data.createAgent} tokens={tokens} raw={raw} compact={compact} />
      )}
      {data.sendAgentPrompt ? <SendAgentPromptView data={data.sendAgentPrompt} tokens={tokens} raw={raw} compact={compact} /> : null}
      {data.agentOperation ? <AgentOperationView data={data.agentOperation} tokens={tokens} raw={raw} compact={compact} /> : null}
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

function CreateAgentView({ data, tokens, raw, compact }: {
  data: PaseoCreateAgentData;
  tokens: ExtendedThemeTokens;
  raw: boolean;
  compact: boolean;
}) {
  const capabilities = useInputCapabilities(compact);
  const { width } = useWindowDimensions();
  const mobile = capabilities.native || width < 600;
  const lines = useMemo(() => data.initialPrompt.split("\n"), [data.initialPrompt]);
  const paseo = usePaseo();
  const cwd = useAgent(data.agentId ?? "", (agent) => agent.cwd) ?? null;
  const { modelName, thinkingLabel } = useFooterModel(paseo, data.provider, data.model ?? null,
    data.thinkingOptionId ?? null, cwd, { requireCwd: false });
  const mode = useProviderMode(paseo, data.provider, data.modeId ?? null, cwd);
  const thinking = thinkingLabel ?? data.thinkingOptionId;
  return (
    <AgentCardContent title={data.title} agentId={data.agentId} state={data.status} tokens={tokens} mobile={mobile}
      metadata={<>
          {data.model ? <ModelName provider={data.provider} model={data.model} modelName={modelName}
            thinkingLabel={thinking} tokens={tokens} mobile={mobile} /> :
            <ProviderLogo provider={data.provider} size={16} showLabel labelColor={tokens.foregroundMuted}
              neutralColor={tokens.foregroundMuted} />}
          {thinking ? <MetadataItem testID="create-agent-thinking" accessibilityLabel={`Thinking: ${thinking}`}
            icon="Brain" iconColor={tokens.accent} label={thinking} tokens={tokens} /> : null}
          <MetadataItem testID="create-agent-permissions" accessibilityLabel={`Permissions: ${mode?.label ?? data.modeId ?? "未指定"}`}
            icon={mode?.icon ?? "Shield"} iconColor={modeColor(mode?.colorTier, tokens)}
            label={mode?.label ?? data.modeId ?? "未指定"} tokens={tokens} />
      </>}>
      {raw ? <PreviewLines text={data.initialPrompt} lines={lines} tokens={tokens}
        style={{ color: tokens.foreground, fontFamily: tokens.fontMono,
          fontSize: tokens.typography.mono.size, lineHeight: tokens.typography.mono.lineHeight }} /> :
        <MarkdownView text={data.initialPrompt} tokens={tokens} variant="document" compact={mobile}
          size={blockProseBase(tokens.typography)} />}
    </AgentCardContent>
  );
}

/** The sender and event come from host provenance; the response never decides status. */
export function agentStatusColor(data: AgentStatusData, tokens: ExtendedThemeTokens): string {
  return data.status === "errored" ? tokens.danger : data.status === "needs permission" ? tokens.warning :
    data.status === "finished" ? tokens.success : tokens.foregroundMuted;
}

export function AgentStatusView({ data, tokens, raw = false, compact = false }: {
  data: AgentStatusData; tokens: ExtendedThemeTokens; raw?: boolean; compact?: boolean;
}) {
  const capabilities = useInputCapabilities(compact);
  const { width } = useWindowDimensions();
  const mobile = capabilities.native || width < 600;
  const lines = useMemo(() => data.body.split("\n"), [data.body]);
  const color = agentStatusColor(data, tokens);
  return <AgentCardContent title={data.title} agentId={data.agentId} color={tokens.foregroundMuted}
    testID="agent-status" tokens={tokens} mobile={mobile}
    metadata={<MetadataItem testID="agent-status-state" accessibilityLabel={AGENT_STATUS_LABEL[data.status]}
      icon={AGENT_STATUS_ICON[data.status]} iconColor={color} label={AGENT_STATUS_LABEL[data.status]} tokens={tokens} />}>
    {raw ? <PreviewLines text={data.body} lines={lines} tokens={tokens}
      style={{ color: tokens.foreground, fontFamily: tokens.fontMono,
        fontSize: tokens.typography.mono.size, lineHeight: tokens.typography.mono.lineHeight }} /> :
      <MarkdownView text={data.body} tokens={tokens} variant="document" compact={mobile}
        size={blockProseBase(tokens.typography)} />}
  </AgentCardContent>;
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
        buttonStyle={{ width: "auto", height: "auto", minHeight: mobile ? 24 : capabilities.touch ? 44 : 24,
          flexDirection: "row", gap: space.xs, minWidth: 0, maxWidth: "100%" }}>
        <ProviderLogo provider={provider} size={16} neutralColor={tokens.foregroundMuted} />
        <Text testID="create-agent-model-label" style={{ fontSize: tokens.typography.block.meta.size, fontFamily: tokens.fontUi,
          fontWeight: "400", color: tokens.foregroundMuted, flexShrink: 1, minWidth: 0 }}>{modelName ?? model}</Text>
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
