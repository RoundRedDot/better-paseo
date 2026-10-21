import React, { useMemo, useState, type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useAgent } from "@getpaseo/plugin/client";
import { Glyph } from "./glyph";
import { ProviderLogo } from "./provider-logo";
import { MarkdownView } from "./markdown/markdown-view";
import { PreviewLines } from "../ui/preview-lines";
import { usePreviewPanel } from "../ui/hover-preview";
import { blockProseBase } from "../ui/tokens/typography";
import { mix, radiusV2, space, withAlpha, type ExtendedThemeTokens } from "./theme-tokens";
import { useCopy } from "../ui/use-copy";
import { useHover } from "../ui/use-hover";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { providerName, shortAgentId, shouldFold } from "../tools/agent-row";

/*
 * The opened body of every agent card (agent cards design 5.2). The row above
 * already names the agent, so the body never repeats its title: an identity
 * strip, a full-bleed rule, then labelled sections whose prose is the point.
 */

/** The body's horizontal padding, which the rule bleeds through. */
const BODY_PAD = space.md;

export type AgentState = "initializing" | "idle" | "running" | "error" | "closed" | "waiting";

export function agentStateColor(state: string | undefined, tokens: ExtendedThemeTokens): string {
  switch (state) {
    case "running":
    case "initializing":
    case "sending": return tokens.accent;
    case "waiting": return tokens.warning;
    case "error":
    case "failed": return tokens.danger;
    default: return withAlpha(tokens.foregroundMuted, 0.5);
  }
}

/** The composer's colour for each permission tier; text stays muted like the composer. */
export function modeColor(tier: string | undefined, tokens: ExtendedThemeTokens): string {
  switch (tier) {
    case "safe": return tokens.success;
    case "dangerous": return tokens.danger;
    case "planning":
    case "moderate": return tokens.accent;
    default: return tokens.foregroundMuted;
  }
}

/** The host's live view of an agent, one primitive per selector so no render returns a fresh object. */
export function useLiveAgent(agentId: string | undefined) {
  const id = agentId ?? "";
  return {
    title: useAgent(id, (agent) => agent.title) ?? undefined,
    provider: useAgent(id, (agent) => agent.provider) ?? undefined,
    model: useAgent(id, (agent) => agent.model) ?? undefined,
    status: useAgent(id, (agent) => agent.attentionReason === "permission" ? "waiting" : agent.status) ?? undefined,
    cwd: useAgent(id, (agent) => agent.cwd) ?? undefined,
  };
}

export interface AgentField {
  key: string;
  icon: string;
  label: string;
  /** The icon's own colour: a thinking level in accent, a mode in its tier. */
  iconColor?: string;
  /** Names the field for a screen reader: "Thinking: High". */
  accessibilityLabel?: string;
}

/**
 * Provider, fields, state, then the short ID with its copy button. One
 * wrapping line; the ID is pushed to the end and never takes a line alone.
 */
