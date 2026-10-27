import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { tasksRenameRpc } from "../../../shared/tasks-rpc";
import { TaskText as Text, TasksTypography, HOST_FONT as F, HOST_LINE, taskControlHeight, useTasksFontScale } from "../typography";
import type { cardStrings } from "./strings";
import { useTitleUpdateControl, useTitleUpdateState } from "../actions/title-update";
import { useRevealedTitle } from "./title-reveal";

export function TaskRenameDialog(props: {
  agentId: string;
  title: string;
  strings: ReturnType<typeof cardStrings>;
  theme: PluginTheme;
  canAutoTitle?: boolean;
  autoTitlePending?: boolean;
  onClose(): void;
}) {
  const rename = useRpc(tasksRenameRpc);
  const preview = useTitleUpdateControl(usePaseo(), "preview");
  const generated = useTitleUpdateState(preview, props.agentId);
  const [title, setTitle] = useState(props.title);
  const [contentHeight, setContentHeight] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const generatedTitle = generated.state === "running" ? generated.text?.replace(/\s+/g, " ").trim() || undefined : generated.state === "done" ? generated.title : undefined;
  const revealedTitle = useRevealedTitle(generatedTitle ?? props.title, generatedTitle !== undefined);
  const generating = generated.state === "running" || generated.state === "done" && revealedTitle !== generated.title;
  useEffect(() => {
    if (generatedTitle !== undefined && revealedTitle) setTitle(revealedTitle);
  }, [generatedTitle, revealedTitle]);
  useEffect(() => {
    if (generated.state === "error") setError(props.strings.autoTitleFailed(generated.error));
  }, [generated, props.strings]);
  const scale = useTasksFontScale();
  const colors = props.theme.colors;
  const inputLineHeight = Math.round(HOST_LINE.base * scale);
  const disabled = pending || generating || !title.trim() || title.trim() === props.title;
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
              multiline
              scrollEnabled={false}
              onContentSizeChange={(event) => setContentHeight(event.nativeEvent.contentSize.height)}
              onChangeText={(value) => { setTitle(value); setError(null); }}
              editable={!pending && !generating}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              submitBehavior="submit"
              onSubmitEditing={() => void save()}
              style={{ minHeight: taskControlHeight(44, scale), height: Math.max(taskControlHeight(44, scale), contentHeight), textAlignVertical: "center", lineHeight: inputLineHeight, includeFontPadding: false, paddingHorizontal: 12, paddingVertical: Math.max(10, (taskControlHeight(44, scale) - inputLineHeight - 2) / 2), borderWidth: 1, borderRadius: 8, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface0, fontSize: Math.round(F.base * scale) }}
            />
            {error ? <Text accessibilityRole="alert" style={{ fontSize: F.sm, color: colors.statusDanger }}>{error}</Text> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
              {props.canAutoTitle ? <Pressable testID="task-rename-auto-title" accessibilityRole="button" accessibilityLabel={props.strings.generateTitle}
                accessibilityState={{ disabled: pending || generating || props.autoTitlePending === true, busy: generating || props.autoTitlePending === true }} disabled={pending || generating || props.autoTitlePending === true}
                onPress={() => {
                  if (saving.current || props.autoTitlePending) return;
                  setError(null);
                  preview.start(props.agentId);
                }}
                style={{ minHeight: taskControlHeight(44, scale), paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 8, opacity: pending || generating || props.autoTitlePending ? 0.5 : 1 }}>
                {generating ? <ActivityIndicator testID="task-rename-title-loading" size="small" color={colors.foreground} /> : <Icon name="Sparkles" size={18} color={colors.foreground} />}
                <Text style={{ fontSize: F.base, lineHeight: HOST_LINE.base, color: colors.foreground }}>{props.strings.generateTitle}</Text>
              </Pressable> : null}
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
