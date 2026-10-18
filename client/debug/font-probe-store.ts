/** Fixed samples only: never retain the command being diagnosed. */
export const FONT_SAMPLES = { narrow: "iiiiiiii", wide: "WWWWWWWW" } as const;
export type FontSample = keyof typeof FONT_SAMPLES;

export interface FontProbeMetadata {
  runtimePlatform: string;
  tokenPlatform: string;
  family: string | null;
  size: number | null;
  weight: string | null;
  fontStyle: string | null;
  letterSpacing: number | null;
  monoSource: string;
  selectionContext: boolean;
}

interface FontProbeSnapshot extends FontProbeMetadata {
  narrowWidth: number | null;
  wideWidth: number | null;
  equalWidths: boolean | null;
}

let latest: FontProbeSnapshot | null = null;

/** A late layout from an older panel cannot overwrite the current capture. */
export function beginFontProbe(metadata: FontProbeMetadata): (sample: FontSample, width: number) => void {
  const capture: FontProbeSnapshot = { ...metadata, narrowWidth: null, wideWidth: null, equalWidths: null };
  latest = capture;
  return (sample, width) => {
    if (latest !== capture || !Number.isFinite(width) || width <= 0) return;
    capture[sample === "narrow" ? "narrowWidth" : "wideWidth"] = width;
    if (capture.narrowWidth !== null && capture.wideWidth !== null) {
      // Allow half a layout point of rounding across the eight glyphs.
      capture.equalWidths = Math.abs(capture.narrowWidth - capture.wideWidth) <= 0.5;
    }
  };
}

export function fontProbeSnapshot(): FontProbeSnapshot | null {
  return latest ? { ...latest } : null;
}

export function resetFontProbe(): void {
  latest = null;
}
