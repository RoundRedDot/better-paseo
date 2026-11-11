import React, { useState, useSyncExternalStore, type ComponentProps, type ComponentType } from "react";
import { ActivityIndicator, Platform, Pressable, View, type TextStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { questionRequestKey, type QuestionDialogState, type QuestionDialogStore } from "../actions/question-dialog";
import type { TaskCard } from "../model";
import { questionAnswers, questionDraftSupported, questionFormSupported, questionTextInput } from "../question-form";
import { TaskText as Text, TasksTypography, HOST_FONT as F, HOST_LINE, taskControlHeight, useTasksFontScale } from "../typography";
import { cardStrings } from "./strings";
import type { TasksLanguage } from "../i18n";
import { ProjectIcon } from "./project-icon";
import { StatusIcon } from "./status-icon";
import { BrandMark, branchPillColors, neutralPillColors } from "./brand-mark";
import { taskTokens } from "./tokens";

// The host SDK gains desktopSizing with the content-sized modal implementation.
const ContentSizedModal = Modal.Content as ComponentType<ComponentProps<typeof Modal.Content> & { desktopSizing: "content" }>;

export function TaskQuestionDialog(props: {
  store: QuestionDialogStore;
  cardById(id: string): TaskCard | undefined;
  submit(state: QuestionDialogState): Promise<void>;
  theme: PluginTheme;
  language: TasksLanguage;
  compact?: boolean;
  onOpen?(id: string): void;
}) {
  const state = useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get);
  if (!state) return null;
  const card = props.cardById(state.agentId);
  return <QuestionDialogBody key={state.key} {...props} state={state} card={card} />;
}

