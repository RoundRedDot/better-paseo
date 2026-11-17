import React from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useEnhancerPreferences, type TimelineLevel } from "./preferences";
import { useHover } from "./ui/use-hover";
import { TIMELINE_LEVEL_ICONS, TIMELINE_LEVELS, timelineLevelStrings } from "./timeline-level-control";

export function TimelineLevelMenu(props: PluginButtonContentProps & { select(level: TimelineLevel): void; openSettings(): void }) {
  const preferences = useEnhancerPreferences();
  const text = timelineLevelStrings(preferences);
  const colors = props.theme.colors;
  const rowHeight = props.layout.compact ? 44 : 28;
  // The host adds 12pt around popover content; desktop menus use a 4pt inset.
  return (
    <View testID="timeline-level-menu" style={props.layout.compact ? undefined : { margin: -8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", height: rowHeight, paddingHorizontal: 8 }}>
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, lineHeight: 18, fontWeight: "500" }}>{text.title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={text.settings} onPress={() => { props.close(); props.openSettings(); }}
          style={{ width: rowHeight, height: rowHeight, alignItems: "center", justifyContent: "center" }}>
          <Icon name="Settings" size={16} color={colors.foregroundMuted} />
        </Pressable>
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 }} />
      {TIMELINE_LEVELS.map((level) => <LevelRow key={level} level={level} title={text.levels[level]} selected={preferences.timelineLevel === level}
        colors={colors} height={rowHeight} onPress={() => { props.close(); props.select(level); }} />)}
    </View>
  );
}

function LevelRow(props: { level: TimelineLevel; title: string; selected: boolean; colors: PluginButtonContentProps["theme"]["colors"]; height: number; onPress(): void }) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: props.selected }} accessibilityLabel={props.title}
      onPress={props.onPress} {...hoverProps} style={({ pressed }) => ({ height: props.height, borderRadius: 6, paddingHorizontal: 8,
        flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: pressed || hovered ? props.colors.surface2 : "transparent" })}>
      <Icon name={TIMELINE_LEVEL_ICONS[props.level]} size={16} color={props.colors.foregroundMuted} />
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 18, color: props.colors.foreground }}>{props.title}</Text>
      {props.selected ? <Icon name="Check" size={16} color={props.colors.foreground} /> : null}
    </Pressable>
  );
}
