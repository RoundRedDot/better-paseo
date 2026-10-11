import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { codeSurface, itemRootFont } from "./components/host-font-escape";
import { radiusV2, space, buildThemeTokens, type ExtendedThemeTokens } from "./components/theme-tokens";
import { ensureEmbeddedFonts } from "./components/embed-fonts";
import { pluginRoot } from "./components/focus-ring";
import { surfaceProps } from "./components/view-props";
import {
  ACCENT_PRESETS,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  resetEnhancerPreferences,
  updateEnhancerPreferences,
  useEnhancerPreferences,
  monoChoice,
  monoChoiceUpdate,
  type AccentPreset,
  type MonoChoice,
  type PathDisplayPreference,
  type ToolDetailPreference,
  type UiFontPreference,
} from "./preferences";
import { NATIVE_MONO_CHOICES, TYPE, readHostTypography } from "./ui/tokens/typography";
import { usePreferenceSettings } from "./state/preference-sync-slot";
import type { SyncStatus } from "./state/preference-sync";

/** What the settings page says about the daemon store, or null when all is well. */
function storageHint(sync: SyncStatus): string | null {
  if (sync.failed) return "Your last change could not be saved to this Paseo host. It applies on this client until the next change or reload.";
  if (sync.status === "invalid") {
    return `The settings stored on this Paseo host could not be read, so the defaults are shown. Changing any setting replaces the stored record. (${sync.error ?? "invalid"})`;
  }
  if (sync.status === "error") {
    return `The settings stored on this Paseo host are unreachable right now; the last known values are shown, and a change is saved once the host answers. (${sync.error ?? "error"})`;
  }
  if (sync.status === "loading") return "Loading the settings stored on this Paseo host…";
  return null;
}

