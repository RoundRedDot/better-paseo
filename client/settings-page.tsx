import { useRpc } from "@getpaseo/plugin/client";
import { isNewerVersion, updateCheckRpc } from "../shared/update-check";
import { openTerminalRpc, updateCommand } from "../shared/open-terminal";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from "react-native";
import { copyText, TextInput } from "@getpaseo/plugin/client/react-native";
import { DETAILS_FONT_SIZE_DEFAULT, DETAILS_FONT_SIZE_MIN, DETAILS_FONT_SIZE_MAX, clampDetailsFontSize } from "../shared/preferences-settings";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { codeSurface, itemRootFont } from "./components/host-font-escape";
import { radiusV2, space, buildThemeTokens, inlineCodeColor, type ExtendedThemeTokens } from "./components/theme-tokens";
import { ensureEmbeddedFonts } from "./components/embed-fonts";
import { pluginRoot } from "./components/focus-ring";
import { useHostAppearance } from "./ui/tokens/host-appearance-shim";
import { useHostLanguageVersion } from "./i18n/host-language";
import { surfaceProps } from "./components/view-props";
import {
  ACCENT_PRESETS,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  BLOCK_FONT_SIZE_MAX,
  BLOCK_FONT_SIZE_MIN,
  HOVER_DELAY_MAX,
  HOVER_DELAY_MIN,
  clampHoverDelay,
  resetEnhancerPreferences,
  updateEnhancerPreferences,
  useEnhancerPreferences,
  type AccentPreset,
  type EnhancerPreferences,
  type InlineCodeColorPreference,
  type MonoFontPreference,
  type PathDisplayPreference,
  type RowLabelStylePreference,
  type UiFontPreference,
} from "./preferences";
import {
  DEFAULT_WEB_MONO_STACK,
  NATIVE_MONO_CHOICES,
  TYPE,
  readHostTypography,
} from "./ui/tokens/typography";
import { usePreferenceSettings } from "./state/preference-sync-slot";
import { useCopy } from "./ui/use-copy";
import { useWideHostColumn } from "./ui/wide-host-column";
import { SettingsPreview } from "./settings-preview";
import { MarkdownView } from "./components/markdown/markdown-view";
import { selectionCodeText } from "./components/selection-actions";
import { CommandBand } from "./ui/command-band";
import { SelectableSpan, SelectableText } from "./ui/prose-text";
import { PHONE_PREVIEW_WIDTH, PlainButton, Section, SectionNote, Segmented, SettingRow, Toggle, controlStyles, settingsTextStyle, type PageLook } from "./settings-controls";
import { setSettingsTab, useSettingsTab, type SettingsTab } from "./settings-tab";
import { TasksSettingsPanel } from "./tasks/settings/tasks-panel";
import type { SyncStatus } from "./state/preference-sync";
import { resolveLanguage, type SettingsLanguagePreference } from "./i18n/settings-strings";
import { SETTINGS_STRINGS, type SettingsStrings } from "./i18n/settings-page-strings";
import { describeMonoSource } from "./settings-mono-source";

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

const INLINE_CODE_OPTIONS: ReadonlyArray<{
  id: InlineCodeColorPreference;
  label: "inlineCodeGrey" | "inlineCodeBlue" | "inlineCodeViolet" | "inlineCodeGreen" | "inlineCodeCoral";
}> = [
  { id: "grey", label: "inlineCodeGrey" },
  { id: "blue", label: "inlineCodeBlue" },
  { id: "violet", label: "inlineCodeViolet" },
  { id: "green", label: "inlineCodeGreen" },
  { id: "coral", label: "inlineCodeCoral" },
];

type PreviewDevice = "desktop" | "mobile";

/** Accent swatches: 22pt, each in a 44pt target. */
const SWATCH = 22;
const SWATCH_SLOP = (44 - SWATCH) / 2;
/** A swatch with a 2pt ring and a 2pt gap around it. */
const RINGED_SWATCH = SWATCH + 8;

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
        styles.input, settingsTextStyle(tokens, -1),
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

/** Seconds as the field shows them: `1`, `0.5`, never `1.0` or `0.30000000000000004`. */
function formatSeconds(seconds: number): string {
  return String(Math.round(seconds * 10) / 10);
}

/**
 * The hover delay, typed in seconds. Like the custom family it is saved when
 * the field is left or submitted; a value outside 0-10 is pulled into range,
 * and anything that is not a number puts the saved value back.
 */
