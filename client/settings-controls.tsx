import { TextUpdateDot } from "./ui/text-update-dot";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { radiusV2, space, type ExtendedThemeTokens } from "./components/theme-tokens";
import { TYPE } from "./ui/tokens/typography";
import { SwitchTrack } from "./ui/switch-track";
import { useSwitchSpace } from "./ui/use-switch-space";
import type { SettingsStrings } from "./i18n/settings-page-strings";

/**
 * The settings page's controls, drawn the way Paseo draws its own settings:
 * sections of label-and-control rows, a switch, a segmented control and a
 * plain button. Shared by the chat options and the Tasks board options.
 */

/** The width of the settings previews' phone frame: a phone's, in points, padding included. */
export const PHONE_PREVIEW_WIDTH = 390;

/** Layout of the page: a grouped list on touch layouts, cards of label-and-control rows on desktop. */
export interface PageLook {
  compact: boolean;
  tokens: ExtendedThemeTokens;
  /** The page's strings, in the language the reader chose. */
  t: SettingsStrings;
}

/** Settings chrome follows Paseo's interface size, with smaller supporting text. */
export function settingsTextStyle(tokens: ExtendedThemeTokens, offset = 0) {
  const fontSize = tokens.typography.ui.size + offset;
  return { fontSize, lineHeight: Math.round(fontSize * 1.4) };
}

/**
 * An on/off control that reads as one: on is the accent track with the
 * accent's foreground knob, off a surface2 track with a surface0 knob.
 */
export function Toggle({
  value,
  onChange,
  label,
  look,
  disabled = false,
}: {
  value: boolean;
  onChange(next: boolean): void;
  label: string;
  look: PageLook;
  disabled?: boolean;
}) {
  const { tokens } = look;
  const onPress = () => { if (!disabled) onChange(!value); };
  const spaceKeys = useSwitchSpace(onPress);
  return (
    <Pressable
      accessibilityRole="switch"
      // React Native Web does not map `accessibilityState.checked` onto a
      // Pressable, so the ARIA attribute is set directly as well.
      aria-checked={value}
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={10}
      onPress={onPress}
      {...(disabled ? {} : spaceKeys)}
    >
      <SwitchTrack
        value={value}
        colors={{ accent: tokens.accent, accentForeground: tokens.accentForeground, surface0: tokens.v2.surface0, surface2: tokens.v2.surface2, border: tokens.v2.border }}
      />
    </Pressable>
  );
}

/**
 * One choice of several, as a segmented control: a surface2 track, the
 * selected segment raised on surface0 with a hairline. Equal widths on touch
 * layouts, content widths on desktop.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  look,
  label,
  contentWidth = false,
  wrap = false,
}: {
  value: T | null;
  options: ReadonlyArray<{ value: T; label: string; badge?: string }>;
  contentWidth?: boolean;
  wrap?: boolean;
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
        wrap ? { flexWrap: "wrap", alignSelf: "stretch" } : null,
        { backgroundColor: tokens.v2.surface2, minHeight: compact ? 32 : 28 },
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
            accessibilityLabel={option.badge ? `${option.label}, ${option.badge}` : option.label}
            hitSlop={compact ? { top: 6, bottom: 6 } : undefined}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              compact && !contentWidth && !wrap ? styles.segmentFill : null,
              wrap ? { flexGrow: 1, flexBasis: 0, minWidth: 140 } : null,
              selected
                ? { backgroundColor: tokens.v2.surface0, borderColor: tokens.v2.border }
                : styles.segmentIdle,
            ]}
          >
            <View style={{ flexShrink: 1 }}>
              <Text
                numberOfLines={1}
                style={[
                  styles.segmentLabel, settingsTextStyle(tokens, -1),
                  {
                    color: selected ? tokens.foreground : tokens.foregroundMuted,
                    fontWeight: selected ? "500" : "400",
                    fontFamily: tokens.fontUi,
                  },
                ]}
              >
                {option.label}
              </Text>
              {option.badge ? <TextUpdateDot testID="update-badge" /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A plain bordered button (Reset, Follow Paseo, the stepper's minus and plus). */
