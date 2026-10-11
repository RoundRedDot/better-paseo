import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { codeSurface, itemRootFont } from "./components/host-font-escape";
import { radiusV2, space, buildThemeTokens, type ExtendedThemeTokens } from "./components/theme-tokens";
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
import { NATIVE_MONO_CHOICES, UI_SCALE, readHostTypography } from "./ui/tokens/typography";
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
  { id: "host", label: "Host theme", color: undefined },
  { id: "jade", label: "Jade", color: ACCENT_PRESETS.jade },
  { id: "violet", label: "Violet", color: ACCENT_PRESETS.violet },
  { id: "amber", label: "Amber", color: ACCENT_PRESETS.amber },
  { id: "rose", label: "Rose", color: ACCENT_PRESETS.rose },
];

const TRACK_WIDTH = 38;
const TRACK_HEIGHT = 22;
const KNOB = 16;

/**
 * An on/off control that reads as one. A pair of buttons states the value
 * twice — the label and the selection — and a reader has to compare them to
 * learn which way it is set.
 */
function Toggle({
  value,
  onChange,
  label,
  tokens,
}: {
  value: boolean;
  onChange(next: boolean): void;
  label: string;
  tokens: ExtendedThemeTokens;
}) {
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
            backgroundColor: value ? tokens.accentForeground : tokens.foregroundMuted,
            transform: [
              {
                translateX: position.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, TRACK_WIDTH - KNOB - 6],
                }),
              },
            ],
          },
        ]}
      />
    </Pressable>
  );
}

function RowText({
  title,
  description,
  tokens,
}: {
  title: string;
  description?: string;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <>
      <Text style={[styles.rowTitle, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
        {title}
      </Text>
      {description ? (
        <Text
          style={[styles.rowDescription, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}
        >
          {description}
        </Text>
      ) : null}
    </>
  );
}

/** Rows divide with a hairline; the first row of a card has none. */
function rowBorder(tokens: ExtendedThemeTokens, first: boolean) {
  return { borderTopColor: first ? "transparent" : tokens.v2.borderSubtle };
}

/** A row whose control is a toggle: text on the left, switch on the right. */
function ToggleRow({
  title,
  description,
  value,
  onChange,
  tokens,
  first = false,
}: {
  title: string;
  description: string;
  value: boolean;
  onChange(next: boolean): void;
  tokens: ExtendedThemeTokens;
  first?: boolean;
}) {
  return (
    <View style={[styles.row, styles.toggleRow, rowBorder(tokens, first)]}>
      <View style={styles.toggleText}>
        <RowText title={title} description={description} tokens={tokens} />
      </View>
      <Toggle value={value} onChange={onChange} label={title} tokens={tokens} />
    </View>
  );
}

function OptionButton({
  label,
  selected,
  onPress,
  tokens,
  accessibilityLabel,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
  tokens: ExtendedThemeTokens;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled }}
      aria-pressed={selected}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: selected ? tokens.accentBg : pressed ? tokens.v2.surface2 : tokens.v2.surface1,
          borderColor: selected ? tokens.accent : tokens.v2.borderSubtle,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.optionLabel,
          { color: selected ? tokens.accent : tokens.foregroundMuted, fontFamily: tokens.fontUi },
        ]}
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
  first = false,
  children,
}: {
  title: string;
  description?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange(value: T): void;
  tokens: ExtendedThemeTokens;
  first?: boolean;
  /** Extra controls under the options (a custom value). */
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.row, rowBorder(tokens, first)]}>
      <RowText title={title} description={description} tokens={tokens} />
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
      {children}
    </View>
  );
}