const ACCENT_OPTIONS: ReadonlyArray<{
  id: AccentPreset;
  label: string;
  color: string | undefined;
}> = [
  { id: "host", label: "Host", color: undefined },
  { id: "jade", label: "Jade", color: ACCENT_PRESETS.jade },
  { id: "violet", label: "Violet", color: ACCENT_PRESETS.violet },
  { id: "amber", label: "Amber", color: ACCENT_PRESETS.amber },
  { id: "rose", label: "Rose", color: ACCENT_PRESETS.rose },
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
const PAGE_MAX = 820;

/** Layout of the page: a grouped list on touch layouts, two columns on desktop. */
interface PageLook {
  compact: boolean;
  tokens: ExtendedThemeTokens;
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
  const { tokens } = look;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next !== value) updateEnhancerPreferences({ customMonoFont: next });
  };
  return (
    <TextInput
      accessibilityLabel="Custom monospace family"
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      placeholder="e.g. JetBrains Mono"
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
      accessibilityLabel="Font preview"
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
  const { tokens } = look;
  const effective = tokens.typography.mono.size;
  const set = (next: number) =>
    updateEnhancerPreferences({
      codeFontSize: Math.min(CODE_FONT_SIZE_MAX, Math.max(CODE_FONT_SIZE_MIN, next)),
    });
  return (
    <View style={styles.controlLine}>
      <Segmented<"host" | "custom">
        label="Code font size source"
        value={value === null ? "host" : "custom"}
        options={[
          { value: "host", label: "Follow Paseo" },
          { value: "custom", label: "Custom" },
        ]}
        onChange={(choice) =>
          updateEnhancerPreferences({ codeFontSize: choice === "host" ? null : effective })
        }
        look={{ ...look, compact: false }}
      />
      <View style={styles.stepper}>
        <PlainButton
          label="−"
          accessibilityLabel="Smaller code font"
          disabled={effective <= CODE_FONT_SIZE_MIN}
          onPress={() => set(effective - 1)}
          look={look}
          square
        />
        <Text
          accessibilityLabel={`Code font size ${effective} pixels`}
          style={[
            styles.stepperValue,
            { color: value === null ? tokens.foregroundMuted : tokens.foreground, fontFamily: tokens.fontMono },
          ]}
        >
          {`${effective}px`}
        </Text>
        <PlainButton
          label="+"
          accessibilityLabel="Larger code font"
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
  const { tokens } = look;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Accent colour" style={styles.swatches}>
      {ACCENT_OPTIONS.map((option) => {
        const selected = value === option.id;
        const color = option.color ?? hostAccent;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityLabel={`Accent: ${option.label}`}
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
                Host
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
  const hint = storageHint(sync);
  const platform =
    layout?.platform ?? (Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web");
  const native = platform !== "web";
  const compact = layout?.compact ?? native;
  const tokens = useMemo(
    () => {
      ensureEmbeddedFonts(preferences, platform);
      return buildThemeTokens(theme.colors, preferences, { platform, theme });
    },
    [preferences, theme, platform],
  );
  const look = useMemo<PageLook>(() => ({ tokens, compact }), [tokens, compact]);
  const hostTypography = useMemo(() => readHostTypography(theme) !== null, [theme]);

  const monoOptions: ReadonlyArray<{ value: MonoChoice; label: string }> = native
    ? [
        { value: "host", label: "Follow Paseo" },
        { value: "custom", label: "Custom" },
      ]
    : [
        { value: "host", label: "Follow Paseo" },
        { value: "iosevka", label: "Iosevka" },
        { value: "iosevka-code", label: "Iosevka Code" },
        { value: "custom", label: "Custom" },
      ];
  const nativeChoices = platform === "web" ? [] : NATIVE_MONO_CHOICES[platform];
  // A stored Iosevka (from a synced web profile) is drawn as Follow on native,
  // which is also what `resolveTypography` renders for it there.
  const currentMono = monoChoice(preferences);
  const shownMono: MonoChoice = native && currentMono.startsWith("iosevka") ? "host" : currentMono;

  return (
    <View
      {...surfaceProps(itemRootFont(preferences.uiFont), pluginRoot)}
      style={[styles.container, compact ? null : styles.containerDesktop, { backgroundColor: tokens.v2.surface0 }]}
    >
      <View style={compact ? styles.introInset : null}>
        <Text style={[styles.title, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
          Chat presentation
        </Text>
        <Text style={[styles.rowNote, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
          Saved on this Paseo host and shared by every client connected to it (desktop, web, iOS,
          Android). Options a platform cannot draw fall back there.
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

      <Section title="Appearance" look={look}>
        <SettingRow
          title="Accent colour"
          description="Follow the Paseo theme, or pick a presentation accent. Only the accent changes; every other colour comes from the theme."
          control={<AccentControl value={preferences.accent} hostAccent={theme.colors.accent} look={look} />}
          look={look}
          first
          stacked
        />
      </Section>

      <Section title="Fonts" look={look}>
        {hostTypography ? null : (
          <SettingRow
            title="Paseo's font settings"
            description={`This Paseo version does not share its font settings with plugins, so Follow Paseo uses Paseo's default monospace: ${
              native ? "the system monospace face" : "SF Mono, Menlo, Monaco or Consolas, whichever this computer has"
            }, at 12px.`}
            look={look}
            first
          />
        )}
        <SettingRow
          title="Monospace font"
          description={
            native
              ? "For code, diffs, terminals and paths. Custom offers only faces this device is known to have, since a missing face would turn code proportional."
              : "For code, diffs, terminals and paths. Iosevka Code adds programming ligatures inside code blocks; diffs and terminals stay literal."
          }
          control={
            <Segmented<MonoChoice>
              label="Monospace font"
              value={shownMono}
              options={monoOptions}
              onChange={(choice) => updateEnhancerPreferences(monoChoiceUpdate(choice))}
              look={look}
            />
          }
          below={
            shownMono === "custom" ? (
              native ? (
                <Segmented<string>
                  label="Custom monospace family"
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
          title="Code font size"
          description={`Follow Paseo, or choose ${CODE_FONT_SIZE_MIN}–${CODE_FONT_SIZE_MAX}px for code, diffs, terminals and paths. Line height is 1.5×.`}
          control={<CodeSizeControl value={preferences.codeFontSize} look={look} />}
          below={<MonoPreview look={look} />}
          look={look}
          stacked
        />
        <SettingRow
          title="Interface font"
          description={
            native
              ? "Follow Paseo's interface font, or use the system face."
              : "Follow Paseo's interface font, or choose the embedded Inter face or the system face."
          }
          control={
            <Segmented<UiFontPreference>
              label="Interface font"
              value={native && preferences.uiFont === "inter" ? "host" : preferences.uiFont}
              options={
                native
                  ? [
                      { value: "host", label: "Follow Paseo" },
                      { value: "system", label: "System" },
                    ]
                  : [
                      { value: "host", label: "Follow Paseo" },
                      { value: "inter", label: "Inter" },
                      { value: "system", label: "System" },
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

      <Section title="Tools and paths" look={look}>
        <SettingRow
          title="Tool details"
          description="Tool calls start as one line. Choose whether a failed call opens on its own."
          control={
            <Segmented<ToolDetailPreference>
              label="Tool details"
              value={preferences.toolDetail}
              options={[
                { value: "collapsed", label: "Always collapsed" },
                { value: "expand-failed", label: "Open failed calls" },
              ]}
              onChange={(toolDetail) => updateEnhancerPreferences({ toolDetail })}
              look={look}
            />
          }
          look={look}
          first
          stacked
        />
        <SettingRow
          title="File paths"
          description="Relative to the workspace (a worktree's main repository is prefixed with its name), or in full. Copying always gives the absolute path."
          control={
            <Segmented<PathDisplayPreference>
              label="File paths"
              value={preferences.pathDisplay}
              options={[
                { value: "relative", label: "Relative" },
                { value: "absolute", label: "Absolute" },
              ]}
              onChange={(pathDisplay) => updateEnhancerPreferences({ pathDisplay })}
              look={look}
            />
          }
          look={look}
          stacked
        />
      </Section>

      <Section title="Messages" look={look}>
        <SettingRow
          title="Enhanced prompt bubble"
          description="Paseo removes pasted images before a plugin sees the message, so the enhanced bubble cannot show them. Turn this off for Paseo's own bubble with image previews. New prompts follow the change."
          control={
            <Toggle
              value={preferences.enhancedUserBubble}
              onChange={(enhancedUserBubble) => updateEnhancerPreferences({ enhancedUserBubble })}
              label="Enhanced prompt bubble"
              look={look}
            />
          }
          look={look}
          first
        />
        {native ? null : (
          <SettingRow
            title="Selection actions"
            description="Highlighting text in a callout raises a small bar with Copy and Add to chat. Add to chat drops the highlight into the composer as a quote, or a fenced block when it came from code."
            control={
              <Toggle
                value={preferences.selectionActions}
                onChange={(selectionActions) => updateEnhancerPreferences({ selectionActions })}
                label="Selection actions"
                look={look}
              />
            }
            look={look}
          />
        )}
        <SettingRow
          title="Assistant markdown"
          description="Draws the reply with the plugin's own headings, lists and syntax-highlighted code blocks. The plugin cannot reach Paseo's markdown pipeline, so its version is a subset: turn this off for mermaid diagrams, images, and the host's file-path links."
          control={
            <Toggle
              value={preferences.assistantMarkdown}
              onChange={(assistantMarkdown) => updateEnhancerPreferences({ assistantMarkdown })}
              label="Assistant markdown"
              look={look}
            />
          }
          look={look}
        />
        <SettingRow
          title="Markdown style"
          description="Document is airy and built for long answers. Compact tightens the spacing for short replies. Terminal sets the body in the code face."
          control={
            <Segmented
              label="Markdown style"
              value={preferences.markdownVariant}
              options={[
                { value: "document", label: "Document" },
                { value: "compact", label: "Compact" },
                { value: "terminal", label: "Terminal" },
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
        <PlainButton label="Reset defaults" onPress={resetEnhancerPreferences} look={look} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // No `flex: 1` here. The host mounts a settings screen inside a plain
  // column `View` (app `plugins/settings/index.tsx:107`), and React Native Web
  // compiles `flex: 1` to `flex: 1 1 0%` — a zero basis in a container that
  // sizes to its content, so the whole page collapses to nothing.
  container: { alignSelf: "stretch", paddingVertical: space.lg, gap: space.xl },
  containerDesktop: { paddingHorizontal: space.xl, maxWidth: PAGE_MAX },
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
