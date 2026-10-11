import type { TaskItemData, TaskStatus } from "../../shared/contracts";

/**
 * A status the reader set on a task by tapping it, and the host status it
 * was set over. The host's list stays the source of truth: an override holds
 * only while the host still reports `base` for that task, so a later host
 * update (the agent ticking the task off) always wins over a stale tap.
 */
export interface TaskOverride {
  status: TaskStatus;
  base: TaskStatus;
}

export type TaskOverrides = Readonly<Record<string, TaskOverride>>;

export const NO_OVERRIDES: TaskOverrides = Object.freeze({});

/**
 * The tasks to draw: the host's latest list, with each live override applied.
 * Returns `tasks` itself when no override applies, so memoised rows hold.
 */
export function applyTaskOverrides(
  tasks: readonly TaskItemData[],
  overrides: TaskOverrides,
): readonly TaskItemData[] {
  let changed = false;
  const next = tasks.map((task) => {
    const override = overrides[task.id];
    if (!override || override.base !== task.status || override.status === task.status) return task;
    changed = true;
    return { ...task, status: override.status };
  });
  return changed ? next : tasks;
}

/** Records a tap on `hostTask` (the host's version of the task, not the drawn one). */
export function setTaskOverride(
  overrides: TaskOverrides,
  hostTask: TaskItemData,
  status: TaskStatus,
): TaskOverrides {
  const next = { ...overrides };
  if (status === hostTask.status) delete next[hostTask.id];
  else next[hostTask.id] = { status, base: hostTask.status };
  return next;
}
