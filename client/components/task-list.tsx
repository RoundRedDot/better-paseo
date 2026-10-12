import React, { useState, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
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
import { FadeIn } from "../ui/fade-in";
import { DISCLOSURE_HEADER } from "../ui/disclosure-header";
import { TYPE } from "../ui/tokens/typography";

interface TaskListProps {
  data: TaskListData;
  tokens: ExtendedThemeTokens;
  /** `layout.compact`: 32pt rows. */
  compact?: boolean;
  onToggleTask?: (taskId: string, newStatus: TaskStatus) => void;
}

/** The static progress line in the header (S7 §3.3): 48 wide, 2 tall. */
const PROGRESS_WIDTH = 48;
const PROGRESS_HEIGHT = 2;
/** The pending ring. */
const RING = 10;

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  pending: "in_progress",
  in_progress: "completed",
  completed: "pending",
  blocked: "pending",
};

/**
 * The agent's checklist as rows (S7 design spec §3.3): a header row —
 * `Tasks 1/4` and a static 2px progress line — then one row per task in the
 * same status slot as a tool's icon, so a checklist lines up with the calls
 * around it. No frame, no fill. The only motion is the `RunningDot` of the
 * task in progress; the progress line jumps to its value.
 *
 * Four views per task: the row, its status button, the status mark and the
 * title, which takes the same press.
 */
export function TaskList({ data, tokens, compact = false, onToggleTask }: TaskListProps) {
  // The host's list is the source of truth and is re-read on every update; a
  // tap only overrides a task until the host reports a new status for it.
  const [overrides, setOverrides] = useState<TaskOverrides>(NO_OVERRIDES);
  const tasks = useMemo(() => applyTaskOverrides(data.tasks, overrides), [data.tasks, overrides]);
  const [expandedBlockedId, setExpandedBlockedId] = useState<string | null>(null);

  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const totalCount = tasks.length;
  const allDone = totalCount > 0 && completedCount === totalCount;
  const progress = totalCount > 0 ? completedCount / totalCount : 0;
  const rowHeight = compact ? DISCLOSURE_HEADER.height.compact : DISCLOSURE_HEADER.height.desktop;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          ...selectableSurface,
        },
        row: {
          height: rowHeight,
          flexDirection: "row",
          alignItems: "center",
          gap: DISCLOSURE_HEADER.gap,
          paddingHorizontal: DISCLOSURE_HEADER.paddingX,
          marginHorizontal: -DISCLOSURE_HEADER.bleed,
        },
        slot: {
          width: DISCLOSURE_HEADER.iconSlot,
          paddingRight: DISCLOSURE_HEADER.iconSlotPad,
          alignSelf: "stretch",
          alignItems: "center",
          justifyContent: "center",
        },
        headerTitle: {
          fontFamily: tokens.fontUi,
          fontSize: TYPE.label.size,
          lineHeight: TYPE.label.lineHeight,
          fontWeight: "500",
          color: tokens.foreground,
          ...unselectable,
        },
        headerCount: {
          fontFamily: tokens.fontMono,
          fontSize: TYPE.meta.size,
          lineHeight: TYPE.meta.lineHeight,
          fontVariant: ["tabular-nums"],
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        phase: {
          flex: 1,
          minWidth: 0,
          textAlign: "right",
          fontFamily: tokens.fontUi,
          fontSize: TYPE.caption.size,
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        spacer: { flex: 1 },
        progressTrack: {
          width: PROGRESS_WIDTH,
          height: PROGRESS_HEIGHT,
          backgroundColor: tokens.v2.surface2,
        },
        progressFill: {
          height: PROGRESS_HEIGHT,
        },
        ring: {
          width: RING,
          height: RING,
          borderRadius: RING / 2,
          borderWidth: 1.5,
          borderColor: tokens.foregroundSubtle,
        },
        title: {
          flex: 1,
          minWidth: 0,
          fontFamily: tokens.fontUi,
          fontSize: TYPE.label.size,
          lineHeight: TYPE.label.lineHeight,
          color: tokens.foreground,
        },
        titleDone: {
          color: tokens.foregroundMuted,
        },
        meta: {
          fontFamily: tokens.fontMono,
          fontSize: TYPE.meta.size,
          fontVariant: ["tabular-nums"],
          color: tokens.foregroundMuted,
        },
        blocked: {
          fontFamily: tokens.fontUi,
          fontSize: TYPE.caption.size,
          lineHeight: TYPE.caption.lineHeight,
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
          fontSize: TYPE.settingNote.size,
          lineHeight: TYPE.settingNote.lineHeight,
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

  // A live checklist always arrives as "Checklist Progress"; only a named
  // phase says something the header does not.
  const phase = data.phaseName && data.phaseName !== "Checklist Progress" ? data.phaseName : null;

  return (
    <View {...selectionSurface} style={styles.container}>
      <View style={styles.row}>
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
        <View
          style={styles.progressTrack}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: totalCount, now: completedCount }}
        >
          <View
            style={[
              styles.progressFill,
              {
                width: Math.round(progress * PROGRESS_WIDTH),
                backgroundColor: allDone ? tokens.success : tokens.accent,
              },
            ]}
          />
        </View>
      </View>

      {tasks.map((task) => {
        const isDone = task.status === "completed";
        const isActive = task.status === "in_progress";
        const isBlocked = task.status === "blocked";
        const isBlockedOpen = expandedBlockedId === task.id;

        return (
          <React.Fragment key={task.id}>
            <View style={styles.row}>
              <Pressable
                accessibilityLabel={`Set ${task.title} status`}
                hitSlop={compact ? 6 : 0}
                onPress={() => toggleStatus(task)}
                style={styles.slot}
              >
                {isActive ? (
                  <RunningDot color={tokens.accent} accessibilityLabel="In progress" />
                ) : isDone ? (
                  <Icon name="Check" size={DISCLOSURE_HEADER.icon} color={tokens.success} />
                ) : isBlocked ? (
                  <Icon name="TriangleAlert" size={DISCLOSURE_HEADER.icon} color={tokens.warning} />
                ) : (
                  <View style={styles.ring} />
                )}
              </Pressable>
              <Text
                selectable
                numberOfLines={1}
                onPress={() => toggleStatus(task)}
                style={[styles.title, isDone && styles.titleDone]}
              >
                {task.title}
              </Text>
              {isBlocked ? (
                <Text
                  selectable={false}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isBlockedOpen }}
                  onPress={() => setExpandedBlockedId(isBlockedOpen ? null : task.id)}
                  style={styles.blocked}
                >
                  Blocked
                </Text>
              ) : null}
              {task.duration ? (
                <Text selectable style={styles.meta}>
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
    </View>
  );
}
