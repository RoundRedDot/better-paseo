import { useContext, useState, type ReactNode } from "react";
import { View, Text, StyleSheet } from "react-native";
import { QuestionSelectionMark } from "./question-selection-mark";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { radiusV2, space } from "./theme-tokens";
import type { UserQuestion, UserQuestionData } from "../tools/user-questions";
import { SelectableText } from "../ui/prose-text";
import { ToolbarButton, TooltipAlignContext } from "../ui/toolbar-button";
import { ToolPager } from "../ui/tool-pager";
import { AlwaysWrapPreview, HoverPreviewBody } from "../ui/hover-preview";
import { useEnhancerPreferences } from "../preferences";
import { TextZoomContext, zoomBlockMetrics } from "../ui/text-zoom";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { TranslationGroup, translatedField, translationGroupState, type TranslationField } from "../translation/group";
import { InlineTranslateButtonWithTokens, InlineTranslationNoticeWithTokens } from "../translation/inline";

function selectedAnswerOptions(question: UserQuestion): string[] {
  const selected = question.selected ?? (question.answer !== undefined ? question.options.filter((option) =>
    question.answer === option.label || (question.multiSelect && question.answer?.split(", ").includes(option.label))).map((option) => option.label) : []);
  return selected.length > 0 && question.answer === selected.join(", ") ? selected : [];
}

/** A read-only question transcript; submitting answers belongs to the host. */
export function UserQuestions({ questions: data, tokens, rawBody, renderHeader, children, translationAgentId }: {
  translationAgentId?: string;
  questions: UserQuestionData;
  tokens: ExtendedThemeTokens;
  rawBody: ReactNode;
  renderHeader?(controls: ReactNode): ReactNode;
  children?: ReactNode;
}) {
  const [raw, setRaw] = useState(false);
  const [page, setPage] = useState(0);
  const index = Math.min(page, data.questions.length - 1);
  const question = data.questions[index]!;
  const { language } = useEnhancerPreferences();
  const label = (value: string) => toolbarLabel(value, language);
  // In the details panel the text follows its text size (pinch, toolbar, badge).
  const block = zoomBlockMetrics(tokens.typography.block, useContext(TextZoomContext));
  const prose = { fontFamily: tokens.fontUi, fontSize: block.label.size, lineHeight: block.label.lineHeight, color: tokens.foreground };
  const meta = { fontFamily: tokens.fontUi, fontSize: block.meta.size, lineHeight: block.meta.lineHeight, color: tokens.foregroundMuted };
  const fields: TranslationField[] = [];
  data.questions.forEach((item, questionIndex) => {
    const add = (id: string, text: string) => fields.push({ id: `${questionIndex}:${id}`, text, kind: "tool_output" });
    add("question", item.question);
    if (item.header) add("header", item.header);
    item.options.forEach((option, i) => {
      add(`option-${i}`, option.label);
      if (option.description) add(`description-${i}`, option.description);
    });
    if (item.answer && !selectedAnswerOptions(item).length) add("answer", item.answer);
  });
  const answerOptions = selectedAnswerOptions(question);
  return <TranslationGroup agentId={translationAgentId} fields={fields}>
  {(states) => {
      const group = translationGroupState(states);
      const translated = (id: string, text: string) => translatedField(states, `${index}:${id}`, text);
      const answer = answerOptions.length ? answerOptions.map((option) => {
        const optionIndex = question.options.findIndex((item) => item.label === option);
        return optionIndex < 0 ? option : translated(`option-${optionIndex}`, option);
      }).join(", ") : question.answer !== undefined ? translated("answer", question.answer) : undefined;
      const controls = <View style={styles.controls}>
        <ToolbarButton icon={raw ? "MessagesSquare" : "FileJson"} label={raw ? "Show questions" : "Show raw data"}
          checked={raw} onPress={() => setRaw((value) => !value)} tokens={tokens} />
        {!raw && group ? <InlineTranslateButtonWithTokens state={group} tokens={tokens} timeline testID="question-translate" /> : null}
        {!raw && data.questions.length > 1 ? <ToolPager subject="question" index={index}
          count={data.questions.length} onChange={setPage} tokens={tokens} /> : null}
      </View>;
      const body = <>
        {!raw && group ? <InlineTranslationNoticeWithTokens state={group} tokens={tokens} /> : null}
        {raw ? rawBody : <View testID="user-question" style={styles.question}>
          <View style={styles.heading}>
            {question.header ? <Text style={[meta, styles.header]}>{translated("header", question.header)}</Text> : null}
            <Text style={meta}>{label(question.options.length === 0 ? "Free text" : question.multiSelect ? "Select multiple" : "Select one")}</Text>
          </View>
          <SelectableText style={[prose, styles.title]}>{translated("question", question.question)}</SelectableText>
          <View style={styles.options}>
            {question.options.map((option, i) => {
              const selected = question.selected ? question.selected.includes(option.label) :
                question.answer === option.label || (question.multiSelect && question.answer?.split(", ").includes(option.label)) === true;
              return <View key={i} testID="user-question-option" accessibilityLabel={option.label}
                accessibilityState={{ selected }}
                style={[styles.option, { borderColor: selected ? tokens.accent : tokens.v2.borderSubtle,
                  backgroundColor: selected ? tokens.v2.surface2 : "transparent" }]}>
                <View style={styles.mark}>
                  <QuestionSelectionMark multiSelect={question.multiSelect} selected={selected} size={16}
                    accent={tokens.accent} accentForeground={tokens.accentForeground} muted={tokens.foregroundMuted} />
                </View>
                <View style={styles.optionText}>
                  <SelectableText style={[prose, selected && styles.header]}>{translated(`option-${i}`, option.label)}</SelectableText>
                  {option.description ? <SelectableText style={meta}>{translated(`description-${i}`, option.description)}</SelectableText> : null}
                </View>
              </View>;
            })}
          </View>
          <View style={[styles.answer, { borderTopColor: tokens.v2.borderSubtle }]}>
            <Text style={meta}>{label("Answer")}</Text>
            <SelectableText style={question.answer !== undefined ? prose : meta}>
              {answer !== undefined ? answer : label(data.dismissed ? "Dismissed" : data.running ? "Waiting for answer…" : "No answer recorded")}
            </SelectableText>
          </View>
        </View>}
        {children}
      </>;
      return <AlwaysWrapPreview>
        {renderHeader ? renderHeader(controls) : <TooltipAlignContext.Provider value="start">{controls}</TooltipAlignContext.Provider>}
        {renderHeader ? <HoverPreviewBody streaming={data.running}>{body}</HoverPreviewBody> : body}
      </AlwaysWrapPreview>;
  }}
  </TranslationGroup>;
}

const styles = StyleSheet.create({
  // Raised over the question below, so a button's name can hang down across it.
  controls: { flexDirection: "row", alignItems: "center", gap: space.xs, zIndex: 1 },
  question: { gap: space.md, minWidth: 0 },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  header: { fontWeight: "600", flexShrink: 1 },
  title: { fontWeight: "600" },
  options: { gap: space.xs },
  option: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, padding: space.sm,
    borderWidth: 1, borderRadius: radiusV2.block },
  mark: { paddingTop: 2 },
  optionText: { flex: 1, minWidth: 0, gap: 2 },
  answer: { gap: space.xs, borderTopWidth: 1, paddingTop: space.sm },
});
