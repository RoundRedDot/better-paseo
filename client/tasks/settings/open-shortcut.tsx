import React, { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { PlainButton, SettingRow, settingsTextStyle, type PageLook } from "../../settings-controls";
import { captureTasksShortcut, isShortcutMac } from "../open-shortcut";
import { DEFAULT_OPEN_TASKS_SHORTCUT, shortcutFromEvent, shortcutLabel } from "../shortcut-model";
import type { TasksSettingsStrings } from "./strings";

export function OpenTasksShortcut({ value, ready, onChange, look, strings }: {
  value: string | null;
  ready: boolean;
  onChange(value: string | null): Promise<void>;
  look: PageLook;
  strings: TasksSettingsStrings;
}) {
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return;
    const stop = captureTasksShortcut((event) => {
      if (event.repeat) return;
      if (event.code === "Escape") return setRecording(false);
      const shortcut = shortcutFromEvent(event, isShortcutMac());
      if (!shortcut) return;
      setRecording(false);
      void onChange(shortcut);
    });
    const cancel = () => setRecording(false);
    window.addEventListener("blur", cancel);
    return () => { stop(); window.removeEventListener("blur", cancel); };
  }, [recording, onChange]);
  if (Platform.OS !== "web") return null;
  return (
    <SettingRow
      title={strings.openShortcut}
      description={recording ? strings.shortcutRecording : strings.shortcutHint}
      look={look}
      disabled={!ready}
      control={
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Text testID="tasks-open-shortcut" accessibilityLiveRegion="polite" style={[settingsTextStyle(look.tokens, -1), { color: look.tokens.foreground, fontFamily: look.tokens.fontUi }]}>
            {value ? shortcutLabel(value, isShortcutMac()) : strings.shortcutNone}
          </Text>
          <PlainButton label={recording ? strings.resetCancel : strings.shortcutRecord} onPress={() => setRecording(!recording)} disabled={!ready} look={look} />
          {!recording ? <>
            <PlainButton label={strings.shortcutClear} onPress={() => void onChange(null)} disabled={!ready || value === null} look={look} />
            <PlainButton label={strings.shortcutDefault} onPress={() => void onChange(DEFAULT_OPEN_TASKS_SHORTCUT)} disabled={!ready || value === DEFAULT_OPEN_TASKS_SHORTCUT} look={look} />
          </> : null}
        </View>
      }
    />
  );
}
