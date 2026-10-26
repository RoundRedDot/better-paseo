import React, { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { tasksRenameRpc } from "../../../shared/tasks-rpc";
import { TaskText as Text, TasksTypography, HOST_FONT as F, HOST_LINE, taskControlHeight, useTasksFontScale } from "../typography";
import type { cardStrings } from "./strings";

export function TaskRenameDialog(props: {
  agentId: string;
  title: string;
  strings: ReturnType<typeof cardStrings>;
  theme: PluginTheme;
  onClose(): void;
}) {
  const rename = useRpc(tasksRenameRpc);
  const [title, setTitle] = useState(props.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const scale = useTasksFontScale();
  const colors = props.theme.colors;
  const disabled = pending || !title.trim() || title.trim() === props.title;
  const save = async () => {
    if (saving.current || disabled) return;
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await rename({ agentId: props.agentId, title: title.trim() });
      if (!result.ok) {
        setError(props.strings.renameFailed(result.error ?? "Unknown error."));
        return;
      }
      props.onClose();
    } catch (failure) {
      setError(props.strings.renameFailed(failure instanceof Error ? failure.message : String(failure)));
    } finally {
      saving.current = false;
      setPending(false);
    }
  };
  return (
    <Modal title={props.strings.renameTitle} open onOpenChange={(open) => { if (!open && !saving.current) props.onClose(); }}>
      <Modal.Content>
        <TasksTypography theme={props.theme}>
          <View style={{ gap: 16 }} testID="task-rename-dialog">
            <TextInput
              testID="task-rename-input"
              accessibilityLabel={props.strings.titleLabel}
              value={title}
              onChangeText={(value) => { setTitle(value); setError(null); }}
              editable={!pending}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={() => void save()}
              style={{ minHeight: taskControlHeight(44, scale), paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderRadius: 8, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface0, fontSize: Math.round(F.base * scale) }}
            />
            {error ? <Text accessibilityRole="alert" style={{ fontSize: F.sm, color: colors.statusDanger }}>{error}</Text> : null}
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={props.strings.cancelTitle} disabled={pending} onPress={props.onClose}
                style={{ minHeight: taskControlHeight(44, scale), paddingHorizontal: 16, justifyContent: "center", opacity: pending ? 0.5 : 1 }}>
                <Text style={{ fontSize: F.base, lineHeight: HOST_LINE.base, color: colors.foreground }}>{props.strings.cancelTitle}</Text>
              </Pressable>
              <Pressable testID="task-rename-save" accessibilityRole="button" accessibilityLabel={props.strings.saveTitle} accessibilityState={{ disabled, busy: pending }} disabled={disabled} onPress={() => void save()}
                style={{ minHeight: taskControlHeight(44, scale), paddingHorizontal: 16, justifyContent: "center", borderRadius: 8, backgroundColor: colors.accent, opacity: disabled ? 0.5 : 1 }}>
                <Text style={{ fontSize: F.base, lineHeight: HOST_LINE.base, color: colors.accentForeground }}>{pending ? props.strings.savingTitle : props.strings.saveTitle}</Text>
              </Pressable>
            </View>
          </View>
        </TasksTypography>
      </Modal.Content>
    </Modal>
  );
}
