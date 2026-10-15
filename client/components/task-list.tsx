import React, { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { space } from "./theme-tokens";
import { selectableSurface, unselectable } from "./selection";
import { selectionSurface } from "./selection-actions";
import type { ExtendedThemeTokens } from "./theme-tokens";
import type { TaskListData, TaskItemData, TaskStatus } from "../../shared/contracts";
import {
  NO_OVERRIDES,
  applyTaskOverrides,
  setTaskOverride,
  type TaskOverrides,
} from "../state/task-overrides";
import { RunningDot } from "../ui/running-dot";
import { ProgressRing } from "../ui/progress-ring";
import { FadeIn } from "../ui/fade-in";
import { DISCLOSURE_HEADER } from "../ui/disclosure-header";
import { HoverPreview, HoverPreviewBody, HoverPreviewHeader, useHoverPreview, usePreviewWraps } from "../ui/hover-preview";
import { ToolbarButton, TooltipAlignContext, TooltipSideContext } from "../ui/toolbar-button";
import { bindPreviewPointer } from "../web";

/** The checklist's floating panel: the row preview's own (`useHoverPreview`). */
export type TaskListPanelControl = ReturnType<typeof useHoverPreview>;

interface TaskListProps {
  data: TaskListData;
  tokens: ExtendedThemeTokens;
  /** `layout.compact`: 32pt rows. */
  compact?: boolean;
  onToggleTask?: (taskId: string, newStatus: TaskStatus) => void;
  /**
   * A panel owned by a caller it must outlive: the live checklist folds to a
   * row when the next update arrives, and its panel stays open on the newest
   * list (`live-renderers.tsx`). That caller places the panel's anchor; the
   * header here still opens it. Without one the list owns its panel,
   * anchored on its header.
   */
  panel?: TaskListPanelControl;
  /**
   * The list as the panel draws it: no header (the panel's title bar says
   * "Tasks"), every title in full, and nothing to press. With the panel's
   * line wrap off each title stays on one line and the body scrolls sideways.
   */
  full?: boolean;
}

/** The static progress ring in the header: as wide as the status icons. */
const PROGRESS_SIZE = DISCLOSURE_HEADER.icon;
const PROGRESS_STROKE = 2;
/** The pending ring. */
const RING = 10;

const NO_EXPANDED: ReadonlySet<string> = new Set();

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  pending: "in_progress",
  in_progress: "completed",
  completed: "pending",
  blocked: "pending",
};

/**
 * The agent's checklist as rows (S7 design spec §3.3): a header row —
 * `Tasks 1/4` and a static progress ring — then one row per task in the
 * same status slot as a tool's icon, so a checklist lines up with the calls
 * around it. No frame, no fill. The only motion is the `RunningDot` of the
 * task in progress; the progress ring jumps to its value, and a finished
 * list trades it for a checked circle.
 *
 * A title is one line until it is tapped, then wraps in full; another tap
 * folds it again. The whole list opens in the row preview's floating panel:
 * a long press on any row on iOS and Android, a pointer resting on the
 * header on web, and everywhere the header's window button. The button is
 * on phones too: a long press is found by chance, it is off with the
 * reader's hover previews, and a screen reader needs a control to reach.
 *
 * Four views per task: the row, its status button, the status mark and the
 * title.
 */
