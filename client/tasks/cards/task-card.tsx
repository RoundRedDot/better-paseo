import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { labelLimitCount, type CardSettings } from "../../../shared/tasks-settings";
import { ProviderLogo } from "../../components/provider-logo";
import { useHover } from "../../ui/use-hover";
import type { PermissionButton, StopPhase } from "../actions";
import { useTasksLanguage, type TasksLanguage } from "../i18n";
import type { TaskCard, TaskChild, WorkspaceKind } from "../model";
import {
  contextRatio,
  contextTone,
  formatApprox,
  formatDuration,
  formatRelative,
  formatWait,
  since,
} from "./format";
import { StatusIcon } from "./status-icon";
import { cardStrings, subtaskSummary } from "./strings";
import { taskTokens, type TaskTokens } from "./tokens";

export interface CardCallbacks {
  /** Jump to the agent's tab (`navigation.openAgent`). Absent on hosts without navigation: hide the jump button. */
  onOpen?(agentId: string): void;
  /** Scroll the board to a card and highlight it (child → parent link). */
  onReveal(agentId: string): void;
  /** Stop, if the card is stoppable and Stop is available. */
  onStop?(card: TaskCard, options?: { withChildren?: boolean }): void;
  onCancelStop?(agentId: string): void;
  onPermission?(card: TaskCard, button: PermissionButton): void;
  /** Long press on a phone, hover on desktop: the details sheet or popover. */
  onDetails?(card: TaskCard): void;
  /** Desktop: the pointer left the card, so the board may close the popover (after its grace delay). */
  onDetailsEnd?(agentId: string): void;
}

export interface TaskCardViewProps extends CardCallbacks {
  card: TaskCard;
  /** Field switches after `effectiveCard`. */
  fields: CardSettings;
  theme: PluginTheme;
  /** Phone layout (`layout.compact`): must/default/details-only tiers, 36 px jump button. */
  compact: boolean;
  /** The permission buttons for `card.permission` (from `permissionButtons`). */
  permissionButtons: PermissionButton[];
  stopPhase: StopPhase;
  /** Keyboard focus ring. */
  focused: boolean;
  /** The 1 s highlight after a parent link scrolled here. */
  highlighted: boolean;
  /** The board's clock (ms), ticking once a second while visible. */
  now: number;
  /** The board's language; read from the preferences when absent. */
  language?: TasksLanguage;
  /** False stops the running ring (a hidden pane, a static preview). Default true. */
  animated?: boolean;
}

const WEB = Platform.OS === "web";
/** No hover: the stop button and the subtask jump buttons stay visible. */
const TOUCH = !WEB;
const DETAILS_DELAY_MS = 450;
const TOOLTIP_DELAY_MS = 400;
const NBSP = "\u00a0";

// --- Geometry (prototype "卡片" and "移动端") --------------------------------

interface Metrics {
  padV: number;
  padH: number;
  slot: number;
  statusHeight: number;
  titleSize: number;
  titleLine: number;
  subSize: number;
  subLine: number;
  rowSize: number;
  rowLine: number;
  icon: number;
  mark: number;
  locGap: number;
  footGap: number;
  blockGap: number;
  jump: number;
  jumpIcon: number;
  chipHeight: number;
  chipSize: number;
}

const DESKTOP: Metrics = {
  padV: 12,
  padH: 14,
  slot: 16,
  statusHeight: 20,
  titleSize: 13,
  titleLine: 20,
  subSize: 12,
  subLine: 18,
  rowSize: 12,
  rowLine: 20,
  icon: 12,
  mark: 12,
  locGap: 10,
  footGap: 8,
  blockGap: 10,
  jump: 24,
  jumpIcon: 14,
  chipHeight: 20,
  chipSize: 11,
};

const PHONE: Metrics = {
  padV: 14,
  padH: 16,
  slot: 20,
  statusHeight: 22,
  titleSize: 16,
  titleLine: 22,
  subSize: 14,
  subLine: 22,
  rowSize: 14,
  rowLine: 22,
  icon: 14,
  mark: 14,
  locGap: 12,
  footGap: 12,
  blockGap: 12,
  jump: 36,
  jumpIcon: 18,
  chipHeight: 22,
  chipSize: 12,
};

const GAP = 6;
const tabular: TextStyle = { fontVariant: ["tabular-nums"] };
const webTransition = (WEB
  ? { transitionProperty: "background-color, border-color, box-shadow, color, opacity", transitionDuration: "120ms", transitionTimingFunction: "ease-out" }
  : {}) as ViewStyle;

function kindIcon(kind: WorkspaceKind | null): string {
  if (kind === "local_checkout") return "Monitor";
  if (kind === "worktree") return "FolderGit2";
  return "Folder";
}

/** Keeps "Opus 5.5" on one line while the subtitle wraps between segments. */
const glue = (text: string) => text.replace(/ /g, NBSP);

