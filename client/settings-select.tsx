import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { radiusV2, space } from "./components/theme-tokens";
import { settingsTextStyle, type PageLook } from "./settings-controls";

/**
 * The pieces every settings dropdown shares: the bordered trigger, the
 * floating card its menu sits in, and the menu's option row. The choice menu
 * (`settings-choice-menu.tsx`) and the language picker
 * (`translation/language-picker.tsx`) both build on these, so a select looks
 * the same wherever it appears on the settings page.
 */

/** The chevron's box. Drawn with the host's Lucide icon so its stroke matches every other host icon. */
export const SELECT_CHEVRON = 14;

export function SelectTrigger({
  look,
  label,
  text,
  logo,
  open,
  disabled = false,
  onPress,
  triggerRef,
  style,
}: {
  look: PageLook;
  /** The control's name, the setting title. */
  label: string;
  /** The closed control's face. */
  text: string;
  logo?: React.ReactNode;
  open: boolean;
  disabled?: boolean;
  onPress(): void;
  triggerRef?: React.Ref<View>;
  style?: StyleProp<ViewStyle>;
}) {
  const { tokens, compact } = look;
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      ref={triggerRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open, disabled }}
      accessibilityValue={{ text }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.trigger,
        compact ? styles.triggerCompact : null,
        {
          borderColor: open ? tokens.accent : tokens.v2.border,
          backgroundColor: (hovered || pressed) && !disabled ? tokens.v2.surface2 : tokens.v2.surface0,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {logo ?? null}
      <Text
        numberOfLines={1}
        style={[
          styles.name,
          settingsTextStyle(tokens, -1),
          { color: tokens.foreground, fontWeight: "500", fontFamily: tokens.fontUi },
        ]}
      >
        {text}
      </Text>
      <View style={styles.chevron}>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={SELECT_CHEVRON} color={tokens.foregroundMuted} />
      </View>
    </Pressable>
  );
}

/** The floating card a select's menu sits in. */
export function selectMenuSurface(tokens: PageLook["tokens"]): ViewStyle {
  return {
    borderRadius: radiusV2.overlay,
    backgroundColor: tokens.v2.surface0,
    borderColor: tokens.v2.border,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: tokens.isDark ? "0px 8px 32px rgba(0,0,0,0.5)" : "0px 8px 32px rgba(0,0,0,0.12)",
  } as ViewStyle;
}

/** One row of a select's menu: selected and hovered rows share a fill, the selected name is heavier. */
export function SelectOption({
  look,
  name,
  selected,
  onPress,
  logo,
  trailing,
  inset = 6,
}: {
  look: PageLook;
  name: string;
  selected: boolean;
  onPress(): void;
  logo?: React.ReactNode;
  /** Extra detail on the row's far side, such as a language code. */
  trailing?: string;
  /** The row's side margin inside its card. */
  inset?: number;
}) {
  const { tokens, compact } = look;
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      aria-checked={selected}
      accessibilityLabel={name}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.option,
        {
          height: selectOptionHeight(compact),
          marginHorizontal: inset,
          backgroundColor: pressed || hovered || selected ? tokens.v2.surface2 : "transparent",
        },
      ]}
    >
      {logo ?? null}
      <Text
        numberOfLines={1}
        style={[
          styles.name,
          settingsTextStyle(tokens, -1),
          {
            color: selected ? tokens.foreground : tokens.foregroundMuted,
            fontWeight: selected ? "500" : "400",
            fontFamily: tokens.fontUi,
          },
        ]}
      >
        {name}
      </Text>
      {trailing ? (
        <Text numberOfLines={1} style={[styles.trailing, { color: tokens.foregroundMuted, fontFamily: tokens.fontMono }]}>
          {trailing}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function selectOptionHeight(compact: boolean): number {
  return compact ? 44 : 32;
}

const styles = StyleSheet.create({
  trigger: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radiusV2.block,
    borderWidth: 1,
  },
  triggerCompact: { minHeight: 44 },
  name: { flexShrink: 1, minWidth: 0 },
  chevron: {
    width: SELECT_CHEVRON,
    height: SELECT_CHEVRON,
    flexShrink: 0,
    marginStart: "auto",
    alignItems: "center",
    justifyContent: "center",
  },
  option: {
    paddingHorizontal: 8,
    borderRadius: radiusV2.block,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  trailing: { marginStart: "auto", flexShrink: 0, fontSize: 11, lineHeight: 14 },
});
