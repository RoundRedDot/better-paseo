import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { codeSurface, itemRootFont } from "./components/host-font-escape";
import { radiusV2, space, buildThemeTokens, type ExtendedThemeTokens } from "./components/theme-tokens";
import { ensureEmbeddedFonts } from "./components/embed-fonts";
import { pluginRoot } from "./components/focus-ring";
import { useHostAppearance } from "./ui/tokens/host-appearance-shim";
import { surfaceProps } from "./components/view-props";
import {
  ACCENT_PRESETS,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  HOVER_DELAYS,
  resetEnhancerPreferences,
  updateEnhancerPreferences,
  useEnhancerPreferences,
  monoChoice,
  monoChoiceUpdate,
  type AccentPreset,
  type MonoChoice,
  type HoverDelayPreference,
  type PathDisplayPreference,
  type RowLabelStylePreference,
  type ToolDetailPreference,
  type UiFontPreference,
} from "./preferences";
import { NATIVE_MONO_CHOICES, TYPE, describeMonoSource, readHostTypography } from "./ui/tokens/typography";
import { usePreferenceSettings } from "./state/preference-sync-slot";
import type { SyncStatus } from "./state/preference-sync";
import {
  SETTINGS_STRINGS,
  resolveLanguage,
  type SettingsLanguagePreference,
  type SettingsStrings,
} from "./i18n/settings-strings";

/** What the settings page says about the daemon store, or null when all is well. */
function storageHint(sync: SyncStatus, t: SettingsStrings): string | null {
  if (sync.failed) return t.syncFailed;
  if (sync.status === "invalid") return t.syncInvalid(sync.error ?? "invalid");
  if (sync.status === "error") return t.syncError(sync.error ?? "error");
  if (sync.status === "loading") return t.syncLoading;
  return null;
}

const ACCENT_OPTIONS: ReadonlyArray<{
  id: AccentPreset;
  label: "accentHost" | "accentJade" | "accentViolet" | "accentAmber" | "accentRose";
  color: string | undefined;
}> = [
  { id: "host", label: "accentHost", color: undefined },
  { id: "jade", label: "accentJade", color: ACCENT_PRESETS.jade },
  { id: "violet", label: "accentViolet", color: ACCENT_PRESETS.violet },
  { id: "amber", label: "accentAmber", color: ACCENT_PRESETS.amber },
  { id: "rose", label: "accentRose", color: ACCENT_PRESETS.rose },
];

/** Switch geometry (S7 §3.9): a 40x24 track and an 18pt knob. */
const TRACK_WIDTH = 40;
const TRACK_HEIGHT = 24;
const KNOB = 18;
const KNOB_INSET = (TRACK_HEIGHT - KNOB) / 2;
/** Accent swatches: 22pt, each in a 44pt target. */
const SWATCH = 22;
const SWATCH_SLOP = (44 - SWATCH) / 2;
/** The desktop label column. */
const LABEL_COLUMN = 300;

/** Layout of the page: a grouped list on touch layouts, two columns on desktop. */
interface PageLook {
  compact: boolean;
  tokens: ExtendedThemeTokens;
  /** The page's strings, in the language the reader chose. */
  t: SettingsStrings;
}

/**
 * An on/off control that reads as one: on is the accent track with the
 * accent's foreground knob, off a surface2 track with a surface0 knob.
 */
function Toggle({
  value,
  onChange,
  label,
  look,
}: {
  value: boolean;
  onChange(next: boolean): void;
  label: string;
  look: PageLook;
}) {
  const { tokens } = look;
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.timing(position, {
      toValue: value ? 1 : 0,
      duration: 140,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [value, position]);

  return (
    <Pressable
      accessibilityRole="switch"
      // React Native Web does not map `accessibilityState.checked` onto a
      // Pressable, so the ARIA attribute is set directly as well.
      aria-checked={value}
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      hitSlop={10}
      onPress={() => onChange(!value)}
      style={[
        styles.track,
        {
          backgroundColor: value ? tokens.accent : tokens.v2.surface2,
          borderColor: value ? tokens.accent : tokens.v2.border,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.knob,
          {
            backgroundColor: value ? tokens.accentForeground : tokens.v2.surface0,
            borderColor: value ? tokens.accentForeground : tokens.v2.border,
            transform: [
              {
                translateX: position.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, TRACK_WIDTH - KNOB - KNOB_INSET * 2 - 2],
                }),
              },
            ],
          },
        ]}
      />
    </Pressable>
  );
}