// --- What the card shows ----------------------------------------------------

/** The rows a card draws for a field set; pure, so tier and collapse rules are testable. */
export interface CardLayout {
  subtitle: boolean;
  brand: boolean;
  model: boolean;
  thinking: boolean;
  project: boolean;
  /** "image" draws `projectIcon`, "letter" the outlined initial, "icon" FolderKanban, null the workspace-kind icon. */
  projectAvatar: "image" | "letter" | "icon" | null;
  workspace: boolean;
  branch: boolean;
  gitStatus: boolean;
  folder: boolean;
  path: boolean;
  pullRequest: boolean;
  labels: number;
  labelLimit: number;
  timer: boolean;
  context: boolean;
  subtasks: boolean;
  failure: boolean;
  permission: boolean;
}

/**
 * Desktop follows the switches. Compact keeps the must tier whatever the
 * switches say (status, title, agent · model · thinking, timer, actions,
 * permission, failure), lets the default tier follow them (project,
 * workspace, branch, first label, subtasks summary) and never draws the
 * details-only tier (folder, path, git status, PR, project image).
 */
export function cardLayout(card: TaskCard, fields: CardSettings, compact: boolean): CardLayout {
  const location = card.location;
  const project = fields.project && !!location.projectName;
  const ratio = contextRatio(card.context);
  const brand = card.providerMark !== null && (compact || fields.provider);
  const model = !!card.modelLabel && (compact || fields.model);
  const thinking = !!card.thinkingLabel && (compact || fields.thinking);
  const path = !compact && fields.path && !!location.cwd;
  let projectAvatar: CardLayout["projectAvatar"] = null;
  if (project) {
    if (compact) projectAvatar = "letter";
    else if (fields.projectIcon) projectAvatar = location.projectIcon ? "image" : "letter";
    else projectAvatar = "icon";
  }
  return {
    subtitle: compact || fields.provider || fields.model || fields.thinking,
    brand,
    model,
    thinking,
    project,
    projectAvatar,
    workspace: fields.workspace && !!location.workspaceName,
    branch: fields.branch && !!location.branch,
    gitStatus: !compact && fields.gitStatus && location.git !== null,
    folder: !compact && !path && fields.folder && !!location.folder,
    path,
    pullRequest: !compact && fields.pullRequest && location.pullRequest !== null,
    labels: fields.labels ? card.labels.length : 0,
    labelLimit: compact ? 1 : labelLimitCount(fields.labelLimit),
    timer: compact || fields.timer,
    context:
      card.lane === "running" && ratio !== null && (compact ? ratio > 0.8 : fields.context),
    subtasks: fields.subtasks && card.children.length > 0,
    failure: card.lane === "review" && !!card.error,
    permission: card.lane === "needs_input" && card.permission !== null,
  };
}

interface TimerView {
  text: string;
  /** "warning" draws the clock icon in the warning colour. */
  tone: "muted" | "warning" | "running";
}

/** The footer's timer at `now`; null when there is nothing to count. */
export function cardTimer(card: TaskCard, now: number, language: TasksLanguage): TimerView | null {
  const timing = card.timing;
  if (card.lane === "needs_input") {
    const waited = since(timing.attentionAt, now) ?? since(timing.turnStartedAt, now);
    return waited === null ? null : { text: formatWait(waited, language), tone: "warning" };
  }
  if (card.lane === "running") {
    const ran = since(timing.turnStartedAt, now);
    return ran === null
      ? { text: cardStrings(language).starting, tone: "running" }
      : { text: formatDuration(ran), tone: "muted" };
  }
  const parts: string[] = [];
  if (timing.lastTurnMs !== null) parts.push(formatApprox(timing.lastTurnMs, language));
  const ago = since(timing.updatedAt, now);
  if (ago !== null) parts.push(formatRelative(ago, language));
  return parts.length ? { text: parts.join(" · "), tone: "muted" } : null;
}

/** Children that Stop with subtasks would reach. */
function activeChildren(card: TaskCard): number {
  return card.children.filter((child) => child.status === "running" || child.status === "needs_input").length;
}

// --- The card -----------------------------------------------------------------

