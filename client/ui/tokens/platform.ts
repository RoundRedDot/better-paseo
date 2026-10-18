import { PixelRatio, Platform, StyleSheet } from "react-native";
import type { ViewStyle } from "react-native";
import type { TypographyPlatform } from "./typography";

/**
 * The running platform, narrowed to the three the host reports in
 * `layout.platform`. Electron and every browser are `web`.
 */
export function currentPlatform(): TypographyPlatform {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

/**
 * A horizontal hairline — a reply's `---`, a sticky header's rule — one device
 * pixel thick.
 *
 * `StyleSheet.hairlineWidth` is that device pixel on iOS and Android, but React
 * Native Web answers with a whole CSS pixel, and Chromium then snaps a sub-pixel
 * height up to a whole one as well: a `0.5` rule paints two device pixels on a
 * dense display, exactly as thick as a `1`. Drawing the rule a pixel tall and
 * letting the compositor scale it does paint one — scaled about an edge, which
 * keeps it on the pixel grid instead of smearing it across two — and leaves a
 * 1x display an unscaled, crisp line.
 *
 * The platform is the tokens', not the running one, so a settings preview draws
 * the line of the phone it shows.
 */
export function hairline(platform: TypographyPlatform, origin: "top" | "bottom" = "top"): ViewStyle {
  if (platform !== "web") return { height: StyleSheet.hairlineWidth };
  return {
    height: 1,
    transformOrigin: origin,
    transform: [{ scaleY: 1 / PixelRatio.get() }],
  };
}
