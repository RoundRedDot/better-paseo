import React from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { updateEnhancerPreferences, useEnhancerPreferences, type TimelineLevel } from "./preferences";
import { SwitchTrack } from "./ui/switch-track";
import { useSwitchSpace } from "./ui/use-switch-space";
import { useHover } from "./ui/use-hover";
import { TIMELINE_LEVEL_ICONS, TIMELINE_LEVELS, timelineLevelStrings } from "./timeline-level-control";

export function TimelineLevelMenu(props: PluginButtonContentProps & { select(level: TimelineLevel): void; openSettings(): void }) {
  const preferences = useEnhancerPreferences();
  const text = timelineLevelStrings(preferences);
  const colors = props.theme.colors;
  const rowHeight = props.layout.compact ? 44 : 28;
  const levels = TIMELINE_LEVELS.map((level) => <LevelRow key={level} level={level} title={text.levels[level]} description={text.descriptions[level]} selected={preferences.timelineLevel === level}
    colors={colors} height={rowHeight} onPress={() => { props.close(); props.select(level); }} />);
  const toggleChat = () => updateEnhancerPreferences({ chatEnabled: !preferences.chatEnabled });
  const spaceKeys = useSwitchSpace(toggleChat);
  const chatSwitch = <Pressable accessibilityRole="switch" accessibilityLabel={text.chat} aria-checked={preferences.chatEnabled}
    accessibilityState={{ checked: preferences.chatEnabled }} onPress={toggleChat} {...spaceKeys}
    style={{ minHeight: rowHeight, paddingHorizontal: 8, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
    <Text style={{ flex: 1, color: colors.foreground, fontSize: 13 }}>{text.chat}</Text>
    <View style={{ width: 30, height: 18, alignItems: "center", justifyContent: "center" }}>
      <View style={{ transform: [{ scale: 0.75 }] }}><SwitchTrack value={preferences.chatEnabled} colors={colors} /></View>
    </View>
  </Pressable>;
  const openSettings = () => { props.close(); props.openSettings(); };
  // On compact the host's sheet header already shows the title and has no slot for a trailing button,
  // so settings moves below the levels as a row of its own.
  if (props.layout.compact) {
    return (
      <View testID="timeline-level-menu">
        {preferences.chatEnabled ? <>{levels}<View testID="chat-switch-divider" style={{ height: 0.5, backgroundColor: colors.border, marginVertical: 4 }} /></> : null}
        {chatSwitch}
        <MenuRow icon="Settings" title={text.settings} accessibilityRole="button" colors={colors} height={rowHeight} onPress={openSettings} />
      </View>
    );
  }
  // The host adds 12pt around popover content; desktop menus use a 4pt inset.
  return (
    <View testID="timeline-level-menu" style={{ margin: -8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", height: rowHeight, paddingHorizontal: 8 }}>
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, lineHeight: 18, fontWeight: "normal" }}>{text.title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={text.settings} onPress={openSettings}
          style={{ width: rowHeight, height: rowHeight, alignItems: "center", justifyContent: "center" }}>
          <Icon name="Settings" size={16} color={colors.foregroundMuted} />
        </Pressable>
      </View>
      <View style={{ height: 0.5, backgroundColor: colors.border, marginVertical: 4 }} />
      {preferences.chatEnabled ? <>{levels}<View testID="chat-switch-divider" style={{ height: 0.5, backgroundColor: colors.border, marginVertical: 4 }} /></> : null}
      {chatSwitch}
    </View>
  );
}

type Colors = PluginButtonContentProps["theme"]["colors"];

function LevelRow(props: { level: TimelineLevel; title: string; description: string; selected: boolean; colors: Colors; height: number; onPress(): void }) {
  return (
    <MenuRow icon={TIMELINE_LEVEL_ICONS[props.level]} title={props.title} description={props.description} accessibilityRole="radio" checked={props.selected}
      colors={props.colors} height={props.height} onPress={props.onPress} />
  );
}

function MenuRow(props: { icon: string; title: string; description?: string; accessibilityRole: "radio" | "button"; checked?: boolean; colors: Colors; height: number; onPress(): void }) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable accessibilityRole={props.accessibilityRole} accessibilityState={props.checked === undefined ? undefined : { checked: props.checked }}
      accessibilityLabel={props.description ? `${props.title}, ${props.description}` : props.title} onPress={props.onPress} {...hoverProps} style={({ pressed }) => ({ minHeight: props.height, paddingVertical: props.description ? 8 : 0, borderRadius: 6, paddingHorizontal: 8,
        flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: pressed || hovered ? props.colors.surface2 : "transparent" })}>
      <View style={props.description ? { alignSelf: "flex-start", marginTop: 1 } : undefined}>
        <Icon name={props.icon} size={16} color={props.colors.foregroundMuted} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontSize: props.description ? 13 : 14, lineHeight: props.description ? 17 : 18, color: props.colors.foreground }}>{props.title}</Text>
        {props.description ? <Text style={{ fontSize: 11, lineHeight: 15, color: props.colors.foregroundMuted }}>{props.description}</Text> : null}
      </View>
      {props.checked ? <View style={props.description ? { alignSelf: "flex-start", marginTop: 1 } : undefined}><Icon name="Check" size={16} color={props.colors.foreground} /></View> : null}
    </Pressable>
  );
}