function TaskCardViewImpl(props: TaskCardViewProps) {
  const { card, fields, compact, theme } = props;
  const tokens = taskTokens(theme);
  const preferred = useTasksLanguage();
  const language = props.language ?? preferred;
  const strings = cardStrings(language);
  const m = compact ? PHONE : DESKTOP;
  const layout = cardLayout(card, fields, compact);
  const { hovered, hoverProps } = useHover();
  const [menuOpen, setMenuOpen] = useState(false);
  const [stopAll, setStopAll] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const detailsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const latest = useRef(props);
  latest.current = props;
  const clearDetails = () => {
    if (detailsTimer.current) clearTimeout(detailsTimer.current);
    detailsTimer.current = null;
  };
  useEffect(() => clearDetails, []);

  const onHoverIn = () => {
    hoverProps.onHoverIn();
    if (!props.onDetails || compact) return;
    clearDetails();
    detailsTimer.current = setTimeout(() => {
      detailsTimer.current = null;
      latest.current.onDetails?.(latest.current.card);
    }, DETAILS_DELAY_MS);
  };
  const onHoverOut = () => {
    hoverProps.onHoverOut();
    clearDetails();
    setMenuOpen(false);
    props.onDetailsEnd?.(card.id);
    if (props.stopPhase === "confirming") props.onCancelStop?.(card.id);
  };

  const background = props.highlighted ? tokens.highlight : hovered ? tokens.surface1 : tokens.surface0;
  const canStop = card.stoppable && !!props.onStop;
  const parentStop = canStop && activeChildren(card) > 0;
  const showStop = canStop && !compact && (TOUCH || hovered || props.stopPhase !== "idle" || menuOpen);
  const pressStop = (withChildren: boolean) => {
    setMenuOpen(false);
    setStopAll(withChildren);
    props.onStop?.(card, { withChildren });
  };
  const stop = {
    tokens,
    strings,
    phase: props.stopPhase,
    all: stopAll,
    parent: parentStop,
    count: activeChildren(card),
    menuOpen,
    onPress: () => pressStop(props.stopPhase === "confirming" ? stopAll : false),
    onToggleMenu: () => setMenuOpen((open) => !open),
    onPick: pressStop,
  };

  const cardStyle: ViewStyle = {
    paddingVertical: m.padV,
    paddingHorizontal: m.padH,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: props.focused || props.highlighted ? tokens.accent : hovered ? tokens.borderStrong : tokens.border,
    backgroundColor: background,
    zIndex: menuOpen ? 30 : hovered ? 2 : 1,
    ...(props.focused ? ({ boxShadow: `0px 0px 0px 3px ${tokens.accentRing}` } as ViewStyle) : null),
    ...webTransition,
  };

  const text = (size: number, line: number, color: string, weight: TextStyle["fontWeight"] = "400"): TextStyle => ({
    fontSize: size,
    lineHeight: line,
    color,
    fontWeight: weight,
  });
  const slot: ViewStyle = { width: m.slot, height: m.rowLine, alignItems: "center", justifyContent: "center", flexShrink: 0 };
  const rule = <DashedRule color={tokens.border} inset={m.padH} />;
  const block: ViewStyle = { marginTop: m.blockGap };
  const blockBody: ViewStyle = { paddingTop: m.blockGap };

  // Header group -----------------------------------------------------------
  const subtitleParts = [card.providerLabel];
  if (layout.model && card.modelLabel) subtitleParts.push(card.modelLabel);
  if (layout.thinking && card.thinkingLabel) subtitleParts.push(card.thinkingLabel);
  const header = (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: GAP }}>
      <StatusIcon
        kind={card.status}
        size={m.slot}
        height={m.statusHeight}
        theme={theme}
        backdrop={background}
        animated={props.animated}
      />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={2} style={text(m.titleSize, m.titleLine, tokens.foreground, "600")}>
          {card.title}
        </Text>
        {layout.subtitle ? (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
            {layout.brand ? (
              <View style={{ height: m.subLine, justifyContent: "center" }}>
                <ProviderLogo provider={card.provider} size={m.mark} />
              </View>
            ) : null}
            <Text numberOfLines={2} style={[text(m.subSize, m.subLine, tokens.foregroundMuted), { flex: 1 }]}>
              {subtitleParts.map(glue).join(" · ")}
            </Text>
          </View>
        ) : null}
      </View>
      {showStop ? <StopControl {...stop} compact={false} /> : null}
      {props.onOpen ? (
        <JumpButton
          tokens={tokens}
          compact={compact}
          label={strings.openInWorkspace}
          onPress={() => props.onOpen?.(card.id)}
        />
      ) : null}
    </View>
  );

  // Parent link ------------------------------------------------------------
  const parent = card.parent ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={strings.revealParent}
      onPress={() => props.onReveal(card.parent!.id)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: GAP,
        marginBottom: compact ? 4 : 2,
        minHeight: compact ? 28 : undefined,
      }}
    >
      <View style={{ width: m.slot, alignItems: "center" }}>
        <Icon name="CornerDownRight" size={compact ? 14 : 12} color={tokens.foregroundMuted} />
      </View>
      <Text numberOfLines={2} style={text(compact ? 13 : 11, compact ? 18 : 16, tokens.foregroundMuted)}>
        {card.parent.missing ? strings.parentArchived : card.parent.title ?? strings.parentUnknown}
      </Text>
    </Pressable>
  ) : null;

  // Location group ---------------------------------------------------------
  const location = card.location;
  const rowText = text(m.rowSize, m.rowLine, tokens.foregroundMuted);
  const showLoc = layout.project || layout.workspace;
  const showLine2 = layout.branch || layout.gitStatus || layout.folder || layout.path;
  const avatar = layout.projectAvatar;
  const locationGroup =
    showLoc || showLine2 || layout.pullRequest ? (
      <View style={{ marginTop: m.locGap, gap: 4 }}>
        {showLoc ? (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: GAP }}>
            <View style={slot}>
              {avatar === "image" ? (
                <Image source={{ uri: location.projectIcon! }} style={{ width: m.mark, height: m.mark, borderRadius: 3 }} />
              ) : avatar === "letter" ? (
                <View
                  style={{
                    width: m.mark,
                    height: m.mark,
                    borderRadius: 3,
                    borderWidth: 1,
                    borderColor: tokens.foregroundMuted,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: compact ? 9 : 8, lineHeight: compact ? 11 : 10, fontWeight: "600", color: tokens.foregroundMuted }}>
                    {(location.projectName ?? "?").slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              ) : (
                <Icon name={avatar === "icon" ? "FolderKanban" : kindIcon(location.workspaceKind)} size={m.icon} color={tokens.foregroundMuted} />
              )}
            </View>
            <Text numberOfLines={2} style={[rowText, { flex: 1 }]}>
              {layout.project ? <Text style={{ color: tokens.foreground }}>{location.projectName}</Text> : null}
              {layout.project && layout.workspace ? " › " : null}
              {layout.workspace ? (
                <Text style={{ color: layout.project ? tokens.foregroundMuted : tokens.foreground }}>{location.workspaceName}</Text>
              ) : null}
            </Text>
          </View>
        ) : null}
        {showLine2 ? (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: GAP }}>
            <View style={slot}>
              <Icon
                name={layout.branch || layout.gitStatus ? "GitBranch" : kindIcon(location.workspaceKind)}
                size={m.icon}
                color={tokens.foregroundMuted}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: GAP }}>
              {layout.branch ? (
                <Text numberOfLines={2} style={[rowText, { flexShrink: 1 }]}>
                  {location.branch}
                </Text>
              ) : null}
              {layout.gitStatus && location.git ? <GitStatus git={location.git} tokens={tokens} style={rowText} strings={strings} /> : null}
              {(layout.folder || layout.path) && (layout.branch || layout.gitStatus) ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={rowText}>·</Text>
                  <Icon name={layout.path ? "FolderOpen" : "Folder"} size={m.icon} color={tokens.foregroundMuted} />
                </View>
              ) : null}
              {layout.folder || layout.path ? (
                <Text numberOfLines={2} style={[rowText, { flexShrink: 1 }]}>
                  {layout.path ? location.cwd : location.folder}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
        {layout.pullRequest && location.pullRequest ? (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: GAP }}>
            <View style={slot}>
              <Icon name="GitPullRequest" size={m.icon} color={tokens.foregroundMuted} />
            </View>
            <Text numberOfLines={2} style={[rowText, { flex: 1 }]}>
              {location.pullRequest.number !== null ? (
                <Text style={[{ color: tokens.foreground }, tabular]}>#{location.pullRequest.number} </Text>
              ) : null}
              {location.pullRequest.title}
            </Text>
          </View>
        ) : null}
      </View>
    ) : null;

  // Footer group -----------------------------------------------------------
  const timer = layout.timer ? cardTimer(card, props.now, language) : null;
  const shownLabels = layout.labels > 0 ? card.labels.slice(0, layout.labelLimit) : [];
  const hiddenLabels = layout.labels > 0 ? card.labels.length - shownLabels.length : 0;
  const chip: ViewStyle = {
    height: m.chipHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: compact ? 5 : 4,
    paddingHorizontal: compact ? 7 : 6,
    borderWidth: 1,
    borderColor: tokens.tagChip.border,
    borderRadius: 3,
    backgroundColor: tokens.tagChip.background,
  };
  const chipText = text(m.chipSize, m.chipHeight - 2, tokens.tagChip.text);
  const timerColor = timer?.tone === "warning" ? tokens.status.warning : timer?.tone === "running" ? tokens.status.running : tokens.foregroundMuted;
  const footer =
    shownLabels.length > 0 || timer ? (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: compact ? "wrap" : "nowrap",
          gap: GAP,
          marginTop: m.footGap,
          paddingLeft: m.slot + GAP,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {shownLabels.map((label) => (
            <View key={label.name} style={chip}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: label.color ?? tokens.foregroundMuted }} />
              <Text style={chipText}>{label.name}</Text>
            </View>
          ))}
          {hiddenLabels > 0 ? (
            <View style={chip}>
              <Text style={[chipText, tabular]}>+{hiddenLabels}</Text>
            </View>
          ) : null}
        </View>
        {timer ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3, height: m.chipHeight, flexShrink: 0 }}>
            {timer.tone === "warning" ? <Icon name="Clock" size={m.icon} color={timerColor} /> : null}
            <Text style={[text(compact ? 14 : 12, m.chipHeight, timerColor), tabular]}>{timer.text}</Text>
          </View>
        ) : null}
      </View>
    ) : null;

  // Lane blocks ------------------------------------------------------------
  const failed = card.status === "failed";
  const failure = layout.failure ? (
    <View style={block}>
      {rule}
      <View style={[blockBody, { flexDirection: "row", alignItems: "flex-start", gap: GAP }]}>
        <View style={[slot, { height: compact ? 22 : 18 }]}>
          <Icon name={failed ? "CircleX" : "Square"} size={m.icon} color={failed ? tokens.danger : tokens.foregroundMuted} />
        </View>
        <Text style={[text(m.rowSize, compact ? 22 : 18, failed ? tokens.danger : tokens.foregroundMuted), { flex: 1 }]}>{card.error}</Text>
      </View>
    </View>
  ) : null;

  const permission = card.permission;
  const asksQuestion = permission?.kind === "question" || permission?.kind === "other";
  const permissionBlock =
    layout.permission && permission ? (
      <View style={block}>
        {rule}
        <View style={[blockBody, { gap: 8 }]}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: GAP }}>
            <View style={[slot, { height: compact ? 22 : 18 }]}>
              <Icon name={permissionIcon(permission.kind)} size={compact ? 15 : 13} color={tokens.status.warning} />
            </View>
            <Text numberOfLines={2} style={[text(m.rowSize, compact ? 22 : 18, tokens.foreground), { flex: 1 }]}>
              <Text style={{ fontWeight: asksQuestion ? "500" : "600" }}>{permission.title}</Text>
              {permission.summary ? <Text style={{ color: tokens.foregroundMuted }}> · </Text> : null}
              {permission.summary}
            </Text>
            {compact && permission.remaining > 0 ? <MoreChip tokens={tokens} label={strings.more(permission.remaining)} compact /> : null}
          </View>
          {!compact && (props.permissionButtons.length > 0 || permission.remaining > 0) ? (
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: GAP, paddingLeft: m.slot + GAP }}>
              {props.permissionButtons.map((button) => (
                <ActionButton
                  key={button.key}
                  button={button}
                  tokens={tokens}
                  compact={false}
                  onPress={() => props.onPermission?.(card, button)}
                />
              ))}
              <View style={{ flex: 1 }} />
              {permission.remaining > 0 ? <MoreChip tokens={tokens} label={strings.more(permission.remaining)} compact={false} /> : null}
            </View>
          ) : null}
        </View>
      </View>
    ) : null;

  const ratio = contextRatio(card.context);
  const tone = ratio === null ? "normal" : contextTone(ratio);
  const contextColor = tone === "danger" ? tokens.danger : tone === "warning" ? tokens.warning : tokens.foregroundMuted;
  const contextBlock =
    layout.context && ratio !== null ? (
      <View style={block}>
        {rule}
        <View style={[blockBody, { flexDirection: "row", alignItems: "center", gap: GAP }]}>
          <View style={[slot, { height: m.slot }]}>
            <Icon name="Gauge" size={m.icon} color={compact ? contextColor : tokens.foregroundMuted} />
          </View>
          <View style={{ flex: 1, height: compact ? 3 : 2, borderRadius: 2, backgroundColor: tokens.surface2, overflow: "hidden" }}>
            <View style={{ width: `${Math.round(ratio * 100)}%`, height: "100%", backgroundColor: tone === "normal" ? tokens.foregroundMuted : contextColor }} />
          </View>
          <Text style={[text(compact ? 13 : 11, compact ? 22 : 16, contextColor), tabular]}>
            {strings.context} {Math.round(ratio * 100)}%
          </Text>
        </View>
      </View>
    ) : null;

  const subtasks = layout.subtasks ? (
    <View style={block}>
      {rule}
      <View style={{ paddingTop: compact ? 6 : 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((open) => !open)}
          style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: GAP, minHeight: compact ? 36 : undefined }}
        >
          <View style={{ width: m.slot, alignItems: "center" }}>
            <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={m.icon} color={tokens.foregroundMuted} />
          </View>
          <Text style={[text(m.rowSize, compact ? 22 : 18, tokens.foregroundMuted), tabular]}>
            {subtaskSummary(card.children, language)}
          </Text>
        </Pressable>
        {expanded ? (
          <View style={{ marginTop: compact ? 0 : 4 }}>
            {card.children.map((child) => (
              <SubtaskRow
                key={child.id}
                child={child}
                theme={theme}
                tokens={tokens}
                compact={compact}
                state={strings.status[child.status]}
                openLabel={strings.openInWorkspace}
                backdrop={background}
                animated={props.animated}
                onReveal={props.onReveal}
                onOpen={props.onOpen}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  ) : null;

  // Phone action bar -------------------------------------------------------
  const buttons = compact && layout.permission ? props.permissionButtons : [];
  const actionBar =
    compact && (buttons.length > 0 || canStop) ? (
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        {buttons.map((button) => (
          <ActionButton key={button.key} button={button} tokens={tokens} compact onPress={() => props.onPermission?.(card, button)} />
        ))}
        {canStop ? <StopControl {...stop} compact /> : null}
      </View>
    ) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={card.title}
      onPress={props.onOpen ? () => props.onOpen?.(card.id) : undefined}
      onLongPress={props.onDetails && (compact || TOUCH) ? () => props.onDetails?.(card) : undefined}
      delayLongPress={DETAILS_DELAY_MS}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      style={cardStyle}
      testID={`task-card-${card.id}`}
    >
      {parent}
      {header}
      {locationGroup}
      {compact ? null : footer}
      {failure}
      {permissionBlock}
      {contextBlock}
      {subtasks}
      {compact ? footer : null}
      {actionBar}
    </Pressable>
  );
}

function permissionIcon(kind: string): string {
  if (kind === "question" || kind === "other") return "MessageCircleQuestion";
  if (kind === "plan") return "ListChecks";
  if (kind === "mode") return "ShieldCheck";
  return "Terminal";
}

/**
 * A 1 px dashed rule from card edge to card edge. iOS draws no dashes on a
 * one-sided border, so the rule is the top edge of a dashed box clipped to 1 px.
 */
function DashedRule(props: { color: string; inset: number }) {
  return (
    <View style={{ height: 1, overflow: "hidden", marginHorizontal: -props.inset }}>
      <View style={{ height: 3, borderWidth: 1, borderStyle: "dashed", borderColor: props.color }} />
    </View>
  );
}

function GitStatus(props: {
  git: NonNullable<TaskCard["location"]["git"]>;
  tokens: TaskTokens;
  style: TextStyle;
  strings: ReturnType<typeof cardStrings>;
}) {
  const { git, tokens } = props;
  const arrows = [git.ahead !== null ? `↑${git.ahead}` : null, git.behind !== null ? `↓${git.behind}` : null].filter(Boolean).join(" ");
  if (!git.dirty && !arrows) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {git.dirty ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.warning }} /> : null}
      <Text style={[props.style, tabular]}>{[git.dirty ? props.strings.uncommitted : null, arrows || null].filter(Boolean).join(" ")}</Text>
    </View>
  );
}

