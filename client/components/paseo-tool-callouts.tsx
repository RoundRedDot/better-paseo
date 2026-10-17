import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { Glyph } from "./glyph";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { surfaceProps } from "./view-props";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { MarkdownView } from "./markdown/markdown-view";
import { PreviewLines } from "../ui/preview-lines";
import { ToolbarItem } from "../ui/toolbar-button";
import { FooterDetails, useFooterDetailsWidth } from "./footer-details";
import { useCopy } from "../ui/use-copy";
import { useHover } from "../ui/use-hover";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { blockProseBase } from "../ui/tokens/typography";
import { ProviderLogo, normalizeProvider } from "./provider-logo";
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
  return (
    <View style={{ gap: mobile ? space.xs : space.sm, minWidth: 0 }}>
      <Text testID="create-agent-title" selectable accessibilityRole="header" style={{
        fontFamily: tokens.fontUi, fontSize: mobile ? 18 : 20, lineHeight: mobile ? 26 : 28,
        fontWeight: "600", color: tokens.foreground, minWidth: 0, flexShrink: 1, marginBottom: mobile ? 0 : 4,
      }}>{data.title}</Text>
      <View testID="create-agent-metadata" style={{
        flexDirection: mobile ? "column" : "row", alignItems: mobile ? "stretch" : "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: mobile ? space.xs : space.sm, minWidth: 0,
      }}>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, minWidth: 0, flexShrink: 1 }}>
          <ProviderLogo provider={data.provider} size={16} showLabel
            color={normalizeProvider(data.provider) === "cursor" ? (tokens.isDark ? "#FFFFFF" : "#000000") : undefined} />
          {data.model ? <ModelName model={data.model} thinkingOptionId={data.thinkingOptionId} tokens={tokens} mobile={mobile} /> : null}
          <View testID="create-agent-permissions" accessibilityLabel={`Permissions: ${data.modeId ?? "未指定"}`}
            style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0, maxWidth: "100%", flexShrink: 1 }}>
            <Icon name="Shield" size={14} color={tokens.foregroundMuted} />
            <Text selectable style={{ fontSize: tokens.typography.block.meta.size,
              fontFamily: tokens.fontUi, color: tokens.foregroundMuted, flexShrink: 1 }}>
              {data.modeId ?? "未指定"}
            </Text>
          </View>
        </View>
        <AgentId agentId={data.agentId} tokens={tokens} mobile={mobile} />
      </View>
      {raw ? <PreviewLines text={data.initialPrompt} lines={lines} tokens={tokens}
        style={{ color: tokens.foreground, fontFamily: tokens.fontMono,
          fontSize: tokens.typography.mono.size, lineHeight: tokens.typography.mono.lineHeight }} /> :
        <MarkdownView text={data.initialPrompt} tokens={tokens} variant="document" compact={mobile}
          size={blockProseBase(tokens.typography)} />}
    </View>
  );
}

/** Copies the model ID exactly as requested, without provider or metadata. */
function ModelName({ model, thinkingOptionId, tokens, mobile }: {
  model: string;
  thinkingOptionId?: string;
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
        details={<FooterDetails modelName={model} thinkingLabel={thinkingOptionId ?? "未指定"} tokens={tokens} />}
        detailsWidth={detailsWidth} hitSlop={mobile ? 10 : 4}
        buttonStyle={{ width: "auto", height: "auto", minHeight: mobile ? 24 : capabilities.touch ? 44 : 24,
          flexDirection: "row", gap: space.xs, minWidth: 0, maxWidth: "100%" }}>
        <Text style={{ fontSize: tokens.typography.block.meta.size, fontFamily: tokens.fontUi,
          color: tokens.foregroundMuted, flexShrink: 1, minWidth: 0 }}>{model}</Text>
        <Glyph name={copied ? "Check" : "Copy"} size={14} color={copied ? tokens.success : tokens.foregroundMuted} />
      </ToolbarItem>
    </View>
  );
}

/** The entire ID is one copy target; touch keeps its affordance visible. */
function AgentId({ agentId, tokens, mobile }: { agentId?: string; tokens: ExtendedThemeTokens; mobile: boolean }) {
  const { copied, copy } = useCopy();
  const { hovered, hoverProps } = useHover();
  const [focused, setFocused] = useState(false);
  const capabilities = useInputCapabilities();
  const showCopy = !capabilities.hover || hovered || focused || copied;
  return (
    <Pressable testID="create-agent-id" accessibilityRole={agentId ? "button" : undefined}
      accessibilityLabel={agentId ? `Copy agent ID ${agentId}` : "running"}
      disabled={!agentId} hitSlop={mobile ? 10 : 0} {...hoverProps}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPress={() => { if (agentId) void copy(agentId, { label: "Copy agent ID" }); }}
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs, maxWidth: "100%", minWidth: 0,
        minHeight: mobile ? 24 : capabilities.touch ? 44 : 24, paddingVertical: 3, borderRadius: radiusV2.block }}>
      <Glyph name="CheckCircle" size={11} color={tokens.success} />
      <Text style={{ fontSize: tokens.typography.block.meta.size, fontFamily: tokens.fontUi,
        color: tokens.success, fontWeight: "600", flexShrink: 1, minWidth: 0 }}>{agentId ?? "running"}</Text>
      {agentId ? <View testID="create-agent-copy-icon" style={{ opacity: showCopy ? 1 : 0 }}>
        <Glyph name={copied ? "Check" : "Copy"} size={14} color={tokens.success} />
      </View> : null}
    </Pressable>
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
