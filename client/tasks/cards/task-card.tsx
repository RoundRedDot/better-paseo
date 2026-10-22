import React, { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { TaskText as Text, HOST_LINE, HOST_FONT as F, TASK_MONO, useTasksFontScale, taskControlHeight } from "../typography";
import { labelLimitCount, type CardSettings } from "../../../shared/tasks-settings";
import { useHover } from "../../ui/use-hover";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { duration, PREVIEW_REVEAL } from "../../ui/tokens/motion";
import type { PermissionButton, StopPhase } from "../actions";
import { useTasksLanguage, type TasksLanguage } from "../i18n";
import type { StatusKind, TaskCard, TaskChild } from "../model";
import { contextRatio, tildePath } from "./format";
import { cardStart, cardTimer, type Timed } from "./card-time";
import { useTime, type TaskClock, type TimeSource } from "./clock";
import { ContextRing, contextRingTone, formatSessionCost, formatTokenCount } from "./context-ring";
import { agentPillColors, BrandMark, branchPillColors, neutralPillColors, type AgentPillColors } from "./brand-mark";
import { THINKING_ICON } from "./mode-icons";
import { ProjectIcon } from "./project-icon";
import { StatusIcon } from "./status-icon";
import { ChildMark } from "./child-mark";
import { CascadeMenu, MENU, type MenuSection } from "../board/menu";
import { layoutMenu } from "../board/menu-model";
import { panelChrome } from "./panel";
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
  /** Mark read, if the card is readable and the server reaches the daemon. */
  onRead?(card: TaskCard): void;
  onPermission?(card: TaskCard, button: PermissionButton): void;
  /** A long press on a phone or touch screen: the details sheet or sidebar. */
  onDetails?(card: TaskCard): void;
  /**
   * A press on the body chooses the card for the details sidebar instead of
   * opening its tab; on desktop a second click right after opens the tab.
   */
  onSelect?(card: TaskCard): void;
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
  /** A mark read is on its way: the button waits, disabled. */
  readPending?: boolean;
  /** Keyboard focus ring. */
  focused: boolean;
  /** The 1 s highlight after a parent link scrolled here. */
  highlighted: boolean;
  /** The card the details sidebar shows. */
  current?: boolean;
  /** A fixed instant (ms) for the timer: previews and tests. Beats `clock`. */
  now?: number;
  /**
   * The board's clock, ticking once a second while visible. Only the timer
   * text reads it, so a tick re-renders that text and not the card.
   */
  clock?: TaskClock;
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
/** Touch: a long press. */
const LONG_PRESS_MS = 450;
/** Two clicks on a card this close together open its tab (the first one selected it). */
const DOUBLE_CLICK_MS = 350;
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
  buttonHeight: number;
}

// Text sizes are steps of the host's type ramp (`HOST_FONT`), which TaskText scales with the user's interface size.
const DESKTOP: Metrics = {
  padH: 12,
  padTop: 10,
  padBottom: 12,
  metaSize: F.sm,
  metaLine: HOST_LINE.sm,
  titleGap: 5,
  // One step under the host's list rows: a lane's card is narrower than a row and reads denser.
  titleSize: F.sm,
  titleLine: HOST_LINE.smRead,
  iconSlot: 14,
  iconBox: 16,
  rowGap: 10,
  pillHeight: 24,
  pillText: F.sm,
  pillLine: HOST_LINE.sm,
  pillPad: 10,
  icon: 12,
  footSize: F.sm,
  footLine: HOST_LINE.sm,
  blockSize: F.sm,
  blockLine: HOST_LINE.sm,
  jump: 20,
  jumpIcon: 14,
  buttonHeight: 28,
};

const PHONE: Metrics = {
  padH: 14,
  padTop: 12,
  padBottom: 14,
  metaSize: F.sm,
  metaLine: HOST_LINE.sm,
  titleGap: 6,
  titleSize: F.base,
  titleLine: HOST_LINE.base,
  iconSlot: 18,
  iconBox: 20,
  rowGap: 12,
  pillHeight: 28,
  pillText: F.sm,
  pillLine: HOST_LINE.sm,
  pillPad: 11,
  icon: 14,
  footSize: F.sm,
  footLine: HOST_LINE.sm,
  blockSize: F.sm,
  blockLine: HOST_LINE.smRead,
  jump: 32,
  jumpIcon: 18,
  buttonHeight: 40,
};

const GAP = 6;
const tabular: TextStyle = { fontVariant: ["tabular-nums"] };
const webTransition = (WEB
  ? { transitionProperty: "background-color, border-color, box-shadow, color, opacity", transitionDuration: "120ms", transitionTimingFunction: "ease-out" }
  : {}) as ViewStyle;

/**
 * Stop's hover entrance on web: a fade with the preview's 4px drift in from
 * the card's right edge, then a plain fade out. RNW compiles keyframes only
 * through `StyleSheet.create`. Native shows Stop all the time, so has none.
 */