function MoreChip(props: { tokens: TaskTokens; label: string; compact: boolean }) {
  const height = props.compact ? 22 : 18;
  return (
    <View
      style={{
        height,
        paddingHorizontal: props.compact ? 6 : 5,
        borderWidth: 1,
        borderColor: props.tokens.border,
        borderRadius: 3,
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Text style={[{ fontSize: props.compact ? 12 : 11, lineHeight: height - 2, color: props.tokens.foregroundMuted }, tabular]}>
        {props.label}
      </Text>
    </View>
  );
}

/** A permission answer or "去回答": an outlined pill, 24 high on desktop, 40 and evenly split on a phone. */
function ActionButton(props: { button: PermissionButton; tokens: TaskTokens; compact: boolean; onPress(): void }) {
  const { button, tokens, compact } = props;
  const { hovered, hoverProps } = useHover();
  const color = button.variant === "primary" ? tokens.accent : button.variant === "danger" ? tokens.danger : tokens.foreground;
  const border = button.variant === "secondary" ? tokens.border : color;
  const hoverFill = button.variant === "primary" ? tokens.accentSoft : button.variant === "danger" ? tokens.dangerSoft : tokens.surface2;
  const icon =
    button.kind === "open" ? null : button.action.behavior === "allow" ? "Check" : "X";
  const size = compact ? 16 : 12;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={button.label}
      onPress={props.onPress}
      {...hoverProps}
      style={{
        height: compact ? 40 : 24,
        flex: compact ? 1 : undefined,
        paddingHorizontal: compact ? 12 : 10,
        borderRadius: compact ? 20 : 999,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: hovered ? hoverFill : "transparent",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: compact ? 6 : 4,
        ...webTransition,
      }}
    >
      {icon ? <Icon name={icon} size={size} color={color} /> : null}
      <Text numberOfLines={1} style={{ fontSize: compact ? 15 : 12, fontWeight: "500", color }}>
        {button.label}
      </Text>
      {button.kind === "open" ? <Icon name="ArrowUpRight" size={size} color={color} /> : null}
    </Pressable>
  );
}

interface StopControlProps {
  tokens: TaskTokens;
  strings: ReturnType<typeof cardStrings>;
  phase: StopPhase;
  /** The armed stop includes the children. */
  all: boolean;
  parent: boolean;
  count: number;
  menuOpen: boolean;
  compact: boolean;
  onPress(): void;
  onToggleMenu(): void;
  onPick(withChildren: boolean): void;
}

/** Stop, its confirm state, and a parent's "only this / with subtasks" menu. */
function StopControl(props: StopControlProps) {
  const { tokens, strings, phase, compact } = props;
  const confirming = phase === "confirming";
  const stopping = phase === "stopping";
  const color = confirming ? tokens.danger : tokens.foreground;
  const border = confirming ? tokens.danger : tokens.border;
  const fill = confirming ? tokens.dangerSoft : compact ? "transparent" : tokens.surface0;
  const height = compact ? 40 : 22;
  const round = compact ? 20 : 999;
  const label = stopping ? strings.stopping : confirming ? (props.all ? strings.confirmStopAll : strings.confirmStop) : strings.stop;
  const segment: ViewStyle = {
    height,
    borderWidth: 1,
    borderColor: border,
    backgroundColor: fill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    ...webTransition,
  };
  return (
    <View style={{ flexDirection: "row", flex: compact ? 1 : undefined, flexShrink: 0, marginTop: compact ? 0 : -1, zIndex: 40 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={stopping}
        onPress={props.onPress}
        style={[
          segment,
          {
            flex: compact ? 1 : undefined,
            gap: compact ? 6 : 4,
            paddingHorizontal: compact ? 12 : 8,
            borderTopLeftRadius: round,
            borderBottomLeftRadius: round,
            borderTopRightRadius: props.parent ? 0 : round,
            borderBottomRightRadius: props.parent ? 0 : round,
            opacity: stopping ? 0.6 : 1,
          },
        ]}
      >
        <Icon name="Square" size={compact ? 13 : 10} color={color} />
        <Text numberOfLines={1} style={{ fontSize: compact ? 15 : 12, fontWeight: "500", color }}>
          {label}
        </Text>
      </Pressable>
      {props.parent ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.stopOptions}
          disabled={stopping}
          onPress={props.onToggleMenu}
          style={[
            segment,
            { width: compact ? 48 : 20, marginLeft: -1, borderTopRightRadius: round, borderBottomRightRadius: round },
          ]}
        >
          <Icon name={compact ? "ChevronUp" : "ChevronDown"} size={compact ? 16 : 12} color={color} />
        </Pressable>
      ) : null}
      {props.parent && props.menuOpen ? (
        <View
          style={{
            position: "absolute",
            right: 0,
            ...(compact ? { bottom: height + 6 } : { top: height + 4 }),
            width: compact ? 240 : 196,
            padding: 4,
            backgroundColor: tokens.surface0,
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: compact ? 10 : 8,
            boxShadow: tokens.popoverShadow,
          } as ViewStyle}
        >
          <MenuItem tokens={tokens} compact={compact} icon="Square" label={strings.stopOnlyThis} onPress={() => props.onPick(false)} />
          <MenuItem
            tokens={tokens}
            compact={compact}
            icon="ListTree"
            label={strings.stopWithChildren}
            count={props.count}
            onPress={() => props.onPick(true)}
          />
        </View>
      ) : null}
    </View>
  );
}

function MenuItem(props: { tokens: TaskTokens; compact: boolean; icon: string; label: string; count?: number; onPress(): void }) {
  const { tokens, compact } = props;
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="menuitem"
      onPress={props.onPress}
      {...hoverProps}
      style={{
        height: compact ? 44 : 30,
        flexDirection: "row",
        alignItems: "center",
        gap: compact ? 10 : 8,
        paddingHorizontal: compact ? 12 : 8,
        borderRadius: compact ? 6 : 5,
        backgroundColor: hovered ? tokens.surface1 : "transparent",
      }}
    >
      <Icon name={props.icon} size={compact ? 14 : 11} color={tokens.foregroundMuted} />
      <Text style={{ flex: 1, fontSize: compact ? 15 : 12, color: tokens.foreground }}>{props.label}</Text>
      {props.count !== undefined ? (
        <Text style={[{ fontSize: compact ? 15 : 12, color: tokens.foregroundMuted }, tabular]}>{props.count}</Text>
      ) : null}
    </Pressable>
  );
}

