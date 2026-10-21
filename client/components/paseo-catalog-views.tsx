import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { AgentMarkdown, AgentSection, agentStateColor, modeColor, useCardMobile } from "./agent-card-content";
import { ProviderLogo } from "./provider-logo";
import { space, withAlpha, type ExtendedThemeTokens } from "./theme-tokens";
import { providerName } from "../tools/agent-row";
import type { PaseoCatalogData, PaseoCatalogMode } from "../../shared/contracts";

interface Appearance { tokens: ExtendedThemeTokens }

/**
 * The provider catalog in the agent cards' list grammar: one block per
 * provider, model or profile, a hairline between them, the name first and
 * its quiet facts under it. The daemon's JSON is behind "Show raw text".
 */
export function CatalogView({ data, tokens, raw = false, compact = false }: Appearance & {
  data: PaseoCatalogData; raw?: boolean; compact?: boolean;
}) {
  const mobile = useCardMobile(compact);
  if (raw) return <AgentMarkdown text={JSON.stringify({ arguments: data.arguments, result: data.result }, null, 2)}
    tokens={tokens} raw mobile={mobile} />;
  switch (data.kind) {
    case "providers": return <Rows testID="catalog-providers" empty="No providers returned" tokens={tokens}>
      {data.providers?.map((provider) => <ProviderBlock key={provider.id} provider={provider} tokens={tokens} />)}
    </Rows>;
    case "provider": {
      const provider = data.providers?.[0];
      if (!provider) return <Empty text="No provider returned" tokens={tokens} />;
      return <View testID="catalog-provider" style={styles.stack}>
        <ProviderBlock provider={provider} tokens={tokens} showModes={false} />
        {provider.modes.length ? <AgentSection label="Modes" tokens={tokens}>
          {provider.modes.map((mode) => <ModeLine key={mode.id} mode={mode} tokens={tokens} />)}
        </AgentSection> : null}
        {data.features?.length ? <AgentSection label="Features" tokens={tokens}>
          {data.features.map((feature) => <Text key={feature.label} selectable style={[styles.fact, muted(tokens)]}>
            {feature.label}<Text style={{ color: tokens.foreground }}>{feature.value ? `  ${feature.value}` : ""}</Text></Text>)}
        </AgentSection> : null}
      </View>;
    }
    case "models": return <Rows testID="catalog-models" empty="No models returned" tokens={tokens}>
      {data.models?.map((model) => <View key={model.id} testID={`catalog-model-${model.id}`} style={styles.block}>
        <View style={styles.head}>
          <Text selectable style={[styles.name, strong(tokens)]}>{model.label}</Text>
          {model.isDefault ? <Badge label="default" tokens={tokens} /> : null}
          <Text selectable numberOfLines={1} style={[styles.id, { color: tokens.foregroundMuted, fontFamily: tokens.fontMono }]}>{model.id}</Text>
        </View>
        {model.description ? <Text selectable style={[styles.detail, muted(tokens)]}>{model.description}</Text> : null}
        {model.thinking.length ? <View style={styles.line}>
          <Icon name="Brain" size={12} color={tokens.foregroundMuted} />
          <Text selectable style={[styles.detail, muted(tokens), styles.shrink]}>
            {model.thinking.map((level, index) => <Text key={level} style={level === model.defaultThinking ?
              { color: tokens.foreground, fontWeight: "600" } : undefined}>{index ? ` · ${level}` : level}</Text>)}
          </Text>
        </View> : null}
      </View>)}
    </Rows>;
    case "profiles": return <Rows testID="catalog-profiles" empty="No profiles configured" tokens={tokens}>
      {data.profiles?.map((profile) => <View key={profile.id} testID={`catalog-profile-${profile.id}`} style={styles.block}>
        <View style={styles.head}>
          <Icon name={lucideName(profile.icon) ?? "UserRound"} size={14} color={tokens.accent} />
          <Text selectable style={[styles.name, strong(tokens), styles.shrink]}>{profile.name}</Text>
        </View>
        <View style={styles.facts}>
          <View style={styles.line}>
            <ProviderLogo provider={profile.provider} size={12} neutralColor={tokens.foregroundMuted} />
            <Text selectable numberOfLines={1} style={[styles.detail, muted(tokens), styles.shrink]}>
              {profile.model ?? providerName(profile.provider)}</Text>
          </View>
          {profile.thinkingOptionId ? <Fact icon="Brain" label={profile.thinkingOptionId} tokens={tokens} /> : null}
          {profile.modeId ? <Fact icon="Shield" label={profile.modeId} tokens={tokens} /> : null}
        </View>
        {profile.notes ? <Text selectable style={[styles.detail, muted(tokens)]}>{profile.notes}</Text> : null}
      </View>)}
    </Rows>;
  }
}