export function AgentIdentityStrip({ testID, provider, leading, fields = [], state, stateLabel, agentId, tokens, mobile }: {
  testID: string;
  provider?: string;
  /** Replaces the provider mark: the create card's copyable model. */
  leading?: ReactNode;
  fields?: AgentField[];
  state?: string;
  stateLabel?: string;
  agentId?: string;
  tokens: ExtendedThemeTokens;
  mobile: boolean;
}) {
  const label = providerName(provider);
  // The ID sits outside the wrapping fields, so it ends the last line instead of wrapping onto one alone.
  return <View testID={`${testID}-metadata`} style={styles.stripRow}><View style={styles.strip}>
    {leading ?? (provider ? <View style={styles.item}>
      <ProviderLogo provider={provider} size={12} neutralColor={tokens.foregroundMuted} />
      <Text selectable style={[styles.provider, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>{label}</Text>
    </View> : null)}
    {fields.map((field) => <AgentCardMetadataItem key={field.key} testID={`${testID}-${field.key}`}
      accessibilityLabel={field.accessibilityLabel ?? field.label} icon={field.icon} iconColor={field.iconColor ?? tokens.foregroundMuted}
      label={field.label} tokens={tokens} />)}
    {state ? <View testID={`${testID}-state`} style={styles.item} accessibilityLabel={stateLabel ?? state}>
      <View style={[styles.dot, { backgroundColor: agentStateColor(state, tokens) }]} />
      <Text selectable style={[styles.field, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>{stateLabel ?? state}</Text>
    </View> : null}
  </View>
    {agentId ? <AgentId agentId={agentId} testID={testID} tokens={tokens} mobile={mobile} /> : null}
  </View>;
}

/** A 12px lucide icon beside a quiet label. */
export function AgentCardMetadataItem({ testID, accessibilityLabel, icon, iconColor, label, tokens }: {
  testID: string; accessibilityLabel: string; icon: string; iconColor: string; label: string; tokens: ExtendedThemeTokens;
}) {
  return <View testID={testID} accessibilityLabel={accessibilityLabel} style={styles.item}>
    <Icon name={icon} size={12} color={iconColor} />
    <Text selectable numberOfLines={1} style={[styles.field, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>{label}</Text>
  </View>;
}

/** Eight characters on view; a press copies the full ID. */
function AgentId({ agentId, tokens, mobile, testID }: { agentId: string; tokens: ExtendedThemeTokens; mobile: boolean; testID: string }) {
  const { copied, copy } = useCopy();
  const { hovered, hoverProps } = useHover();
  const muted = withAlpha(tokens.foregroundMuted, hovered ? 1 : 0.6);
  return <Pressable testID={`${testID}-id`} accessibilityRole="button" accessibilityLabel={`Copy agent ID ${agentId}`}
    hitSlop={mobile ? 10 : 6} {...hoverProps} onPress={() => { void copy(agentId, { label: "Copy agent ID" }); }}
    style={styles.id}>
    <Text style={[styles.idText, { color: tokens.foregroundMuted, fontFamily: tokens.fontMono }]}>{shortAgentId(agentId)}</Text>
    <View testID={`${testID}-copy-icon`}><Glyph name={copied ? "Check" : "Copy"} size={12} color={copied ? tokens.success : muted} /></View>
  </Pressable>;
}

/** The full-width rule between the identity strip and the content. */
export function AgentDivider({ tokens }: { tokens: ExtendedThemeTokens }) {
  return <View style={[styles.divider, { backgroundColor: tokens.border }]} />;
}

export function AgentSection({ label, tokens, children, testID }: {
  label?: string; tokens: ExtendedThemeTokens; children: ReactNode; testID?: string;
}) {
  return <View testID={testID} style={styles.section}>
    {label ? <Text style={[styles.sectionLabel, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>{label}</Text> : null}
    {children}
  </View>;
}

/** A failure's first line, in danger, straight after the rule. */
export function AgentErrorLine({ text, tokens }: { text: string; tokens: ExtendedThemeTokens }) {
  return <View testID="agent-error" style={styles.errorRow}>
    <View style={styles.errorIcon}><Icon name="CircleX" size={14} color={tokens.danger} /></View>
    <Text selectable style={[styles.errorText, { color: tokens.danger, fontFamily: tokens.fontUi }]}>{text}</Text>
  </View>;
}

/** A quiet note under the content: send_agent_prompt's guidance. */
export function AgentNote({ text, tokens, testID }: { text: string; tokens: ExtendedThemeTokens; testID?: string }) {
  return <View testID={testID} style={styles.note}>
    <Icon name="Info" size={12} color={tokens.foregroundMuted} />
    <Text selectable style={[styles.noteText, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>{text}</Text>
  </View>;
}

const FOLD_HEIGHT = 200;
const FADE_HEIGHT = 48;
const FADE_STEPS = 8;

/**
 * Markdown the card is about. Inline, a long body folds to 200px under a fade
 * with "Show all - N lines"; a hover preview never folds, its panel scrolls.
 */
export function AgentMarkdown({ text, tokens, mobile, raw = false, testID }: {
  text: string; tokens: ExtendedThemeTokens; mobile: boolean; raw?: boolean; testID?: string;
}) {
  const inPreview = usePreviewPanel() !== null;
  const lines = useMemo(() => text.split("\n"), [text]);
  const foldable = !inPreview && !raw && shouldFold(text);
  const [open, setOpen] = useState(false);
  const folded = foldable && !open;
  const surface = tokens.row.outputBg;
  const content = raw ? <PreviewLines text={text} lines={lines} tokens={tokens} style={{ color: tokens.foreground,
    fontFamily: tokens.fontMono, fontSize: tokens.typography.mono.size, lineHeight: tokens.typography.mono.lineHeight }} /> :
    <MarkdownView text={text} tokens={tokens} variant="document" compact={mobile} size={blockProseBase(tokens.typography)} />;
  return <View testID={testID}>
    <View testID={folded ? "agent-body-folded" : undefined} style={folded ? styles.folded : undefined}>
      {content}
      {folded ? <View pointerEvents="none" style={styles.fade}>
        {Array.from({ length: FADE_STEPS }, (_, step) => <View key={step}
          style={{ flex: 1, backgroundColor: withAlpha(surface, (step + 1) / FADE_STEPS) }} />)}
      </View> : null}
    </View>
    {foldable ? <Pressable testID="agent-body-toggle" accessibilityRole="button" hitSlop={mobile ? 8 : 4}
      onPress={() => setOpen((value) => !value)} style={[styles.toggle, { minHeight: mobile ? 36 : 24 }]}>
      <Icon name={open ? "ChevronUp" : "ChevronDown"} size={12} color={tokens.foreground} />
      <Text style={[styles.toggleText, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
        {open ? "Show less" : `Show all · ${lines.length} lines`}</Text>
    </Pressable> : null}
  </View>;
}

/** The permission block's frame: warning mixed into the border (design 5.3). */
export function permissionBorder(tokens: ExtendedThemeTokens): string {
  return mix(tokens.border, tokens.warning, 0.45);
}

/** Inline code-like line: a command or a request ID. */
export function AgentCode({ text, tokens }: { text: string; tokens: ExtendedThemeTokens }) {
  return <View style={[styles.code, { backgroundColor: tokens.v2.surface2 }]}>
    <Text selectable style={{ color: tokens.foreground, fontFamily: tokens.fontMono, fontSize: 12, lineHeight: 18 }}>{text}</Text>
  </View>;
}

/** A phone, or a window narrow enough to read like one. */
export function useCardMobile(compact = false): boolean {
  const capabilities = useInputCapabilities(compact);
  const { width } = useWindowDimensions();
  return capabilities.native || width < 600;
}

const styles = StyleSheet.create({
  stripRow: { flexDirection: "row", alignItems: "flex-end", gap: space.md, minWidth: 0 },
  strip: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.md, rowGap: space.xs, minHeight: 20, minWidth: 0 },
  item: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0, maxWidth: "100%", flexShrink: 1 },
  provider: { fontSize: 12, lineHeight: 20, fontWeight: "500" },
  field: { fontSize: 12, lineHeight: 20, flexShrink: 1 },
  // State labels are lowercase, so the dot centres on the x-height, which sits 1px below the line box's centre.
  dot: { width: 6, height: 6, borderRadius: 3, transform: [{ translateY: 1 }] },
  id: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 20, borderRadius: radiusV2.block },
  idText: { fontSize: 11, lineHeight: 16 },
  divider: { height: 1, marginHorizontal: -BODY_PAD },
  section: { gap: 2, minWidth: 0 },
  sectionLabel: { fontSize: 11, lineHeight: 16, fontWeight: "500" },
  errorRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  errorIcon: { height: 18, justifyContent: "center" },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18 },
  note: { flexDirection: "row", alignItems: "center", gap: space.xs },
  noteText: { flex: 1, fontSize: 12, lineHeight: 16 },
  folded: { maxHeight: FOLD_HEIGHT, overflow: "hidden" },
  fade: { position: "absolute", left: 0, right: 0, bottom: 0, height: FADE_HEIGHT },
  toggle: { flexDirection: "row", alignItems: "center", gap: space.xs, alignSelf: "flex-start" },
  toggleText: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
  code: { borderRadius: 4, paddingVertical: 6, paddingHorizontal: space.sm },
});
