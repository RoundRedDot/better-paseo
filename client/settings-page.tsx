import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { hostFontEscape } from "./components/host-font-escape";
import { radius, buildThemeTokens, type ExtendedThemeTokens } from "./components/theme-tokens";
import {
  ACCENT_PRESETS,
  resetEnhancerPreferences,
  updateEnhancerPreferences,
  useEnhancerPreferences,
  type AccentPreset,
  type CodeFontPreference,
  type UiFontPreference,
} from "./preferences";

const ACCENT_OPTIONS: ReadonlyArray<{
  id: AccentPreset;
  label: string;
  color: string | undefined;
}> = [
  { id: "host", label: "Host theme", color: undefined },
  { id: "jade", label: "Jade", color: ACCENT_PRESETS.jade },
  { id: "violet", label: "Violet", color: ACCENT_PRESETS.violet },
  { id: "amber", label: "Amber", color: ACCENT_PRESETS.amber },
  { id: "rose", label: "Rose", color: ACCENT_PRESETS.rose },
];

function OptionButton({
  label,
  selected,
  onPress,
  tokens,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.option,
        {
          backgroundColor: selected ? tokens.accentBg : tokens.surface2,
          borderColor: selected ? tokens.accent : tokens.borderSubtle,
        },
      ]}
    >
      <Text
        style={[styles.optionLabel, { color: selected ? tokens.accent : tokens.foregroundMuted }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ChoiceRow<T extends string>({
  title,
  description,
  value,
  options,
  onChange,
  tokens,
}: {
  title: string;
  description: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange(value: T): void;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <View style={[styles.row, { borderTopColor: tokens.borderSubtle }]}>
      <Text style={[styles.rowTitle, { color: tokens.foreground }]}>{title}</Text>
      <Text style={[styles.rowDescription, { color: tokens.foregroundMuted }]}>{description}</Text>
      <View style={styles.options}>
        {options.map((option) => (
          <OptionButton
            key={option.value}
            label={option.label}
            selected={value === option.value}
            onPress={() => onChange(option.value)}
            tokens={tokens}
          />
        ))}
      </View>
    </View>
  );
}

/** Settings content mounted by Paseo under the selected host's Plugin settings. */
export function BeautifulChatSettingsPage({ theme }: PluginSurfaceProps) {
  const preferences = useEnhancerPreferences();
  const tokens = useMemo(
    () => buildThemeTokens(theme.colors, preferences),
    [preferences, theme.colors],
  );

  return (
    <View {...hostFontEscape} style={[styles.container, { backgroundColor: tokens.surface0 }]}>
      <View
        style={[
          styles.intro,
          { borderColor: tokens.borderSubtle, backgroundColor: tokens.surface1 },
        ]}
      >
        <Text style={[styles.title, { color: tokens.foreground }]}>Chat presentation</Text>
        <Text style={[styles.description, { color: tokens.foregroundMuted }]}>
          Changes apply to every enhanced tool call, reasoning trace, checklist, and prompt in this
          client.
        </Text>
      </View>

      <View
        style={[
          styles.card,
          { borderColor: tokens.borderSubtle, backgroundColor: tokens.surfaceGlass },
        ]}
      >
        <View style={styles.row}>
          <Text style={[styles.rowTitle, { color: tokens.foreground }]}>Accent colour</Text>
          <Text style={[styles.rowDescription, { color: tokens.foregroundMuted }]}>
            Use the current Paseo theme, or choose a presentation accent.
          </Text>
          <View style={styles.accentOptions}>
            {ACCENT_OPTIONS.map((option) => {
              const selected = preferences.accent === option.id;
              const swatch = option.color ?? theme.colors.accent;
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Accent: ${option.label}`}
                  accessibilityState={{ selected }}
                  onPress={() => updateEnhancerPreferences({ accent: option.id })}
                  style={[
                    styles.accentOption,
                    {
                      borderColor: selected ? tokens.accent : tokens.borderSubtle,
                      backgroundColor: selected ? tokens.accentBg : tokens.surface2,
                    },
                  ]}
                >
                  <View style={[styles.swatch, { backgroundColor: swatch }]} />
                  <Text
                    style={[
                      styles.accentLabel,
                      { color: selected ? tokens.accent : tokens.foregroundMuted },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <ChoiceRow<UiFontPreference>
          title="Interface font"
          description="Choose the embedded Inter face or the system interface face."
          value={preferences.uiFont}
          options={[
            { value: "inter", label: "Inter" },
            { value: "system", label: "System" },
          ]}
          onChange={(uiFont) => updateEnhancerPreferences({ uiFont })}
          tokens={tokens}
        />

        <ChoiceRow<CodeFontPreference>
          title="Code glyphs"
          description="Use programming ligatures inside syntax blocks, or keep every code glyph literal."
          value={preferences.codeFont}
          options={[
            { value: "code", label: "Ligatures" },
            { value: "plain", label: "Literal" },
          ]}
          onChange={(codeFont) => updateEnhancerPreferences({ codeFont })}
          tokens={tokens}
        />

        <View style={[styles.row, { borderTopColor: tokens.borderSubtle }]}>
          <Text style={[styles.rowTitle, { color: tokens.foreground }]}>Frosted glass</Text>
          <Text style={[styles.rowDescription, { color: tokens.foregroundMuted }]}>
            Blur surfaces where the host supports it, or use solid surfaces instead.
          </Text>
          <OptionButton
            label={preferences.frostedGlass ? "On" : "Off"}
            selected={preferences.frostedGlass}
            onPress={() =>
              updateEnhancerPreferences({
                frostedGlass: !preferences.frostedGlass,
              })
            }
            tokens={tokens}
          />
        </View>

        <View style={[styles.row, { borderTopColor: tokens.borderSubtle }]}>
          <Text style={[styles.rowTitle, { color: tokens.foreground }]}>
            Enhanced prompt bubble
          </Text>
          <Text style={[styles.rowDescription, { color: tokens.foregroundMuted }]}>
            Paseo removes pasted images before a plugin sees the message, so the enhanced bubble
            cannot show them. Turn this off for Paseo's own bubble with image previews. New prompts
            follow the change.
          </Text>
          <OptionButton
            label={preferences.enhancedUserBubble ? "On" : "Off"}
            selected={preferences.enhancedUserBubble}
            onPress={() =>
              updateEnhancerPreferences({
                enhancedUserBubble: !preferences.enhancedUserBubble,
              })
            }
            tokens={tokens}
          />
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={resetEnhancerPreferences}
        style={[styles.reset, { borderColor: tokens.borderSubtle }]}
      >
        <Text style={[styles.resetText, { color: tokens.foregroundMuted }]}>Reset defaults</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  intro: { padding: 14, borderWidth: 1, borderRadius: radius.card, gap: 4 },
  title: { fontSize: 16, fontWeight: "700" },
  description: { fontSize: 13, lineHeight: 18 },
  card: { borderWidth: 1, borderRadius: radius.card, overflow: "hidden" },
  row: { padding: 14, gap: 8, borderTopWidth: 1 },
  rowTitle: { fontSize: 14, fontWeight: "600" },
  rowDescription: { fontSize: 12, lineHeight: 17 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { borderWidth: 1, borderRadius: radius.block, paddingHorizontal: 10, paddingVertical: 7 },
  optionLabel: { fontSize: 12, fontWeight: "600" },
  accentOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  accentOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.block,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  swatch: { width: 12, height: 12, borderRadius: radius.chip },
  accentLabel: { fontSize: 12, fontWeight: "600" },
  reset: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: radius.block,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  resetText: { fontSize: 12, fontWeight: "600" },
});
