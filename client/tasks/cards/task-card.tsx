import React, { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Platform, Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { labelLimitCount, type CardSettings } from "../../../shared/tasks-settings";
import { ProviderLogo } from "../../components/provider-logo";
import { useHover } from "../../ui/use-hover";
import type { PermissionButton, StopPhase } from "../actions";
import { useTasksLanguage, type TasksLanguage } from "../i18n";
import type { TaskCard, TaskChild } from "../model";
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
  /** Phone layout (`layout.compact`): must/default/details-only tiers, larger type and targets. */
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
/**
 * The card and a subtask row hold buttons of their own, so on web they must not
 * be buttons: React Native Web draws `role="button"` as a `<button>`, and a
 * `<button>` inside another is invalid HTML (React reports it, and Paseo shows
 * the error badge). As a `group` the Pressable is a focusable `<div>`: a click
 * on the body presses it, Enter on it while focused presses it (RNW's
 * PressResponder), and an inner button's click and keydown stop propagating
 * before they reach it. Native has no such nesting rule, and the responder
 * system gives a touch to the innermost Pressable, so it keeps the button role.
 */
const CONTAINER_ROLE = WEB ? ({ role: "group" } as const) : ({ accessibilityRole: "button" } as const);
const DETAILS_DELAY_MS = 450;
const TOOLTIP_DELAY_MS = 400;

// --- Geometry (Linear's issue card, measured on the desktop app) -------------

interface Metrics {
  padH: number;
  padTop: number;
  padBottom: number;
  /** Meta row: project, workspace, parent; muted, one line. */
  metaSize: number;
  metaLine: number;
  /** Meta row to title row. */
  titleGap: number;
  titleSize: number;
  titleLine: number;
  /** The status icon's slot; its box is two wider so the mark keeps the sidebar's 12 px. */
  iconSlot: number;
  iconBox: number;
  /** Title to pills, pills to footer, footer to a lane block. */
  rowGap: number;
  pillHeight: number;
  pillText: number;
  pillLine: number;
  pillPad: number;
  icon: number;
  footSize: number;
  footLine: number;
  /** Lane block text. */
  blockSize: number;
  blockLine: number;
  jump: number;
  jumpIcon: number;
  stopHeight: number;
  buttonHeight: number;
}

const DESKTOP: Metrics = {
  padH: 12,
  padTop: 10,
  padBottom: 12,
  metaSize: 12,
  metaLine: 16,
  titleGap: 5,
  titleSize: 13,
  titleLine: 18,
  iconSlot: 14,
  iconBox: 16,
  rowGap: 10,
  pillHeight: 24,
  pillText: 12,
  pillLine: 16,
  pillPad: 10,
  icon: 12,
  footSize: 12,
  footLine: 16,
  blockSize: 12,
  blockLine: 18,
  jump: 20,
  jumpIcon: 14,
  stopHeight: 20,
  buttonHeight: 28,
};

const PHONE: Metrics = {
  padH: 14,
  padTop: 12,
  padBottom: 14,
  metaSize: 13,
  metaLine: 18,
  titleGap: 6,
  titleSize: 16,
  titleLine: 22,
  iconSlot: 18,
  iconBox: 20,
  rowGap: 12,
  pillHeight: 28,
  pillText: 13,
  pillLine: 18,
  pillPad: 11,
  icon: 14,
  footSize: 13,
  footLine: 18,
  blockSize: 14,
  blockLine: 20,
  jump: 32,
  jumpIcon: 18,
  stopHeight: 40,
  buttonHeight: 40,
};

const GAP = 6;
const tabular: TextStyle = { fontVariant: ["tabular-nums"] };
const webTransition = (WEB
  ? { transitionProperty: "background-color, border-color, box-shadow, color, opacity", transitionDuration: "120ms", transitionTimingFunction: "ease-out" }
  : {}) as ViewStyle;

// --- What the card shows ----------------------------------------------------

/** The rows and pills a card draws for a field set; pure, so tier and collapse rules are testable. */
export interface CardLayout {
  /** The agent pill: brand mark, model and thinking, or the provider's name. */
  agent: boolean;
  brand: boolean;
  model: boolean;
  thinking: boolean;
  project: boolean;
  /** The 12 px avatar before the project: "image" is `projectIcon`, "letter" the outlined initial. */
  projectAvatar: "image" | "letter" | null;
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
 * switches say (status, title, agent, model, thinking, timer, actions,
 * permission, failure), lets the default tier follow them (project,
 * workspace, branch, first label, subtasks) and never draws the
 * details-only tier (folder, path, git status, PR, project icon).
 */
export function cardLayout(card: TaskCard, fields: CardSettings, compact: boolean): CardLayout {
  const location = card.location;
  const project = fields.project && !!location.projectName;
  const ratio = contextRatio(card.context);
  const path = !compact && fields.path && !!location.cwd;
  let projectAvatar: CardLayout["projectAvatar"] = null;
  if (project && !compact && fields.projectIcon) projectAvatar = location.projectIcon ? "image" : "letter";
  return {
    agent: compact || fields.provider || fields.model || fields.thinking,
    brand: card.providerMark !== null && (compact || fields.provider),
    model: !!card.modelLabel && (compact || fields.model),
    thinking: !!card.thinkingLabel && (compact || fields.thinking),
    project,
    projectAvatar,
    workspace: fields.workspace && !!location.workspaceName,
    branch: fields.branch && !!location.branch,
    gitStatus: !compact && fields.branch && fields.gitStatus && !!location.branch && location.git !== null,
    folder: !compact && !path && fields.folder && !!location.folder,
    path,
    pullRequest: !compact && fields.pullRequest && location.pullRequest !== null,
    labels: fields.labels ? card.labels.length : 0,
    labelLimit: compact ? 1 : labelLimitCount(fields.labelLimit),
    timer: compact || fields.timer,
    context: card.lane === "running" && ratio !== null && (compact ? ratio > 0.8 : fields.context),
    subtasks: fields.subtasks && card.children.length > 0,
    // Review: a failure or a manual stop. Done: the board's "Stopped manually" after a stop the daemon filed as idle.
    failure: (card.lane === "review" || card.lane === "done") && !!card.error,
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

/** Children that finished: done, or done but not yet looked at. */
function finishedChildren(card: TaskCard): number {
  return card.children.filter((child) => child.status === "done" || child.status === "unread").length;
}

// --- Overlays and control hover ----------------------------------------------

/**
 * RNW gives every View `position: relative; z-index: 0`, so each one is a
 * stacking context: an overlay's own zIndex only counts inside its row, and a
 * later sibling row (transparent, but still a hit target) sits above it. The
 * rows that hold overlays (the stop menu and the jump tooltip, the phone
 * action bar's menu) are therefore raised above the rows after them.
 */
export const OVERLAY_ROW_Z = 2;

/** A control tells its card whether the pointer is on it; `key` is the control's own. */
export type ControlHover = (key: string, on: boolean) => void;

let nextControl = 0;

/**
 * A control's hover, reported to the card so the details popover waits for
 * the body. Pass `rowRef` for a control that holds another (a subtask row):
 * on web it then takes the DOM's hover, which RNW's hover lock cannot end.
 */
function useControlHover(report: ControlHover | undefined, rowRef?: React.RefObject<unknown>) {
  const [key] = useState(() => `control-${nextControl++}`);
  const hover = useHover(rowRef);
  const { hovered } = hover;
  useEffect(() => {
    if (hovered) report?.(key, true);
    return () => report?.(key, false);
  }, [report, key, hovered]);
  return hover;
}

// --- The card -----------------------------------------------------------------

function TaskCardViewImpl(props: TaskCardViewProps) {
  const { card, fields, compact, theme } = props;
  const tokens = taskTokens(theme);
  const look = tokens.card;
  const preferred = useTasksLanguage();
  const language = props.language ?? preferred;
  const strings = cardStrings(language);
  const m = compact ? PHONE : DESKTOP;
  const layout = cardLayout(card, fields, compact);
  // On web the hover is the DOM's, child controls included (`bindRowHover`):
  // RNW's Pressable ends an ancestor's hover as soon as the pointer enters an
  // inner Pressable (its `hover:lock` event), which dropped the Stop button
  // the moment the pointer reached it. Native keeps the Pressable's own hover.
  const rootRef = useRef<View>(null);
  const { hovered, hoverProps } = useHover(rootRef);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stopAll, setStopAll] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const detailsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** This card asked for the popover, so it may ask to close it (the board closes whichever is open). */
  const detailsShown = useRef(false);

  const latest = useRef(props);
  latest.current = props;
  const clearDetails = () => {
    if (detailsTimer.current) clearTimeout(detailsTimer.current);
    detailsTimer.current = null;
  };

  // The card's own controls report their hover here: the popover is for the
  // card body, not for a pointer resting on Stop, the menu or a button.
  const controls = useRef(new Set<string>());
  const [overControl, setOverControl] = useState(false);
  const reportControl = useCallback<ControlHover>((key, on) => {
    if (on) controls.current.add(key);
    else controls.current.delete(key);
    setOverControl(controls.current.size > 0);
  }, []);

  const parentHover = useControlHover(reportControl);

  // Leaving the card closes the menu and cancels an armed stop.
  const wasHovered = useRef(false);
  useEffect(() => {
    if (hovered === wasHovered.current) return;
    wasHovered.current = hovered;
    if (hovered) return;
    const current = latest.current;
    controls.current.clear();
    setOverControl(false);
    setMenuOpen(false);
    if (current.stopPhase === "confirming") current.onCancelStop?.(current.card.id);
  }, [hovered]);

  // The details popover: 450 ms of hover on the body, never while the pointer
  // is on a control, the stop menu is open or a stop is armed or running.
  const detailsWanted =
    hovered && !overControl && !menuOpen && props.stopPhase === "idle" && !!props.onDetails && !compact;
  useEffect(() => {
    if (!detailsWanted) return;
    detailsTimer.current = setTimeout(() => {
      detailsTimer.current = null;
      detailsShown.current = true;
      latest.current.onDetails?.(latest.current.card);
    }, DETAILS_DELAY_MS);
    return () => {
      clearDetails();
      if (detailsShown.current) {
        detailsShown.current = false;
        latest.current.onDetailsEnd?.(latest.current.card.id);
      }
    };
  }, [detailsWanted]);

  const background = props.highlighted ? look.highlight : look.background;
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
    report: reportControl,
    onPick: pressStop,
  };

  const shadows = [hovered ? look.shadowHover : look.shadow];
  if (props.focused) shadows.push(`0px 0px 0px 3px ${tokens.accentRing}`);
  const cardStyle = {
    paddingHorizontal: m.padH,
    paddingTop: m.padTop,
    paddingBottom: m.padBottom,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: props.focused || props.highlighted ? tokens.accent : hovered ? look.borderHover : look.border,
    backgroundColor: background,
    boxShadow: shadows.join(", "),
    zIndex: menuOpen ? 30 : hovered ? 2 : 1,
    ...webTransition,
  } as ViewStyle;

  const text = (size: number, line: number, color: string, weight: TextStyle["fontWeight"] = "400"): TextStyle => ({
    fontSize: size,
    lineHeight: line,
    color,
    fontWeight: weight,
  });
  const muted = tokens.foregroundMuted;
  const block: ViewStyle = {
    marginTop: m.rowGap,
    paddingTop: m.rowGap,
    borderTopWidth: 1,
    borderTopColor: look.border,
  };

  // Controls: Stop (hover, confirming) and the jump button, on the meta row,
  // or on the title row when the meta row has nothing to say.
  const location = card.location;
  const metaParts: string[] = [];
  if (layout.project && location.projectName) metaParts.push(location.projectName);
  if (layout.workspace && location.workspaceName) metaParts.push(location.workspaceName);
  const metaText = metaParts.join(" › ");
  const hasMeta = metaText !== "" || card.parent !== null;
  const controlsFor = (line: number) => (
    <>
      {showStop ? <StopControl {...stop} compact={false} line={line} /> : null}
      {props.onOpen ? (
        <JumpButton
          report={reportControl}
          tokens={tokens}
          compact={compact}
          line={line}
          label={strings.openInWorkspace}
          onPress={() => props.onOpen?.(card.id)}
        />
      ) : null}
    </>
  );

  // Meta row ---------------------------------------------------------------
  const avatar = layout.projectAvatar;
  const metaStyle = text(m.metaSize, m.metaLine, muted);
  const parentLabel = card.parent
    ? card.parent.missing
      ? strings.parentArchived
      : card.parent.title ?? strings.parentUnknown
    : null;
  const metaRow = hasMeta ? (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: GAP, minHeight: m.metaLine, zIndex: OVERLAY_ROW_Z }}
      testID="task-card-meta"
    >
      {avatar === "image" ? (
        <Image source={{ uri: location.projectIcon! }} style={{ width: 12, height: 12, borderRadius: 3 }} />
      ) : avatar === "letter" ? (
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 3,
            borderWidth: 1,
            borderColor: muted,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 8, lineHeight: 10, fontWeight: "600", color: muted }}>
            {(location.projectName ?? "?").slice(0, 1).toUpperCase()}
          </Text>
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}>
        {metaText ? (
          <Text numberOfLines={1} style={[metaStyle, { flexShrink: 1 }]}>
            {metaText}
          </Text>
        ) : null}
        {parentLabel !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.revealParent}
            onPress={() => props.onReveal(card.parent!.id)}
            {...parentHover.hoverProps}
            style={{ flexShrink: 1, minWidth: 0 }}
          >
            <Text numberOfLines={1} style={[metaStyle, parentHover.hovered ? { color: tokens.foreground } : null]}>
              {metaText ? " › " : ""}
              {"↳ "}
              {parentLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {controlsFor(m.metaLine)}
    </View>
  ) : null;

  // Title row --------------------------------------------------------------
  const titleRow = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: GAP,
        marginTop: hasMeta ? m.titleGap : 0,
        zIndex: hasMeta ? undefined : OVERLAY_ROW_Z,
      }}
      testID="task-card-title-row"
    >
      <View style={{ width: m.iconSlot, alignItems: "center" }}>
        <StatusIcon
          kind={card.status}
          size={m.iconBox}
          height={m.titleLine}
          theme={theme}
          backdrop={background}
          animated={props.animated}
        />
      </View>
      <Text
        numberOfLines={2}
        ellipsizeMode="tail"
        style={[text(m.titleSize, m.titleLine, tokens.foreground, "500"), { flex: 1 }]}
        testID="task-card-title"
      >
        {card.title}
      </Text>
      {hasMeta ? null : controlsFor(m.titleLine)}
    </View>
  );

  // Pills ------------------------------------------------------------------
  const pill = { tokens, compact };
  const pills: ReactNode[] = [];
  if (layout.agent) {
    const parts: string[] = [];
    if (layout.model && card.modelLabel) parts.push(card.modelLabel);
    if (layout.thinking && card.thinkingLabel) parts.push(card.thinkingLabel);
    pills.push(
      <Pill
        key="agent"
        {...pill}
        testID="pill-agent"
        lead={layout.brand ? <ProviderLogo provider={card.provider} size={m.icon} /> : undefined}
        label={parts.length ? parts.join(" · ") : card.providerLabel}
        accessibilityLabel={[card.providerLabel, ...parts].join(" · ")}
      />,
    );
  }
  if (layout.branch && location.branch) {
    pills.push(
      <Pill key="branch" {...pill} testID="pill-branch" icon="GitBranch" label={location.branch}>
        {layout.gitStatus && location.git ? (
          <GitStatus git={location.git} tokens={tokens} size={m.pillText} line={m.pillLine} strings={strings} />
        ) : null}
      </Pill>,
    );
  }
  if (layout.path) {
    pills.push(<Pill key="path" {...pill} testID="pill-path" icon="FolderOpen" label={location.cwd} />);
  } else if (layout.folder && location.folder) {
    pills.push(<Pill key="folder" {...pill} testID="pill-folder" icon="Folder" label={location.folder} />);
  }
  if (layout.labels > 0) {
    const shown = card.labels.slice(0, layout.labelLimit);
    for (const label of shown) {
      pills.push(
        <Pill
          key={`label-${label.name}`}
          {...pill}
          testID={`pill-label-${label.name}`}
          dot={label.color ?? tokens.foregroundMuted}
          label={label.name}
        />,
      );
    }
    const hidden = card.labels.length - shown.length;
    if (hidden > 0) {
      pills.push(
        <Pill
          key="labels-more"
          {...pill}
          testID="pill-labels-more"
          label={`+${hidden}`}
          tabular
          accessibilityLabel={card.labels
            .slice(shown.length)
            .map((label) => label.name)
            .join(", ")}
        />,
      );
    }
  }
  if (layout.pullRequest && location.pullRequest) {
    const pr = location.pullRequest;
    pills.push(
      <Pill
        key="pr"
        {...pill}
        testID="pill-pr"
        icon="GitPullRequest"
        label={pr.number !== null ? `#${pr.number}` : pr.title}
        tabular
        accessibilityLabel={pr.number !== null ? `#${pr.number} ${pr.title}` : pr.title}
      />,
    );
  }
  const ratio = contextRatio(card.context);
  if (layout.context && ratio !== null) {
    const tone = contextTone(ratio);
    const color = tone === "danger" ? tokens.danger : tone === "warning" ? tokens.warning : muted;
    const percent = `${Math.round(ratio * 100)}%`;
    pills.push(
      <Pill
        key="context"
        {...pill}
        testID="pill-context"
        icon="Gauge"
        color={color}
        label={percent}
        tabular
        accessibilityLabel={`${strings.context} ${percent}`}
      />,
    );
  }
  if (layout.subtasks) {
    pills.push(
      <PillButton
        key="subtasks"
        {...pill}
        testID="pill-subtasks"
        icon="ListTree"
        label={`${finishedChildren(card)}/${card.children.length}`}
        tabular
        accessibilityLabel={subtaskSummary(card.children, language)}
        expanded={expanded}
        report={reportControl}
        onPress={() => setExpanded((open) => !open)}
      />,
    );
  }
  const pillRow =
    pills.length > 0 ? (
      <View
        style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 4, rowGap: 6, marginTop: m.rowGap }}
        testID="task-card-pills"
      >
        {pills}
      </View>
    ) : null;

  // Footer -----------------------------------------------------------------
  const timer = layout.timer ? cardTimer(card, props.now, language) : null;
  const timerColor =
    timer?.tone === "warning" ? tokens.status.warning : timer?.tone === "running" ? tokens.status.running : muted;
  const footer = timer ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: m.rowGap }} testID="task-card-footer">
      {timer.tone === "warning" ? <Icon name="Clock" size={m.icon} color={timerColor} /> : null}
      <Text style={[text(m.footSize, m.footLine, timerColor), tabular]}>{timer.text}</Text>
    </View>
  ) : null;

  // Lane blocks ------------------------------------------------------------
  const iconCell: ViewStyle = { width: m.iconSlot, height: m.blockLine, alignItems: "center", justifyContent: "center" };
  const failed = card.status === "failed";
  const failure = layout.failure ? (
    <View style={[block, { flexDirection: "row", alignItems: "flex-start", gap: GAP }]} testID="task-card-reason">
      <View style={iconCell}>
        <Icon name={failed ? "CircleX" : "Square"} size={m.icon} color={failed ? tokens.danger : muted} />
      </View>
      <Text style={[text(m.blockSize, m.blockLine, failed ? tokens.danger : muted), { flex: 1 }]}>{card.error}</Text>
    </View>
  ) : null;

  const permission = card.permission;
  const asksQuestion = permission?.kind === "question" || permission?.kind === "other";
  const permissionBlock =
    layout.permission && permission ? (
      <View style={[block, { gap: 8 }]} testID="task-card-permission">
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: GAP }}>
          <View style={iconCell}>
            <Icon name={permissionIcon(permission.kind)} size={m.icon + 1} color={tokens.status.warning} />
          </View>
          <Text numberOfLines={2} style={[text(m.blockSize, m.blockLine, tokens.foreground), { flex: 1 }]}>
            <Text style={{ fontWeight: asksQuestion ? "500" : "600" }}>{permission.title}</Text>
            {permission.summary ? <Text style={{ color: muted }}> · </Text> : null}
            {permission.summary}
          </Text>
          {permission.remaining > 0 ? (
            <Text style={[text(m.blockSize - 1, m.blockLine, muted), tabular]}>{strings.more(permission.remaining)}</Text>
          ) : null}
        </View>
        {!compact && props.permissionButtons.length > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: GAP, paddingLeft: m.iconSlot + GAP }}>
            {props.permissionButtons.map((button) => (
              <ActionButton
                report={reportControl}
                key={button.key}
                button={button}
                tokens={tokens}
                compact={false}
                onPress={() => props.onPermission?.(card, button)}
              />
            ))}
          </View>
        ) : null}
      </View>
    ) : null;

  const subtaskList =
    layout.subtasks && expanded ? (
      <View style={[block, { paddingTop: m.rowGap - 4 }]} testID="task-card-subtasks">
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
            report={reportControl}
            onReveal={props.onReveal}
            onOpen={props.onOpen}
          />
        ))}
      </View>
    ) : null;

  // Phone action bar -------------------------------------------------------
  const buttons = compact && layout.permission ? props.permissionButtons : [];
  const actionBar =
    compact && (buttons.length > 0 || canStop) ? (
      <View style={{ flexDirection: "row", gap: 8, marginTop: m.rowGap, zIndex: OVERLAY_ROW_Z }} testID="task-card-actions">
        {buttons.map((button) => (
          <ActionButton
            key={button.key}
            report={reportControl}
            button={button}
            tokens={tokens}
            compact
            onPress={() => props.onPermission?.(card, button)}
          />
        ))}
        {canStop ? <StopControl {...stop} compact line={m.stopHeight} /> : null}
      </View>
    ) : null;

  return (
    <Pressable
      {...CONTAINER_ROLE}
      accessibilityLabel={card.title}
      onPress={props.onOpen ? () => props.onOpen?.(card.id) : undefined}
      onLongPress={props.onDetails && (compact || TOUCH) ? () => props.onDetails?.(card) : undefined}
      delayLongPress={DETAILS_DELAY_MS}
      ref={rootRef}
      {...(WEB ? null : hoverProps)}
      style={cardStyle}
      testID={`task-card-${card.id}`}
    >
      {metaRow}
      {titleRow}
      {pillRow}
      {footer}
      {permissionBlock}
      {failure}
      {subtaskList}
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

// --- Pills ------------------------------------------------------------------

interface PillProps {
  tokens: TaskTokens;
  compact: boolean;
  label: string;
  /** A Lucide icon before the text. */
  icon?: string;
  /** An 8 px dot before the text (a label's colour). */
  dot?: string;
  /** Any other leading mark (the agent's brand). */
  lead?: ReactNode;
  /** Text and icon colour; muted by default. */
  color?: string;
  tabular?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  children?: ReactNode;
}

/** Linear's property pill: 24 high (28 on a phone), fully rounded, a hairline outline and no fill. */
export function pillStyle(tokens: TaskTokens, compact: boolean): ViewStyle {
  const m = compact ? PHONE : DESKTOP;
  return {
    height: m.pillHeight,
    minWidth: m.pillHeight,
    maxWidth: "100%",
    borderRadius: m.pillHeight / 2,
    borderWidth: 1,
    borderColor: tokens.card.pillBorder,
    paddingHorizontal: m.pillPad,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: compact ? 7 : 6,
  };
}

function PillContent(props: PillProps) {
  const m = props.compact ? PHONE : DESKTOP;
  const color = props.color ?? props.tokens.foregroundMuted;
  return (
    <>
      {props.lead ?? null}
      {props.icon ? <Icon name={props.icon} size={m.icon} color={color} /> : null}
      {props.dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: props.dot }} /> : null}
      <Text
        numberOfLines={1}
        style={[{ fontSize: m.pillText, lineHeight: m.pillLine, color, flexShrink: 1 }, props.tabular ? tabular : null]}
      >
        {props.label}
      </Text>
      {props.children}
    </>
  );
}

