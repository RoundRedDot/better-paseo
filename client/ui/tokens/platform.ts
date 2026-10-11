import { Platform } from "react-native";
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
