import React, { useState } from "react";
import { StyleSheet } from "react-native";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { TaskList, TaskListPreview } from "./task-list";
import { DisclosureHeader, RowIcon } from "../ui/disclosure-header";
import { FadeIn } from "../ui/fade-in";
import type { TodoActivity } from "../state/todo-timeline";
import type { TaskListData } from "../../shared/contracts";

interface TaskActivityRowProps {
  /** What the update changed (`deriveTodoActivities`); empty when nothing named did. */
  activities: readonly TodoActivity[];
  /** The list as it stood after the update. */
  data: TaskListData;
  tokens: ExtendedThemeTokens;
  /** `layout.compact`. */
  compact?: boolean;
}

/** Paseo's badge icons for each change (`taskActivityIcon` in its `message.tsx`). */
const ACTIVITY_ICON: Record<TodoActivity["type"], string> = {
  created: "ListChecks",
  added: "Plus",
  started: "CircleDot",
  completed: "Check",
};

const ACTIVITY_VERB: Record<TodoActivity["type"], string> = {
  created: "Created",
  added: "Added",
  started: "Started",
  completed: "Completed",
};

function activityTarget(activity: TodoActivity): string {
  if (activity.type === "created") return `${activity.count} ${activity.count === 1 ? "task" : "tasks"}`;
  return activity.task;
}

const styles = StyleSheet.create({
  body: { marginTop: 2 },
});

/**
 * An earlier checklist update, folded to one row the way Paseo draws every
 * one: the change it made ("Completed Fix the bug"), a `+1` when it made more
 * than one, and the list's progress. Opened, it shows the list as it stood
 * after that update; hovered on web or long-pressed on a phone, it previews
 * that list the way a tool row previews its output. Only the newest update
 * draws its checklist open (`state/todo-timeline.ts`).
 */
export function TaskActivityRow({ activities, data, tokens, compact = false }: TaskActivityRowProps) {
  const [expanded, setExpanded] = useState(false);
  const first = activities[0];
  const done = data.tasks.filter((task) => task.status === "completed").length;
  const meta: string[] = [];
  if (activities.length > 1) meta.push(`+${activities.length - 1}`);
  meta.push(`${done}/${data.tasks.length}`);
  const verb = first ? ACTIVITY_VERB[first.type] : "Tasks";
  const target = first ? activityTarget(first) : undefined;
  const label = activities.map((activity) => `${ACTIVITY_VERB[activity.type]} ${activityTarget(activity)}`).join(", ");

  return (
    <>
      <DisclosureHeader
        expanded={expanded}
        onToggle={() => setExpanded((prev) => !prev)}
        tokens={tokens}
        compact={compact}
        icon={<RowIcon name={first ? ACTIVITY_ICON[first.type] : "ListChecks"} />}
        verb={verb}
        target={target}
        meta={meta}
        accessibilityLabel={label || `Tasks ${done}/${data.tasks.length}`}
        previewContent={() => <TaskListPreview data={data} tokens={tokens} compact={compact} />}
      />
      {expanded ? (
        <FadeIn style={styles.body}>
          <TaskList data={data} tokens={tokens} compact={compact} />
        </FadeIn>
      ) : null}
    </>
  );
}
