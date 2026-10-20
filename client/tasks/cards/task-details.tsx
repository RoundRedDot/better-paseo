import React from "react";
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useHover } from "../../ui/use-hover";
import { useTasksLanguage, type TasksLanguage } from "../i18n";
import type { TaskCard } from "../model";
import { formatCost, formatRelative, formatTokens, since, tildePath } from "./format";
import { cardStrings } from "./strings";
import { pillTint, taskTokens, type TaskTokens } from "./tokens";
import { modeIcon, THINKING_ICON } from "./mode-icons";
import { BrandMark } from "./brand-mark";

export interface TaskDetailsProps {
  card: TaskCard;
  theme: PluginTheme;
  now: number;
  onOpen?(agentId: string): void;
  /** The phone's bottom sheet: larger type, no frame (the sheet draws its own). */
  compact?: boolean;
  language?: TasksLanguage;
}

interface Row {
  key: string;
  value: string;
  sub?: string;
  muted?: boolean;
}

/** The rows of the details, in order; pure for the tests and the sheet. */
export function detailRows(card: TaskCard, now: number, language: TasksLanguage): { location: Row[]; stats: Row[] } {
  const strings = cardStrings(language).details;
  const kinds = cardStrings(language).kind;
  const location = card.location;
  const rows: Row[] = [];
  if (location.projectName) rows.push({ key: strings.project, value: location.projectName });
  if (location.workspaceName || location.workspaceKind) {
    rows.push({
      key: strings.workspace,
      value: location.workspaceName ?? location.projectName ?? "—",
      sub: location.workspaceKind ? kinds[location.workspaceKind] : undefined,
    });
  }
  if (location.branch) {
    const git = location.git;
    const parts: string[] = [];
    if (git && (git.ahead !== null || git.behind !== null)) parts.push(`↑${git.ahead ?? 0} ↓${git.behind ?? 0} origin`);
    if (git && git.dirty !== null) parts.push(git.dirty ? strings.dirty : strings.clean);
    rows.push({ key: strings.branch, value: location.branch, sub: parts.join(" · ") || undefined });
  } else if (location.git === null) {
    rows.push({ key: strings.branch, value: strings.notGit, muted: true });
  }
  const folder = location.cwd.split("/").filter(Boolean).pop();
  if (folder) rows.push({ key: strings.folder, value: folder });
  rows.push({ key: strings.cwd, value: tildePath(location.cwd) });
  if (location.pullRequest) {
    const number = location.pullRequest.number !== null ? `#${location.pullRequest.number} ` : "";
    rows.push({ key: strings.pr, value: `${number}${location.pullRequest.title}` });
  }

  const stats: Row[] = [];
  const created = since(card.timing.createdAt, now);
  if (created !== null) stats.push({ key: strings.created, value: formatRelative(created, language) });
  const usage = card.usage;
  if (usage?.inputTokens != null) {
    const cached = usage.cachedInputTokens != null ? ` (${strings.cached} ${formatTokens(usage.cachedInputTokens)})` : "";
    stats.push({ key: strings.input, value: `${formatTokens(usage.inputTokens)}${cached}` });
  }
  if (usage?.outputTokens != null) stats.push({ key: strings.output, value: formatTokens(usage.outputTokens) });
  if (usage?.totalCostUsd != null) stats.push({ key: strings.cost, value: formatCost(usage.totalCostUsd) });
  if (card.context) {
    stats.push({ key: strings.context, value: `${formatTokens(card.context.usedTokens)} / ${formatTokens(card.context.maxTokens)}` });
  }
  return { location: rows, stats };
}

