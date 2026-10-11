import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Glyph } from "./glyph";
import { surfaceProps } from "./view-props";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { ProviderLogo } from "./provider-logo";
import { SyntaxHighlightBlock } from "./syntax-highlight";
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
import { UI_SCALE } from "../ui/tokens/typography";

interface PaseoToolCalloutProps {
  data: PaseoToolData;
  tokens: ExtendedThemeTokens;
}

/**
 * The body of a Paseo agent tool call. It draws no frame, header or
 * disclosure of its own (plan §3.3 item 5): it sits inside the tool card,
 * whose header already names the call and whose open state decides whether
 * this is mounted at all.
 */
export function PaseoToolCallout({ data, tokens }: PaseoToolCalloutProps) {
  return (
    <View {...surfaceProps(selectionSurface)} style={styles.body}>
      {data.tool === "create_agent" && data.createAgent && (
        <CreateAgentView data={data.createAgent} tokens={tokens} />
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

function CreateAgentView({
  data,
  tokens,
}: {
  data: PaseoCreateAgentData;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <ProviderLogo provider={data.provider} size={16} showLabel />
          {data.model && (
            <Text
              selectable
              style={{
                fontSize: UI_SCALE.sm,
                fontFamily: tokens.fontUi,
                color: tokens.foregroundMuted,
                backgroundColor: tokens.surface2,
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: radiusV2.block,
              }}
            >
              {data.model}
            </Text>
          )}
          {data.modeId && (
            <Text
              selectable
              style={{
                fontSize: UI_SCALE.xs,
                fontWeight: "600",
                textTransform: "uppercase",
                color: tokens.accent,
                backgroundColor: tokens.accentBg,
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: radiusV2.block,
              }}
            >
              {data.modeId} mode
            </Text>
          )}
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            paddingHorizontal: space.sm,
            paddingVertical: 3,
            borderRadius: radiusV2.block,
            backgroundColor: tokens.successBg,
          }}
        >
          <Glyph name="CheckCircle" size={11} color={tokens.success} />
          <Text
            selectable
            style={{
              fontSize: UI_SCALE.sm,
              fontFamily: tokens.fontUi,
              color: tokens.success,
              fontWeight: "600",
            }}
          >
            {data.agentId ? `${data.agentId.slice(0, 12)}…` : "running"}
          </Text>
        </View>
      </View>

      <View style={{ gap: space.xs }}>
        <Text
          selectable
          style={{
            fontSize: UI_SCALE.xs,
            fontWeight: "700",
            textTransform: "uppercase",
            color: tokens.foregroundSubtle,
          }}
        >
          Initial Task Prompt
        </Text>
        <SyntaxHighlightBlock
          code={data.initialPrompt}
          language="markdown"
          tokens={tokens}
          compact
        />
      </View>
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
          fontSize: UI_SCALE.sm,
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
                backgroundColor: tokens.surface1,
                borderWidth: 1,
                borderColor: tokens.borderSubtle,
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
                        fontSize: UI_SCALE.base,
                        fontWeight: "700",
                        color: tokens.foreground,
                      }}
                    >
                      {p.label}
                    </Text>
                    <Text
                      selectable
                      style={{
                        fontSize: UI_SCALE.xs,
                        fontFamily: tokens.fontUi,
                        color: tokens.foregroundSubtle,
                      }}
                    >
                      {p.id}
                    </Text>
                  </View>
                  <Text
                    selectable
                    style={{
                      fontSize: UI_SCALE.sm,
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
                    fontSize: UI_SCALE.xs,
                    fontWeight: "600",
                    textTransform: "uppercase",
                    color: isAvail ? tokens.success : tokens.foregroundSubtle,
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
        <Text selectable style={{ fontSize: UI_SCALE.sm, color: tokens.foregroundSubtle }}>
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
              backgroundColor: tokens.surface1,
              borderWidth: 1,
              borderColor: tokens.borderSubtle,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text
                selectable
                style={{
                  fontSize: UI_SCALE.base,
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
                  fontSize: UI_SCALE.sm,
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
                    backgroundColor: tokens.accentBg,
                  }}
                >
                  <Glyph name="Brain" size={10} color={tokens.accent} />
                  <Text
                    selectable
                    style={{
                      fontSize: UI_SCALE.xs,
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
                  fontSize: UI_SCALE.xs,
                  fontFamily: tokens.fontUi,
                  color: tokens.foregroundSubtle,
                  backgroundColor: tokens.surface2,
                  paddingHorizontal: 5,
                  paddingVertical: 1,
                  borderRadius: radiusV2.chip,
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
              fontSize: UI_SCALE.sm,
              fontFamily: tokens.fontUi,
              color: tokens.foregroundMuted,
            }}
          >
            Target: {data.agentId}
          </Text>
        </View>
        <Text selectable style={{ fontSize: UI_SCALE.xs, color: tokens.foregroundSubtle }}>
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
                fontSize: UI_SCALE.base,
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
                fontSize: UI_SCALE.xs,
                fontFamily: tokens.fontUi,
                color: tokens.foregroundSubtle,
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
