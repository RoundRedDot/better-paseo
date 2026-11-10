import React, { useSyncExternalStore } from "react";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { questionRequestKey, type QuestionDialogState, type QuestionDialogStore } from "../actions/question-dialog";
import type { TaskCard } from "../model";
import { questionAnswers, questionDraftSupported, questionFormSupported, questionTextInput } from "../question-form";
import { TaskText as Text, TasksTypography, HOST_FONT as F, HOST_LINE, taskControlHeight, useTasksFontScale } from "../typography";
import { cardStrings } from "./strings";
import type { TasksLanguage } from "../i18n";

export function TaskQuestionDialog(props: {
  store: QuestionDialogStore;
  cardById(id: string): TaskCard | undefined;
  submit(state: QuestionDialogState): Promise<void>;
  theme: PluginTheme;
  language: TasksLanguage;
}) {
  const state = useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get);
  if (!state) return null;
  const card = props.cardById(state.agentId);
  return <QuestionDialogBody {...props} state={state} card={card} />;
}

function QuestionDialogBody(props: Parameters<typeof TaskQuestionDialog>[0] & { state: QuestionDialogState; card?: TaskCard }) {
  const state = props.state;
  const words = cardStrings(props.language).questions;
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  const mobile = Platform.OS !== "web";
  const questions = state.permission.questions;
  const stale = !props.card || questionRequestKey(props.card) !== state.key;
  const supported = questionFormSupported(questions, props.card?.provider ?? "", state.permission.name);
  const draftSupported = !questions || questionDraftSupported(questions, state.draft, props.card?.provider ?? "", state.permission.name);
  const disabled = state.pending || state.submitted || stale || !supported;
  const canSubmit = !disabled && draftSupported && !!questionAnswers(questions!, state.draft);
  const prose = { fontSize: F.base, lineHeight: HOST_LINE.base, color: colors.foreground };
  const meta = { fontSize: F.sm, lineHeight: HOST_LINE.smRead, color: colors.foregroundMuted };
  const Body = mobile ? ScrollView : View;
  return <Modal title={words.title} open onOpenChange={(open) => { if (!open) props.store.close(); }}>
    <Modal.Content scrollable={!mobile} contentContainerStyle={mobile ? { flex: 1, minHeight: 0, padding: 0, gap: 0 } : undefined}>
      <TasksTypography theme={props.theme}>
        <View testID="task-question-dialog" style={mobile ? { flex: 1, minHeight: 0 } : { gap: 16 }}>
          <Body {...(mobile ? { style: { flex: 1, minHeight: 0 }, contentContainerStyle: { padding: 16, gap: 20 }, keyboardShouldPersistTaps: "handled" as const } : { style: { gap: 20 } })}>
            {props.card ? <View testID="task-question-context" style={{ padding: 12, gap: 6, borderRadius: 8, backgroundColor: colors.surface1 }}>
              <Text selectable style={[prose, { fontWeight: "600" }]}>{props.card.title}</Text>
              <Text selectable style={meta}>{[props.card.location.projectName, props.card.location.workspaceTitle ?? props.card.location.workspaceName].filter(Boolean).join(" / ")}</Text>
              <Text selectable style={meta}>{[props.card.providerLabel, props.card.modelLabel, props.card.thinkingLabel, props.card.location.branch].filter(Boolean).join(" · ")}</Text>
              <Text selectable style={meta}>{props.card.id}</Text>
            </View> : null}
            {questions?.map((q, index) => <View key={index} testID="task-question-field" style={{ gap: 10 }}>
              <Text style={meta}>{q.header} · {q.options.length ? q.multiSelect ? words.multiple : words.single : words.text}</Text>
              <Text selectable style={[prose, { fontWeight: "600" }]}>{q.question}</Text>
              {q.options.map((option, optionIndex) => {
                const checked = state.draft.selections[index]?.includes(optionIndex) === true;
                return <Pressable key={optionIndex} testID={`task-question-option-${index}-${optionIndex}`} accessibilityRole={q.multiSelect ? "checkbox" : "radio"}
                  accessibilityLabel={option.label} accessibilityState={{ checked, disabled }} disabled={disabled}
                  onPress={() => {
                    const previous = state.draft.selections[index] ?? [];
                    props.store.change({ selections: { ...state.draft.selections, [index]: q.multiSelect ? checked ? previous.filter((value) => value !== optionIndex) : [...previous, optionIndex] : checked ? [] : [optionIndex] },
                      texts: q.multiSelect ? state.draft.texts : { ...state.draft.texts, [index]: "" } });
                  }}
                  style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, minHeight: taskControlHeight(44, scale), borderWidth: 1, borderRadius: 8, borderColor: checked ? colors.accent : colors.border, backgroundColor: checked ? colors.surface2 : colors.surface0, opacity: disabled ? 0.6 : 1 }}>
                  <View style={{ paddingTop: 2 }}><Icon name={q.multiSelect ? checked ? "SquareCheck" : "Square" : checked ? "CircleDot" : "Circle"} size={18} color={checked ? colors.accent : colors.foregroundMuted} /></View>
                  <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                    <Text style={prose}>{option.label}</Text>
                    {option.description ? <Text style={meta}>{option.description}</Text> : null}
                    {option.preview ? <Text style={prose}>{option.preview}</Text> : null}
                  </View>
                </Pressable>;
              })}
              {questionTextInput(q) ? <TextInput testID={`task-question-input-${index}`} accessibilityLabel={q.question} placeholder={q.placeholder ?? (q.options.length ? words.other : words.text)}
                value={state.draft.texts[index] ?? ""} editable={!disabled} secureTextEntry={q.isSecret} multiline={!q.isSecret}
                autoCorrect={!q.isSecret} autoCapitalize="none"
                onChangeText={(value) => props.store.change({ texts: { ...state.draft.texts, [index]: value }, selections: q.multiSelect ? state.draft.selections : { ...state.draft.selections, [index]: [] } })}
                style={{ minHeight: taskControlHeight(44, scale), borderWidth: 1, borderRadius: 8, borderColor: colors.border, backgroundColor: colors.surface0, color: colors.foreground,
                  fontSize: Math.round(F.base * scale), lineHeight: Math.round(HOST_LINE.base * scale), padding: 12, textAlignVertical: "top" }} /> : null}
              {q.allowEmpty && q.options.length === 0 ? <Text style={meta}>{words.optional}</Text> : null}
            </View>)}
            {!questions ? <Text selectable style={prose}>{state.permission.summary ?? state.permission.title}</Text> : null}
            {stale || !supported ? <Text accessibilityRole="alert" style={[meta, { color: colors.statusWarning }]}>{stale ? words.changed : words.unsupported}</Text> : null}
            {!draftSupported ? <Text accessibilityRole="alert" style={[meta, { color: colors.statusWarning }]}>{words.codexComma}</Text> : null}
            {state.error ? <Text accessibilityRole="alert" style={[meta, { color: colors.statusDanger }]}>{words.failed(state.error)}</Text> : null}
            {state.submitted ? <Text accessibilityLiveRegion="polite" style={prose}>{words.sent}</Text> : null}
          </Body>
          <View testID="task-question-actions" style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, ...(mobile ? { padding: 16, borderTopWidth: 1, borderTopColor: colors.border } : {}) }}>
            <Pressable testID="task-question-close" accessibilityRole="button" disabled={state.pending} onPress={props.store.close}
              style={{ flexGrow: 1, flexBasis: 0, minWidth: 100, minHeight: taskControlHeight(44, scale), padding: 12, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 }}>
              <Text style={prose}>{state.submitted ? words.close : cardStrings(props.language).cancelTitle}</Text>
            </Pressable>
            {!state.submitted ? <Pressable testID="task-question-submit" accessibilityRole="button" accessibilityState={{ disabled: !canSubmit, busy: state.pending }} disabled={!canSubmit}
              onPress={() => { void props.store.submit(props.submit); }}
              style={{ flexGrow: 1, flexBasis: 0, minWidth: 100, minHeight: taskControlHeight(44, scale), padding: 12, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, opacity: canSubmit ? 1 : 0.5 }}>
              {state.pending ? <ActivityIndicator color={colors.accentForeground} /> : <Text style={[prose, { color: colors.accentForeground }]}>{words.submit}</Text>}
            </Pressable> : null}
          </View>
        </View>
      </TasksTypography>
    </Modal.Content>
  </Modal>;
}
