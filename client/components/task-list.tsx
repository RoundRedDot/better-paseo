import React, { useState, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Glyph } from "./glyph";
import { radiusV2, space } from "./theme-tokens";
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
import { DISCLOSURE_HEADER } from "../ui/disclosure-header";
import { UI_SCALE } from "../ui/tokens/typography";

interface TaskListProps {
  data: TaskListData;
  tokens: ExtendedThemeTokens;
  onToggleTask?: (taskId: string, newStatus: TaskStatus) => void;
}

/** Row height (plan §3.6): one line of 13px text, as in a native list. */
const ROW_HEIGHT = 24;
const PROGRESS_HEIGHT = 2;

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  pending: "in_progress",
  in_progress: "completed",
  completed: "pending",
  blocked: "pending",
};

/**
 * The agent's checklist, flat (plan §3.6): a `Tasks · 3/7` header over a 2px
 * progress line, then one 24px row per task. The only motion is the
 * `RunningDot` of the task in progress; the progress line jumps to its new
 * value without animating.
 */
export function TaskList({ data, tokens, onToggleTask }: TaskListProps) {
  // The host's list is the source of truth and is re-read on every update; a
  // tap only overrides a task until the host reports a new status for it.
  const [overrides, setOverrides] = useState<TaskOverrides>(NO_OVERRIDES);
  const tasks = useMemo(() => applyTaskOverrides(data.tasks, overrides), [data.tasks, overrides]);
  const [expandedBlockedId, setExpandedBlockedId] = useState<string | null>(null);

  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const totalCount = tasks.length;
  const progress = totalCount > 0 ? completedCount / totalCount : 0;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          borderRadius: radiusV2.card,
          borderWidth: 1,
          borderColor: tokens.v2.border,
          backgroundColor: tokens.v2.surface0,
          overflow: "hidden",
          ...selectableSurface,
        },
        header: {
          height: DISCLOSURE_HEADER.height.desktop,
          flexDirection: "row",
          alignItems: "center",
          gap: DISCLOSURE_HEADER.gap,
          paddingHorizontal: DISCLOSURE_HEADER.paddingX,
        },
        iconSlot: {
          width: DISCLOSURE_HEADER.iconSlot,
          alignItems: "center",
          justifyContent: "center",
        },
        headerTitle: {
          fontFamily: tokens.fontUi,
          fontSize: DISCLOSURE_HEADER.verb,
          fontWeight: "500",
          color: tokens.foreground,
          ...unselectable,
        },
        headerCount: {
          fontFamily: tokens.fontUi,
          fontSize: DISCLOSURE_HEADER.meta,
          fontVariant: ["tabular-nums"],
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        phase: {
          flex: 1,
          minWidth: 0,
          textAlign: "right",
          fontFamily: tokens.fontUi,
          fontSize: DISCLOSURE_HEADER.meta,
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        progressTrack: {
          height: PROGRESS_HEIGHT,
          backgroundColor: tokens.v2.borderSubtle,
        },
        progressFill: {
          height: PROGRESS_HEIGHT,
          backgroundColor: tokens.accent,
        },
        list: {
          paddingVertical: space.xs,
        },
        row: {
          minHeight: ROW_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: DISCLOSURE_HEADER.gap,
          paddingHorizontal: DISCLOSURE_HEADER.paddingX,
        },
        statusSlot: {
          width: DISCLOSURE_HEADER.iconSlot,
          height: ROW_HEIGHT,
          alignItems: "center",
          justifyContent: "center",
        },
        titlePress: {
          flex: 1,
          minWidth: 0,
        },
        title: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.md,
          lineHeight: 18,
          color: tokens.foreground,
        },
        titleDone: {
          color: tokens.foregroundSubtle,
          textDecorationLine: "line-through",
        },
        titleActive: {
          fontWeight: "500",
        },
        meta: {
          fontFamily: tokens.fontUi,
          fontSize: DISCLOSURE_HEADER.meta,
          fontVariant: ["tabular-nums"],
          color: tokens.foregroundMuted,
        },
        blocked: {
          fontFamily: tokens.fontUi,
          fontSize: DISCLOSURE_HEADER.meta,
          color: tokens.warning,
          ...unselectable,
        },
        reason: {
          // Under the title, past the status slot.
          paddingLeft: DISCLOSURE_HEADER.paddingX + DISCLOSURE_HEADER.iconSlot + DISCLOSURE_HEADER.gap,
          paddingRight: DISCLOSURE_HEADER.paddingX,
          paddingBottom: space.xs,
        },
        reasonText: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.base,
          lineHeight: 16,
          color: tokens.warning,
        },
      }),
    [tokens],
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
      <View style={styles.header}>
        <View style={styles.iconSlot}>
          <Glyph name="ListChecks" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
        </View>
        <Text selectable={false} style={styles.headerTitle}>
          Tasks
        </Text>
        <Text selectable={false} style={styles.headerCount}>
          {`· ${completedCount}/${totalCount}`}
        </Text>
        {phase ? (
          <Text selectable={false} numberOfLines={1} style={styles.phase}>
            {phase}
          </Text>
        ) : null}
      </View>

      <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: totalCount, now: completedCount }}
      >
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      <View style={styles.list}>
        {tasks.map((task) => {
          const isDone = task.status === "completed";
          const isActive = task.status === "in_progress";
          const isBlocked = task.status === "blocked";
          const isBlockedOpen = expandedBlockedId === task.id;

          return (
            <View key={task.id}>
              <View style={styles.row}>
                <Pressable
                  accessibilityLabel={`Set ${task.title} status`}
                  onPress={() => toggleStatus(task)}
                  style={styles.statusSlot}
                >
                  {isActive ? (
                    <RunningDot color={tokens.accent} accessibilityLabel="In progress" />
                  ) : isDone ? (
                    <Glyph name="CheckCircle" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
                  ) : isBlocked ? (
                    <Glyph name="AlertCircle" size={DISCLOSURE_HEADER.icon} color={tokens.warning} />
                  ) : (
                    <Glyph name="Circle" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundSubtle} />
                  )}
                </Pressable>
                <Pressable onPress={() => toggleStatus(task)} style={styles.titlePress}>
                  <Text
                    selectable
                    style={[styles.title, isDone && styles.titleDone, isActive && styles.titleActive]}
                  >
                    {task.title}
                  </Text>
                </Pressable>
                {isBlocked ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isBlockedOpen }}
                    onPress={() => setExpandedBlockedId(isBlockedOpen ? null : task.id)}
                  >
                    <Text selectable={false} style={styles.blocked}>
                      Blocked
                    </Text>
                  </Pressable>
                ) : null}
                {task.duration ? (
                  <Text selectable style={styles.meta}>
                    {task.duration}
                  </Text>
                ) : null}
              </View>
              {isBlocked && isBlockedOpen && task.blockerReason ? (
                <View style={styles.reason}>
                  <Text selectable style={styles.reasonText}>
                    {task.blockerReason}
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