const STOP_EXIT_MS = duration.fast;
const stopMotion = WEB
  ? StyleSheet.create({
      enter: {
        // A string: RNW drops an array transform inside keyframes.
        animationKeyframes: [{ from: { opacity: 0, transform: `translateX(${PREVIEW_REVEAL.shift}px)` } }],
        animationDuration: `${PREVIEW_REVEAL.ms}ms`,
        animationTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
      } as ViewStyle,
      exit: {
        animationKeyframes: [{ to: { opacity: 0 } }],
        animationDuration: `${STOP_EXIT_MS}ms`,
        animationTimingFunction: "ease-out",
        animationFillMode: "forwards",
      } as ViewStyle,
    })
  : null;

/** True for `ms` after `shown` turns false, so a control can fade out before it unmounts. */
function useLeaving(shown: boolean, ms: number): boolean {
  const [was, setWas] = useState(shown);
  const [leaving, setLeaving] = useState(false);
  if (was !== shown) {
    setWas(shown);
    setLeaving(!shown && ms > 0);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(false), ms);
    return () => clearTimeout(timer);
  }, [leaving, ms]);
  return leaving;
}

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

/**
 * The request's summary after its title, unless the title already says it:
 * "Run npm run db:migrate · npm run db:migrate" reads the command twice.
 */
function summaryBeyondTitle(title: string, summary: string | null): string | null {
  if (!summary) return null;
  const words = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  return words(title).includes(words(summary)) ? null : summary;
}