export function TaskList({ data, tokens, compact = false, onToggleTask, panel: shared, full = false }: TaskListProps) {
  // The host's list is the source of truth and is re-read on every update; a
  // tap only overrides a task until the host reports a new status for it.
  const [overrides, setOverrides] = useState<TaskOverrides>(NO_OVERRIDES);
  const tasks = useMemo(() => applyTaskOverrides(data.tasks, overrides), [data.tasks, overrides]);
  const [expandedBlockedId, setExpandedBlockedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(NO_EXPANDED);
  const unwrapped = full && !usePreviewWraps();
  const own = useTaskListPanel(!shared && !full);
  const panel = shared ?? own;
  const longPress = full ? undefined : panel.press;
  const headerRef = useRef<View | null>(null);
  const ownAnchor = own.anchorRef;
  const setHeader = useCallback((node: View | null) => {
    headerRef.current = node;
    if (!shared) ownAnchor.current = node;
  }, [shared, ownAnchor]);
  // A shared panel is anchored elsewhere, so the header binds its hover here.
  const sharedEnter = shared?.enter;
  const sharedLeave = shared?.leave;
  useEffect(() => {
    if (sharedEnter && sharedLeave) return bindPreviewPointer(headerRef.current, sharedEnter, sharedLeave);
  }, [sharedEnter, sharedLeave]);

  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const totalCount = tasks.length;
  const allDone = totalCount > 0 && completedCount === totalCount;
  const rowHeight = compact ? tokens.typography.block.rowHeight.compact : tokens.typography.block.rowHeight.desktop;
  const block = tokens.typography.block;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          ...selectableSurface,
        },
        row: {
          flexDirection: "row",
          alignItems: "center",
          gap: DISCLOSURE_HEADER.gap,
          paddingHorizontal: DISCLOSURE_HEADER.paddingX,
          marginHorizontal: -DISCLOSURE_HEADER.bleed,
        },
        rowClosed: {
          height: rowHeight,
        },
        // A wrapped title grows the row; its first line sits where a closed
        // row's one line does, and the icon and meta stay on that line.
        rowOpen: {
          minHeight: rowHeight,
          alignItems: "flex-start",
          paddingVertical: (rowHeight - block.label.lineHeight) / 2,
        },
        slot: {
          width: DISCLOSURE_HEADER.iconSlot,
          paddingRight: DISCLOSURE_HEADER.iconSlotPad,
          alignSelf: "stretch",
          alignItems: "center",
          justifyContent: "center",
        },
        slotOpen: {
          alignSelf: "flex-start",
          height: block.label.lineHeight,
        },
        firstLine: {
          marginTop: (block.label.lineHeight - block.meta.lineHeight) / 2,
        },
        headerTitle: {
          fontFamily: tokens.fontUi,
          fontSize: block.label.size,
          lineHeight: block.label.lineHeight,
          fontWeight: "500",
          color: tokens.foreground,
          ...unselectable,
        },
        headerCount: {
          fontFamily: tokens.fontMono,
          fontSize: block.meta.size,
          lineHeight: block.meta.lineHeight,
          fontVariant: ["tabular-nums"],
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        phase: {
          flex: 1,
          minWidth: 0,
          textAlign: "right",
          fontFamily: tokens.fontUi,
          fontSize: block.caption.size,
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        spacer: { flex: 1 },
        ring: {
          width: RING,
          height: RING,
          borderRadius: RING / 2,
          borderWidth: 1.5,
          borderColor: tokens.foregroundSubtle,
        },
        title: {
          fontFamily: tokens.fontUi,
          fontSize: block.label.size,
          lineHeight: block.label.lineHeight,
          color: tokens.foreground,
        },
        titleFill: {
          flex: 1,
          minWidth: 0,
        },
        // In the panel's sideways scroller a title sizes to its one line:
        // `flex: 1` would map to a zero basis on web and wrap every word. A
        // phone caps the scroller's width (`MAX_UNWRAPPED_WIDTH`).
        titleUnwrapped: {
          flexGrow: 1,
          flexShrink: Platform.OS === "web" ? 0 : 1,
          minWidth: 0,
        },
        titleDone: {
          color: tokens.foregroundMuted,
        },
        meta: {
          fontFamily: tokens.fontMono,
          fontSize: block.meta.size,
          lineHeight: block.meta.lineHeight,
          fontVariant: ["tabular-nums"],
          color: tokens.foregroundMuted,
        },
        blocked: {
          fontFamily: tokens.fontUi,
          fontSize: block.caption.size,
          lineHeight: block.caption.lineHeight,
          color: tokens.warning,
          ...unselectable,
        },
        reason: {
          // Under the title: the row's text column.
          paddingLeft: DISCLOSURE_HEADER.textColumn,
          paddingBottom: space.xs,
        },
        reasonText: {
          fontFamily: tokens.fontUi,
          fontSize: block.label.size,
          lineHeight: block.label.lineHeight,
          color: tokens.foregroundMuted,
        },
      }),
    [tokens, rowHeight],
  );

  const toggleStatus = (task: TaskItemData) => {
    const nextStatus = NEXT_STATUS[task.status];
    const hostTask = data.tasks.find((t) => t.id === task.id) ?? task;
    setOverrides((prev) => setTaskOverride(prev, hostTask, nextStatus));
    onToggleTask?.(task.id, nextStatus);
  };

  const toggleExpanded = (taskId: string) => {
    if (selectingText()) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(taskId)) next.add(taskId);
      return next;
    });
  };

  // A live checklist always arrives as "Checklist Progress"; only a named
  // phase says something the header does not.
  const phase = data.phaseName && data.phaseName !== "Checklist Progress" ? data.phaseName : null;

  const header = (
    <>
      <View style={styles.slot}>
        <Icon
          name={allDone ? "CircleCheck" : "ListChecks"}
          size={DISCLOSURE_HEADER.icon}
          color={allDone ? tokens.success : tokens.foregroundMuted}
        />
      </View>
      <Text selectable={false} style={styles.headerTitle}>
        Tasks
      </Text>
      <Text selectable={false} style={styles.headerCount}>
        {`${completedCount}/${totalCount}`}
      </Text>
      {phase ? (
        <Text selectable={false} numberOfLines={1} style={styles.phase}>
          {phase}
        </Text>
      ) : (
        <View style={styles.spacer} />
      )}
      {allDone ? (
        <Icon name="CircleCheck" size={PROGRESS_SIZE} color={tokens.success} />
      ) : (
        <ProgressRing
          value={completedCount}
          max={totalCount}
          size={PROGRESS_SIZE}
          stroke={PROGRESS_STROKE}
          color={tokens.accent}
          trackColor={tokens.v2.surface2}
        />
      )}
      {panel.pop ? (
        // At the row's end, in the timeline: its name opens above and leftwards.
        <TooltipSideContext.Provider value="auto">
          <TooltipAlignContext.Provider value="end">
            <ToolbarButton icon="PictureInPicture2" label="Open tasks in a window" onPress={panel.pop} tokens={tokens} />
          </TooltipAlignContext.Provider>
        </TooltipSideContext.Provider>
      ) : null}
    </>
  );

  return (
    <View {...selectionSurface} style={styles.container}>
      {full ? null : longPress ? (
        <Pressable ref={setHeader} accessible={false} onLongPress={longPress} style={[styles.row, styles.rowClosed]}>
          {header}
        </Pressable>
      ) : (
        <View ref={setHeader} style={[styles.row, styles.rowClosed]}>
          {header}
        </View>
      )}

      {tasks.map((task) => {
        const isDone = task.status === "completed";
        const isActive = task.status === "in_progress";
        const isBlocked = task.status === "blocked";
        const isBlockedOpen = expandedBlockedId === task.id;
        const isOpen = full || expanded.has(task.id);
        const mark = isActive ? (
          <RunningDot color={tokens.accent} accessibilityLabel="In progress" />
        ) : isDone ? (
          <Icon name="Check" size={DISCLOSURE_HEADER.icon} color={tokens.success} />
        ) : isBlocked ? (
          <Icon name="TriangleAlert" size={DISCLOSURE_HEADER.icon} color={tokens.warning} />
        ) : (
          <View style={styles.ring} />
        );

        return (
          <React.Fragment key={task.id}>
            <View style={[styles.row, isOpen ? styles.rowOpen : styles.rowClosed]}>
              {full ? (
                <View style={[styles.slot, styles.slotOpen]}>{mark}</View>
              ) : (
                <Pressable
                  accessibilityLabel={`Set ${task.title} status`}
                  hitSlop={compact ? 6 : 0}
                  onPress={() => toggleStatus(task)}
                  onLongPress={longPress}
                  style={[styles.slot, isOpen && styles.slotOpen]}
                >
                  {mark}
                </Pressable>
              )}
              <Text
                // A long press opens the panel, where the titles are selectable.
                selectable={!longPress}
                numberOfLines={isOpen ? 0 : 1}
                {...(full
                  ? null
                  : {
                      accessibilityRole: "button" as const,
                      accessibilityState: { expanded: isOpen },
                      // React Native Web reads the ARIA prop, not `accessibilityState`.
                      "aria-expanded": isOpen,
                      onPress: () => toggleExpanded(task.id),
                      onLongPress: longPress,
                    })}
                style={[styles.title, unwrapped ? styles.titleUnwrapped : styles.titleFill, isDone && styles.titleDone]}
              >
                {task.title}
              </Text>
              {isBlocked ? (
                <Text
                  selectable={false}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isBlockedOpen }}
                  onPress={() => setExpandedBlockedId(isBlockedOpen ? null : task.id)}
                  style={[styles.blocked, isOpen && styles.firstLine]}
                >
                  Blocked
                </Text>
              ) : null}
              {task.duration ? (
                <Text selectable style={[styles.meta, isOpen && styles.firstLine]}>
                  {task.duration}
                </Text>
              ) : null}
            </View>
            {isBlocked && isBlockedOpen && task.blockerReason ? (
              <FadeIn style={styles.reason}>
                <Text selectable style={styles.reasonText}>
                  {task.blockerReason}
                </Text>
              </FadeIn>
            ) : null}
          </React.Fragment>
        );
      })}
      {shared || full ? null : <TaskListPanel panel={own} data={data} tokens={tokens} compact={compact} />}
    </View>
  );
}

