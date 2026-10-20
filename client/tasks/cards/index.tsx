/**
 * The cards' public contract (slice B owns this directory): the status icon,
 * the card and its details, plus the derived colours and formatters the
 * board and settings slices share.
 *
 * Every running ring rotates in phase from one clock (`status-icon.tsx`); the
 * card re-renders for a clock tick only when its timer text changes
 * (`sameCardProps`), so the board should pass stable callbacks.
 */

export { StatusIcon, statusMarkSize, STATUS_RING_PERIOD_MS, type StatusIconProps } from "./status-icon";
export {
  TaskCardView,
  cardLayout,
  cardTimer,
  sameCardProps,
  type CardCallbacks,
  type CardLayout,
  type TaskCardViewProps,
} from "./task-card";
export { TaskDetails, detailRows, type TaskDetailsProps } from "./task-details";
export { buildTaskTokens, taskTokens, useTaskTokens, type TaskTokens } from "./tokens";
export {
  contextRatio,
  contextTone,
  formatApprox,
  formatCost,
  formatDuration,
  formatRelative,
  formatTokens,
  formatWait,
  since,
  type ContextTone,
} from "./format";
export { cardStrings, subtaskSummary } from "./strings";