export function PlainButton({
  label,
  onPress,
  look,
  accessibilityLabel,
  disabled = false,
  square = false,
  loading = false,
  updateBadge = false,
}: {
  label: string;
  onPress(): void;
  look: PageLook;
  accessibilityLabel?: string;
  disabled?: boolean;
  square?: boolean;
  loading?: boolean;
  updateBadge?: boolean;
}) {
  const { tokens } = look;
  const labelText = <Text style={[styles.plainLabel, settingsTextStyle(tokens, -1), { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>{label}</Text>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={loading ? { disabled, busy: true } : { disabled }}
      disabled={disabled}
      hitSlop={look.compact ? 6 : 0}
      onPress={onPress}
      style={({ pressed }) => [
        styles.plainButton,
        square ? styles.squareButton : null,
        loading ? { flexDirection: "row", gap: space.xs } : null,
        {
          borderColor: tokens.v2.border,
          backgroundColor: pressed ? tokens.v2.surface2 : "transparent",
          opacity: disabled && !loading ? 0.4 : 1,
        },
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={tokens.foregroundMuted} accessible={false} /> : null}
      {updateBadge ? <View>
        {labelText}
        <TextUpdateDot testID="version-item-update-dot" />
      </View> : labelText}
    </Pressable>
  );
}

/**
 * A section: a muted label over a card of rows, as Paseo draws its own
 * settings (`SettingsSection`): a grouped list on touch, a bordered surface1
 * card on desktop. A `hidden` section (its parent option is off) is not
 * rendered, so neither pointer nor keyboard can reach its controls.
 */
export function Section({ title, look, children, hidden = false }: { title: string; look: PageLook; children: React.ReactNode; hidden?: boolean }) {
  const { tokens, compact } = look;
  if (hidden) return null;
  return (
    <View style={styles.section}>
      <Text
        accessibilityRole="header"
        style={[
          styles.sectionTitle, settingsTextStyle(tokens, -1),
          compact ? styles.sectionTitleInset : styles.sectionTitleDesktop,
          { color: tokens.foregroundMuted, fontFamily: tokens.fontUi },
        ]}
      >
        {title}
      </Text>
      <Group look={look}>{children}</Group>
    </View>
  );
}

export function Group({ look, children }: { look: PageLook; children: React.ReactNode }) {
  const { tokens, compact } = look;
  return (
    <View style={[
      styles.group,
      { backgroundColor: tokens.v2.surface1 },
      !compact && [styles.groupDesktop, { borderColor: tokens.v2.border }],
    ]}>
      {children}
    </View>
  );
}

export function SectionFooter({ look, children }: { look: PageLook; children: React.ReactNode }) {
  return (
    <View style={look.compact ? styles.rowInset : undefined}>
      <View style={[
        styles.footer,
        !look.compact && styles.footerDesktop,
        { borderTopColor: look.tokens.v2.border },
      ]}>
        {children}
      </View>
    </View>
  );
}

export function RowNotice({ look, text, tone = "neutral", alert = false }: {
  look: PageLook;
  text: string;
  tone?: "neutral" | "accent" | "warning" | "danger";
  alert?: boolean;
}) {
  const { tokens } = look;
  return (
    <Text accessibilityRole={alert ? "alert" : undefined} style={[
      styles.rowNote, settingsTextStyle(tokens, -1),
      { color: tone === "neutral" ? tokens.foregroundMuted : tokens[tone], fontFamily: tokens.fontUi },
    ]}>
      {text}
    </Text>
  );
}

export function ResetRow({
  look, title, description, confirmDescription, action, confirm, cancel, onReset,
  first, disabled, confirmAccessibilityLabel, cancelAccessibilityLabel, onArmedChange,
}: {
  look: PageLook;
  title: string;
  description: string;
  confirmDescription: string;
  action: string;
  confirm: string;
  cancel: string;
  onReset(): void | Promise<void>;
  first?: boolean;
  disabled?: boolean;
  confirmAccessibilityLabel?: string;
  cancelAccessibilityLabel?: string;
  onArmedChange?(armed: boolean): void;
}) {
  const [armed, setArmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    if (!armed || resetting) return;
    const timer = setTimeout(() => {
      setArmed(false);
      onArmedChange?.(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, [armed, resetting, onArmedChange]);

  const disarm = () => {
    setArmed(false);
    onArmedChange?.(false);
  };
  const press = async () => {
    if (!armed) {
      setArmed(true);
      onArmedChange?.(true);
      return;
    }
    setResetting(true);
    try {
      await onReset();
    } finally {
      setResetting(false);
      disarm();
    }
  };
  return (
    <SettingRow title={title} look={look} first={first} wrapControl
      description={armed ? <RowNotice look={look} text={confirmDescription} tone="warning" /> : description}
      control={
        <View style={styles.resetActions}>
          {armed ? <PlainButton label={cancel} accessibilityLabel={cancelAccessibilityLabel} look={look} onPress={disarm} disabled={resetting} /> : null}
          <PlainButton label={armed ? confirm : action} accessibilityLabel={armed ? confirmAccessibilityLabel : undefined}
            look={look} onPress={() => void press()} disabled={disabled || resetting} />
        </View>
      }
    />
  );
}

/** A muted paragraph under a section's rows, for what applies to the whole section. */
export function SectionNote({ text, look }: { text: string; look: PageLook }) {
  const { tokens, compact } = look;
  return (
    <Text
      style={[
        styles.rowNote, settingsTextStyle(tokens, -1),
        compact ? styles.sectionTitleInset : styles.sectionTitleDesktop,
        styles.sectionNote,
        { color: tokens.foregroundMuted, fontFamily: tokens.fontUi },
      ]}
    >
      {text}
    </Text>
  );
}

/** Related notes grouped by subject, using the same muted colour as row descriptions. */
export function SettingsTips({ items, look }: { items: ReadonlyArray<{ label: string; text: string }>; look: PageLook }) {
  const noteStyle = [styles.rowNote, settingsTextStyle(look.tokens, -1), { color: look.tokens.foregroundMuted, fontFamily: look.tokens.fontUi }];
  return (
    <View style={styles.tips}>
      {items.map((item) => (
        <View key={item.label} style={[styles.tip, look.compact ? styles.tipCompact : null]}>
          <Text style={[noteStyle, styles.tipLabel]}>{item.label}</Text>
          <Text style={[noteStyle, look.compact ? null : styles.tipText]}>{item.text}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * One setting. Touch: a list row: the label and its note, the control beside
 * them (a switch) or under them (`stacked`, a segmented control). Desktop: the
 * label and note on the left, the control on the right, wrapping under them
 * when the column is too narrow for both. Rows after the first take a 1pt rule.
 * A `disabled` row (its parent option is off) is dimmed and takes no input.
 */
export function SettingRow({
  title,
  description,
  control,
  look,
  first = false,
  stacked = false,
  disabled = false,
  wrapControl = false,
  below,
}: {
  title: string;
  description?: React.ReactNode;
  control?: React.ReactNode;
  look: PageLook;
  first?: boolean;
  stacked?: boolean;
  disabled?: boolean;
  wrapControl?: boolean;
  /** Extra content under the row (the font preview, a custom family). */
  below?: React.ReactNode;
}) {
  const { tokens, compact } = look;
  const rule = first ? null : { borderTopWidth: 1, borderTopColor: tokens.v2.border };
  const dim = disabled ? styles.rowDisabled : null;
  const text = (
    <View style={compact ? (wrapControl ? styles.rowTextWrap : styles.rowText) : styles.rowTextDesktop}>
      <Text
        style={[
          compact ? styles.rowTitleCompact : styles.rowTitleDesktop, settingsTextStyle(tokens),
          { color: tokens.foreground, fontFamily: tokens.fontUi },
        ]}
      >
        {title}
      </Text>
      {typeof description === "string" ? description ? (
        <Text style={[styles.rowNote, settingsTextStyle(tokens, -1), { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
          {description}
        </Text>
      ) : null : description}
    </View>
  );
  if (compact) {
    return (
      <View style={styles.rowInset} pointerEvents={disabled ? "none" : "auto"} aria-disabled={disabled}>
        <View style={[styles.rowCompact, rule, stacked ? styles.rowStacked : null, dim]}>
          {stacked ? (
            <>
              {text}
              {control}
            </>
          ) : (
            <View style={[styles.rowLine, wrapControl && styles.rowLineWrap]}>
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
    <View
      style={[styles.rowDesktop, rule, dim]}
      pointerEvents={disabled ? "none" : "auto"}
      aria-disabled={disabled}
    >
      <View style={styles.rowLineDesktop}>
        {text}
        {control ? <View style={styles.controlDesktop}>{control}</View> : null}
      </View>
      {below}
    </View>
  );
}


const styles = StyleSheet.create({
  section: { gap: space.sm },
  sectionTitle: {
    fontSize: TYPE.settingNote.size,
    lineHeight: TYPE.settingNote.lineHeight,
    fontWeight: "500",
  },
  sectionTitleInset: { paddingHorizontal: space.lg },
  sectionTitleDesktop: { paddingHorizontal: space.xs },
  sectionNote: { marginTop: -space.xs },
  tips: { gap: space.sm },
  tip: { flexDirection: "row", flexWrap: "wrap", columnGap: space.md, rowGap: 2 },
  tipCompact: { flexDirection: "column", flexWrap: "nowrap" },
  tipLabel: { width: 92, fontWeight: "500" },
  tipText: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 180, maxWidth: "100%" },
  group: { borderRadius: radiusV2.card, overflow: "hidden" },
  groupDesktop: { borderWidth: 1 },
  footer: { borderTopWidth: 1, paddingTop: space.md, paddingBottom: 14, paddingRight: space.lg },
  footerDesktop: { paddingLeft: space.lg },
  resetActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm, maxWidth: "100%" },
  // Touch: the rule runs from the inset, like a native grouped list.
  rowInset: { paddingLeft: space.lg },
  rowCompact: { minHeight: 44, paddingVertical: 11, paddingRight: space.lg, gap: space.sm },
  rowStacked: { gap: space.md },
  rowLine: { flexDirection: "row", alignItems: "center", gap: space.lg },
  rowLineWrap: { flexWrap: "wrap", rowGap: space.sm },
  rowTextWrap: { flexGrow: 1, flexShrink: 1, flexBasis: 72, minWidth: 0, gap: 2 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowDisabled: { opacity: 0.45 },
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
  // Desktop: the text on the left, the control on the right; the control
  // wraps under the text when the card is too narrow for both.
  rowDesktop: { paddingVertical: 14, paddingHorizontal: space.lg, gap: space.md },
  rowLineDesktop: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.xl,
    rowGap: space.md,
  },
  rowTextDesktop: { flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 0, gap: 2 },
  controlDesktop: { flexShrink: 0, maxWidth: "100%" },
  segmented: {
    flexDirection: "row",
    alignItems: "stretch",
    alignSelf: "flex-start",
    padding: 2,
    borderRadius: radiusV2.block,
  },
  segmentedFill: { alignSelf: "stretch" },
  segment: {
    flexDirection: "row",
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
});

/** The rows' text styles, for a page that draws text of its own beside them. */
export const controlStyles = styles;
