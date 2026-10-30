import { CODE_SIZE, type MonoSource, type TypographyPlatform } from "./ui/tokens/typography";
import { SETTINGS_STRINGS, type SettingsStrings } from "./i18n/settings-page-strings";

/**
 * The settings page's line under "Follow Paseo": which source is in effect,
 * so a reader can see the Paseo setting arrive.
 */
export function describeMonoSource(
  source: MonoSource,
  platform: TypographyPlatform,
  strings: SettingsStrings = SETTINGS_STRINGS.en,
): string {
  if (source.kind === "host-typography") return strings.monoFollowingHost;
  if (source.kind === "paseo-appearance") return strings.monoFollowingAppearance(source.family ?? null, source.size);
  return platform === "web" ? strings.monoDefaultWeb(CODE_SIZE.default) : strings.monoDefaultNative(CODE_SIZE.default);
}
