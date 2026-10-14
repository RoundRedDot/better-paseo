import { clampPreview, type PreviewBox } from "./preview-frame";

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
 * workspace header above (56 and its 8 top padding; the agent's tab bar under
 * it may be covered), the composer below. The composer sits 104 above the safe
 * area on iOS; Android's safe area keeps its navigation bar, so there it is
 * 120. The host tells a plugin neither the timeline's bounds nor these heights,
 * so they are Paseo 0.11's, read from its layout constants and measured on
 * device. `gap` keeps the panel off both.
 */
export const PHONE_CHROME = {
  top: 64,
  bottom: { ios: 104, android: 120 },
  gap: 8,
} as const;

/** The chrome above and below the preview on this platform. */
export function phoneChrome(os: string): { top: number; bottom: number } {
  return { top: PHONE_CHROME.top, bottom: os === "ios" ? PHONE_CHROME.bottom.ios : PHONE_CHROME.bottom.android };
}

export interface PressPreviewFrame {
  width: number;
  maxHeight: number;
}

/**
 * The size of a long-pressed row's preview on a phone. It opens in the middle
 * of the band of the safe area between the header and the composer (`stage`
 * less `phoneChrome`): as wide as the row, the text column the desktop panel
 * spans, and as tall as its content, up to the band less `gap` above and below.
 */
export function pressPreviewFrame(
  stage: { width: number; height: number },
  rowWidth: number,
  os: string,
): PressPreviewFrame {
  const { margin } = PREVIEW_LIMIT;
  const chrome = phoneChrome(os);
  const band = stage.height - chrome.top - chrome.bottom;
  return {
    width: Math.max(0, Math.min(rowWidth, stage.width - 2 * margin)),
    maxHeight: Math.max(0, band - 2 * PHONE_CHROME.gap),
  };
}

/**
 * Where that frame first sits: centred in the band between the header and the
 * composer. Absolute coordinates are the stage's own, padding included, so a
 * later drag can slide into that band without a jump from the centred layout.
 */
export function pressPreviewOrigin(
  stage: { width: number; height: number },
  size: { width: number; height: number },
  os: string,
): PreviewBox {
  const chrome = phoneChrome(os);
  const inner = stage.height - chrome.top - chrome.bottom;
  return clampPreview(
    {
      x: (stage.width - size.width) / 2,
      y: chrome.top + (inner - size.height) / 2,
      width: size.width,
      height: size.height,
    },
    stage,
    size,
    PREVIEW_LIMIT.margin,
  );
}