/** A drag across a title selects its text on web; the click ending it must not also fold the row. */
function selectingText(): boolean {
  if (Platform.OS !== "web") return false;
  const selection = (globalThis as { getSelection?: () => Selection | null }).getSelection?.();
  return Boolean(selection && !selection.isCollapsed);
}

/** The checklist's panel, for a list or for a caller that keeps it past the list (`TaskList` `panel`). */
export function useTaskListPanel(enabled = true): TaskListPanelControl {
  return useHoverPreview(enabled);
}

/** The panel while it is open: `TaskListPreview` on the row preview's layer. */
export function TaskListPanel({ panel, data, tokens, compact = false }: {
  panel: TaskListPanelControl;
  data: TaskListData;
  tokens: ExtendedThemeTokens;
  compact?: boolean;
}) {
  if (!panel.open) return null;
  return (
    <HoverPreview preview={panel} tokens={tokens}>
      <TaskListPreview data={data} tokens={tokens} compact={compact} />
    </HoverPreview>
  );
}

/**
 * The whole list as a preview draws it: "Tasks 3/5" in the title bar, then
 * every task with its title in full. The body scrolls when it is long.
 */
export function TaskListPreview({ data, tokens, compact = false }: {
  data: TaskListData;
  tokens: ExtendedThemeTokens;
  compact?: boolean;
}) {
  const done = data.tasks.filter((task) => task.status === "completed").length;
  return (
    <>
      <HoverPreviewHeader
        tokens={tokens}
        icon={<Icon name="ListChecks" size={14} color={tokens.foregroundMuted} />}
        center={
          <Text
            testID="task-list-preview-title"
            selectable={false}
            numberOfLines={1}
            style={[unselectable, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi, fontSize: tokens.typography.ui.scale.base }]}
          >
            {`Tasks ${done}/${data.tasks.length}`}
          </Text>
        }
      />
      <HoverPreviewBody>
        <TaskList data={data} tokens={tokens} compact={compact} full />
      </HoverPreviewBody>
    </>
  );
}