/** Children that Stop with subtasks would reach. */
function activeChildren(card: TaskCard): number {
  return card.children.filter((child) => child.kind !== "provider" && (child.status === "running" || child.status === "needs_input")).length;
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

// --- The card -----------------------------------------------------------------

function TaskCardViewImpl(props: TaskCardViewProps) {
  const { card, fields, compact, theme } = props;
  const scale = useTasksFontScale();
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

  const latest = useRef(props);
  latest.current = props;

  const parentHover = useHover();

  // Leaving the card closes the menu and cancels an armed stop.
  const wasHovered = useRef(false);
  useEffect(() => {
    if (hovered === wasHovered.current) return;
    wasHovered.current = hovered;
    if (hovered) return;
    const current = latest.current;
    setMenuOpen(false);
    if (current.stopPhase === "confirming") current.onCancelStop?.(current.card.id);
  }, [hovered]);

  // A failed card stands out in danger red; the highlight and the sidebar's card still win.
  const failed = card.status === "failed";
  /** The card's fill right now: the highlight, the sidebar's card, the failure tint, the hover grey, or the card. */
  const background = props.highlighted
    ? look.highlight
    : props.current
      ? look.current
      : failed
        ? hovered ? look.failedHover : look.failed
        : hovered ? look.hoverBackground : look.background;
  const canStop = card.stoppable && !!props.onStop;
  const parentStop = canStop && activeChildren(card) > 0;
  const showStop = canStop && !compact && (TOUCH || hovered || props.stopPhase !== "idle" || menuOpen);
  // Mark read takes Stop's place: a card is never both (Stop needs a running
  // or waiting agent, Mark read one in review).
  const canRead = !canStop && card.readable === true && !!props.onRead;
  const readPending = props.readPending === true;
  const showRead = canRead && !compact && (TOUCH || hovered || readPending);
  const showControl = showStop || showRead;
  const reducedMotion = useReducedMotion();
  const controlLeaving = useLeaving(showControl && !TOUCH, reducedMotion ? 0 : STOP_EXIT_MS);
  const read = { tokens, strings, pending: readPending, onPress: () => props.onRead?.(card) };
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
    onCloseMenu: () => setMenuOpen(false),
    theme,
    onPick: pressStop,
  };

  const shadows = [hovered ? look.shadowHover : look.shadow];
  if (props.focused) shadows.push(`0px 0px 0px 3px ${tokens.accentRing}`);
  const cardStyle = {
    paddingHorizontal: m.padH,
    paddingTop: m.padTop,
    paddingBottom: m.padBottom,
    // Linear's card: radius 8 (measured: the arc settles 16 device px in at 2x), a hairline,
    // and on hover only the fill and shadow change.
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: props.focused || props.highlighted ? tokens.accent : props.current ? look.currentBorder : failed ? look.failedBorder : look.border,
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
    borderTopColor: failed && !props.current && !props.highlighted ? look.failedBorder : look.border,
  };

  // The jump button, on the meta row, or on the title row when the meta row
  // has nothing to say. Stop sits in the footer, away from it.
  const location = card.location;
  const metaParts: string[] = [];
  if (layout.project && location.projectName) metaParts.push(location.projectName);
  if (layout.workspace && location.workspaceName) metaParts.push(location.workspaceName);
  const metaText = metaParts.join(SEPARATOR);
  const hasMeta = metaText !== "" || card.parent !== null;
  const controlsFor = (line: number) =>
    props.onOpen ? (
      <JumpButton
        tokens={tokens}
        compact={compact}
        line={line}
        label={strings.openInWorkspace}
        onPress={() => props.onOpen?.(card.id)}
      />
    ) : null;

  // Meta row ---------------------------------------------------------------
  const avatar = layout.projectAvatar;
  const metaStyle = text(m.metaSize, m.metaLine, muted);
  const parentLabel = card.parent
    ? card.parent.missing && card.parent.archived === true
      ? strings.parentArchived
      : card.parent.title ?? strings.parentUnknown
    : null;
  const metaRow = hasMeta ? (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: GAP, minHeight: Math.round(m.metaLine * scale), zIndex: OVERLAY_ROW_Z }}
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
          kind={card.stoppedManually ? "stopped" : card.status}
          size={m.iconBox}
          height={Math.round(m.titleLine * scale)}
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
      // The branch: a faint blue fill, a blue icon and the name in monospace.
      <Pill key="branch" {...pill} testID="pill-branch" solid={branchPillColors(tokens)} icon="GitBranch" label={location.branch} mono>
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
        onPress={() => setExpanded((open) => !open)}
      >
        {SUBTASK_ORDER.filter((kind) => counts.has(kind)).map((kind) => (
          <View key={kind} style={{ flexDirection: "row", alignItems: "center", gap: 3 }} testID={`subtask-count-${kind}`}>
            <StatusIcon kind={kind} size={m.icon + 2} height={Math.round(m.pillLine * scale)} theme={theme} animated={props.animated} />
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
  // Whether there is a timer and its tone do not change with the time; the text does, in `TimerText`.
  const timer = layout.timer ? cardTimer(card, props.now ?? 0, language) : null;
  // A running turn's start behind a clock, then how long it has run behind an hourglass, as the turn footer draws them.
  const started = timer && cardStart(card, props.now ?? 0) !== null;
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
        theme={theme}
        onOpenChange={setRingOpen}
      />
    ) : null;
  // The ring's details card opens upwards over the rows above, and Stop's menu
  // downwards over the blocks below, so whichever row holds the footer is raised while either shows.
  const footerZ = ringOpen ? OVERLAY_ROW_Z + 1 : showControl || controlLeaving ? OVERLAY_ROW_Z : undefined;
  // A stoppable or readable card keeps the footer even when it has nothing else, so Stop or Mark read has a place to appear.
  const stopSlot = (canStop || canRead) && !compact;
  // A desktop request's buttons take the footer in on their row: the wait sits
  // beside the answer it waits for, as the details sidebar shows it, rather
  // than above the divider with the buttons alone on a row of their own.
  const answerRow = layout.permission && card.permission !== null && !compact && props.permissionButtons.length > 0;
  const footerContent =
    timer || ring || stopSlot ? (
      <>
        {timer ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {started ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }} testID="task-card-started">
                <Icon name="Clock" size={m.icon} color={muted} />
                <StartText card={card} now={props.now} clock={props.clock} style={[text(m.footSize, m.footLine, muted), tabular]} />
              </View>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }} testID="task-card-timer">
              {timer.tone === "warning" ? <Icon name="Clock" size={m.icon} color={timerColor} /> : null}
              {started ? <Icon name="Hourglass" size={m.icon} color={timerColor} /> : null}
              <TimerText card={card} language={language} now={props.now} clock={props.clock} style={[text(m.footSize, m.footLine, timerColor), tabular]} />
            </View>
          </View>
        ) : null}
        {/* Bottom right, where Linear keeps nothing else; it stays there without a timer. */}
        {showControl && TOUCH ? (
          <View style={{ marginLeft: "auto" }}>
            {canStop ? <StopControl {...stop} compact={false} line={m.footLine} /> : <ReadControl {...read} compact={false} line={m.footLine} />}
          </View>
        ) : null}
        {ring ? <View style={{ marginLeft: showControl && TOUCH ? 0 : "auto" }}>{ring}</View> : null}
        {(showControl || controlLeaving) && !TOUCH ? (
          // On web Stop appears on hover, so it floats over the ring (the card's
          // fill behind it hides what it covers) instead of taking room from the
          // row: hovering must not move anything. Native shows it all the time, in flow.
          <View
            pointerEvents={controlLeaving ? "none" : "auto"}
            aria-hidden={controlLeaving || undefined}
            style={[
              {
                position: "absolute",
                right: 0,
                top: (Math.round(m.footLine * scale) - taskControlHeight(m.buttonHeight, scale)) / 2,
                paddingLeft: GAP,
                // Follows the card's fill as it eases back from the hover grey.
                backgroundColor: background,
                ...webTransition,
              },
              reducedMotion ? null : controlLeaving ? stopMotion?.exit : stopMotion?.enter,
            ]}
            testID={canStop ? "task-card-stop-overlay" : "task-card-read-overlay"}
          >
            {canStop ? <StopControl {...stop} compact={false} line={m.buttonHeight} /> : <ReadControl {...read} compact={false} line={m.buttonHeight} />}
          </View>
        ) : null}
      </>
    ) : null;
  const footLine = Math.round(m.footLine * scale);
  const footer =
    footerContent && !answerRow ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: footLine, marginTop: m.rowGap, zIndex: footerZ }} testID="task-card-footer">
        {footerContent}
      </View>
    ) : null;

  // Lane blocks ------------------------------------------------------------
  const iconCell: ViewStyle = { width: m.iconSlot, height: Math.round(m.blockLine * scale), alignItems: "center", justifyContent: "center" };
  const failure = layout.failure ? (
    <View style={[block, { flexDirection: "row", alignItems: "flex-start", gap: GAP }]} testID="task-card-reason">
      <View style={iconCell}>
        {card.stoppedManually && !failed ? (
          // Stopped: the stop pill's solid square, not Lucide's hollow one.
          <View style={{ width: m.icon - 4, height: m.icon - 4, borderRadius: 2, backgroundColor: muted }} testID="task-card-reason-stopped" />
        ) : (
          <Icon name={failed ? "CircleX" : "Square"} size={m.icon} color={failed ? tokens.danger : muted} />
        )}
      </View>
      <Text style={[text(m.blockSize, m.blockLine, failed ? tokens.danger : muted), { flex: 1 }]}>{card.error}</Text>
    </View>
  ) : null;

  const permission = card.permission;
  const asksQuestion = permission?.kind === "question" || permission?.kind === "other";
  const permissionSummary = permission ? summaryBeyondTitle(permission.title, permission.summary) : null;
  const permissionBlock =
    layout.permission && permission ? (
      <View style={[block, { gap: 8, zIndex: answerRow ? footerZ : undefined }]} testID="task-card-permission">
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: GAP }}>
          <View style={iconCell}>
            <Icon name={permissionIcon(permission.kind)} size={m.icon + 1} color={tokens.status.warning} />
          </View>
          <Text numberOfLines={2} style={[text(m.blockSize, m.blockLine, tokens.foreground), { flex: 1 }]}>
            <Text style={{ fontWeight: asksQuestion ? "500" : "600" }}>{permission.title}</Text>
            {permissionSummary ? <Text style={{ color: muted }}> · </Text> : null}
            {permissionSummary}
          </Text>
          {permission.remaining > 0 ? (
            <Text style={[text(m.blockSize - 1, m.blockLine, muted), tabular]}>{strings.more(permission.remaining)}</Text>
          ) : null}
        </View>
        {answerRow ? (
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: GAP, paddingLeft: m.iconSlot + GAP }}>
            {props.permissionButtons.map((button) => (
              <ActionButton
                key={button.key}
                button={button}
                tokens={tokens}
                compact={false}
                onPress={() => props.onPermission?.(card, button)}
              />
            ))}
            {footerContent ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: footLine, marginLeft: "auto" }} testID="task-card-footer">
                {footerContent}
              </View>
            ) : null}
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
            parentId={card.id}
            theme={theme}
            tokens={tokens}
            compact={compact}
            openLabel={strings.openInWorkspace}
            backdrop={background}
            animated={props.animated}
            language={language}
            now={props.now}
            clock={props.clock}
            onReveal={props.onReveal}
            onOpen={props.onOpen}
          />
        ))}
      </View>
    ) : null;

  // Phone action bar -------------------------------------------------------
  const buttons = compact && layout.permission ? props.permissionButtons : [];
  const actionBar =
    compact && (buttons.length > 0 || canStop || canRead) ? (
      // One row: no flexWrap, whose Yoga layout left a phantom second row's
      // height under the buttons on Android.
      <View style={{ flexDirection: "row", gap: 8, marginTop: m.rowGap, zIndex: OVERLAY_ROW_Z }} testID="task-card-actions">
        {buttons.map((button) => (
          <ActionButton
            key={button.key}
            button={button}
            tokens={tokens}
            compact
            onPress={() => props.onPermission?.(card, button)}
          />
        ))}
        {canStop ? <StopControl {...stop} compact line={m.buttonHeight} /> : null}
        {canRead ? <ReadControl {...read} compact line={m.buttonHeight} /> : null}
      </View>
    ) : null;

  const lastPress = useRef(0);
  const pressBody = props.onSelect
    ? () => {
        const at = Date.now();
        const second = !TOUCH && at - lastPress.current < DOUBLE_CLICK_MS;
        lastPress.current = second ? 0 : at;
        if (second) props.onOpen?.(card.id);
        else props.onSelect?.(card);
      }
    : props.onOpen
      ? () => props.onOpen?.(card.id)
      : undefined;

  return (
    <Pressable
      {...CONTAINER_ROLE}
      accessibilityLabel={card.title}
      onPress={pressBody}
      onLongPress={props.onDetails && (compact || TOUCH) ? () => props.onDetails?.(card) : undefined}
      delayLongPress={LONG_PRESS_MS}
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
  /** The label in monospace, a size down (a branch name). */
  mono?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  children?: ReactNode;
}

