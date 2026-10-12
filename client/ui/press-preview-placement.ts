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

/**
 * The phone chrome the preview leaves in view, inside the safe area: Paseo's
 * header (56 and its 8 top padding) and the agent's tab bar (36) above, the
 * composer below (about 100 on iOS, 120 on Android with its navigation bar).
 * The host tells a plugin neither the timeline's bounds nor these heights, so
 * they are Paseo 0.11's, read from its layout constants and measured on device.
 */
export const PHONE_CHROME = {
  top: 100,
  bottom: 120,
} as const;

export interface PressPreviewFrame {
  width: number;
  maxHeight: number;
}

/**
 * The size of a long-pressed row's preview on a phone. It opens in the middle
 * of the timeline's band of the safe area (`stage` less `PHONE_CHROME`), sized
 * like the desktop's maximized preview, whose viewport is the timeline too: as
 * wide as the row, the text column the desktop panel spans, and as tall as its
 * content, up to the band less `maximizedGap` above and below.
 */
export function pressPreviewFrame(
  stage: { width: number; height: number },
  rowWidth: number,
): PressPreviewFrame {
  const { maximizedGap, margin } = PREVIEW_LIMIT;
  const band = stage.height - PHONE_CHROME.top - PHONE_CHROME.bottom;
  return {
    width: Math.max(0, Math.min(rowWidth, stage.width - 2 * margin)),
    maxHeight: Math.max(0, band - 2 * maximizedGap),
  };
}
