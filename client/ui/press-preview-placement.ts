/**
 * The preview's limits, shared with the desktop hover preview
 * (`openPreviewLayer`): the hover panel is never taller than `maxHeight`, a
 * maximized one keeps `maximizedGap` above and below, and both stay `margin`
 * clear of the edges of the space they open in.
 */
export const PREVIEW_LIMIT = {
  maxHeight: 360,
  maximizedGap: 16,
  margin: 8,
} as const;

export interface PressPreviewFrame {
  width: number;
  maxHeight: number;
}

/**
 * The size of a long-pressed row's preview on a phone, which opens in the
 * middle of the safe area (`stage`). A phone has no room to hover a panel
 * beside the row and no button to enlarge it, so it is sized like the
 * desktop's maximized preview: as wide as the row, the text column the desktop
 * panel spans too, and as tall as its content, up to the safe area less
 * `margin` and `maximizedGap` above and below.
 */
export function pressPreviewFrame(
  stage: { width: number; height: number },
  rowWidth: number,
): PressPreviewFrame {
  const { maximizedGap, margin } = PREVIEW_LIMIT;
  return {
    width: Math.max(0, Math.min(rowWidth, stage.width - 2 * margin)),
    maxHeight: Math.max(0, stage.height - 2 * (margin + maximizedGap)),
  };
}