function SecondsInput({ value, look }: { value: number; look: PageLook }) {
  const { tokens, t } = look;
  const [draft, setDraft] = useState(formatSeconds(value));
  useEffect(() => setDraft(formatSeconds(value)), [value]);
  const commit = () => {
    const parsed = Number(draft.trim().replace(",", "."));
    if (draft.trim() === "" || !Number.isFinite(parsed)) return setDraft(formatSeconds(value));
    const next = clampHoverDelay(parsed);
    setDraft(formatSeconds(next));
    if (next !== value) updateEnhancerPreferences({ hoverDelaySeconds: next });
  };
  return (
    <View style={styles.secondsField}>
      <TextInput
        accessibilityLabel={t.hoverDelayTitle}
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType="decimal-pad"
        inputMode="decimal"
        selectTextOnFocus
        style={[
          styles.input, settingsTextStyle(tokens, -1),
          styles.secondsInput,
          {
            color: tokens.foreground,
            borderColor: tokens.v2.border,
            backgroundColor: tokens.v2.surface0,
            fontFamily: tokens.fontMono,
          },
        ]}
      />
      <Text style={[styles.plainLabel, settingsTextStyle(tokens, -1), { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
        {t.hoverDelayUnit}
      </Text>
    </View>
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
      <Text style={[line, { fontFamily: tokens.fontMono, color: tokens.foreground }]}>
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
      <Text style={[styles.previewMeta, settingsTextStyle(tokens, -2), { color: tokens.foregroundMuted, fontFamily: tokens.fontMono }]}>
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
            styles.stepperValue, settingsTextStyle(tokens, -1),
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

/** 9–20px for tool rows, thoughts, checklists and notices. */
function BlockSizeControl({ value, look }: { value: number; look: PageLook }) {
  const { tokens, t } = look;
  const set = (next: number) =>
    updateEnhancerPreferences({
      blockFontSize: Math.min(BLOCK_FONT_SIZE_MAX, Math.max(BLOCK_FONT_SIZE_MIN, next)),
    });
  return (
    <View style={styles.stepper}>
      <PlainButton
        label="−"
        accessibilityLabel={t.blockSizeSmaller}
        disabled={value <= BLOCK_FONT_SIZE_MIN}
        onPress={() => set(value - 1)}
        look={look}
        square
      />
      <Text
        accessibilityLabel={t.blockSizeValue(value)}
        style={[styles.stepperValue, settingsTextStyle(tokens, -1), { color: tokens.foreground, fontFamily: tokens.fontMono }]}
      >
        {`${value}px`}
      </Text>
      <PlainButton
        label="+"
        accessibilityLabel={t.blockSizeLarger}
        disabled={value >= BLOCK_FONT_SIZE_MAX}
        onPress={() => set(value + 1)}
        look={look}
        square
      />
    </View>
  );
}

/** Native details have one absolute reading size, independent of timeline fonts. */
function DetailsSizeControl({ value, look }: { value: number; look: PageLook }) {
  const { tokens, t } = look;
  const set = (next: number) => updateEnhancerPreferences({ detailsFontSize: clampDetailsFontSize(next) });
  return (
    <View style={styles.controlLine}>
      <View style={styles.stepper}>
        <PlainButton label="−" accessibilityLabel={t.detailsSizeSmaller}
          disabled={value <= DETAILS_FONT_SIZE_MIN} onPress={() => set(value - 1)} look={look} square />
        <Text accessibilityLabel={t.detailsSizeValue(value)}
          style={[styles.stepperValue, settingsTextStyle(tokens, -1), { color: tokens.foreground, fontFamily: tokens.fontMono }]}>
          {`${value}px`}
        </Text>
        <PlainButton label="+" accessibilityLabel={t.detailsSizeLarger}
          disabled={value >= DETAILS_FONT_SIZE_MAX} onPress={() => set(value + 1)} look={look} square />
      </View>
      <PlainButton label={t.detailsSizeReset} onPress={() => set(DETAILS_FONT_SIZE_DEFAULT)} look={look} />
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
              <Text style={[styles.hostChipLabel, settingsTextStyle(tokens, -1), { color: selected ? tokens.foreground : tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
                {t.accentHost}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Round swatches in the shade this theme would draw, the selected one ringed
 * with a gap: the grey is a step off the foreground, so a ring drawn on the
 * swatch itself would vanish into it.
 */
function InlineCodeColorControl({ value, look }: { value: InlineCodeColorPreference; look: PageLook }) {
  const { tokens, t } = look;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t.inlineCodeTitle} style={styles.ringedSwatches}>
      {INLINE_CODE_OPTIONS.map((option) => {
        const selected = value === option.id;
        const color = inlineCodeColor(option.id, tokens.foreground, tokens.surface0, tokens.isDark);
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityLabel={t.inlineCodeOption(t[option.label])}
            accessibilityState={{ selected, checked: selected }}
            aria-checked={selected}
            hitSlop={SWATCH_SLOP - (RINGED_SWATCH - SWATCH) / 2}
            onPress={() => updateEnhancerPreferences({ inlineCodeColor: option.id })}
            style={[styles.ringedSwatch, { borderColor: selected ? tokens.foreground : "transparent" }]}
          >
            <View style={[styles.swatchFill, { backgroundColor: color }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The sample turn in a frame: a header with the title and how to try it, the
 * rows on the chat's own surface below. Beside the options it stays in view
 * while the page scrolls (web `position: sticky`), and scrolls inside itself
 * when taller than the window; above the options it can be folded away. The
 * phone is drawn whole instead, scrolling with the page: a narrow column that
 * scrolls on its own hides most of the turn behind a scroll bar.
 */
function PreviewPanel({
  look,
  preferences,
  pointer,
  side,
  mobileTokens,
  device,
  onDevice,
}: {
  look: PageLook;
  preferences: EnhancerPreferences;
  /** Whether rows preview on hover (web) rather than on a long press. */
  pointer: boolean;
  /** Drawn in the side column rather than above the options. */
  side: boolean;
  /**
   * Tokens for a phone's rows, which add a Desktop / Mobile switch; null on
   * iOS and Android, where the preview already draws as a phone does.
   */
  mobileTokens: ExtendedThemeTokens | null;
  /** Which tab is showing; the page holds it, since the phone also unpins the side column. */
  device: PreviewDevice;
  onDevice(device: PreviewDevice): void;
}) {
  const { tokens, compact, t } = look;
  const [open, setOpen] = useState(true);
  const { height } = useWindowDimensions();
  const mobile = mobileTokens !== null && device === "mobile";
  const rows = mobile ? (
    <View style={[styles.phoneFrame, { borderColor: tokens.v2.border }]}>
      <SettingsPreview tokens={mobileTokens} preferences={preferences} compact t={t} />
    </View>
  ) : (
    <SettingsPreview tokens={tokens} preferences={preferences} compact={compact} t={t} />
  );
  return (
    <View style={[styles.previewCard, { borderColor: tokens.v2.border }]}>
      <View
        style={[
          styles.previewHeader,
          { backgroundColor: tokens.v2.surface1 },
          open ? { borderBottomWidth: 1, borderBottomColor: tokens.v2.border } : null,
        ]}
      >
        <View style={styles.previewHeaderText}>
          <Text style={[styles.rowTitleDesktop, settingsTextStyle(tokens), { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
            {t.previewTitle}
          </Text>
          {open ? (
            <Text style={[styles.rowNote, settingsTextStyle(tokens, -1), { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
              {mobile ? t.previewHintMobile : pointer ? t.previewHintPointer : t.previewHintTouch}
            </Text>
          ) : null}
        </View>
        {open && mobileTokens ? (
          // Sized as on a desktop row even on a narrow page: it sits in a header, not a row of its own.
          <Segmented<PreviewDevice>
            label={t.previewDevice}
            value={device}
            options={[
              { value: "desktop", label: t.previewDesktop },
              { value: "mobile", label: t.previewMobile },
            ]}
            onChange={onDevice}
            look={{ ...look, compact: false }}
          />
        ) : null}
        {side ? null : (
          <PlainButton label={open ? t.previewHide : t.previewShow} onPress={() => setOpen(!open)} look={look} />
        )}
      </View>
      {open ? (
        side && !mobile ? (
          <ScrollView
            style={[styles.previewScroll, { maxHeight: Math.max(PREVIEW_MIN_HEIGHT, height - PREVIEW_WINDOW_MARGIN) }]}
            contentContainerStyle={styles.previewBody}
          >
            {rows}
          </ScrollView>
        ) : (
          <View style={styles.previewBody}>{rows}</View>
        )
      ) : null}
    </View>
  );
}

/** Reset needs a second press within a few seconds: it reaches every client of the host. */
function ResetButton({ look }: { look: PageLook }) {
  const { tokens, t } = look;
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), RESET_ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <View style={styles.reset}>
      <PlainButton
        label={armed ? t.resetConfirm : t.resetDefaults}
        onPress={() => {
          if (!armed) return setArmed(true);
          setArmed(false);
          resetEnhancerPreferences();
        }}
        look={look}
      />
      <Text style={[styles.rowNote, settingsTextStyle(tokens, -1), { color: armed ? tokens.warning : tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
        {t.resetDescription}
      </Text>
    </View>
  );
}

function useVersionCheck() {
  const check = useRpc(updateCheckRpc);
  const [state, setState] = useState<Awaited<ReturnType<typeof check>> | { state: "starting" }>({ state: "idle" });
  const started = useRef(false);
  useEffect(() => {
    let active = true;
    void check({ action: "status" }).then((result) => {
      if (!active || started.current) return;
      setState(result);
    }).catch(() => { if (active && !started.current) setState({ state: "failed" }); });
    return () => { active = false; };
  }, [check]);
  useEffect(() => {
    if (state.state !== "checking") return;
    const timer = setTimeout(() => {
      void check({ action: "status" }).then((result) => {
        setState(result);
      }).catch(() => setState({ state: "failed" }));
    }, 2000);
    return () => clearTimeout(timer);
  }, [check, state]);
  async function run() {
    started.current = true;
    setState({ state: "starting" });
    try {
      if (state.state === "failed") {
        const previous = await check({ action: "status" });
        if (previous.state === "checking" || previous.state === "done") return setState(previous);
      }
      setState(await check({ action: "check" }));
    }
    catch { setState({ state: "failed" }); }
  }
  return { state, run };
}

function VersionResult({ state, look, language, updateAvailable }: {
  state: Extract<ReturnType<typeof useVersionCheck>["state"], { state: "done" }>;
  look: PageLook;
  language: "en" | "zh";
  updateAvailable: boolean;
}) {
  const { t, tokens } = look;
  const labelStyle = [settingsTextStyle(tokens, -1), { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }];
  return <View style={{ gap: space.sm, marginTop: space.xs }}>
    {[
      { label: t.versionInstalled, version: state.versions.status === "available" ? state.versions.current : null, revision: state.current },
      { label: t.versionDirectory, version: state.versions.status === "available" ? state.versions.latest : null, revision: state.latest },
    ].map((entry) => <View key={entry.label} style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
      <Text style={[labelStyle, { width: tokens.typography.ui.size * (language === "zh" ? 4 : 9) }]}>{entry.label}</Text>
      <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", columnGap: space.sm, alignItems: "baseline" }}>
        {entry.version ? <Text {...(codeSurface as object)} style={[settingsTextStyle(tokens, -1), { color: tokens.foreground, fontFamily: tokens.fontMono, fontWeight: "500" }]}>{entry.version}</Text> : null}
        <Text {...(codeSurface as object)} style={[settingsTextStyle(tokens, -1), { color: entry.version ? tokens.foregroundMuted : tokens.foreground, fontFamily: tokens.fontMono }]}>{entry.version ? `(${entry.revision.slice(0, 7)})` : entry.revision.slice(0, 7)}</Text>
      </View>
    </View>)}
    <View style={{ gap: 2, marginTop: space.xs }}>
      <Text style={[labelStyle, { color: tokens.foreground, fontWeight: updateAvailable ? "500" : "400" }]}>{state.matches ? t.versionUpToDate : updateAvailable ? t.versionNewAvailable : t.versionAvailable}</Text>
      <Text style={labelStyle}>{t.versionChecked(new Date(state.checkedAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US"))}</Text>
      {state.versions.status === "unavailable" ? <Text style={labelStyle}>{t.versionMapUnavailable}</Text> : null}
      {state.versions.status === "available" && (state.versions.current === null || state.versions.latest === null || state.versions.currentBuild === null || state.versions.latestBuild === null) ? <Text style={labelStyle}>{t.versionUnmapped}</Text> : null}
    </View>
  </View>;
}

function VersionSection({ look, language, version, autoUpdateCheck, native }: { look: PageLook; language: "en" | "zh"; version: ReturnType<typeof useVersionCheck>; autoUpdateCheck: boolean; native: boolean }) {
  const { state, run } = version;
  const { copied, copy } = useCopy();
  const openTerminal = useRpc(openTerminalRpc);
  const [terminalStatus, setTerminalStatus] = useState<"idle" | "opening" | "opened" | "unsupported" | "failed" | "copyFailed">("idle");
  const t = look.t;
  const updateAvailable = state.state === "done" && state.versions.status === "available" && state.versions.current !== null && state.versions.latest !== null && state.versions.currentBuild !== null && state.versions.latestBuild !== null && isNewerVersion(state.versions.current, state.versions.latest, state.versions.currentBuild, state.versions.latestBuild);
  const orderUnknown = state.state === "done" && !state.matches && (state.versions.status === "unavailable" || state.versions.current === null || state.versions.latest === null || state.versions.currentBuild === null || state.versions.latestBuild === null);
  const command = state.state === "done" ? updateCommand() : "";
  async function goToUpdate() {
    if (state.state !== "done") return;
    setTerminalStatus("opening");
    try { await copyText(command); } catch { return setTerminalStatus("copyFailed"); }
    try {
      const result = await openTerminal({ source: state.source, latest: state.latest });
      setTerminalStatus(result.status);
    } catch {
      setTerminalStatus("failed");
    }
  }
  const description = state.state === "failed" ? t.versionFailed : state.state === "local" ? t.versionLocal : state.state === "unsupported" ? t.versionUnsupported : state.state === "done"
    ? <VersionResult state={state} look={look} language={language} updateAvailable={updateAvailable} />
    : t.versionDescription;
  return <>
  <Section title={t.versionTitle} look={look}>
    <SettingRow title={t.versionAutoCheck} description={t.versionAutoCheckDescription} first look={look}
      control={<Toggle value={autoUpdateCheck} onChange={(autoUpdateCheck) => updateEnhancerPreferences({ autoUpdateCheck })} label={t.versionAutoCheck} look={look} />} />
    <SettingRow title={t.versionInfo} description={description} stacked look={look}
      control={<PlainButton label={state.state === "checking" || state.state === "starting" ? t.versionChecking : t.versionCheck} disabled={state.state === "checking" || state.state === "starting"} loading={state.state === "checking" || state.state === "starting"} onPress={() => { void run(); }} look={look} />} />
  </Section>
  {(updateAvailable || orderUnknown) && state.state === "done" ? <Section title={orderUnknown ? t.versionMarketCommand : t.versionUpdateCommand} look={look}>
      <View style={{ paddingHorizontal: space.lg, paddingVertical: look.compact ? 11 : 14, gap: space.sm }}>
        <Text style={[styles.rowNote, settingsTextStyle(look.tokens, -1), { color: look.tokens.foregroundMuted, fontFamily: look.tokens.fontUi }]}>{orderUnknown ? t.versionMarketCommandHint : t.versionCommandHint}</Text>
        <CommandBand tokens={look.tokens} style={{ borderLeftWidth: 0, borderRadius: radiusV2.block }}>
          <SelectableText {...selectionCodeText} style={{ fontFamily: look.tokens.fontMono, fontSize: look.tokens.typography.mono.size, lineHeight: look.tokens.typography.mono.lineHeight, color: look.tokens.row.outputText, backgroundColor: "transparent" }}>
            <SelectableSpan style={{ color: look.tokens.row.meta }}>{"$ "}</SelectableSpan>{command}
          </SelectableText>
        </CommandBand>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <PlainButton label={copied ? t.versionCommandCopied : orderUnknown ? t.versionCopyMarketCommand : t.versionCopyCommand} onPress={() => { void copy(command); }} look={look} />
          {!native && !orderUnknown ? <PlainButton label={t.versionOpenTerminal} disabled={terminalStatus === "opening"} loading={terminalStatus === "opening"} onPress={() => { void goToUpdate(); }} look={look} /> : null}
        </View>
        {!orderUnknown ? <Text style={[settingsTextStyle(look.tokens, -1), { color: look.tokens.foregroundMuted, fontFamily: look.tokens.fontUi }]}>
          {native ? t.versionMobileTerminalUnavailable : terminalStatus === "opened" ? t.versionOpenTerminalOpened : terminalStatus === "copyFailed" ? t.versionCopyFailed : terminalStatus === "unsupported" ? t.versionOpenTerminalUnsupported : terminalStatus === "failed" ? t.versionOpenTerminalFailed : t.versionOpenTerminalHint}
        </Text> : null}
      </View>
  </Section> : null}
  {state.state === "done" ? <Section title={t.releaseNotesTitle} look={look}>
    <View style={{ paddingHorizontal: space.lg, paddingVertical: look.compact ? 11 : 14 }}>
      {state.notes.status === "available"
        ? <MarkdownView text={state.notes[language]} tokens={look.tokens} variant="compact" compact={look.compact} size={look.tokens.typography.ui.size} />
        : <Text style={[styles.rowNote, settingsTextStyle(look.tokens, -1), { color: look.tokens.foregroundMuted, fontFamily: look.tokens.fontUi }]}>
            {state.notes.status === "missing" ? t.releaseNotesMissing : t.releaseNotesUnavailable}
          </Text>}
    </View>
  </Section> : null}
  </>;
}

/** Settings content mounted by Paseo under the selected host's Plugin settings. */
export function BetterPaseoSettingsPage({ theme, layout, host }: PluginSurfaceProps) {
  const preferences = useEnhancerPreferences();
  // The selected settings section persists across page mounts.
  const tab = useSettingsTab();
  const version = useVersionCheck();
  const updateAvailable = version.state.state === "done" && version.state.versions.status === "available" && version.state.versions.current !== null && version.state.versions.latest !== null && version.state.versions.currentBuild !== null && version.state.versions.latestBuild !== null && isNewerVersion(version.state.versions.current, version.state.versions.latest, version.state.versions.currentBuild, version.state.versions.latestBuild);
  // The settings screen reads (and, through the store, saves) the daemon
  // record itself, so it works with no chat open.
  const sync = usePreferenceSettings();
  // "Follow Paseo" on iOS and Android learns the host's language a turn later.
  useHostLanguageVersion();
  const t = SETTINGS_STRINGS[resolveLanguage(preferences.language)];
  const hint = storageHint(sync, t);
  const platform =
    layout?.platform ?? (Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web");
  const native = platform !== "web";
  const compact = layout?.compact ?? native;
  const hostTypography = useMemo(() => readHostTypography(theme) !== null, [theme]);
  // Content size follows Paseo's Appearance settings on native as well as web.
  const appearance = useHostAppearance(!hostTypography, theme);
  const tokens = useMemo(
    () => {
      ensureEmbeddedFonts(preferences, platform);
      return buildThemeTokens(theme.colors, preferences, { platform, theme, appearance });
    },
    [preferences, theme, platform, appearance],
  );
  const look = useMemo<PageLook>(() => ({ tokens, compact, t }), [tokens, compact, t]);

  // Desktop web: take the room Paseo's 720 column withholds, and put the
  // preview beside the options once the page is wide enough for both.
  const rootRef = useRef<View>(null);
  useWideHostColumn(rootRef, !compact && platform === "web");
  const [width, setWidth] = useState(0);
  const side = !compact && width >= TWO_COLUMN_MIN;

  const nativeChoices = platform === "web" ? [] : NATIVE_MONO_CHOICES[platform];
  const previews = preferences.hoverPreview;

  // The web page also previews a phone: iOS rows at a phone's width, with
  // the platform monospace and inline code without a fill.
  const mobileTokens = useMemo(() => {
    if (native) return null;
    const ios = buildThemeTokens(theme.colors, preferences, { platform: "ios", theme });
    // iOS names its monospace `ui-monospace`, which Chromium (Electron
    // included) does not know: it would draw the code in a serif face.
    return { ...ios, fontMono: `${ios.fontMono}, ${DEFAULT_WEB_MONO_STACK}` };
  }, [native, preferences, theme]);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");
  const pinned = !(mobileTokens !== null && previewDevice === "mobile");
  const preview = (
    <PreviewPanel
      look={look}
      preferences={preferences}
      pointer={!native}
      side={side}
      mobileTokens={mobileTokens}
      device={previewDevice}
      onDevice={setPreviewDevice}
    />
  );

  const options = (
    <View style={styles.options}>
      <Section title={t.sectionGeneral} look={look}>
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
      </Section>

      <Section title={t.sectionAppearance} look={look}>
        <SettingRow
          title={t.accentTitle}
          description={t.accentDescription}
          control={<AccentControl value={preferences.accent} hostAccent={theme.colors.accent} look={look} />}
          look={look}
          first
          stacked
        />
        <SettingRow
          title={t.uiFontTitle}
          description={t.uiFontDescription}
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
        <SettingRow
          title={t.inlineCodeTitle}
          description={t.inlineCodeDescription}
          control={<InlineCodeColorControl value={preferences.inlineCodeColor} look={look} />}
          look={look}
          stacked
        />
      </Section>

      <View style={styles.sectionWithNote}>
        <Section title={t.sectionCode} look={look}>
          <SettingRow
            title={t.monoTitle}
            description={native ? t.monoNative : t.monoWeb}
            control={
              <Segmented<MonoFontPreference>
                label={t.monoTitle}
                value={preferences.monoFont}
                options={[
                  { value: "host", label: t.followPaseo },
                  { value: "custom", label: t.custom },
                ]}
                onChange={(monoFont) => updateEnhancerPreferences({ monoFont })}
                look={look}
              />
            }
            below={
              preferences.monoFont === "host" ? (
                <Text
                  accessibilityLabel={t.monoSource}
                  style={[styles.rowNote, settingsTextStyle(tokens, -1), { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}
                >
                  {describeMonoSource(tokens.typography.mono.source, platform, t)}
                </Text>
              ) : preferences.monoFont === "custom" ? (
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
            first
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
        </Section>
        {hostTypography ? null : <SectionNote text={native ? t.paseoFontsNative : t.paseoFontsWeb} look={look} />}
      </View>

      <Section title={t.sectionTools} look={look}>
        <SettingRow
          title={t.blockSizeTitle}
          description={t.blockSizeDescription(BLOCK_FONT_SIZE_MIN, BLOCK_FONT_SIZE_MAX)}
          control={<BlockSizeControl value={preferences.blockFontSize} look={look} />}
          look={look}
          first
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
          title={t.toolDetailTitle}
          description={t.toolDetailDescription}
          control={
            <Toggle
              value={preferences.toolDetail === "expand-failed"}
              onChange={(open) => updateEnhancerPreferences({ toolDetail: open ? "expand-failed" : "collapsed" })}
              label={t.toolDetailTitle}
              look={look}
            />
          }
          look={look}
        />
      </Section>

      <Section title={t.sectionSpacing} look={look}>
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
          first
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
          disabled={!preferences.assistantMarkdown}
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
      </Section>

      <Section title={t.sectionPreview} look={look}>
        <SettingRow
          title={t.hoverPreviewTitle}
          description={t.hoverPreviewDescription}
          control={
            <Toggle
              value={preferences.hoverPreview}
              onChange={(hoverPreview) => updateEnhancerPreferences({ hoverPreview })}
              label={t.hoverPreviewTitle}
              look={look}
            />
          }
          look={look}
          first
        />
        <SettingRow
          title={t.blockDetailsTitle}
          description={t.blockDetailsDescription}
          control={
            <Toggle
              value={preferences.blockDetails}
              onChange={(blockDetails) => updateEnhancerPreferences({ blockDetails })}
              label={t.blockDetailsTitle}
              look={look}
            />
          }
          look={look}
        />
        <SettingRow
          title={t.detailsSizeTitle}
          description={t.detailsSizeDescription(DETAILS_FONT_SIZE_MIN, DETAILS_FONT_SIZE_MAX, DETAILS_FONT_SIZE_DEFAULT)}
          control={<DetailsSizeControl value={preferences.detailsFontSize} look={look} />}
          look={look}
          stacked
        />
        {native ? null : (
          <SettingRow
            title={t.hoverDelayTitle}
            description={t.hoverDelayDescription(HOVER_DELAY_MIN, HOVER_DELAY_MAX)}
            control={
              <SecondsInput value={preferences.hoverDelaySeconds} look={look} />
            }
            look={look}
            stacked
            disabled={!previews}
          />
        )}
        <SettingRow
          title={t.previewWrapTitle}
          description={t.previewWrapDescription}
          control={
            <Toggle
              value={preferences.previewWrap}
              onChange={(previewWrap) => updateEnhancerPreferences({ previewWrap })}
              label={t.previewWrapTitle}
              look={look}
            />
          }
          look={look}
          disabled={!previews}
        />
        <SettingRow
          title={t.previewLineNumbersTitle}
          description={t.previewLineNumbersDescription}
          control={
            <Toggle
              value={preferences.previewLineNumbers}
              onChange={(previewLineNumbers) => updateEnhancerPreferences({ previewLineNumbers })}
              label={t.previewLineNumbersTitle}
              look={look}
            />
          }
          look={look}
          disabled={!previews}
        />
        <SettingRow
          title={t.previewStripesTitle}
          description={t.previewStripesDescription}
          control={
            <Toggle
              value={preferences.previewStripes}
              onChange={(previewStripes) => updateEnhancerPreferences({ previewStripes })}
              label={t.previewStripesTitle}
              look={look}
            />
          }
          look={look}
          disabled={!previews}
        />
      </Section>

      <ResetButton look={look} />
    </View>
  );

  return (
    <View
      ref={rootRef}
      {...surfaceProps(itemRootFont(preferences.uiFont), pluginRoot)}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.container, compact ? styles.pageInset : null, { backgroundColor: tokens.v2.surface0 }]}
    >
      <View style={compact ? null : styles.introDesktop}>
        <View style={tab === "display" ? styles.tabs : null}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Segmented<SettingsTab>
              label={t.tabsLabel}
              value={tab}
              options={[
                { value: "display", label: t.tabDisplay },
                { value: "tasks", label: t.tabTasks },
                { value: "version", label: t.tabVersion, badge: updateAvailable ? t.versionBadge : undefined },
              ]}
              onChange={setSettingsTab}
              look={look}
              contentWidth
            />
          </ScrollView>
        </View>
        {tab === "display" ? (
          <>
            <Text style={[styles.title, settingsTextStyle(tokens, 2), { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
              {t.pageTitle}
            </Text>
            <Text style={[styles.rowNote, settingsTextStyle(tokens, -1), { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
              {t.pageIntro}
            </Text>
          </>
        ) : null}
        {hint && tab === "display" ? (
          <Text
            accessibilityRole="alert"
            style={[
              styles.rowNote, settingsTextStyle(tokens, -1),
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

      {tab === "version" ? (
        <VersionSection look={look} language={resolveLanguage(preferences.language)} version={version} autoUpdateCheck={preferences.autoUpdateCheck} native={native} />
      ) : tab === "tasks" ? (
        <TasksSettingsPanel look={look} theme={theme} side={side} hostId={host?.id} />
      ) : side ? (
        <View style={styles.columns}>
          <View style={styles.optionsColumn}>
            {options}
          </View>
          <View style={[styles.previewColumn, pinned ? stickyColumn : null]}>{preview}</View>
        </View>
      ) : (
        <>
          {preview}
          {options}
        </>
      )}
    </View>
  );
}

/** Wide enough for the options (about 520) and the preview (about 400) side by side. */
const TWO_COLUMN_MIN = 960;
/** The side preview never shrinks below this, however short the window. */
const PREVIEW_MIN_HEIGHT = 320;
/** Window height the side preview leaves for Paseo's header and the page's own padding. */
const PREVIEW_WINDOW_MARGIN = 140;
const RESET_ARM_MS = 4000;
/** React Native's types lack `sticky`; React Native Web passes it through to CSS. */
const stickyColumn = (Platform.OS === "web" ? { position: "sticky", top: space.lg } : null) as ViewStyle | null;

const styles = {
  ...controlStyles,
  ...StyleSheet.create({
    // No `flex: 1` here. The host mounts a settings screen inside a plain
    // column `View` (app `plugins/settings/index.tsx:107`), and React Native Web
    // compiles `flex: 1` to `flex: 1 1 0%`: a zero basis in a container that
    // sizes to its content, so the whole page collapses to nothing.
    // Desktop has no side padding: the host's content column (`PageLayout`)
    // already pads the page, so the cards line up with the page title. Its 720
    // cap is lifted on desktop web (`useWideHostColumn`).
    // Touch shares one edge across the tab, both previews and the section
    // cards. The host column pads 16, and the phone board's cards sit 12 from
    // the screen, so the page pulls outward by 4 to meet that edge.
    container: { alignSelf: "stretch", paddingVertical: space.lg, gap: space.xl },
    pageInset: { marginHorizontal: -space.xs },
    introDesktop: { paddingHorizontal: space.xs },
    title: {
      fontSize: TYPE.title.size,
      lineHeight: TYPE.title.lineHeight,
      fontWeight: "600",
      marginBottom: space.xs,
    },
    tabs: { marginBottom: space.lg },
    storageHint: { marginTop: space.sm, padding: space.sm, borderWidth: 1, borderRadius: radiusV2.block },
    columns: { flexDirection: "row", alignItems: "flex-start", gap: space.xl },
    optionsColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, gap: space.xl },
    previewColumn: { flexGrow: 0, flexShrink: 0, flexBasis: "44%", minWidth: 380, maxWidth: 640 },
    options: { gap: space.xl },
    sectionWithNote: { gap: space.sm },
    controlLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.md },
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
    ringedSwatch: {
      width: RINGED_SWATCH,
      height: RINGED_SWATCH,
      borderRadius: RINGED_SWATCH / 2,
      borderWidth: 2,
      alignItems: "center",
      justifyContent: "center",
    },
    // Centre to centre as far apart as the accent swatches above.
    ringedSwatches: { flexDirection: "row", alignItems: "center", gap: space.md - (RINGED_SWATCH - SWATCH) },
    swatchFill: { width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2 },
    secondsField: { flexDirection: "row", alignItems: "center", gap: space.sm },
    secondsInput: { alignSelf: "auto", width: 72, textAlign: "right" },
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
    previewCard: { borderWidth: 1, borderRadius: radiusV2.card, overflow: "hidden" },
    previewHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
    },
    previewHeaderText: { flex: 1, minWidth: 0, gap: 2 },
    previewScroll: { flexGrow: 0 },
    previewBody: { padding: space.lg },
    phoneFrame: {
      width: "100%",
      maxWidth: PHONE_PREVIEW_WIDTH,
      alignSelf: "center",
      borderWidth: 1,
      borderRadius: radiusV2.bubble,
      padding: space.lg,
    },
    reset: { gap: space.sm },
  }),
};
