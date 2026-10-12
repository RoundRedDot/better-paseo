/**
 * The preview's limits, shared with the desktop hover preview
 * (`openPreviewLayer`): never taller than `maxHeight`, and `margin` clear of
 * the edges of the space it opens in.
 */
export const PREVIEW_LIMIT = {
  maxHeight: 360,
  margin: 8,
} as const;

export interface PressPreviewFrame {
  width: number;
  maxHeight: number;
}

/**
 * The size of a long-pressed row's preview on a phone, which opens in the
 * middle of the safe area (`stage`). It is as wide as the row, the text column
 * the desktop panel spans too, and as tall as its content, up to the desktop's
 * limit: 360, or the room inside the margins on a shorter screen.
 */
export function pressPreviewFrame(
  stage: { width: number; height: number },
  rowWidth: number,
): PressPreviewFrame {
  const { maxHeight, margin } = PREVIEW_LIMIT;
  return {
    width: Math.max(0, Math.min(rowWidth, stage.width - 2 * margin)),
    maxHeight: Math.max(0, Math.min(maxHeight, stage.height - 2 * margin)),
  };
}