/**
 * Linear's property pill, 24 high (28 on a phone), fully rounded, with a
 * hairline; filled with a light tint of its data colour, or neutral grey.
 */
export function pillStyle(tokens: TaskTokens, compact: boolean, tint: string | null = null, solid?: AgentPillColors, scale = 1): ViewStyle {
  const m = compact ? PHONE : DESKTOP;
  const colors = solid ? { background: solid.background, border: "transparent" } : pillTint(tokens, tint);
  return {
    height: taskControlHeight(m.pillHeight, scale),
    minWidth: taskControlHeight(m.pillHeight, scale),
    maxWidth: "100%",
    borderRadius: taskControlHeight(m.pillHeight, scale) / 2,
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
          props.mono ? { fontFamily: TASK_MONO } : null,
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
  const scale = useTasksFontScale();
  return (
    <View
      style={pillStyle(props.tokens, props.compact, props.tint ?? null, props.solid, scale)}
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel}
    >
      <PillContent {...props} />
    </View>
  );
}

function PillButton(props: PillProps & { expanded: boolean; onPress(): void }) {
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ expanded: props.expanded }}
      onPress={props.onPress}
      {...hoverProps}
      testID={props.testID}
      style={[
        pillStyle(props.tokens, props.compact, props.tint ?? null, undefined, scale),
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
  theme: PluginTheme;
  onOpenChange(open: boolean): void;
}) {
  const { tokens, strings, context } = props;
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
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
      style={{ height: Math.round(props.line * scale), justifyContent: "center" }}
      testID="task-card-context"
    >
      <ContextRing ratio={props.ratio} color={color} track={withAlpha(tokens.foregroundMuted, 0.25)} />
      {open ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: -8,
            bottom: Math.round(props.line * scale) + 6,
            minWidth: 180,
            paddingHorizontal: 10,
            paddingVertical: 8,
            gap: 4,
            ...panelChrome(props.theme),
          } as ViewStyle}
          testID="task-card-context-details"
        >
          <Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, fontWeight: "500", color: tokens.foreground }}>{strings.contextWindow}</Text>
          <Text style={[{ fontSize: F.base, lineHeight: HOST_LINE.base, color: tokens.foreground }, tabular]}>{strings.contextUsed(percent)}</Text>
          <Text style={[{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted }, tabular]}>
            {strings.contextTokens(formatTokenCount(context.usedTokens), formatTokenCount(context.maxTokens))}
          </Text>
          {cost ? (
            <Text style={[{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted }, tabular]}>{strings.sessionCost(cost)}</Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

// --- Buttons ------------------------------------------------------------------

/** A system font at least this much larger than normal lets a phone button's label wrap. */
export const LARGE_FONT_SCALE = 1.15;
/** A phone button is never narrower than this. */
export const PHONE_BUTTON_MIN_WIDTH = 72;

/**
 * A phone action button's share of the bar: as wide as its label on one
 * line, then an equal part of what is left. At a normal font size a
 * permission button never shrinks under its label, so no label breaks
 * inside a word ("Sto/p", "Allo/w"); only the stop pill gives width back
 * when the labels do not fit side by side (an armed "Confirm stop" beside
 * Allow and Deny on a narrow phone), shrinking its font to fit its one
 * line, never under 75%. With an enlarged system font any label may take a
 * second line, broken between words.
 */
export function phoneButtonSizing(fontScale: number, yields = false): {
  wraps: boolean;
  box: ViewStyle;
  label: TextStyle;
  lines: number;
  fit: { adjustsFontSizeToFit?: boolean; minimumFontScale?: number };
} {
  const wraps = fontScale >= LARGE_FONT_SCALE;
  const shrinks = wraps || yields;
  return {
    wraps,
    box: { flexGrow: 1, flexShrink: shrinks ? 1 : 0, flexBasis: "auto", minWidth: PHONE_BUTTON_MIN_WIDTH },
    label: { flexShrink: shrinks ? 1 : 0 },
    lines: wraps ? 2 : 1,
    fit: !wraps && yields ? { adjustsFontSizeToFit: true, minimumFontScale: 0.75 } : {},
  };
}

/** A permission answer or "go answer": 28 high, radius 6; 40 and evenly split on a phone. */
export function ActionButton(props: {
  button: PermissionButton;
  tokens: TaskTokens;
  compact: boolean;
  onPress(): void;
}) {
  const { button } = props;
  const answer = button.kind === "open";
  const primary = button.variant === "primary" && !answer;
  // Deny pairs with Allow: Allow's accent tint, Deny the Stop button's danger tint.
  const danger = !answer && !primary && (button.variant === "danger" || button.action.behavior === "deny");
  let look: CardButtonLook = "plain";
  if (answer) look = "answer";
  else if (primary) look = "primary";
  else if (danger) look = "danger";
  return (
    <CardButton
      label={answer ? button.label.replace(/\s*\u2197\s*$/, "") : button.label}
      accessibilityLabel={button.label}
      look={look}
      icon={answer ? null : button.action.behavior === "allow" ? "Check" : "X"}
      tokens={props.tokens}
      compact={props.compact}
      onPress={props.onPress}
    />
  );
}

export type CardButtonLook = "primary" | "plain" | "danger" | "answer";

/**
 * The card's button: Allow's accent tint, a plain outline, the Stop button's
 * danger tint, or "Answer" in the needs-input amber with its arrow. A busy
 * one keeps its look and swaps its icon for a spinner, as Paseo's own
 * loading buttons do.
 */
export function CardButton(props: {
  label: string;
  /** The label read out, when it differs from the one drawn. */
  accessibilityLabel?: string;
  look: CardButtonLook;
  icon?: string | null;
  tokens: TaskTokens;
  compact: boolean;
  /** Working: a spinner in place of the icon, and no second press. */
  busy?: boolean;
  onPress(): void;
  testID?: string;
}) {
  const { tokens, compact, look: kind } = props;
  const scale = useTasksFontScale();
  const look = tokens.card;
  const { hovered: hover, hoverProps } = useHover();
  const hovered = hover && !props.busy;
  const answer = kind === "answer";
  // "Answer" opens the tab for a question: it wears the needs-input icon's
  // amber (the statusDot band), tinted, with a hairline of the same hue; its
  // label is that amber pulled until it reads at 4.5:1.
  let color = kind === "primary" ? look.primaryText : kind === "danger" ? tokens.danger : tokens.foreground;
  let fill = hovered ? look.controlHover : "transparent";
  let border = look.pillBorder;
  if (kind === "primary") fill = border = hovered ? look.primaryFillHover : look.primaryFill;
  if (kind === "danger") fill = border = hovered ? look.dangerFillHover : look.dangerFill;
  if (answer) {
    color = look.answerText;
    fill = hovered ? look.answerFillHover : look.answerFill;
    border = look.answerBorder;
  }
  const size = compact ? 16 : 13;
  const sizing = phoneButtonSizing((useWindowDimensions().fontScale ?? 1) * scale);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={props.busy ? { disabled: true, busy: true } : undefined}
      disabled={props.busy}
      onPress={props.onPress}
      {...hoverProps}
      testID={props.testID}
      style={{
        // A phone's button grows with a large system font.
        ...(compact ? { minHeight: PHONE.buttonHeight, paddingVertical: 4, ...sizing.box } : { height: taskControlHeight(DESKTOP.buttonHeight, scale) }),
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
      {props.busy ? (
        // The platform's small spinner is 20; scaled into the icon's box so the button keeps its width.
        <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="small" color={color} style={{ transform: [{ scale: size / 20 }] }} testID={props.testID ? `${props.testID}-spinner` : undefined} />
        </View>
      ) : props.icon ? (
        <Icon name={props.icon} size={size} color={color} />
      ) : null}
      <Text numberOfLines={compact ? sizing.lines : 1} {...(compact ? sizing.fit : null)} style={{ ...(compact ? sizing.label : null), textAlign: "center", fontSize: compact ? F.base : F.sm, fontWeight: "500", color }}>
        {props.label}
      </Text>
      {/* The one arrow: a label that still ends in its own is trimmed by the caller. */}
      {answer ? <Icon name="ArrowUpRight" size={size} color={color} /> : null}
    </Pressable>
  );
}

/**
 * Mark read: a card button's size, as Stop and "Answer" are, led by
 * Lucide's CheckCheck (a read receipt), in the plain outline, since clearing a card is
 * no alarm. While the request is out it says so, dimmed, and takes no second press.
 */
function ReadControl(props: {
  tokens: TaskTokens;
  strings: ReturnType<typeof cardStrings>;
  pending: boolean;
  compact: boolean;
  /** The line it sits on, so it centres without growing the row. */
  line: number;
  onPress(): void;
}) {
  const { tokens, strings, pending, compact } = props;
  const scale = useTasksFontScale();
  const look = tokens.card;
  const { hovered, hoverProps } = useHover();
  const sizing = phoneButtonSizing((useWindowDimensions().fontScale ?? 1) * scale, true);
  const height = taskControlHeight(compact ? PHONE.buttonHeight : DESKTOP.buttonHeight, scale);
  const label = pending ? strings.markingRead : strings.markRead;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={pending ? { disabled: true, busy: true } : undefined}
      disabled={pending}
      onPress={props.onPress}
      {...hoverProps}
      testID="task-card-read"
      style={{
        ...(compact ? { ...sizing.box, minHeight: height, paddingVertical: 4 } : { flexShrink: 0, height }),
        marginVertical: compact ? 0 : (Math.round(props.line * scale) - height) / 2,
        paddingHorizontal: compact ? 14 : 10,
        borderRadius: compact ? 8 : 6,
        borderWidth: 1,
        borderColor: look.pillBorder,
        backgroundColor: hovered && !pending ? look.controlHover : "transparent",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: compact ? 6 : 5,
        opacity: pending ? 0.6 : 1,
        ...webTransition,
      }}
    >
      <Icon name="CheckCheck" size={compact ? 16 : 13} color={tokens.foreground} />
      <Text numberOfLines={compact ? sizing.lines : 1} {...(compact ? sizing.fit : null)} style={{ ...(compact ? sizing.label : null), textAlign: "center", fontSize: compact ? F.base : F.sm, fontWeight: "500", color: tokens.foreground }}>
        {label}
      </Text>
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
  onCloseMenu(): void;
  theme: PluginTheme;
}

/**
 * Stop, its confirm state, and a parent's "only this / with subtasks" menu:
 * the details sidebar's stop button at a card button's size ("Answer"'s 28,
 * radius 6), a rounded rectangle led by Lucide's Power. At rest a danger tint with danger text and outline; armed,
 * a solid danger fill with white text; the parent's chevron is its end.
 */
function StopControl(props: StopControlProps) {
  const { tokens, strings, phase, compact } = props;
  const scale = useTasksFontScale();
  const look = tokens.card;
  const confirming = phase === "confirming";
  const stopping = phase === "stopping";
  const solid = confirming || stopping;
  const stopHover = useHover();
  const chevronHover = useHover();
  const stopSections: MenuSection[] = [
    {
      key: "stop",
      items: [
        {
          key: "only",
          label: strings.stopOnlyThis,
          icon: "Power",
          onSelect: () => props.onPick(false),
        },
        {
          key: "all",
          label: strings.stopWithChildren,
          leading: <StopTreeGlyph tokens={tokens} />,
          hint: String(props.count),
          onSelect: () => props.onPick(true),
        },
      ],
    },
  ];
  const sizing = phoneButtonSizing((useWindowDimensions().fontScale ?? 1) * scale, true);
  const color = solid ? look.onStrong : tokens.danger;
  const fill = (hovered: boolean) =>
    solid ? (hovered ? look.dangerStrongHover : tokens.danger) : hovered ? look.dangerFillHover : look.dangerFill;
  const height = taskControlHeight(compact ? PHONE.buttonHeight : DESKTOP.buttonHeight, scale);
  // A card button's: 8 at a phone's 40, 6 at the desktop's 28, as "Answer" is.
  const round = compact ? 8 : 6;
  const label = stopping ? strings.stopping : confirming ? (props.all ? strings.confirmStopAll : strings.confirmStop) : strings.stop;
  const segment: ViewStyle = {
    ...(compact ? { minHeight: height, paddingVertical: 4 } : { height }),
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
        // On a phone the pill shares the action bar like the buttons, as wide
        // as its label: "Confirm stop" takes more than "Stop". Explicit grow
        // and basis, never the `flex` shorthand beside `flexShrink`.
        ...(compact ? sizing.box : { flexShrink: 0 }),
        marginVertical: compact ? 0 : (Math.round(props.line * scale) - height) / 2,
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
            ...(compact ? { flexGrow: 1, flexShrink: 1, flexBasis: "auto" } : null),
            gap: compact ? 6 : 5,
            // Armed on a phone the solid pill says what it does in words; its
            // square goes and its padding narrows, so "Confirm stop" fits
            // beside Allow and Deny at full size on a 360 pt phone.
            paddingHorizontal: compact ? (solid ? 10 : 14) : 10,
            backgroundColor: fill(stopHover.hovered),
            borderTopLeftRadius: round,
            borderBottomLeftRadius: round,
            borderTopRightRadius: props.parent ? 0 : round,
            borderBottomRightRadius: props.parent ? 0 : round,
            opacity: stopping ? 0.6 : 1,
          },
        ]}
      >
        {compact && solid ? null : <Icon name="Power" size={compact ? 16 : 13} color={color} />}
        <Text numberOfLines={compact ? sizing.lines : 1} {...(compact ? sizing.fit : null)} style={{ ...(compact ? sizing.label : null), textAlign: "center", fontSize: compact ? F.base : F.sm, fontWeight: "500", color }}>
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
              width: compact ? 44 : 26,
              borderLeftWidth: 1,
              borderLeftColor: solid ? withAlpha(look.onStrong, 0.4) : withAlpha(tokens.danger, 0.4),
              marginLeft: -1,
              backgroundColor: fill(chevronHover.hovered || props.menuOpen),
              borderTopRightRadius: round,
              borderBottomRightRadius: round,
            },
          ]}
        >
          <Icon name={compact ? "ChevronUp" : "ChevronDown"} size={compact ? 16 : 13} color={color} />
        </Pressable>
      ) : null}
      {props.parent && props.menuOpen ? (
        // The board's Linear menu (radius 12, hairline, soft shadow, 32 pt
        // rows): below the pill on desktop, above the action bar on a phone.
        <CascadeMenu
          sections={stopSections}
          theme={props.theme}
          width={STOP_MENU_WIDTH}
          top={compact ? -(layoutMenu(stopSections, scale).height + 2 * StyleSheet.hairlineWidth + 6) : height + 4}
          align="right"
          onClose={props.onCloseMenu}
          testID="task-card-stop-menu"
        />
      ) : null}
    </View>
  );
}