/** ArrowUpRight, 24 × 24 (36 on a phone); a tooltip after 400 ms of hover on desktop. */
function JumpButton(props: { tokens: TaskTokens; compact: boolean; label: string; onPress(): void }) {
  const { tokens, compact } = props;
  const { hovered, hoverProps } = useHover();
  const [tip, setTip] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);
  const size = compact ? 36 : 24;
  const lit = hovered && !compact;
  return (
    <View style={{ flexShrink: 0, margin: compact ? -7 : -3, marginRight: compact ? -10 : -6, marginLeft: 0, zIndex: 45 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.label}
        onPress={props.onPress}
        onHoverIn={() => {
          hoverProps.onHoverIn();
          if (compact) return;
          clear();
          timer.current = setTimeout(() => setTip(true), TOOLTIP_DELAY_MS);
        }}
        onHoverOut={() => {
          hoverProps.onHoverOut();
          clear();
          setTip(false);
        }}
        style={{
          width: size,
          height: size,
          borderRadius: compact ? 18 : 4,
          borderWidth: compact ? 0 : 1,
          borderColor: lit ? tokens.border : "transparent",
          backgroundColor: lit ? tokens.surface2 : "transparent",
          alignItems: "center",
          justifyContent: "center",
          ...webTransition,
        }}
      >
        <Icon name="ArrowUpRight" size={compact ? 18 : 14} color={lit ? tokens.foreground : tokens.foregroundMuted} />
      </Pressable>
      {tip ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: size + 6,
            right: 0,
            height: 26,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingLeft: 8,
            paddingRight: 6,
            backgroundColor: tokens.surface0,
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: 6,
            boxShadow: tokens.popoverShadow,
          } as ViewStyle}
        >
          <Text numberOfLines={1} style={{ fontSize: 12, color: tokens.foreground }}>
            {props.label}
          </Text>
          <View style={{ height: 16, paddingHorizontal: 4, borderWidth: 1, borderColor: tokens.border, borderRadius: 3, justifyContent: "center" }}>
            <Text style={{ fontSize: 11, lineHeight: 14, color: tokens.foregroundMuted }}>Enter</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** One expanded child: press reveals it on the board; the jump button opens its tab. */
function SubtaskRow(props: {
  child: TaskChild;
  theme: PluginTheme;
  tokens: TaskTokens;
  compact: boolean;
  state: string;
  openLabel: string;
  /** The card's fill, under the row's status icon while it is not hovered. */
  backdrop: string;
  animated?: boolean;
  onReveal(agentId: string): void;
  onOpen?(agentId: string): void;
}) {
  const { child, tokens, compact } = props;
  const { hovered, hoverProps } = useHover();
  const showJump = !!props.onOpen && (compact || TOUCH || hovered);
  const size = compact ? 32 : 22;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={child.title}
      onPress={() => props.onReveal(child.id)}
      {...hoverProps}
      style={{
        minHeight: compact ? 36 : 26,
        flexDirection: "row",
        alignItems: "center",
        gap: GAP,
        paddingVertical: 2,
        paddingLeft: compact ? 0 : 6,
        paddingRight: 2,
        marginHorizontal: compact ? 0 : -6,
        borderRadius: 4,
        backgroundColor: hovered && !compact ? tokens.surface2 : "transparent",
      }}
    >
      <StatusIcon
        kind={child.status}
        size={compact ? 20 : 16}
        height={compact ? 20 : 18}
        theme={props.theme}
        backdrop={hovered && !compact ? tokens.surface2 : props.backdrop}
        animated={props.animated}
      />
      <Text numberOfLines={2} style={{ flex: 1, fontSize: compact ? 14 : 12, lineHeight: compact ? 22 : 18, color: tokens.foreground }}>
        {child.title}
      </Text>
      <Text style={{ fontSize: compact ? 12 : 11, color: tokens.foregroundMuted }}>{props.state}</Text>
      {props.onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.openLabel}
          disabled={!showJump}
          onPress={() => props.onOpen?.(child.id)}
          style={{
            width: size,
            height: size,
            marginRight: compact ? -10 : 0,
            borderRadius: 4,
            alignItems: "center",
            justifyContent: "center",
            opacity: showJump ? 1 : 0,
          }}
        >
          <Icon name="ArrowUpRight" size={compact ? 16 : 14} color={tokens.foregroundMuted} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/**
 * The card re-renders for a tick of `now` only when the text it shows from
 * the clock changes: a running timer every second, a "5 分钟前" once a minute,
 * a card without a timer never. Every other prop compares by identity, so the
 * board passes stable callbacks and keeps a card object until it changes.
 */
export function sameCardProps(prev: TaskCardViewProps, next: TaskCardViewProps): boolean {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof TaskCardViewProps>;
  for (const key of keys) {
    if (key === "now") continue;
    if (prev[key] !== next[key]) return false;
  }
  if (prev.now === next.now) return true;
  if (!cardLayout(next.card, next.fields, next.compact).timer) return true;
  // The en and zh texts change at the same instants.
  return cardTimer(prev.card, prev.now, "en")?.text === cardTimer(next.card, next.now, "en")?.text;
}

export const TaskCardView = memo(TaskCardViewImpl, sameCardProps);