function Pill(props: PillProps) {
  return (
    <View style={pillStyle(props.tokens, props.compact)} testID={props.testID} accessibilityLabel={props.accessibilityLabel}>
      <PillContent {...props} />
    </View>
  );
}

function PillButton(props: PillProps & { expanded: boolean; report?: ControlHover; onPress(): void }) {
  const { hovered, hoverProps } = useControlHover(props.report);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ expanded: props.expanded }}
      onPress={props.onPress}
      {...hoverProps}
      testID={props.testID}
      style={[
        pillStyle(props.tokens, props.compact),
        { backgroundColor: hovered || props.expanded ? props.tokens.card.controlHover : "transparent" },
        webTransition,
      ]}
    >
      <PillContent {...props} color={hovered ? props.tokens.foreground : props.color} />
    </Pressable>
  );
}

function GitStatus(props: {
  git: NonNullable<TaskCard["location"]["git"]>;
  tokens: TaskTokens;
  size: number;
  line: number;
  strings: ReturnType<typeof cardStrings>;
}) {
  const { git, tokens } = props;
  const arrows = [git.ahead !== null ? `↑${git.ahead}` : null, git.behind !== null ? `↓${git.behind}` : null]
    .filter(Boolean)
    .join(" ");
  if (!git.dirty && !arrows) return null;
  return (
    <>
      {git.dirty ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.warning }} /> : null}
      <Text style={[{ fontSize: props.size, lineHeight: props.line, color: tokens.foregroundMuted }, tabular]}>
        {[git.dirty ? props.strings.uncommitted : null, arrows || null].filter(Boolean).join(" ")}
      </Text>
    </>
  );
}

