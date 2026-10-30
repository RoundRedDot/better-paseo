import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
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
  blockedReason?: string;
  autoTitleBlockedReason?: string;
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
  const mobile = Platform.OS !== "web";
  const InputContainer = mobile ? ScrollView : View;
  const colors = props.theme.colors;
  const inputLineHeight = Math.round(HOST_LINE.base * scale);
  const disabled = !!props.blockedReason || pending || generating || !title.trim() || title.trim() === props.title;
  const autoDisabled = !!props.blockedReason || !!props.autoTitleBlockedReason || pending || generating || props.autoTitlePending === true;
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
  const automatic = props.canAutoTitle ? (
    <Pressable testID="task-rename-auto-title" accessibilityRole="button" accessibilityLabel={props.strings.generateTitle}
      accessibilityState={{ disabled: autoDisabled, busy: generating || props.autoTitlePending === true }} disabled={autoDisabled}
      onPress={() => {
        if (saving.current || autoDisabled) return;
        setError(null);
        preview.start(props.agentId);
      }}
      style={{ minHeight: taskControlHeight(44, scale), paddingHorizontal: mobile ? 12 : 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: mobile ? 22 : 0, borderWidth: mobile ? 1 : 0, borderColor: colors.border, opacity: autoDisabled ? 0.5 : 1 }}>
      {generating ? <ActivityIndicator testID="task-rename-title-loading" size="small" color={colors.foreground} /> : <Icon name="Sparkles" size={18} color={colors.foreground} />}
      <Text style={{ fontSize: F.base, lineHeight: HOST_LINE.base, color: colors.foreground }}>{props.strings.generateTitle}</Text>
    </Pressable>
  ) : null;
  return (
    <Modal title={props.strings.renameTitle} open onOpenChange={(open) => { if (!open && !saving.current) props.onClose(); }}>
      <Modal.Content scrollable={!mobile} contentContainerStyle={mobile ? { flex: 1, minHeight: 0, paddingHorizontal: 0, paddingTop: 0, paddingBottom: 16, gap: 0 } : undefined}>
        <TasksTypography theme={props.theme}>
          <View style={mobile ? { flex: 1, minHeight: 0 } : { gap: 16 }} testID="task-rename-dialog">
            <InputContainer {...(mobile ? { style: { flex: 1 }, contentContainerStyle: { padding: 16, gap: 16 }, keyboardShouldPersistTaps: "handled" as const } : { style: { gap: 16 } })}>
              <TextInput
              testID="task-rename-input"
              accessibilityLabel={props.strings.titleLabel}
              value={title}
              multiline
              scrollEnabled={false}
              onContentSizeChange={Platform.OS === "web" ? (event) => setContentHeight(event.nativeEvent.contentSize.height) : undefined}
              onChangeText={(value) => { setTitle(value); setError(null); }}
              editable={!props.blockedReason && !pending && !generating}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              submitBehavior="submit"
              onSubmitEditing={() => void save()}
              style={{ width: "100%", minHeight: taskControlHeight(44, scale), height: Platform.OS === "web" ? Math.max(taskControlHeight(44, scale), contentHeight) : undefined, textAlignVertical: "center", lineHeight: inputLineHeight, includeFontPadding: false, paddingHorizontal: 12, paddingVertical: Math.max(10, (taskControlHeight(44, scale) - inputLineHeight - 2) / 2), borderWidth: 1, borderRadius: 8, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface0, fontSize: Math.round(F.base * scale) }}
            />
              {error ? <Text accessibilityRole="alert" style={{ fontSize: F.sm, color: colors.statusDanger }}>{error}</Text> : null}
              {props.blockedReason || props.autoTitleBlockedReason ? <Text accessibilityRole="alert" testID="task-rename-unavailable" style={{ fontSize: F.sm, color: colors.statusWarning }}>{props.blockedReason ?? props.autoTitleBlockedReason}</Text> : null}
            </InputContainer>
            <View testID="task-rename-actions" style={mobile ? { paddingTop: 12, paddingHorizontal: 16, flexDirection: "row", gap: 10, borderTopWidth: 1, borderTopColor: colors.border } : { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
              {!mobile ? automatic : null}
              <Pressable accessibilityRole="button" accessibilityLabel={props.strings.cancelTitle} disabled={pending} onPress={props.onClose}
                style={{ minHeight: taskControlHeight(44, scale), paddingHorizontal: mobile ? 18 : 16, justifyContent: "center", alignItems: "center", borderRadius: mobile ? 22 : 0, borderWidth: mobile ? 1 : 0, borderColor: colors.border, opacity: pending ? 0.5 : 1 }}>
                <Text style={{ fontSize: F.base, lineHeight: HOST_LINE.base, color: colors.foreground }}>{props.strings.cancelTitle}</Text>
              </Pressable>
              <Pressable testID="task-rename-save" accessibilityRole="button" accessibilityLabel={props.strings.saveTitle} accessibilityState={{ disabled, busy: pending }} disabled={disabled} onPress={() => void save()}
                style={{ minHeight: taskControlHeight(44, scale), paddingHorizontal: 16, flex: mobile ? 1 : undefined, justifyContent: "center", alignItems: "center", borderRadius: mobile ? 22 : 8, backgroundColor: colors.accent, opacity: disabled ? 0.5 : 1 }}>
                <Text style={{ fontSize: F.base, lineHeight: HOST_LINE.base, color: colors.accentForeground }}>{pending ? props.strings.savingTitle : props.strings.saveTitle}</Text>
              </Pressable>
              {mobile ? automatic : null}
            </View>
          </View>
        </TasksTypography>
      </Modal.Content>
    </Modal>
  );
}