function GroupTitle({ title, tokens }: { title: string; tokens: ExtendedThemeTokens }) {
  return (
    <Text
      accessibilityRole="header"
      style={[styles.groupTitle, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}
    >
      {title}
    </Text>
  );
}

/**
 * The custom family on web: free text, saved when the field is left or
 * submitted rather than per keystroke, since every change restyles the whole
 * timeline. A family the browser lacks falls back through the stack.
 */
function CustomMonoInput({ value, tokens }: { value: string; tokens: ExtendedThemeTokens }) {
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
          backgroundColor: tokens.v2.surface1,
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
function MonoPreview({ tokens }: { tokens: ExtendedThemeTokens }) {
  const mono = tokens.typography.mono;
  const line = { fontSize: mono.size, lineHeight: mono.lineHeight };
  const syntax = tokens.syntax;
  return (
    <View
      {...codeSurface}
      accessibilityLabel="Font preview"
      style={[styles.preview, { backgroundColor: tokens.v2.surfaceCode }]}
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
      <Text style={[styles.previewMeta, { color: tokens.foregroundSubtle, fontFamily: tokens.fontUi }]}>
        {`${mono.size}px / ${mono.lineHeight}px`}
      </Text>
    </View>
  );
}

/** Follow Paseo, or a size from 10 to 22 with a stepper and a reset, over a live preview. */
function CodeSizeRow({ value, tokens }: { value: number | null; tokens: ExtendedThemeTokens }) {
  const effective = tokens.typography.mono.size;
  const set = (next: number) =>
    updateEnhancerPreferences({
      codeFontSize: Math.min(CODE_FONT_SIZE_MAX, Math.max(CODE_FONT_SIZE_MIN, next)),
    });
  return (
    <View style={[styles.row, rowBorder(tokens, false)]}>
      <RowText
        title="Code font size"
        description={`Follow Paseo, or choose ${CODE_FONT_SIZE_MIN}–${CODE_FONT_SIZE_MAX}px for code, diffs, terminals and paths. Line height is 1.5×.`}
        tokens={tokens}
      />
      <View style={styles.options}>
        <OptionButton
          label="Follow Paseo"
          selected={value === null}
          onPress={() => updateEnhancerPreferences({ codeFontSize: null })}
          tokens={tokens}
        />
        <View style={styles.stepper}>
          <OptionButton
            label="−"
            accessibilityLabel="Smaller code font"
            selected={false}
            disabled={effective <= CODE_FONT_SIZE_MIN}
            onPress={() => set(effective - 1)}
            tokens={tokens}
          />
          <Text
            accessibilityLabel={`Code font size ${effective} pixels`}
            style={[
              styles.stepperValue,
              { color: value === null ? tokens.foregroundMuted : tokens.foreground, fontFamily: tokens.fontUi },
            ]}
          >
            {`${effective}px`}
          </Text>
          <OptionButton
            label="+"
            accessibilityLabel="Larger code font"
            selected={false}
            disabled={effective >= CODE_FONT_SIZE_MAX}
            onPress={() => set(effective + 1)}
            tokens={tokens}
          />
        </View>
        {value !== null ? (
          <OptionButton
            label="Reset"
            selected={false}
            onPress={() => updateEnhancerPreferences({ codeFontSize: null })}
            tokens={tokens}
          />
        ) : null}
      </View>
      <MonoPreview tokens={tokens} />
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
  const tokens = useMemo(
    () => buildThemeTokens(theme.colors, preferences, { platform, theme }),
    [preferences, theme, platform],
  );
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
      {...itemRootFont(preferences.uiFont)}
      style={[styles.container, { backgroundColor: tokens.v2.surface0 }]}
    >
      <View style={styles.intro}>
        <Text style={[styles.title, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
          Chat presentation
        </Text>
        <Text
          style={[styles.description, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}
        >
          Saved on this Paseo host and shared by every client connected to it (desktop, web, iOS,
          Android). Options a platform cannot draw fall back there.
        </Text>
        {hint ? (
          <Text
            accessibilityRole="alert"
            style={[
              styles.hint,
              styles.storageHint,
              {
                color: sync.status === "loading" ? tokens.foregroundMuted : tokens.warning,
                borderColor: tokens.v2.borderSubtle,
                fontFamily: tokens.fontUi,
              },
            ]}
          >
            {hint}
          </Text>
        ) : null}
      </View>

      <GroupTitle title="Appearance" tokens={tokens} />
      <View style={[styles.card, { borderColor: tokens.v2.border }]}>
        <View style={[styles.row, rowBorder(tokens, true)]}>
          <RowText
            title="Accent colour"
            description="Use the current Paseo theme, or choose a presentation accent."
            tokens={tokens}
          />
          <View style={styles.options}>
            {ACCENT_OPTIONS.map((option) => {
              const selected = preferences.accent === option.id;
              const swatch = option.color ?? theme.colors.accent;
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Accent: ${option.label}`}
                  accessibilityState={{ selected }}
                  aria-pressed={selected}
                  onPress={() => updateEnhancerPreferences({ accent: option.id })}
                  style={[
                    styles.option,
                    styles.accentOption,
                    {
                      borderColor: selected ? tokens.accent : tokens.v2.borderSubtle,
                      backgroundColor: selected ? tokens.accentBg : tokens.v2.surface1,
                    },
                  ]}
                >
                  <View style={[styles.swatch, { backgroundColor: swatch }]} />
                  <Text
                    style={[
                      styles.optionLabel,
                      {
                        color: selected ? tokens.accent : tokens.foregroundMuted,
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
        </View>

      </View>

      <GroupTitle title="Fonts" tokens={tokens} />
      <View style={[styles.card, { borderColor: tokens.v2.border }]}>
        {hostTypography ? null : (
          <View style={[styles.row, rowBorder(tokens, true)]}>
            <Text style={[styles.hint, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
              {`This Paseo version does not share its font settings with plugins, so Follow Paseo uses the defaults: ${
                native ? "the system monospace face" : "the embedded Iosevka"
              } at 12px.`}
            </Text>
          </View>
        )}

        <ChoiceRow<MonoChoice>
          title="Monospace font"
          description={
            native
              ? "For code, diffs, terminals and paths. Custom offers only faces this device is known to have, since a missing face would turn code proportional."
              : "For code, diffs, terminals and paths. Iosevka Code adds programming ligatures inside code blocks; diffs and terminals stay literal."
          }
          value={shownMono}
          options={monoOptions}
          onChange={(choice) => updateEnhancerPreferences(monoChoiceUpdate(choice))}
          tokens={tokens}
          first={hostTypography}
        >
          {shownMono === "custom" ? (
            native ? (
              <View style={styles.options}>
                {nativeChoices.map((choice) => (
                  <OptionButton
                    key={choice.value}
                    label={choice.label}
                    selected={preferences.customMonoFont === choice.value}
                    onPress={() => updateEnhancerPreferences({ customMonoFont: choice.value })}
                    tokens={tokens}
                  />
                ))}
              </View>
            ) : (
              <CustomMonoInput value={preferences.customMonoFont} tokens={tokens} />
            )
          ) : null}
        </ChoiceRow>

        <CodeSizeRow value={preferences.codeFontSize} tokens={tokens} />

        <ChoiceRow<UiFontPreference>
          title="Interface font"
          description={
            native
              ? "Follow Paseo's interface font, or use the system face."
              : "Follow Paseo's interface font, or choose the embedded Inter face or the system face."
          }
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
          tokens={tokens}
        />
      </View>

      <GroupTitle title="Tools and paths" tokens={tokens} />
      <View style={[styles.card, { borderColor: tokens.v2.border }]}>
        <ChoiceRow<ToolDetailPreference>
          title="Tool details"
          description="Tool calls start as one line. Choose whether a failed call opens on its own."
          value={preferences.toolDetail}
          options={[
            { value: "collapsed", label: "Always collapsed" },
            { value: "expand-failed", label: "Open failed calls" },
          ]}
          onChange={(toolDetail) => updateEnhancerPreferences({ toolDetail })}
          tokens={tokens}
          first
        />

        <ChoiceRow<PathDisplayPreference>
          title="File paths"
          description="Relative to the workspace (a worktree's main repository is prefixed with its name), or in full. Copying always gives the absolute path."
          value={preferences.pathDisplay}
          options={[
            { value: "relative", label: "Relative" },
            { value: "absolute", label: "Absolute" },
          ]}
          onChange={(pathDisplay) => updateEnhancerPreferences({ pathDisplay })}
          tokens={tokens}
        />
      </View>

      <GroupTitle title="Messages" tokens={tokens} />
      <View style={[styles.card, { borderColor: tokens.v2.border }]}>
        <ToggleRow
          title="Enhanced prompt bubble"
          description="Paseo removes pasted images before a plugin sees the message, so the enhanced bubble cannot show them. Turn this off for Paseo's own bubble with image previews. New prompts follow the change."
          value={preferences.enhancedUserBubble}
          onChange={(enhancedUserBubble) => updateEnhancerPreferences({ enhancedUserBubble })}
          tokens={tokens}
          first
        />

        {native ? null : (
          <ToggleRow
            title="Selection actions"
            description="Highlighting text in a callout raises a small bar with Copy and Add to chat. Add to chat drops the highlight into the composer as a quote, or a fenced block when it came from code."
            value={preferences.selectionActions}
            onChange={(selectionActions) => updateEnhancerPreferences({ selectionActions })}
            tokens={tokens}
          />
        )}

        <ToggleRow
          title="Assistant markdown"
          description="Draws the reply with the plugin's own headings, lists and syntax-highlighted code blocks. The plugin cannot reach Paseo's markdown pipeline, so its version is a subset: turn this off for mermaid diagrams, images, and the host's file-path links."
          value={preferences.assistantMarkdown}
          onChange={(assistantMarkdown) => updateEnhancerPreferences({ assistantMarkdown })}
          tokens={tokens}
        />

        <ChoiceRow
          title="Markdown style"
          description="Document is airy and built for long answers. Compact tightens the spacing for short replies. Terminal sets the body in the code face."
          value={preferences.markdownVariant}
          options={[
            { value: "document", label: "Document" },
            { value: "compact", label: "Compact" },
            { value: "terminal", label: "Terminal" },
          ]}
          onChange={(markdownVariant) => updateEnhancerPreferences({ markdownVariant })}
          tokens={tokens}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={resetEnhancerPreferences}
        style={({ pressed }) => [
          styles.option,
          styles.reset,
          {
            borderColor: tokens.v2.borderSubtle,
            backgroundColor: pressed ? tokens.v2.surface2 : "transparent",
          },
        ]}
      >
        <Text style={[styles.optionLabel, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
          Reset defaults
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // No `flex: 1` here. The host mounts a settings screen inside a plain
  // column `View` (app `plugins/settings/index.tsx:107`), and React Native Web
  // compiles `flex: 1` to `flex: 1 1 0%` — a zero basis in a container that
  // sizes to its content, so the whole page collapses to nothing.
  container: { alignSelf: "stretch", padding: space.lg, gap: space.sm },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: space.lg },
  // The text column takes the slack so a long description wraps instead of
  // pushing the switch off the card.
  toggleText: { flex: 1, minWidth: 0, gap: space.xs },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 1,
    padding: 2,
    justifyContent: "center",
  },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2 },
  intro: { gap: space.xs, paddingBottom: space.xs },
  title: { fontSize: UI_SCALE.xl, fontWeight: "600" },
  description: { fontSize: UI_SCALE.md, lineHeight: 18 },
  groupTitle: {
    fontSize: UI_SCALE.base,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: space.sm,
  },
  card: { borderWidth: 1, borderRadius: radiusV2.card, overflow: "hidden" },
  row: { padding: space.md, gap: space.sm, borderTopWidth: 1 },
  rowTitle: { fontSize: UI_SCALE.lg, fontWeight: "500" },
  rowDescription: { fontSize: UI_SCALE.base, lineHeight: 17 },
  hint: { fontSize: UI_SCALE.base, lineHeight: 17 },
  storageHint: { marginTop: space.xs, padding: space.sm, borderWidth: 1, borderRadius: radiusV2.block },
  options: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  option: {
    minHeight: 28,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radiusV2.block,
    paddingHorizontal: 10,
  },
  optionLabel: { fontSize: UI_SCALE.base, fontWeight: "500" },
  accentOption: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: radiusV2.chip },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.xs },
  stepperValue: {
    minWidth: 40,
    textAlign: "center",
    fontSize: UI_SCALE.md,
    fontVariant: ["tabular-nums"],
  },
  input: {
    minHeight: 32,
    borderWidth: 1,
    borderRadius: radiusV2.block,
    paddingHorizontal: space.sm,
    fontSize: UI_SCALE.md,
  },
  preview: { borderRadius: radiusV2.block, padding: space.md, gap: 2 },
  previewMeta: { fontSize: UI_SCALE.base, marginTop: space.xs },
  reset: { alignSelf: "flex-start", marginTop: space.sm },
});