/** The details shown on hover (desktop popover) or long press (phone sheet): cwd, created, mode, tokens and cost. */
export function TaskDetails(props: TaskDetailsProps) {
  const { card, compact = false } = props;
  const tokens = taskTokens(props.theme);
  const preferred = useTasksLanguage();
  const language = props.language ?? preferred;
  const strings = cardStrings(language);
  const { location, stats } = detailRows(card, props.now, language);
  // Rows in the card's meta and footer style: 12 px (13 on a phone), muted keys.
  const size = compact ? 13 : 12;
  const line = compact ? 18 : 16;
  const padH = compact ? 16 : 12;
  // A fixed key column and a value column that wraps; rows grow with their content.
  const label: TextStyle = { width: compact ? 96 : 84, fontSize: size, lineHeight: line, color: tokens.foregroundMuted, flexShrink: 0 };
  const value: TextStyle = { fontSize: size, lineHeight: line, color: tokens.foreground };
  const section: ViewStyle = { paddingHorizontal: padH, paddingVertical: 10, gap: 6 };
  const rule = <View style={{ height: 1, backgroundColor: tokens.card.border }} />;
  const iconSize = compact ? 14 : 12;

  const frame: ViewStyle = compact
    ? {}
    : ({
        width: 288,
        backgroundColor: tokens.card.background,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: tokens.card.border,
        borderRadius: 8,
        boxShadow: tokens.popoverShadow,
      } as ViewStyle);

  return (
    <View style={frame} testID="task-details">
      <View style={{ paddingHorizontal: padH, paddingTop: 10, paddingBottom: 10, gap: 4 }}>
        <Text numberOfLines={2} style={{ fontSize: compact ? 16 : 13, lineHeight: compact ? 22 : 18, fontWeight: "500", color: tokens.foreground }}>
          {card.title}
        </Text>
        {/* Model, thinking and mode as the composer shows them, each with its icon. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 4 }} testID="task-details-agent">
          <AgentItem
            lead={card.providerMark !== null ? <BrandMark provider={card.provider} size={iconSize} tokens={tokens} /> : null}
            text={card.modelLabel ?? card.providerLabel}
            style={label}
            testID="task-details-model"
          />
          {card.thinkingLabel ? (
            <AgentItem
              lead={<Icon name={THINKING_ICON} size={iconSize} color={tokens.foregroundMuted} />}
              text={card.thinkingLabel}
              style={label}
              testID="task-details-thinking"
            />
          ) : null}
          {card.modeLabel ? (
            <AgentItem
              lead={<Icon name={modeIcon(card.provider, card.modeLabel)} size={iconSize} color={tokens.foregroundMuted} />}
              text={card.modeLabel}
              style={label}
              testID="task-details-mode"
            />
          ) : null}
        </View>
      </View>
      {rule}
      <View style={section}>
        {location.map((row) => (
          <DetailRow key={row.key} row={row} label={label} value={value} tokens={tokens} compact={compact} />
        ))}
        {card.labels.length > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <Text style={label}>{strings.details.labels}</Text>
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
              {card.labels.map((tag) => (
                <View
                  key={tag.name}
                  style={{
                    height: 20,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    paddingHorizontal: 8,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: pillTint(tokens, tag.color).border,
                    backgroundColor: pillTint(tokens, tag.color).background,
                    borderRadius: 10,
                  }}
                >
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tag.color ?? tokens.foregroundMuted }} />
                  <Text style={{ fontSize: 11, lineHeight: 16, color: tokens.foregroundMuted }}>{tag.name}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
      {stats.length > 0 ? (
        <>
          {rule}
          <View style={[section, { paddingBottom: 10 }]}>
            {stats.map((row) => (
              <DetailRow key={row.key} row={row} label={label} value={value} tokens={tokens} compact={compact} tabular />
            ))}
          </View>
        </>
      ) : null}
      {props.onOpen ? (
        <>
          {rule}
          <View style={{ paddingHorizontal: 6, paddingVertical: 4, alignItems: "flex-end" }}>
            <OpenTab tokens={tokens} label={strings.openTab} compact={compact} onPress={() => props.onOpen?.(card.id)} />
          </View>
        </>
      ) : null}
    </View>
  );
}

function AgentItem(props: { lead: React.ReactNode; text: string; style: TextStyle; testID: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }} testID={props.testID}>
      {props.lead}
      <Text style={[props.style, { width: undefined }]}>{props.text}</Text>
    </View>
  );
}

function DetailRow(props: { row: Row; label: TextStyle; value: TextStyle; tokens: TaskTokens; compact: boolean; tabular?: boolean }) {
  const { row } = props;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }} testID={`detail-row-${row.key}`}>
      <Text style={props.label}>{row.key}</Text>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text
          style={[
            props.value,
            row.muted ? { color: props.tokens.foregroundMuted } : null,
            props.tabular ? { fontVariant: ["tabular-nums"] } : null,
          ]}
        >
          {row.value}
        </Text>
        {row.sub ? (
          <Text
            style={{
              fontSize: props.compact ? 12 : 11,
              lineHeight: props.compact ? 16 : 14,
              color: props.tokens.foregroundMuted,
              fontVariant: ["tabular-nums"],
            }}
          >
            {row.sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function OpenTab(props: { tokens: TaskTokens; label: string; compact: boolean; onPress(): void }) {
  const { tokens } = props;
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      {...hoverProps}
      style={{
        height: props.compact ? 36 : 26,
        paddingHorizontal: 8,
        borderRadius: 6,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: hovered ? tokens.card.primaryFill : "transparent",
      }}
    >
      <Text style={{ fontSize: props.compact ? 14 : 12, fontWeight: "500", color: tokens.accent }}>{props.label}</Text>
      <Icon name="ArrowUpRight" size={props.compact ? 15 : 13} color={tokens.accent} />
    </Pressable>
  );
}
