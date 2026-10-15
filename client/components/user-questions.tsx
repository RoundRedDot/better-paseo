import { useState, type ReactNode } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { radiusV2, space } from "./theme-tokens";
import type { UserQuestionData } from "../tools/user-questions";
import { SelectableText } from "../ui/prose-text";
import { ToolbarButton, TooltipAlignContext } from "../ui/toolbar-button";
import { ToolPager } from "../ui/tool-pager";
import { AlwaysWrapPreview, HoverPreviewBody } from "../ui/hover-preview";
import { useEnhancerPreferences } from "../preferences";
import { toolbarLabel } from "../i18n/toolbar-strings";

/** A read-only question transcript; submitting answers belongs to the host. */
export function UserQuestions({ questions: data, tokens, rawBody, renderHeader, children }: {
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
  const prose = { fontFamily: tokens.fontUi, fontSize: tokens.typography.block.label.size,
    lineHeight: tokens.typography.block.label.lineHeight, color: tokens.foreground };
  const meta = { fontFamily: tokens.fontUi, fontSize: tokens.typography.block.meta.size,
    lineHeight: tokens.typography.block.meta.lineHeight, color: tokens.foregroundMuted };
  const controls = <View style={styles.controls}>
    <ToolbarButton icon={raw ? "MessagesSquare" : "FileJson"} label={raw ? "Show questions" : "Show raw data"}
      checked={raw} onPress={() => setRaw((value) => !value)} tokens={tokens} />
    {!raw && data.questions.length > 1 ? <ToolPager subject="question" index={index}
      count={data.questions.length} onChange={setPage} tokens={tokens} /> : null}
  </View>;
  const body = <>
    {raw ? rawBody : <View testID="user-question" style={styles.question}>
      <View style={styles.heading}>
        {question.header ? <Text style={[meta, styles.header]}>{question.header}</Text> : null}
        <Text style={meta}>{label(question.options.length === 0 ? "Free text" : question.multiSelect ? "Select multiple" : "Select one")}</Text>
      </View>
      <SelectableText style={[prose, styles.title]}>{question.question}</SelectableText>
      <View style={styles.options}>
        {question.options.map((option, i) => {
          const selected = question.selected ? question.selected.includes(option.label) :
            question.answer === option.label || (question.multiSelect && question.answer?.split(", ").includes(option.label)) === true;
          return <View key={i} testID="user-question-option" accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            style={[styles.option, { borderColor: selected ? tokens.accent : tokens.v2.borderSubtle,
              backgroundColor: selected ? tokens.v2.surface2 : "transparent" }]}>
            <View style={styles.mark}>
              <Icon name={question.multiSelect ? selected ? "SquareCheck" : "Square" : selected ? "CircleDot" : "Circle"}
                size={16} color={selected ? tokens.accent : tokens.foregroundMuted} />
            </View>
            <View style={styles.optionText}>
              <SelectableText style={[prose, selected && styles.header]}>{option.label}</SelectableText>
              {option.description ? <SelectableText style={meta}>{option.description}</SelectableText> : null}
            </View>
          </View>;
        })}
      </View>
      <View style={[styles.answer, { borderTopColor: tokens.v2.borderSubtle }]}>
        <Text style={meta}>{label("Answer")}</Text>
        <SelectableText style={question.answer !== undefined ? prose : meta}>
          {question.answer ?? label(data.dismissed ? "Dismissed" : data.running ? "Waiting for answer…" : "No answer recorded")}
        </SelectableText>
      </View>
    </View>}
    {children}
  </>;
  return <AlwaysWrapPreview>
    {renderHeader ? renderHeader(controls) : <TooltipAlignContext.Provider value="start">{controls}</TooltipAlignContext.Provider>}
    {renderHeader ? <HoverPreviewBody streaming={data.running}>{body}</HoverPreviewBody> : body}
  </AlwaysWrapPreview>;
}

const styles = StyleSheet.create({
  controls: { flexDirection: "row", alignItems: "center", gap: space.xs },
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