/**
 * One choice of several, as a segmented control: a surface2 track, the
 * selected segment raised on surface0 with a hairline. Equal widths on touch
 * layouts, content widths on desktop.
 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  look,
  label,
}: {
  value: T | null;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange(value: T): void;
  look: PageLook;
  label: string;
}) {
  const { tokens, compact } = look;
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[
        styles.segmented,
        compact ? styles.segmentedFill : null,
        { backgroundColor: tokens.v2.surface2, height: compact ? 32 : 28 },
      ]}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            aria-checked={selected}
            hitSlop={compact ? { top: 6, bottom: 6 } : undefined}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              compact ? styles.segmentFill : null,
              selected
                ? { backgroundColor: tokens.v2.surface0, borderColor: tokens.v2.border }
                : styles.segmentIdle,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.segmentLabel,
                {
                  color: selected ? tokens.foreground : tokens.foregroundMuted,
                  fontWeight: selected ? "500" : "400",
                  fontFamily: tokens.fontUi,
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A plain bordered button (Reset, Follow Paseo, the stepper's − and +). */
function PlainButton({
  label,
  onPress,
  look,
  accessibilityLabel,
  disabled = false,
  square = false,
}: {
  label: string;
  onPress(): void;
  look: PageLook;
  accessibilityLabel?: string;
  disabled?: boolean;
  square?: boolean;
}) {
  const { tokens } = look;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={look.compact ? 6 : 0}
      onPress={onPress}
      style={({ pressed }) => [
        styles.plainButton,
        square ? styles.squareButton : null,
        {
          borderColor: tokens.v2.border,
          backgroundColor: pressed ? tokens.v2.surface2 : "transparent",
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Text style={[styles.plainLabel, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A section: a sentence-case label over a grouped list (touch) or bare rows (desktop). */
function Section({ title, look, children }: { title: string; look: PageLook; children: React.ReactNode }) {
  const { tokens, compact } = look;
  return (
    <View style={styles.section}>
      <Text
        accessibilityRole="header"
        style={[
          styles.sectionTitle,
          compact ? styles.sectionTitleInset : null,
          { color: tokens.foregroundMuted, fontFamily: tokens.fontUi },
        ]}
      >
        {title}
      </Text>
      <View style={compact ? [styles.group, { backgroundColor: tokens.v2.surface1 }] : null}>
        {children}
      </View>
    </View>
  );
}

/**
 * One setting. Touch: a list row — the label and its note, the control beside
 * them (a switch) or under them (`stacked`, a segmented control). Desktop: the
 * label column, then the control column. Rows after the first take a 1pt rule.
 */
function SettingRow({
  title,
  description,
  control,
  look,
  first = false,
  stacked = false,
  below,
}: {
  title: string;
  description?: string;
  control?: React.ReactNode;
  look: PageLook;
  first?: boolean;
  stacked?: boolean;
  /** Extra content under the row (the font preview, a custom family). */
  below?: React.ReactNode;
}) {
  const { tokens, compact } = look;
  const rule = first ? null : { borderTopWidth: 1, borderTopColor: tokens.v2.border };
  const text = (
    <View style={compact ? styles.rowText : styles.labelColumn}>
      <Text
        style={[
          compact ? styles.rowTitleCompact : styles.rowTitleDesktop,
          { color: tokens.foreground, fontFamily: tokens.fontUi },
        ]}
      >
        {title}
      </Text>
      {description ? (
        <Text style={[styles.rowNote, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
          {description}
        </Text>
      ) : null}
    </View>
  );
  if (compact) {
    return (
      <View style={styles.rowInset}>
        <View style={[styles.rowCompact, rule, stacked ? styles.rowStacked : null]}>
          {stacked ? (
            <>
              {text}
              {control}
            </>
          ) : (
            <View style={styles.rowLine}>
              {text}
              {control}
            </View>
          )}
          {below}
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.rowDesktop, rule]}>
      {text}
      <View style={styles.controlColumn}>
        {control}
        {below}
      </View>
    </View>
  );
}

/**
 * The custom family on web: free text, saved when the field is left or
 * submitted rather than per keystroke, since every change restyles the whole
 * timeline. A family the browser lacks falls back through the stack.
 */
function CustomMonoInput({ value, look }: { value: string; look: PageLook }) {
  const { tokens, t } = look;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next !== value) updateEnhancerPreferences({ customMonoFont: next });
  };
  return (
    <TextInput
      accessibilityLabel={t.customMono}
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      placeholder={t.customMonoPlaceholder}
      placeholderTextColor={tokens.foregroundSubtle}
      autoCapitalize="none"
      autoCorrect={false}
      style={[
        styles.input,
        {
          color: tokens.foreground,
          borderColor: tokens.v2.border,
          backgroundColor: tokens.v2.surface0,
          fontFamily: tokens.fontMono,
        },
      ]}
    />
  );
}

/**
 * Code, two diff lines and mixed CJK/Latin text in the face and size the
 * settings resolve to, so a change is judged before reading a reply. Drawn
 * with plain text in the token colours: no highlight request is needed.
 */
function MonoPreview({ look }: { look: PageLook }) {
  const { tokens } = look;
  const mono = tokens.typography.mono;
  const line = { fontSize: mono.size, lineHeight: mono.lineHeight };
  const syntax = tokens.syntax;
  return (
    <View
      {...codeSurface}
      accessibilityLabel={look.t.fontPreview}
      style={[styles.preview, { backgroundColor: look.compact ? tokens.v2.surface0 : tokens.v2.surfaceCode }]}
    >
      <Text style={[line, { fontFamily: tokens.fontCode, color: tokens.foreground }]}>
        <Text style={{ color: syntax.keyword }}>const</Text>
        {" ok = (a, b) => a !== b; "}
        <Text style={{ color: syntax.comment }}>{"// 0O 1lI"}</Text>
      </Text>
      <Text
        style={[line, { fontFamily: tokens.fontMono, color: tokens.foreground, backgroundColor: syntax.diffRemoveBg }]}
      >
        <Text style={{ color: syntax.diffRemoveMarker }}>- </Text>
        {"return value ?? fallback;"}
      </Text>
      <Text
        style={[line, { fontFamily: tokens.fontMono, color: tokens.foreground, backgroundColor: syntax.diffAddBg }]}
      >
        <Text style={{ color: syntax.diffAddMarker }}>+ </Text>
        {"return value ?? defaults.fallback;"}
      </Text>
      <Text style={[line, { fontFamily: tokens.fontMono, color: tokens.foregroundMuted }]}>
        {"中文与 English 混排 · src/界面/设置.tsx:42"}
      </Text>
      <Text style={[styles.previewMeta, { color: tokens.foregroundMuted, fontFamily: tokens.fontMono }]}>
        {`${mono.size} / ${mono.lineHeight}`}
      </Text>
    </View>
  );
}

/** Follow Paseo, or a size from 10 to 22 with a stepper, over a live preview. */
function CodeSizeControl({ value, look }: { value: number | null; look: PageLook }) {
  const { tokens, t } = look;
  const effective = tokens.typography.mono.size;
  const set = (next: number) =>
    updateEnhancerPreferences({
      codeFontSize: Math.min(CODE_FONT_SIZE_MAX, Math.max(CODE_FONT_SIZE_MIN, next)),
    });
  return (
    <View style={styles.controlLine}>
      <Segmented<"host" | "custom">
        label={t.codeSizeSource}
        value={value === null ? "host" : "custom"}
        options={[
          { value: "host", label: t.followPaseo },
          { value: "custom", label: t.custom },
        ]}
        onChange={(choice) =>
          updateEnhancerPreferences({ codeFontSize: choice === "host" ? null : effective })
        }
        look={{ ...look, compact: false }}
      />
      <View style={styles.stepper}>
        <PlainButton
          label="−"
          accessibilityLabel={t.codeSizeSmaller}
          disabled={effective <= CODE_FONT_SIZE_MIN}
          onPress={() => set(effective - 1)}
          look={look}
          square
        />
        <Text
          accessibilityLabel={t.codeSizeValue(effective)}
          style={[
            styles.stepperValue,
            { color: value === null ? tokens.foregroundMuted : tokens.foreground, fontFamily: tokens.fontMono },
          ]}
        >
          {`${effective}px`}
        </Text>
        <PlainButton
          label="+"
          accessibilityLabel={t.codeSizeLarger}
          disabled={effective >= CODE_FONT_SIZE_MAX}
          onPress={() => set(effective + 1)}
          look={look}
          square
        />
      </View>
    </View>
  );
}

/** "Host" and the four presets: round swatches, the selected one ringed. */
function AccentControl({ value, hostAccent, look }: { value: AccentPreset; hostAccent: string; look: PageLook }) {
  const { tokens, t } = look;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t.accentTitle} style={styles.swatches}>
      {ACCENT_OPTIONS.map((option) => {
        const selected = value === option.id;
        const color = option.color ?? hostAccent;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityLabel={t.accentOption(t[option.label])}
            accessibilityState={{ selected, checked: selected }}
            aria-checked={selected}
            hitSlop={SWATCH_SLOP}
            onPress={() => updateEnhancerPreferences({ accent: option.id })}
            style={option.id === "host" ? [
              styles.hostChip,
              {
                borderColor: selected ? tokens.foreground : tokens.v2.border,
                backgroundColor: selected ? tokens.v2.surface0 : "transparent",
              },
            ] : [
              styles.swatch,
              { backgroundColor: color, borderColor: selected ? tokens.foreground : "transparent" },
            ]}
          >
            {option.id === "host" ? (
              <Text style={[styles.hostChipLabel, { color: selected ? tokens.foreground : tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
                {t.accentHost}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Settings content mounted by Paseo under the selected host's Plugin settings. */
export function BeautifulChatSettingsPage({ theme, layout }: PluginSurfaceProps) {
  const preferences = useEnhancerPreferences();
  // The settings screen reads (and, through the store, saves) the daemon
  // record itself, so it works with no chat open.
  const sync = usePreferenceSettings();
  const t = SETTINGS_STRINGS[resolveLanguage(preferences.language)];
  const hint = storageHint(sync, t);
  const platform =
    layout?.platform ?? (Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web");
  const native = platform !== "web";
  const compact = layout?.compact ?? native;
  const hostTypography = useMemo(() => readHostTypography(theme) !== null, [theme]);
  // Plan D10 level 2: Paseo's Appearance mono settings (web, without H1).
  const appearance = useHostAppearance(platform === "web" && !hostTypography, theme);
  const tokens = useMemo(
    () => {
      ensureEmbeddedFonts(preferences, platform);
      return buildThemeTokens(theme.colors, preferences, { platform, theme, appearance });
    },
    [preferences, theme, platform, appearance],
  );
  const look = useMemo<PageLook>(() => ({ tokens, compact, t }), [tokens, compact, t]);

  const monoOptions: ReadonlyArray<{ value: MonoChoice; label: string }> = native
    ? [
        { value: "host", label: t.followPaseo },
        { value: "custom", label: t.custom },
      ]
    : [
        { value: "host", label: t.followPaseo },
        { value: "iosevka", label: "Iosevka" },
        { value: "iosevka-code", label: "Iosevka Code" },
        { value: "custom", label: t.custom },
      ];
  const nativeChoices = platform === "web" ? [] : NATIVE_MONO_CHOICES[platform];
  // A stored Iosevka (from a synced web profile) is drawn as Follow on native,
  // which is also what `resolveTypography` renders for it there.
  const currentMono = monoChoice(preferences);
  const shownMono: MonoChoice = native && currentMono.startsWith("iosevka") ? "host" : currentMono;

  return (
    <View
      {...surfaceProps(itemRootFont(preferences.uiFont), pluginRoot)}
      style={[styles.container, { backgroundColor: tokens.v2.surface0 }]}
    >
      <View style={compact ? styles.introInset : null}>
        <Text style={[styles.title, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
          {t.pageTitle}
        </Text>
        <Text style={[styles.rowNote, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
          {t.pageIntro}
        </Text>
        {hint ? (
          <Text
            accessibilityRole="alert"
            style={[
              styles.rowNote,
              styles.storageHint,
              {
                color: sync.status === "loading" ? tokens.foregroundMuted : tokens.warning,
                borderColor: tokens.v2.border,
                fontFamily: tokens.fontUi,
              },
            ]}
          >
            {hint}
          </Text>
        ) : null}
      </View>

      <Section title={t.sectionAppearance} look={look}>
        <SettingRow
          title={t.languageTitle}
          description={t.languageDescription}
          control={
            <Segmented<SettingsLanguagePreference>
              label={t.languageTitle}
              value={preferences.language}
              options={[
                { value: "system", label: t.languageSystem },
                { value: "en", label: t.languageEnglish },
                { value: "zh", label: t.languageChinese },
              ]}
              onChange={(language) => updateEnhancerPreferences({ language })}
              look={look}
            />
          }
          look={look}
          first
          stacked
        />
        <SettingRow
          title={t.accentTitle}
          description={t.accentDescription}
          control={<AccentControl value={preferences.accent} hostAccent={theme.colors.accent} look={look} />}
          look={look}
          stacked
        />
      </Section>

      <Section title={t.sectionFonts} look={look}>
        {hostTypography ? null : (
          <SettingRow
            title={t.paseoFontsTitle}
            description={native ? t.paseoFontsNative : t.paseoFontsWeb}
            look={look}
            first
          />
        )}
        <SettingRow
          title={t.monoTitle}
          description={native ? t.monoNative : t.monoWeb}
          control={
            <Segmented<MonoChoice>
              label={t.monoTitle}
              value={shownMono}
              options={monoOptions}
              onChange={(choice) => updateEnhancerPreferences(monoChoiceUpdate(choice))}
              look={look}
            />
          }
          below={
            shownMono === "host" ? (
              <Text
                accessibilityLabel={t.monoSource}
                style={[styles.rowNote, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}
              >
                {describeMonoSource(tokens.typography.mono.source, platform, t)}
              </Text>
            ) : shownMono === "custom" ? (
              native ? (
                <Segmented<string>
                  label={t.customMono}
                  value={preferences.customMonoFont}
                  options={nativeChoices}
                  onChange={(customMonoFont) => updateEnhancerPreferences({ customMonoFont })}
                  look={look}
                />
              ) : (
                <CustomMonoInput value={preferences.customMonoFont} look={look} />
              )
            ) : null
          }
          look={look}
          first={hostTypography}
          stacked
        />
        <SettingRow
          title={t.codeSizeTitle}
          description={t.codeSizeDescription(CODE_FONT_SIZE_MIN, CODE_FONT_SIZE_MAX)}
          control={<CodeSizeControl value={preferences.codeFontSize} look={look} />}
          below={<MonoPreview look={look} />}
          look={look}
          stacked
        />
        <SettingRow
          title={t.uiFontTitle}
          description={native ? t.uiFontNative : t.uiFontWeb}
          control={
            <Segmented<UiFontPreference>
              label={t.uiFontTitle}
              value={native && preferences.uiFont === "inter" ? "host" : preferences.uiFont}
              options={
                native
                  ? [
                      { value: "host", label: t.followPaseo },
                      { value: "system", label: t.system },
                    ]
                  : [
                      { value: "host", label: t.followPaseo },
                      { value: "inter", label: "Inter" },
                      { value: "system", label: t.system },
                    ]
              }
              onChange={(uiFont) => updateEnhancerPreferences({ uiFont })}
              look={look}
            />
          }
          look={look}
          stacked
        />
      </Section>

      <Section title={t.sectionTools} look={look}>
        <SettingRow
          title={t.hoverDelayTitle}
          description={t.hoverDelayDescription}
          control={
            <Segmented<HoverDelayPreference>
              label={t.hoverDelayTitle}
              value={preferences.hoverDelay}
              options={HOVER_DELAYS.map((value) => ({ value, label: value }))}
              onChange={(hoverDelay) => updateEnhancerPreferences({ hoverDelay })}
              look={look}
            />
          }
          look={look}
          first
          stacked
        />
        <SettingRow
          title={t.toolDetailTitle}
          description={t.toolDetailDescription}
          control={
            <Segmented<ToolDetailPreference>
              label={t.toolDetailTitle}
              value={preferences.toolDetail}
              options={[
                { value: "collapsed", label: t.toolDetailCollapsed },
                { value: "expand-failed", label: t.toolDetailExpandFailed },
              ]}
              onChange={(toolDetail) => updateEnhancerPreferences({ toolDetail })}
              look={look}
            />
          }
          look={look}
          stacked
        />
        <SettingRow
          title={t.pathsTitle}
          description={t.pathsDescription}
          control={
            <Segmented<PathDisplayPreference>
              label={t.pathsTitle}
              value={preferences.pathDisplay}
              options={[
                { value: "relative", label: t.pathsRelative },
                { value: "absolute", label: t.pathsAbsolute },
              ]}
              onChange={(pathDisplay) => updateEnhancerPreferences({ pathDisplay })}
              look={look}
            />
          }
          look={look}
          stacked
        />
        <SettingRow
          title={t.rowLabelsTitle}
          description={t.rowLabelsDescription}
          control={
            <Segmented<RowLabelStylePreference>
              label={t.rowLabelsTitle}
              value={preferences.rowLabelStyle}
              options={[
                { value: "icon", label: t.rowLabelsIcon },
                { value: "label", label: t.rowLabelsLabel },
                { value: "both", label: t.rowLabelsBoth },
              ]}
              onChange={(rowLabelStyle) => updateEnhancerPreferences({ rowLabelStyle })}
              look={look}
            />
          }
          look={look}
          stacked
        />
        <SettingRow
          title={t.rowSpacingTitle}
          description={t.rowSpacingDescription}
          control={
            <Toggle
              value={preferences.compactRowSpacing}
              onChange={(compactRowSpacing) => updateEnhancerPreferences({ compactRowSpacing })}
              label={t.rowSpacingTitle}
              look={look}
            />
          }
          look={look}
        />
        <SettingRow
          title={t.replySpacingTitle}
          description={t.replySpacingDescription}
          control={
            <Toggle
              value={preferences.compactReplySpacing}
              onChange={(compactReplySpacing) => updateEnhancerPreferences({ compactReplySpacing })}
              label={t.replySpacingTitle}
              look={look}
            />
          }
          look={look}
        />
      </Section>

      <Section title={t.sectionMessages} look={look}>
        <SettingRow
          title={t.bubbleTitle}
          description={t.bubbleDescription}
          control={
            <Toggle
              value={preferences.enhancedUserBubble}
              onChange={(enhancedUserBubble) => updateEnhancerPreferences({ enhancedUserBubble })}
              label={t.bubbleTitle}
              look={look}
            />
          }
          look={look}
          first
        />
        {native ? null : (
          <SettingRow
            title={t.selectionTitle}
            description={t.selectionDescription}
            control={
              <Toggle
                value={preferences.selectionActions}
                onChange={(selectionActions) => updateEnhancerPreferences({ selectionActions })}
                label={t.selectionTitle}
                look={look}
              />
            }
            look={look}
          />
        )}
        <SettingRow
          title={t.markdownTitle}
          description={t.markdownDescription}
          control={
            <Toggle
              value={preferences.assistantMarkdown}
              onChange={(assistantMarkdown) => updateEnhancerPreferences({ assistantMarkdown })}
              label={t.markdownTitle}
              look={look}
            />
          }
          look={look}
        />
        <SettingRow
          title={t.markdownStyleTitle}
          description={t.markdownStyleDescription}
          control={
            <Segmented
              label={t.markdownStyleTitle}
              value={preferences.markdownVariant}
              options={[
                { value: "document", label: t.markdownDocument },
                { value: "compact", label: t.markdownCompact },
                { value: "terminal", label: t.markdownTerminal },
              ]}
              onChange={(markdownVariant) => updateEnhancerPreferences({ markdownVariant })}
              look={look}
            />
          }
          look={look}
          stacked
        />
      </Section>

      <View style={compact ? styles.introInset : null}>
        <PlainButton label={t.resetDefaults} onPress={resetEnhancerPreferences} look={look} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // No `flex: 1` here. The host mounts a settings screen inside a plain
  // column `View` (app `plugins/settings/index.tsx:107`), and React Native Web
  // compiles `flex: 1` to `flex: 1 1 0%`: a zero basis in a container that
  // sizes to its content, so the whole page collapses to nothing.
  // No width cap or side padding on desktop either: the host's content column
  // (`PageLayout`, 720 wide and padded) already sets the page width, so the
  // rows line up with the page title and Paseo's own settings sections.
  container: { alignSelf: "stretch", paddingVertical: space.lg, gap: space.xl },
  introInset: { paddingHorizontal: space.lg },
  title: {
    fontSize: TYPE.title.size,
    lineHeight: TYPE.title.lineHeight,
    fontWeight: "600",
    marginBottom: space.xs,
  },
  storageHint: { marginTop: space.sm, padding: space.sm, borderWidth: 1, borderRadius: radiusV2.block },
  section: { gap: space.sm },
  sectionTitle: {
    fontSize: TYPE.settingNote.size,
    lineHeight: TYPE.settingNote.lineHeight,
    fontWeight: "500",
  },
  sectionTitleInset: { paddingHorizontal: space.lg },
  group: { borderRadius: radiusV2.card, overflow: "hidden" },
  // Touch: the rule runs from the inset, like a native grouped list.
  rowInset: { paddingLeft: space.lg },
  rowCompact: { minHeight: 44, paddingVertical: 11, paddingRight: space.lg, gap: space.sm },
  rowStacked: { gap: space.md },
  rowLine: { flexDirection: "row", alignItems: "center", gap: space.lg },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitleCompact: {
    fontSize: TYPE.setting.compact.size,
    lineHeight: TYPE.setting.compact.lineHeight,
  },
  rowTitleDesktop: {
    fontSize: TYPE.setting.desktop.size,
    lineHeight: TYPE.setting.desktop.lineHeight,
    fontWeight: "500",
  },
  rowNote: {
    fontSize: TYPE.settingNote.size,
    lineHeight: TYPE.settingNote.lineHeight,
  },
  // Desktop: a label column and a control column, rows divided by a rule.
  rowDesktop: { flexDirection: "row", alignItems: "flex-start", gap: space.xl, paddingVertical: 14 },
  labelColumn: { width: LABEL_COLUMN, flexShrink: 0, gap: 2 },
  controlColumn: { flex: 1, minWidth: 0, alignItems: "flex-start", gap: space.md },
  controlLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.md },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 1,
    paddingHorizontal: KNOB_INSET,
    justifyContent: "center",
  },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, borderWidth: 1 },
  segmented: {
    flexDirection: "row",
    alignItems: "stretch",
    alignSelf: "flex-start",
    padding: 2,
    borderRadius: radiusV2.block,
  },
  segmentedFill: { alignSelf: "stretch" },
  segment: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: space.md,
    borderRadius: radiusV2.chip,
    borderWidth: 1,
  },
  segmentFill: { flex: 1, paddingHorizontal: space.xs },
  segmentIdle: { borderColor: "transparent" },
  segmentLabel: { fontSize: TYPE.button.size, lineHeight: TYPE.button.lineHeight },
  plainButton: {
    minHeight: 32,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: radiusV2.block,
    paddingHorizontal: space.md,
  },
  squareButton: { width: 32, paddingHorizontal: 0 },
  plainLabel: { fontSize: TYPE.button.size, lineHeight: TYPE.button.lineHeight, fontWeight: "500" },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.xs },
  stepperValue: {
    width: 48,
    textAlign: "center",
    fontSize: TYPE.button.size,
    fontVariant: ["tabular-nums"],
  },
  swatches: { flexDirection: "row", alignItems: "center", gap: space.md },
  hostChip: {
    height: SWATCH + 6,
    paddingHorizontal: space.sm,
    borderRadius: radiusV2.chip,
    borderWidth: 1,
    justifyContent: "center",
  },
  hostChipLabel: { fontSize: TYPE.button.size, lineHeight: TYPE.button.lineHeight, fontWeight: "500" },
  swatch: { width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2, borderWidth: 2 },
  input: {
    alignSelf: "stretch",
    minHeight: 32,
    borderWidth: 1,
    borderRadius: radiusV2.block,
    paddingHorizontal: space.sm,
    fontSize: TYPE.button.size,
  },
  preview: { alignSelf: "stretch", borderRadius: radiusV2.block, padding: space.md, gap: 2 },
  previewMeta: { fontSize: TYPE.caption.size, marginTop: space.xs },
});