// --- Buttons ------------------------------------------------------------------

/** A permission answer or "go answer": 28 high, radius 6; 40 and evenly split on a phone. */
function ActionButton(props: {
  button: PermissionButton;
  tokens: TaskTokens;
  compact: boolean;
  report?: ControlHover;
  onPress(): void;
}) {
  const { button, tokens, compact } = props;
  const look = tokens.card;
  const { hovered, hoverProps } = useControlHover(props.report);
  const primary = button.variant === "primary";
  const danger = button.variant === "danger";
  const color = primary ? tokens.accent : danger ? tokens.danger : tokens.foreground;
  let fill = hovered ? look.controlHover : "transparent";
  if (primary) fill = hovered ? look.primaryFillHover : look.primaryFill;
  if (danger) fill = hovered ? look.dangerFillHover : look.dangerFill;
  const icon = button.kind === "open" ? null : button.action.behavior === "allow" ? "Check" : "X";
  const size = compact ? 16 : 13;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={button.label}
      onPress={props.onPress}
      {...hoverProps}
      style={{
        height: compact ? PHONE.buttonHeight : DESKTOP.buttonHeight,
        flex: compact ? 1 : undefined,
        paddingHorizontal: compact ? 14 : 10,
        borderRadius: compact ? 8 : 6,
        borderWidth: 1,
        borderColor: primary || danger ? fill : look.pillBorder,
        backgroundColor: fill,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: compact ? 6 : 5,
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
  /** The line it sits on, so it centres without growing the row. */
  line: number;
  onPress(): void;
  onToggleMenu(): void;
  onPick(withChildren: boolean): void;
  report?: ControlHover;
}

/** Stop, its confirm state, and a parent's "only this / with subtasks" menu. */
function StopControl(props: StopControlProps) {
  const { tokens, strings, phase, compact } = props;
  const look = tokens.card;
  const confirming = phase === "confirming";
  const stopping = phase === "stopping";
  const stopHover = useControlHover(props.report);
  const chevronHover = useControlHover(props.report);
  const color = confirming ? tokens.danger : tokens.foreground;
  const border = confirming ? tokens.danger : look.pillBorder;
  const fill = (hovered: boolean) =>
    confirming ? (hovered ? look.dangerFillHover : look.dangerFill) : hovered ? look.controlHover : look.background;
  const height = compact ? PHONE.stopHeight : DESKTOP.stopHeight;
  const round = compact ? 8 : height / 2;
  const label = stopping ? strings.stopping : confirming ? (props.all ? strings.confirmStopAll : strings.confirmStop) : strings.stop;
  const segment: ViewStyle = {
    height,
    borderWidth: 1,
    borderColor: border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    ...webTransition,
  };
  return (
    <View
      style={{
        flexDirection: "row",
        flex: compact ? 1 : undefined,
        flexShrink: 0,
        marginVertical: compact ? 0 : (props.line - height) / 2,
        zIndex: 40,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={stopping}
        onPress={props.onPress}
        {...stopHover.hoverProps}
        style={[
          segment,
          {
            flex: compact ? 1 : undefined,
            gap: compact ? 6 : 4,
            paddingHorizontal: compact ? 14 : 8,
            backgroundColor: fill(stopHover.hovered),
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
          {...chevronHover.hoverProps}
          style={[
            segment,
            {
              width: compact ? 44 : 20,
              marginLeft: -1,
              backgroundColor: fill(chevronHover.hovered || props.menuOpen),
              borderTopRightRadius: round,
              borderBottomRightRadius: round,
            },
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
            width: compact ? 240 : 200,
            padding: 4,
            backgroundColor: look.background,
            borderWidth: 1,
            borderColor: look.border,
            borderRadius: 8,
            boxShadow: tokens.popoverShadow,
          } as ViewStyle}
        >
          <MenuItem
            report={props.report}
            tokens={tokens}
            compact={compact}
            icon="Square"
            label={strings.stopOnlyThis}
            onPress={() => props.onPick(false)}
          />
          <MenuItem
            report={props.report}
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

function MenuItem(props: {
  tokens: TaskTokens;
  compact: boolean;
  icon: string;
  label: string;
  count?: number;
  report?: ControlHover;
  onPress(): void;
}) {
  const { tokens, compact } = props;
  const { hovered, hoverProps } = useControlHover(props.report);
  return (
    <Pressable
      accessibilityRole="menuitem"
      onPress={props.onPress}
      {...hoverProps}
      style={{
        height: compact ? 44 : 28,
        flexDirection: "row",
        alignItems: "center",
        gap: compact ? 10 : 8,
        paddingHorizontal: compact ? 12 : 8,
        borderRadius: compact ? 6 : 4,
        backgroundColor: hovered ? tokens.card.controlHover : "transparent",
      }}
    >
      <Icon name={props.icon} size={compact ? 14 : 12} color={tokens.foregroundMuted} />
      <Text style={{ flex: 1, fontSize: compact ? 15 : 12, color: tokens.foreground }}>{props.label}</Text>
      {props.count !== undefined ? (
        <Text style={[{ fontSize: compact ? 15 : 12, color: tokens.foregroundMuted }, tabular]}>{props.count}</Text>
      ) : null}
    </Pressable>
  );
}

/** ArrowUpRight, 20 x 20 (32 on a phone), where Linear puts the assignee; a tooltip after 400 ms of hover. */
function JumpButton(props: {
  tokens: TaskTokens;
  compact: boolean;
  /** The line it sits on, so it centres without growing the row. */
  line: number;
  label: string;
  report?: ControlHover;
  onPress(): void;
}) {
  const { tokens, compact } = props;
  const { hovered, hoverProps } = useControlHover(props.report);
  const [tip, setTip] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);
  const size = compact ? PHONE.jump : DESKTOP.jump;
  const lit = hovered && !compact;
  return (
    <View
      style={{
        flexShrink: 0,
        marginVertical: (props.line - size) / 2,
        marginRight: compact ? -8 : -4,
        zIndex: 45,
      }}
    >
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
          borderRadius: compact ? size / 2 : 5,
          backgroundColor: lit ? tokens.card.controlHover : "transparent",
          alignItems: "center",
          justifyContent: "center",
          ...webTransition,
        }}
      >
        <Icon
          name="ArrowUpRight"
          size={compact ? PHONE.jumpIcon : DESKTOP.jumpIcon}
          color={lit ? tokens.foreground : tokens.foregroundMuted}
        />
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
            backgroundColor: tokens.card.background,
            borderWidth: 1,
            borderColor: tokens.card.border,
            borderRadius: 6,
            boxShadow: tokens.popoverShadow,
          } as ViewStyle}
        >
          <Text numberOfLines={1} style={{ fontSize: 12, color: tokens.foreground }}>
            {props.label}
          </Text>
          <View
            style={{ height: 16, paddingHorizontal: 4, borderWidth: 1, borderColor: tokens.card.border, borderRadius: 3, justifyContent: "center" }}
          >
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
  report?: ControlHover;
  onReveal(agentId: string): void;
  onOpen?(agentId: string): void;
}) {
  const { child, tokens, compact } = props;
  const m = compact ? PHONE : DESKTOP;
  // DOM hover on web, as the card: the row's own Pressable hover would end
  // when the pointer reaches its jump button, and hide it.
  const rowRef = useRef<View>(null);
  const { hovered, hoverProps } = useControlHover(props.report, rowRef);
  const showJump = !!props.onOpen && (compact || TOUCH || hovered);
  const fill = hovered && !compact ? tokens.card.controlHover : props.backdrop;
  const size = compact ? 32 : 22;
  return (
    <Pressable
      {...CONTAINER_ROLE}
      accessibilityLabel={child.title}
      onPress={() => props.onReveal(child.id)}
      ref={rowRef}
      {...(WEB ? null : hoverProps)}
      style={{
        minHeight: compact ? 36 : 28,
        flexDirection: "row",
        alignItems: "center",
        gap: GAP,
        paddingVertical: 2,
        paddingLeft: 6,
        paddingRight: 2,
        marginHorizontal: -6,
        borderRadius: 6,
        backgroundColor: fill,
        ...webTransition,
      }}
    >
      <View style={{ width: m.iconSlot, alignItems: "center" }}>
        <StatusIcon kind={child.status} size={m.iconBox} height={m.blockLine} theme={props.theme} backdrop={fill} animated={props.animated} />
      </View>
      <Text numberOfLines={2} style={{ flex: 1, fontSize: m.blockSize, lineHeight: m.blockLine, color: tokens.foreground }}>
        {child.title}
      </Text>
      <Text style={{ fontSize: m.metaSize, color: tokens.foregroundMuted }}>{props.state}</Text>
      {props.onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.openLabel}
          disabled={!showJump}
          onPress={() => props.onOpen?.(child.id)}
          style={{
            width: size,
            height: size,
            marginRight: compact ? -8 : 0,
            borderRadius: 5,
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
 * the clock changes: a running timer every second, "5 min ago" once a minute,
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
