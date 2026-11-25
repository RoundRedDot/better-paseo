import { SHEET_BODY_INSET } from "./ui/tokens/sheet";
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { radiusV2, space } from "./components/theme-tokens";
import { settingsTextStyle, type PageLook } from "./settings-controls";

export function PromptEditorModal({
  look, title, label, value, defaultValue, reset, cancel, save,
  placeholder, testID, maxLength, trim = false, onClose, onSave,
}: {
  look: PageLook;
  title: string;
  label: string;
  value: string;
  defaultValue: string;
  reset: string;
  cancel: string;
  save: string;
  placeholder?: string;
  testID?: string;
  maxLength?: number;
  trim?: boolean;
  onClose(): void;
  onSave(value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  const [height, setHeight] = useState(0);
  const { tokens } = look;
  const mobile = Platform.OS !== "web";
  const next = trim ? draft.trim() : draft;
  const disabled = !draft.trim() || next === value;
  const input = (
    <TextInput testID={testID} accessibilityLabel={label} multiline autoFocus value={draft} maxLength={maxLength}
      placeholder={placeholder} placeholderTextColor={tokens.foregroundSubtle}
      onChangeText={setDraft} scrollEnabled={mobile}
      onContentSizeChange={mobile ? undefined : (event) => setHeight(event.nativeEvent.contentSize.height)}
      style={[settingsTextStyle(tokens), styles.input, {
        color: tokens.foreground, fontFamily: tokens.fontUi,
        backgroundColor: tokens.v2.surface0, borderColor: tokens.v2.border,
        height: mobile ? undefined : Math.max(240, height),
        flex: mobile ? 1 : undefined,
      }]}
    />
  );
  return (
    <Modal title={title} open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Content scrollable={!mobile} contentContainerStyle={mobile ? styles.nativeContent : undefined}>
        <View style={mobile ? styles.fill : styles.desktopBody}>
          {mobile ? (
            <ScrollView style={styles.fill} contentContainerStyle={styles.nativeInputWrap} keyboardShouldPersistTaps="handled">
              {input}
            </ScrollView>
          ) : input}
          <View style={[styles.actions, mobile && styles.nativeActions, { borderTopColor: tokens.v2.border }]}>
            {[
              { label: reset, onPress: () => setDraft(defaultValue) },
              { label: cancel, onPress: onClose },
              { label: save, onPress: () => { onSave(next); onClose(); }, primary: true },
            ].map((action) => (
              <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label}
                accessibilityState={{ disabled: action.primary && disabled }}
                disabled={action.primary && disabled} onPress={action.onPress}
                style={[styles.button, mobile && styles.nativeButton, {
                  flexGrow: !mobile || action.primary ? 1 : 0,
                  borderColor: tokens.v2.border,
                  borderWidth: mobile && !action.primary ? 1 : 0,
                  backgroundColor: action.primary ? tokens.accent : mobile ? undefined : tokens.v2.surface2,
                  opacity: action.primary && disabled ? 0.5 : 1,
                }]}
              >
                <Text style={[settingsTextStyle(tokens, -1), styles.buttonLabel, {
                  color: action.primary ? tokens.accentForeground : tokens.foreground,
                  fontFamily: tokens.fontUi,
                }]}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  nativeContent: { flex: 1, minHeight: 0, paddingHorizontal: 0, paddingTop: 0, paddingBottom: space.lg, gap: 0 },
  nativeInputWrap: { flexGrow: 1, paddingVertical: space.lg, paddingHorizontal: SHEET_BODY_INSET },
  desktopBody: { gap: space.lg },
  input: {
    width: "100%", minHeight: 240, borderWidth: 1, borderRadius: radiusV2.card,
    paddingHorizontal: space.md, paddingVertical: space.sm, includeFontPadding: false, textAlignVertical: "top",
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  nativeActions: { paddingTop: space.md, paddingHorizontal: SHEET_BODY_INSET, borderTopWidth: 1 },
  button: { minHeight: 32, paddingHorizontal: space.md, justifyContent: "center", alignItems: "center", borderRadius: radiusV2.block },
  nativeButton: { minHeight: 44, borderRadius: radiusV2.pill },
  buttonLabel: { fontWeight: "500" },
});
