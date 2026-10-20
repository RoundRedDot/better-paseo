import React, { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { labelLimitCount, type CardSettings } from "../../../shared/tasks-settings";
import { useHover } from "../../ui/use-hover";
import type { PermissionButton, StopPhase } from "../actions";
import { useTasksLanguage, type TasksLanguage } from "../i18n";
import type { StatusKind, TaskCard, TaskChild } from "../model";
import {
  contextRatio,
  formatApprox,
  formatDuration,
  formatRelative,
  formatWait,
  since,
  tildePath,
} from "./format";
import { ContextRing, contextRingTone, formatSessionCost, formatTokenCount } from "./context-ring";
import { agentPillColors, BrandMark, neutralPillColors, tintedPillColors, type AgentPillColors } from "./brand-mark";
import { THINKING_ICON } from "./mode-icons";
import { ProjectIcon } from "./project-icon";
import { StatusIcon } from "./status-icon";
import { cardStrings, subtaskSummary } from "./strings";
import { pillTint, taskTokens, type TaskTokens } from "./tokens";
import { mix, withAlpha } from "../../components/theme-tokens";

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
  /** The host's id: with the project id it keys the project icon's colour, as Paseo's sidebar does. */
  hostId?: string;
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
const NBSP = "\u00a0";
/** " > " between meta segments; non-breaking, since a web text box drops a leading space. */
const SEPARATOR = `${NBSP}\u203a${NBSP}`;
const PARENT_SHRINK = 1000;
/** How far the jump button reaches past the row's end (its negative right margin), desktop and phone. */
const JUMP_OVERHANG = [-4, -8] as const;
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
  /** The model pill: brand mark (`brand`) and the model, or the provider's name when the model is off or unknown. */
  modelPill: boolean;
  brand: boolean;
  model: boolean;
  thinking: boolean;
  project: boolean;
  /** Paseo's project icon before the project name: its image, or the generated initial square. */
  projectAvatar: boolean;
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
  const projectAvatar = project && !compact && fields.projectIcon;
  return {
    modelPill: compact || fields.provider || fields.model,
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

/** The subtasks pill's groups, most urgent first. */
const SUBTASK_ORDER: readonly StatusKind[] = ["needs_input", "running", "failed", "unread", "done"];

/** A status's colour for a tint: the StatusIcon band for running, the theme's status roles otherwise. */
function statusTint(kind: StatusKind, tokens: TaskTokens): string | null {
  if (kind === "running") return tokens.status.running;
  if (kind === "needs_input") return tokens.warning;
  if (kind === "failed") return tokens.danger;
  if (kind === "unread") return tokens.success;
  return null;
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
  const [ringOpen, setRingOpen] = useState(false);
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

  /** The card's fill right now: the highlight, the hover grey, or the card. */
  const background = props.highlighted ? look.highlight : hovered ? look.hoverBackground : look.background;
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
    // Linear's card: radius 6, a hairline, and on hover only the fill and shadow change.
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: props.focused || props.highlighted ? tokens.accent : look.border,
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
  const metaText = metaParts.join(SEPARATOR);
  const hasMeta = metaText !== "" || card.parent !== null;
  // On web Stop appears on hover, so it floats over the row's end (the card's
  // fill behind it hides the text it covers) instead of taking room from the
  // row: hovering must not move anything. Native shows it all the time, in flow.
  const jumpSlot = props.onOpen ? m.jump + JUMP_OVERHANG[compact ? 1 : 0] + GAP : 0;
  const controlsFor = (line: number) => (
    <>
      {showStop && TOUCH ? <StopControl {...stop} compact={false} line={line} /> : null}
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
      {/* Last, so it adds nothing before an in-flow element. */}
      {showStop && !TOUCH ? (
        <View
          style={{
            position: "absolute",
            right: jumpSlot,
            top: (line - m.stopHeight) / 2,
            paddingLeft: GAP,
            backgroundColor: background,
          }}
          testID="task-card-stop-overlay"
        >
          <StopControl {...stop} compact={false} line={m.stopHeight} />
        </View>
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
      {avatar ? <ProjectIcon location={location} size={12} hostId={props.hostId} /> : null}
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}>
        {metaText ? (
          <Text numberOfLines={1} style={[metaStyle, { flexShrink: 1, minWidth: 0 }]} testID="task-card-meta-location">
            {metaText}
          </Text>
        ) : null}
        {metaText && parentLabel !== null ? (
          <Text style={[metaStyle, { flexShrink: 0 }]}>{SEPARATOR}</Text>
        ) : null}
        {parentLabel !== null ? (
          // The parent link gives way first: it shrinks a thousand times faster
          // than "project > workspace", which only truncates once the link is gone.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.revealParent}
            onPress={() => props.onReveal(card.parent!.id)}
            {...parentHover.hoverProps}
            style={{ flexShrink: PARENT_SHRINK, minWidth: 0 }}
            testID="task-card-meta-parent"
          >
            <Text numberOfLines={1} style={[metaStyle, parentHover.hovered ? { color: tokens.foreground } : null]}>
              {`↳${NBSP}${parentLabel}`}
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
  // Model and thinking as the composer shows them: two items, each with its icon,
  // in the brand's borderless status-pill colours.
  const agentColors = agentPillColors(tokens, card.provider);
  if (layout.modelPill) {
    const model = layout.model && card.modelLabel ? card.modelLabel : card.providerLabel;
    pills.push(
      <Pill
        key="model"
        {...pill}
        testID="pill-model"
        solid={agentColors}
        lead={layout.brand ? <BrandMark provider={card.provider} size={m.icon} tokens={tokens} /> : undefined}
        label={model}
        accessibilityLabel={model === card.providerLabel ? model : `${card.providerLabel} ${model}`}
      />,
    );
  }
  if (layout.thinking && card.thinkingLabel) {
    pills.push(
      <Pill
        key="thinking"
        {...pill}
        testID="pill-thinking"
        solid={neutralPillColors(tokens, muted)}
        icon={THINKING_ICON}
        label={card.thinkingLabel}
      />,
    );
  }
  if (layout.branch && location.branch) {
    pills.push(
      // The branch wears the host theme's accent, borderless like the agent pills.
      <Pill key="branch" {...pill} testID="pill-branch" solid={tintedPillColors(tokens, tokens.accent)} icon="GitBranch" label={location.branch}>
        {layout.gitStatus && location.git ? (
          <GitStatus git={location.git} tokens={tokens} size={m.pillText} line={m.pillLine} strings={strings} />
        ) : null}
      </Pill>,
    );
  }
  if (layout.path) {
    pills.push(<Pill key="path" {...pill} testID="pill-path" icon="FolderOpen" label={tildePath(location.cwd)} />);
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
          tint={label.color}
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
  if (layout.subtasks) {
    // Icons and counts, no words: ListTree, then each status the children are in.
    const counts = new Map<StatusKind, number>();
    for (const child of card.children) counts.set(child.status, (counts.get(child.status) ?? 0) + 1);
    // Tinted by the status most children are in; ties go to the more urgent one.
    let dominant: StatusKind | null = null;
    for (const kind of SUBTASK_ORDER) if ((counts.get(kind) ?? 0) > (dominant ? counts.get(dominant)! : 0)) dominant = kind;
    pills.push(
      <PillButton
        key="subtasks"
        {...pill}
        testID="pill-subtasks"
        tint={dominant ? statusTint(dominant, tokens) : null}
        icon="ListTree"
        accessibilityLabel={subtaskSummary(card.children, language)}
        expanded={expanded}
        report={reportControl}
        onPress={() => setExpanded((open) => !open)}
      >
        {SUBTASK_ORDER.filter((kind) => counts.has(kind)).map((kind) => (
          <View key={kind} style={{ flexDirection: "row", alignItems: "center", gap: 3 }} testID={`subtask-count-${kind}`}>
            <StatusIcon kind={kind} size={m.icon + 2} height={m.pillLine} theme={theme} animated={props.animated} />
            <Text style={[{ fontSize: m.pillText, lineHeight: m.pillLine, color: muted }, tabular]}>{counts.get(kind)}</Text>
          </View>
        ))}
      </PillButton>,
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

  // Footer: the timer, and the context ring at the far right ----------------
  const timer = layout.timer ? cardTimer(card, props.now, language) : null;
  const timerColor =
    timer?.tone === "warning" ? tokens.warning : timer?.tone === "running" ? tokens.status.running : muted;
  const ratio = contextRatio(card.context);
  const ring =
    layout.context && ratio !== null && card.context ? (
      <ContextMeter
        tokens={tokens}
        strings={strings}
        compact={compact}
        line={m.footLine}
        context={card.context}
        ratio={ratio}
        cost={card.usage?.totalCostUsd ?? null}
        report={reportControl}
        onOpenChange={setRingOpen}
      />
    ) : null;
  const footer =
    timer || ring ? (
      <View
        // Its details card opens upwards over the rows above, so the row is raised while it shows.
        style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: m.rowGap, zIndex: ringOpen ? OVERLAY_ROW_Z + 1 : undefined }}
        testID="task-card-footer"
      >
        {timer ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {timer.tone === "warning" ? <Icon name="Clock" size={m.icon} color={timerColor} /> : null}
            <Text style={[text(m.footSize, m.footLine, timerColor), tabular]}>{timer.text}</Text>
          </View>
        ) : null}
        {/* Bottom right, where Linear keeps nothing else; it stays there without a timer. */}
        {ring ? <View style={{ marginLeft: "auto" }}>{ring}</View> : null}
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
  /** The pill's text; a pill of icons and counts passes children instead. */
  label?: string;
  /** A Lucide icon before the text. */
  icon?: string;
  /** An 8 px dot before the text (a label's colour). */
  dot?: string;
  /** Any other leading mark (the agent's brand). */
  lead?: ReactNode;
  /** Text and icon colour; muted by default. */
  color?: string;
  /** The data colour the pill is tinted with (label, status); null or absent for the neutral pill. */
  tint?: string | null;
  /** A borderless filled pill (the agent pills): its fill, label and icon colours. */
  solid?: AgentPillColors;
  tabular?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  children?: ReactNode;
}

/**
 * Linear's property pill, 24 high (28 on a phone), fully rounded, with a
 * hairline; filled with a light tint of its data colour, or neutral grey.
 */
export function pillStyle(tokens: TaskTokens, compact: boolean, tint: string | null = null, solid?: AgentPillColors): ViewStyle {
  const m = compact ? PHONE : DESKTOP;
  const colors = solid ? { background: solid.background, border: "transparent" } : pillTint(tokens, tint);
  return {
    height: m.pillHeight,
    minWidth: m.pillHeight,
    maxWidth: "100%",
    borderRadius: m.pillHeight / 2,
    borderWidth: solid ? 0 : StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: m.pillPad,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: compact ? 7 : 6,
  };
}

function PillContent(props: PillProps) {
  const m = props.compact ? PHONE : DESKTOP;
  const color = props.solid?.text ?? props.color ?? props.tokens.foregroundMuted;
  return (
    <>
      {props.lead ?? null}
      {props.icon ? <Icon name={props.icon} size={m.icon} color={props.solid?.icon ?? color} /> : null}
      {props.dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: props.dot }} /> : null}
      {props.label !== undefined ? (
        <Text
          numberOfLines={1}
          style={[
          { fontSize: m.pillText, lineHeight: m.pillLine, color, flexShrink: 1, fontWeight: props.solid ? "500" : "400" },
          props.tabular ? tabular : null,
        ]}
        >
          {props.label}
        </Text>
      ) : null}
      {props.children}
    </>
  );
}

function Pill(props: PillProps) {
  return (
    <View
      style={pillStyle(props.tokens, props.compact, props.tint ?? null, props.solid)}
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel}
    >
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
        pillStyle(props.tokens, props.compact, props.tint ?? null),
        hovered || props.expanded ? { backgroundColor: mix(pillTint(props.tokens, props.tint ?? null).background, props.tokens.foreground, 0.06) } : null,
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

// --- Context ------------------------------------------------------------------

/**
 * The host composer's context ring, inline in the footer; on desktop a hover
 * shows the host's context details in a small card above it. The card floats
 * (absolutely positioned), so showing it moves nothing.
 */
function ContextMeter(props: {
  tokens: TaskTokens;
  strings: ReturnType<typeof cardStrings>;
  compact: boolean;
  line: number;
  context: NonNullable<TaskCard["context"]>;
  ratio: number;
  cost: number | null;
  report?: ControlHover;
  onOpenChange(open: boolean): void;
}) {
  const { tokens, strings, context } = props;
  const { hovered, hoverProps } = useControlHover(props.report);
  const open = hovered && !props.compact;
  const { onOpenChange } = props;
  useEffect(() => {
    onOpenChange(open);
    return () => onOpenChange(false);
  }, [open, onOpenChange]);
  const tone = contextRingTone(props.ratio);
  const color = tone === "danger" ? tokens.danger : tone === "warning" ? tokens.warning : tokens.foregroundMuted;
  const percent = Math.round(props.ratio * 100);
  const cost = formatSessionCost(props.cost);
  return (
    <Pressable
      accessibilityRole="image"
      accessibilityLabel={`${strings.contextWindow} ${strings.contextUsed(percent)}`}
      focusable={false}
      {...hoverProps}
      style={{ height: props.line, justifyContent: "center" }}
      testID="task-card-context"
    >
      <ContextRing ratio={props.ratio} color={color} track={withAlpha(tokens.foregroundMuted, 0.25)} />
      {open ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: -8,
            bottom: props.line + 6,
            minWidth: 180,
            paddingHorizontal: 10,
            paddingVertical: 8,
            gap: 4,
            backgroundColor: tokens.card.background,
            borderWidth: 1,
            borderColor: tokens.card.border,
            borderRadius: 8,
            boxShadow: tokens.popoverShadow,
          } as ViewStyle}
          testID="task-card-context-details"
        >
          <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: "500", color: tokens.foreground }}>{strings.contextWindow}</Text>
          <Text style={[{ fontSize: 14, lineHeight: 20, color: tokens.foreground }, tabular]}>{strings.contextUsed(percent)}</Text>
          <Text style={[{ fontSize: 12, lineHeight: 16, color: tokens.foregroundMuted }, tabular]}>
            {strings.contextTokens(formatTokenCount(context.usedTokens), formatTokenCount(context.maxTokens))}
          </Text>
          {cost ? (
            <Text style={[{ fontSize: 12, lineHeight: 16, color: tokens.foregroundMuted }, tabular]}>{strings.sessionCost(cost)}</Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
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
  const answer = button.kind === "open";
  const primary = button.variant === "primary" && !answer;
  const danger = button.variant === "danger" && !answer;
  // "Answer" opens the tab for a question: it wears the needs-input icon's
  // amber (the statusDot band), tinted, with a hairline of the same hue.
  const amber = tokens.status.warning;
  let color = primary ? tokens.accent : danger ? tokens.danger : tokens.foreground;
  let fill = hovered ? look.controlHover : "transparent";
  let border = look.pillBorder;
  if (primary) fill = border = hovered ? look.primaryFillHover : look.primaryFill;
  if (danger) fill = border = hovered ? look.dangerFillHover : look.dangerFill;
  if (answer) {
    color = amber;
    fill = mix(look.background, amber, (tokens.isDark ? 0.18 : 0.12) + (hovered ? 0.08 : 0));
    border = mix(look.background, amber, tokens.isDark ? 0.45 : 0.4);
  }
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
        borderWidth: answer ? StyleSheet.hairlineWidth : 1,
        borderColor: border,
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
        {answer ? button.label.replace(/\s*\u2197\s*$/, "") : button.label}
      </Text>
      {/* The one arrow: a label that still ends in its own is trimmed above. */}
      {answer ? <Icon name="ArrowUpRight" size={size} color={color} /> : null}
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

/**
 * Stop, its confirm state, and a parent's "only this / with subtasks" menu:
 * one red pill. At rest a danger tint with danger text and outline; armed, a
 * solid danger fill with white text; the parent's chevron is the pill's end.
 */
function StopControl(props: StopControlProps) {
  const { tokens, strings, phase, compact } = props;
  const look = tokens.card;
  const confirming = phase === "confirming";
  const stopping = phase === "stopping";
  const solid = confirming || stopping;
  const stopHover = useControlHover(props.report);
  const chevronHover = useControlHover(props.report);
  const color = solid ? look.onStrong : tokens.danger;
  const fill = (hovered: boolean) =>
    solid ? (hovered ? look.dangerStrongHover : tokens.danger) : hovered ? look.dangerFillHover : look.dangerFill;
  const height = compact ? PHONE.stopHeight : DESKTOP.stopHeight;
  const round = compact ? 8 : height / 2;
  const label = stopping ? strings.stopping : confirming ? (props.all ? strings.confirmStopAll : strings.confirmStop) : strings.stop;
  const segment: ViewStyle = {
    height,
    borderWidth: 1,
    borderColor: tokens.danger,
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
      testID="task-card-stop"
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
        <StopSquare compact={compact} color={color} />
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
              borderLeftWidth: 1,
              borderLeftColor: solid ? withAlpha(look.onStrong, 0.4) : withAlpha(tokens.danger, 0.4),
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
            icon={<StopSquare compact={compact} color={tokens.foregroundMuted} small />}
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

/**
 * The media stop: a solid rounded square (10 px, 12 on a phone, radius 2)
 * in the pill's colour. CircleStop's ring-and-square read poorly at 12 px.
 */
function StopSquare(props: { compact: boolean; color: string; small?: boolean }) {
  const size = (props.compact ? 12 : 10) - (props.small ? 1 : 0);
  return <View style={{ width: size, height: size, borderRadius: 2, backgroundColor: props.color }} testID="stop-square" />;
}

function MenuItem(props: {
  tokens: TaskTokens;
  compact: boolean;
  /** A Lucide name, or a drawn mark. */
  icon: string | ReactNode;
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
      {typeof props.icon === "string" ? (
        <Icon name={props.icon} size={compact ? 14 : 12} color={tokens.foregroundMuted} />
      ) : (
        <View style={{ width: compact ? 14 : 12, alignItems: "center" }}>{props.icon}</View>
      )}
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
        marginRight: JUMP_OVERHANG[compact ? 1 : 0],
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
        alignItems: "flex-start",
        gap: GAP,
        paddingVertical: (compact ? 36 - m.blockLine : 28 - m.blockLine) / 2,
        paddingLeft: 6,
        paddingRight: 2,
        marginHorizontal: -6,
        borderRadius: 6,
        backgroundColor: fill,
        ...webTransition,
      }}
    >
      {/* The official status icon, centred on the title's first line. */}
      <View style={{ width: m.iconSlot, alignItems: "center" }} testID={`subtask-status-${child.id}`}>
        <StatusIcon kind={child.status} size={m.iconBox} height={m.blockLine} theme={props.theme} backdrop={fill} animated={props.animated} />
      </View>
      <Text numberOfLines={2} style={{ flex: 1, fontSize: m.blockSize, lineHeight: m.blockLine, color: tokens.foreground }}>
        {child.title}
      </Text>
      {props.onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.openLabel}
          disabled={!showJump}
          onPress={() => props.onOpen?.(child.id)}
          style={{
            width: size,
            height: size,
            marginVertical: (m.blockLine - size) / 2,
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