function QuestionDialogBody(props: Parameters<typeof TaskQuestionDialog>[0] & { state: QuestionDialogState; card?: TaskCard }) {
  const state = props.state;
  const [index, setIndex] = useState(0);
  const [openHovered, setOpenHovered] = useState(false);
  const words = cardStrings(props.language).questions;
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  const questions = state.permission.questions;
  const stale = !props.card || questionRequestKey(props.card) !== state.key;
  const supported = questionFormSupported(questions, props.card?.provider ?? "", state.permission.name);
  const draftSupported = !questions || questionDraftSupported(questions, state.draft, props.card?.provider ?? "", state.permission.name);
  const disabled = state.pending || state.submitted || stale || !supported;
  const answered = questions?.map((q, i) => !!questionAnswers([q], { selections: { 0: state.draft.selections[i] ?? [] }, texts: { 0: state.draft.texts[i] ?? "" } })) ?? [];
  const allAnswered = answered.length > 0 && answered.every(Boolean);
  const canSubmit = !disabled && draftSupported && allAnswered;
  const multiple = (questions?.length ?? 0) > 1;
  const canAdvance = !disabled && multiple && !allAnswered;
  const tokens = taskTokens(props.theme);
  const neutral = neutralPillColors(tokens);
  const branch = branchPillColors(tokens);
  const prose = { fontSize: F.base, lineHeight: HOST_LINE.base, color: colors.foreground };
  const meta = { fontSize: F.sm, lineHeight: HOST_LINE.smRead, color: colors.foregroundMuted };
  return <Modal title={words.title} open onOpenChange={(open) => { if (!open) props.store.close(); }}>
    <ContentSizedModal scrollable={false} desktopSizing="content" contentContainerStyle={{ ...(props.compact ? { flex: 1 } : { flexShrink: 1 }), minHeight: 0, padding: 0, gap: 0 }}>
      <TasksTypography theme={props.theme}>
        <View testID="task-question-dialog" style={{ ...(props.compact ? { flex: 1 } : { flexShrink: 1 }), minHeight: 0 }}>
          <ScrollView style={{ ...(props.compact ? { flex: 1 } : { flexShrink: 1 }), minHeight: 0 }} contentContainerStyle={{ padding: 16, gap: 20 }} keyboardShouldPersistTaps="handled">
            {multiple && props.compact ? <View testID="task-question-pager" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={words.previous} disabled={index === 0} onPress={() => setIndex(index - 1)} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", opacity: index === 0 ? 0.4 : 1 }}><Icon name="ChevronLeft" size={18} color={colors.foregroundMuted} /></Pressable>
              <Text style={[meta, { textAlign: "center" }]}>{words.answered(answered.filter(Boolean).length, answered.length)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={words.next} disabled={index === questions!.length - 1} onPress={() => setIndex(index + 1)} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", opacity: index === questions!.length - 1 ? 0.4 : 1 }}><Icon name="ChevronRight" size={18} color={colors.foregroundMuted} /></Pressable>
            </View> : null}
            {props.card ? <View testID="task-question-context" style={{ padding: 12, gap: 8, borderRadius: 10, borderWidth: 1, borderColor: tokens.card.border, backgroundColor: tokens.card.background, boxShadow: tokens.card.shadow }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><ProjectIcon location={props.card.location} size={16} /><Text numberOfLines={1} style={[meta, { flex: 1 }]}>{[props.card.location.projectName, props.card.location.workspaceTitle ?? props.card.location.workspaceName].filter(Boolean).join(" › ")}</Text>
                {props.onOpen ? <Pressable testID="task-question-open" accessibilityRole="button" accessibilityLabel={cardStrings(props.language).openTab} onPress={() => props.onOpen?.(props.card!.id)} onHoverIn={() => setOpenHovered(true)} onHoverOut={() => setOpenHovered(false)} style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 6, borderColor: openHovered ? colors.border : "transparent", backgroundColor: openHovered ? colors.surface2 : "transparent" }}><Icon name="ArrowUpRight" size={16} color={colors.foregroundMuted} /></Pressable> : null}
              </View>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}><StatusIcon kind={props.card.status} size={16} height={HOST_LINE.base} theme={props.theme} animated={false} /><Text selectable style={[prose, { flex: 1, fontWeight: "600" }]}>{props.card.title}</Text></View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}><View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99, backgroundColor: neutral.background }}><BrandMark provider={props.card.provider} size={14} tokens={tokens} /><Text style={[meta, { color: neutral.text }]}>{[props.card.providerLabel, props.card.modelLabel, props.card.thinkingLabel].filter(Boolean).join(" · ")}</Text></View>
                {props.card.location.branch ? <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99, backgroundColor: branch.background }}><Icon name="GitBranch" size={14} color={branch.icon} /><Text style={[meta, { color: branch.text }]}>{props.card.location.branch}</Text></View> : null}
              </View>
            </View> : null}
            {multiple ? <ScrollView horizontal showsHorizontalScrollIndicator={false}><View accessibilityRole="tablist" style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
              {questions!.map((q, i) => <Pressable key={i} testID={`task-question-tab-${i}`} accessibilityRole="tab" accessibilityState={{ selected: i === index }} onPress={() => setIndex(i)} style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: i === index ? colors.accent : "transparent" }}><Text style={[meta, { color: i === index ? colors.foreground : colors.foregroundMuted, fontWeight: "600" }]}>{words.question(i + 1)}{answered[i] ? " ✓" : ""}</Text></Pressable>)}
            </View></ScrollView> : null}
            {questions?.map((q, i) => i !== index ? null : <View key={i} testID="task-question-field" style={{ gap: 10 }}>
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
                    {option.preview ? <QuestionPreview text={option.preview} language={props.language} color={colors.foreground} accent={colors.accent} /> : null}
                  </View>
                </Pressable>;
              })}
              {questionTextInput(q) ? <TextInput testID={`task-question-input-${index}`} accessibilityLabel={q.question} placeholder={q.placeholder ?? (q.options.length ? words.other : words.text)}
                value={state.draft.texts[index] ?? ""} editable={!disabled} secureTextEntry={q.isSecret} multiline={!q.isSecret}
                autoCorrect={!q.isSecret} autoCapitalize="none"
                onChangeText={(value) => props.store.change({ texts: { ...state.draft.texts, [index]: value }, selections: q.multiSelect ? state.draft.selections : { ...state.draft.selections, [index]: [] } })}
                style={{ minHeight: taskControlHeight(44, scale), borderWidth: 1, borderRadius: 8, borderColor: colors.border, backgroundColor: colors.surface0, color: colors.foreground,
                  fontSize: Math.round(F.base * scale), lineHeight: Math.round(HOST_LINE.base * scale), padding: 12, textAlignVertical: "top",
                  ...(Platform.OS === "web" && !q.isSecret ? { resize: "vertical" } as TextStyle : {}) }} /> : null}
              {q.allowEmpty && q.options.length === 0 ? <Text style={meta}>{words.optional}</Text> : null}
            </View>)}
            {!questions ? <Text selectable style={prose}>{state.permission.summary ?? state.permission.title}</Text> : null}
            {stale || !supported ? <Text accessibilityRole="alert" style={[meta, { color: colors.statusWarning }]}>{stale ? words.changed : words.unsupported}</Text> : null}
            {!draftSupported ? <Text accessibilityRole="alert" style={[meta, { color: colors.statusWarning }]}>{words.codexComma}</Text> : null}
            {state.error ? <Text accessibilityRole="alert" style={[meta, { color: colors.statusDanger }]}>{words.failed(state.error)}</Text> : null}
            {state.submitted ? <Text accessibilityLiveRegion="polite" style={prose}>{words.sent}</Text> : null}
          </ScrollView>
          <View testID="task-question-actions" style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: colors.border }}>
            {multiple && !props.compact ? <Text testID="task-question-answer-count" style={[meta, { alignSelf: "center", marginRight: "auto" }]}>{words.answered(answered.filter(Boolean).length, answered.length)}</Text> : null}
            <Pressable testID="task-question-close" accessibilityRole="button" disabled={state.pending} onPress={props.store.close}
              style={{ ...(props.compact ? { flexGrow: 1, flexBasis: 0 } : { marginLeft: "auto" }), minWidth: 100, minHeight: taskControlHeight(44, scale), padding: 12, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 }}>
              <Text style={prose}>{state.submitted ? words.close : cardStrings(props.language).cancelTitle}</Text>
            </Pressable>
            {!state.submitted ? <Pressable testID="task-question-submit" accessibilityRole="button" accessibilityState={{ disabled: !(canSubmit || canAdvance), busy: state.pending }} disabled={!(canSubmit || canAdvance)}
              onPress={() => { if (canAdvance) { const next = answered.findIndex((value, i) => i > index && !value); setIndex(next < 0 ? answered.findIndex((value) => !value) : next); return; } void props.store.submit(props.submit); }}
              style={{ ...(props.compact ? { flexGrow: 1, flexBasis: 0 } : {}), minWidth: 100, minHeight: taskControlHeight(44, scale), padding: 12, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, opacity: canSubmit || canAdvance ? 1 : 0.5 }}>
              {state.pending ? <ActivityIndicator color={colors.accentForeground} /> : <Text style={[prose, { color: colors.accentForeground }]}>{canAdvance ? words.next : words.submit}</Text>}
            </Pressable> : null}
          </View>
        </View>
      </TasksTypography>
    </ContentSizedModal>
  </Modal>;
}

function QuestionPreview({ text, language, color, accent }: { text: string; language: TasksLanguage; color: string; accent: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 240 || text.split("\n").length > 4;
  const words = cardStrings(language).questions;
  return <View style={{ gap: 4 }}>
    <Text testID="task-question-preview" numberOfLines={long && !expanded ? 4 : undefined} style={{ fontSize: F.base, lineHeight: HOST_LINE.base, color }}>{text}</Text>
    {long ? <Pressable testID="task-question-preview-toggle" accessibilityRole="button" accessibilityState={{ expanded }}
      onPress={(event) => { event.stopPropagation(); setExpanded(!expanded); }} style={{ alignSelf: "flex-start", paddingVertical: 4 }}>
      <Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.smRead, color: accent }}>{expanded ? words.collapsePreview : words.expandPreview}</Text>
    </Pressable> : null}
  </View>;
}
