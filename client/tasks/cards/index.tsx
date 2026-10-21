/**
 * The cards' public contract (slice B owns this directory): the status icon,
 * the card and its details, plus the derived colours and formatters the
 * board and settings slices share.
 *
 * Every running ring rotates in phase from one clock (`status-icon.tsx`). The
 * board's second clock is a store (`clock.ts`): a tick re-renders a card's
 * timer text and nothing else, so the board should pass stable callbacks.
 */

export { createTaskClock, useTime, type TaskClock, type TickingClock, type TimeSource } from "./clock";

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
export { DETAIL_CARD, DetailBodyCards, DetailCard, DetailHeaderCard, RoundIcon, TaskDetailCards, detailCardFrame, type DetailCardsStrings, type DetailNotice, type TaskDetailCardsProps } from "./detail-cards";
export { SUBTASK_ROWS, branchHint, shortenPath, usageRows } from "./details-format";
export { buildTaskTokens, taskTokens, useTaskTokens, type TaskTokens } from "./tokens";
export {
  contextRatio,
  contextTone,
  formatApprox,
  formatClockTime,
  formatCost,
  formatDuration,
  formatRelative,
  formatTokens,
  formatWait,
  since,
  tildePath,
  type ContextTone,
} from "./format";
export { cardStrings, subtaskSummary } from "./strings";
export { BrandMark, PiMark, brandTint } from "./brand-mark";
export { ContextRing, contextRingTone, formatSessionCost, formatTokenCount } from "./context-ring";
export { ProjectIcon, identityColor, projectIconRadius, projectInitial, projectViewKey } from "./project-icon";