function ProviderBlock({ provider, tokens, showModes = true }: Appearance & {
  provider: NonNullable<PaseoCatalogData["providers"]>[number]; showModes?: boolean;
}) {
  return <View testID={`catalog-provider-${provider.id}`} style={[styles.block, !provider.available && { opacity: 0.55 }]}>
    <View style={styles.head}>
      <ProviderLogo provider={provider.id} size={14} neutralColor={tokens.foregroundMuted} />
      <Text selectable style={[styles.name, strong(tokens)]}>{provider.label}</Text>
      <Text selectable numberOfLines={1} style={[styles.id, { color: tokens.foregroundMuted, fontFamily: tokens.fontMono }]}>{provider.id}</Text>
      <View style={styles.state}>
        <View style={[styles.dot, { backgroundColor: provider.available ? tokens.success : agentStateColor(undefined, tokens) }]} />
        <Text style={[styles.detail, muted(tokens)]}>{provider.available ? "available" : "unavailable"}</Text>
      </View>
    </View>
    {provider.description ? <Text selectable style={[styles.detail, muted(tokens)]}>{provider.description}</Text> : null}
    {showModes && provider.modes.length ? <View style={styles.facts}>
      {provider.modes.map((mode) => <Fact key={mode.id} icon={lucideName(mode.icon) ?? "Shield"}
        iconColor={modeColor(mode.colorTier, tokens)} label={mode.label} tokens={tokens} />)}
    </View> : null}
  </View>;
}

function ModeLine({ mode, tokens }: Appearance & { mode: PaseoCatalogMode }) {
  return <View style={[styles.line, styles.modeLine]}>
    <View style={styles.iconSlot}><Icon name={lucideName(mode.icon) ?? "Shield"} size={12} color={modeColor(mode.colorTier, tokens)} /></View>
    <Text selectable style={[styles.detail, muted(tokens), styles.shrink]}>
      <Text style={{ color: tokens.foreground, fontWeight: "500" }}>{mode.label}</Text>
      {mode.description ? `  ${mode.description}` : ""}</Text>
  </View>;
}

function Rows({ testID, empty, tokens, children }: Appearance & { testID: string; empty: string; children?: React.ReactNode[] }) {
  if (!children?.length) return <Empty text={empty} tokens={tokens} />;
  return <View testID={testID}>{children.map((child, index) => <View key={index}
    style={index > 0 ? { borderTopWidth: 1, borderTopColor: tokens.border } : undefined}>{child}</View>)}</View>;
}

function Fact({ icon, iconColor, label, tokens }: Appearance & { icon: string; iconColor?: string; label: string }) {
  return <View style={styles.line}>
    <Icon name={icon} size={12} color={iconColor ?? tokens.foregroundMuted} />
    <Text selectable numberOfLines={1} style={[styles.detail, muted(tokens), styles.shrink]}>{label}</Text>
  </View>;
}

function Badge({ label, tokens }: Appearance & { label: string }) {
  return <View style={[styles.badge, { backgroundColor: withAlpha(tokens.accent, 0.12) }]}>
    <Text style={[styles.badgeText, { color: tokens.accent, fontFamily: tokens.fontUi }]}>{label}</Text>
  </View>;
}

function Empty({ text, tokens }: Appearance & { text: string }) {
  return <Text style={[styles.detail, muted(tokens)]}>{text}</Text>;
}

/** Profiles name lucide icons in kebab case ("git-branch"); the host's Icon takes PascalCase. */
export function lucideName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return name.split(/[-_\s]+/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
}

const strong = (tokens: ExtendedThemeTokens) => ({ color: tokens.foreground, fontFamily: tokens.fontUi });
const muted = (tokens: ExtendedThemeTokens) => ({ color: tokens.foregroundMuted, fontFamily: tokens.fontUi });

const styles = StyleSheet.create({
  stack: { gap: space.sm, minWidth: 0 },
  block: { paddingVertical: 8, gap: 3, minWidth: 0 },
  head: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  name: { fontSize: 13, lineHeight: 18, fontWeight: "500" },
  id: { flex: 1, minWidth: 0, fontSize: 11, lineHeight: 16 },
  state: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0 },
  // Centres on the lowercase label's x-height, 1px below the line box's centre.
  dot: { width: 6, height: 6, borderRadius: 3, transform: [{ translateY: 1 }] },
  detail: { fontSize: 12, lineHeight: 17 },
  fact: { fontSize: 12, lineHeight: 18 },
  facts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.md, rowGap: 2, minWidth: 0 },
  line: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0, maxWidth: "100%" },
  modeLine: { alignItems: "flex-start", paddingVertical: 2 },
  iconSlot: { height: 17, justifyContent: "center" },
  shrink: { flexShrink: 1, minWidth: 0 },
  badge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { fontSize: 10, lineHeight: 14, fontWeight: "600" },
});