const STOP_MENU_WIDTH = 220;

/** A drawn mark in the menu's 16 pt icon slot. */
function MenuGlyph(props: { children: ReactNode }) {
  return <View style={{ width: MENU.icon, height: MENU.icon, alignItems: "center", justifyContent: "center" }}>{props.children}</View>;
}

/** "Stop with subtasks": the subtask tree with a small stop square at its corner. */
function StopTreeGlyph(props: { tokens: TaskTokens }) {
  const muted = props.tokens.foregroundMuted;
  return (
    <MenuGlyph>
      <Icon name="ListTree" size={14} color={muted} />
      <View
        style={{
          position: "absolute",
          right: -1,
          bottom: -1,
          width: 7,
          height: 7,
          borderRadius: 2,
          backgroundColor: muted,
          borderWidth: 1.5,
          borderColor: props.tokens.surface0,
        }}
        testID="stop-square"
      />
    </MenuGlyph>
  );
}

/** ArrowUpRight, 20 x 20 (32 on a phone), where Linear puts the assignee; a tooltip after 400 ms of hover. */
function JumpButton(props: {
  tokens: TaskTokens;
  compact: boolean;
  /** The line it sits on, so it centres without growing the row. */
  line: number;
  label: string;
  onPress(): void;
}) {
  const { tokens, compact } = props;
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
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
        marginVertical: (Math.round(props.line * scale) - size) / 2,
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
            height: taskControlHeight(26, scale),
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
          <Text numberOfLines={1} style={{ fontSize: F.sm, color: tokens.foreground }}>
            {props.label}
          </Text>
          <View
            style={{ height: taskControlHeight(16, scale), paddingHorizontal: 4, borderWidth: 1, borderColor: tokens.card.border, borderRadius: 3, justifyContent: "center" }}
          >
            <Text style={{ fontSize: F.sm, lineHeight: 14, color: tokens.foregroundMuted }}>Enter</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * One expanded child: its agent's mark, the title, then its start and timer
 * at the end. Press reveals it on the board; the jump button opens its tab.
 * A provider subagent has neither, so press opens the parent's tab, where
 * Paseo's subagent track lists it.
 */
function SubtaskRow(props: TimeSource & {
  child: TaskChild;
  parentId: string;
  theme: PluginTheme;
  tokens: TaskTokens;
  compact: boolean;
  openLabel: string;
  /** The card's fill, under the mark's status corner while the row is not hovered. */
  backdrop: string;
  animated?: boolean;
  language: TasksLanguage;
  onReveal(agentId: string): void;
  onOpen?(agentId: string): void;
}) {
  const { child, tokens, compact } = props;
  const scale = useTasksFontScale();
  const m = compact ? PHONE : DESKTOP;
  // DOM hover on web, as the card: the row's own Pressable hover would end
  // when the pointer reaches its jump button, and hide it.
  const rowRef = useRef<View>(null);
  const { hovered, hoverProps } = useHover(rowRef);
  const provider = child.kind === "provider";
  const showJump = !provider && !!props.onOpen && (compact || TOUCH || hovered);
  const fill = hovered && !compact ? tokens.card.controlHover : props.backdrop;
  const size = compact ? 32 : 22;
  return (
    <Pressable
      {...CONTAINER_ROLE}
      accessibilityLabel={child.title}
      onPress={() => (provider ? props.onOpen?.(props.parentId) : props.onReveal(child.id))}
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
      {/* The agent's mark with its status on the corner, centred on the title's first line. */}
      <View style={{ width: m.iconSlot, height: Math.round(m.blockLine * scale), alignItems: "center", justifyContent: "center" }} testID={`subtask-status-${child.id}`}>
        <ChildMark child={child} tokens={tokens} theme={props.theme} backdrop={fill} animated={props.animated} />
      </View>
      <Text numberOfLines={2} style={{ flex: 1, fontSize: m.blockSize, lineHeight: m.blockLine, color: tokens.foreground }}>
        {child.title}
      </Text>
      {child.lane && child.timing ? (
        <SubtaskTime
          timed={{ lane: child.lane, timing: child.timing }}
          language={props.language}
          now={props.now}
          clock={props.clock}
          style={[{ fontSize: m.blockSize, lineHeight: m.blockLine, color: tokens.foregroundMuted, flexShrink: 0 }, tabular]}
          testID={`subtask-time-${child.id}`}
        />
      ) : null}
      {props.onOpen && !provider ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.openLabel}
          disabled={!showJump}
          onPress={() => props.onOpen?.(child.id)}
          style={{
            width: size,
            height: size,
            marginVertical: (Math.round(m.blockLine * scale) - size) / 2,
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
 * The footer's timer text: the one part of a card that follows the clock. It
 * re-renders when its text changes (a running timer every second, "5 min
 * ago" once a minute); the card around it does not.
 */
function TimerText(props: TimeSource & { card: TaskCard; language: TasksLanguage; style: StyleProp<TextStyle> }) {
  const { card, language } = props;
  const value = useTime(props, (now) => cardTimer(card, now, language)?.text ?? "");
  return <Text style={props.style}>{value}</Text>;
}

/** A subtask's "14:41 · 14m 14s" while it runs, else its timer as a card footer reads it. */
function SubtaskTime(props: TimeSource & { timed: Timed; language: TasksLanguage; style: StyleProp<TextStyle>; testID?: string }) {
  const { timed, language } = props;
  const value = useTime(props, (now) => [cardStart(timed, now), cardTimer(timed, now, language)?.text].filter(Boolean).join(" · "));
  return value ? (
    <Text numberOfLines={1} style={props.style} testID={props.testID}>
      {value}
    </Text>
  ) : null;
}

/** The running turn's start; it follows the clock only to add the date after midnight. */
function StartText(props: TimeSource & { card: TaskCard; style: StyleProp<TextStyle> }) {
  const { card } = props;
  const value = useTime(props, (now) => cardStart(card, now) ?? "");
  return <Text style={props.style}>{value}</Text>;
}

/**
 * With a fixed `now`, the card re-renders for a new instant only when its
 * timer text changes; with the board's `clock` a tick never reaches it (the
 * timer text reads the clock itself). Every other prop compares by identity,
 * so the board passes stable callbacks and keeps a card object until it changes.
 */
export function sameCardProps(prev: TaskCardViewProps, next: TaskCardViewProps): boolean {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof TaskCardViewProps>;
  for (const key of keys) {
    if (key === "now") continue;
    if (prev[key] !== next[key]) return false;
  }
  if (prev.now === next.now) return true;
  if (prev.now === undefined || next.now === undefined) return false;
  if (!cardLayout(next.card, next.fields, next.compact).timer) return true;
  // The en and zh texts change at the same instants.
  return cardTimer(prev.card, prev.now, "en")?.text === cardTimer(next.card, next.now, "en")?.text;
}

export const TaskCardView = memo(TaskCardViewImpl, sameCardProps);
