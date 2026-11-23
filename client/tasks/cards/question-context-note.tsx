import React, { useState } from "react";
import { Pressable, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { MarkdownView } from "../../components/markdown/markdown-view";
import { useSelectionActions } from "../../components/selection-actions";
import { SelectionTranslationScope } from "../../translation/ui";
import { InlineTranslation, InlineTranslateButton, InlineTranslationNotice, type InlineTranslationState } from "../../translation/inline";
import { variantMetrics } from "../../components/markdown/render/styles";
import { useThemeTokens } from "../../components/theme-tokens";
import { useEnhancerPreferences } from "../../preferences";
import { useCodexProvider } from "../../state/provider-family";
import { HoverPreviewContext } from "../../ui/hover-preview";
import { useCopy } from "../../ui/use-copy";
import { useHover } from "../../ui/use-hover";
import { HoverControl } from "../hover-control";
import { hoverFill } from "../hover-fill";
import type { QuestionContext } from "../data/question-context";
import type { TasksLanguage } from "../i18n";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, useTasksFontAdjustment } from "../typography";
import { tipProps } from "./card-hints";
import { FoldedText } from "./folded-text";
import { formatRelative } from "./format";
import { cardStrings } from "./strings";
import { taskTokens } from "./tokens";

/** Lines the note shows before "Show all": the question and its choices stay on the first screen. */
const NOTE_LINES = { wide: 6, compact: 4 } as const;
const SKELETON_WIDTHS = ["94%", "82%", "58%"] as const;

/**
 * The agent's note above a question: what it wrote right before asking, the
 * text a question like "go with the plan above?" refers to. Folded under a
 * fade; nothing at all when the agent wrote nothing before asking.
 */
type NoteProps = {
  read: { context: QuestionContext; retry(): void };
  theme: PluginTheme;
  language: TasksLanguage;
  compact?: boolean;
  translationAgentId?: string;
  provider?: string;
};

export function QuestionContextNote(props: NoteProps) {
  const { context } = props.read;
  if (context.state === "idle" || context.state === "none") return null;
  if (context.state === "error") return <NoteError {...props} />;
  if (context.state === "ready" && props.translationAgentId) return <InlineTranslation agentId={props.translationAgentId} kind="assistant_message" text={context.text} streaming={false}>
    {(translation) => <NoteBody {...props} ready={context} translation={translation} />}
  </InlineTranslation>;
  return <NoteBody {...props} ready={context.state === "ready" ? context : null} />;
}

function noteMeta(theme: PluginTheme) {
  return { fontSize: F.sm, lineHeight: HOST_LINE.smRead, color: theme.colors.foregroundMuted };
}

function NoteError(props: NoteProps) {
  const colors = props.theme.colors;
  const words = cardStrings(props.language).questions;
  const meta = noteMeta(props.theme);
  return <View testID="task-question-note-error" style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 }}>
    <Icon name="MessageSquareText" size={14} color={colors.foregroundMuted} />
    <Text style={meta}>{words.contextError}</Text>
    <HoverControl base={colors.surface0} foreground={colors.foreground} {...tipProps(words.contextRetry)} accessibilityRole="button" onPress={props.read.retry} hitSlop={6} testID="task-question-note-retry" style={{ borderRadius: 6 }}>
      <Text style={[meta, { color: colors.accent, fontWeight: "600" }]}>{words.contextRetry}</Text>
    </HoverControl>
  </View>;
}

/** The note read (`ready`), or three placeholder lines while it is read. */
function NoteBody(props: NoteProps & { ready: Extract<QuestionContext, { state: "ready" }> | null; translation?: InlineTranslationState }) {
  const { ready } = props;
  const [expanded, setExpanded] = useState(false);
  const preferences = useEnhancerPreferences();
  const codex = useCodexProvider(props.provider);
  const prose = useThemeTokens(props.theme, preferences);
  useSelectionActions(prose, !!props.translationAgentId && preferences.selectionActions);
  const adjustment = useTasksFontAdjustment();
  const { copied, copy } = useCopy();
  const { hovered, hoverProps } = useHover();
  const tokens = taskTokens(props.theme);
  const colors = props.theme.colors;
  const words = cardStrings(props.language).questions;
  const meta = noteMeta(props.theme);
  const box = { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.surface1 };
  const font = Math.round(prose.typography.content.size * 0.9 * adjustment);
  const line = variantMetrics(preferences.markdownVariant, font, props.compact === true).bodyLineHeight;
  const text = props.translation?.active && props.translation.view?.status === "done" ? props.translation.view.result.translation : ready?.text;
  const at = ready?.timestamp ? Date.parse(ready.timestamp) : NaN;
  return <View testID="task-question-note" style={{ gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28 }}>
      <Icon name="MessageSquareText" size={14} color={colors.foregroundMuted} />
      <Text style={[meta, { color: colors.foreground, fontWeight: "600" }]}>{words.context}</Text>
      {Number.isFinite(at) ? <Text numberOfLines={1} style={[meta, { flexShrink: 1 }]}>· {formatRelative(Date.now() - at, props.language)}</Text> : null}
      <View style={{ flex: 1 }} />
      <View testID="task-question-note-actions" style={{ flexDirection: "row", alignItems: "center" }}>
      {props.translation ? <InlineTranslateButton state={props.translation} theme={props.theme} base={colors.surface0} testID="task-question-note-translate" /> : null}
      {ready ? <Pressable accessibilityRole="button" accessibilityLabel={words.copyContext} {...tipProps(words.copyContext)} {...hoverProps} onPress={() => { void copy(ready.text, { label: "Copy agent note" }); }}
        hitSlop={4} testID="task-question-note-copy" style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
        {({ pressed }) => <View pointerEvents="none" testID="task-question-note-copy-fill" style={{ width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: hoverFill(colors.surface0, colors.foreground, hovered, pressed, "transparent") }}>
          <Icon name={copied ? "Check" : "Copy"} size={14} color={copied ? tokens.success : colors.foregroundMuted} />
        </View>}
      </Pressable> : null}
      </View>
    </View>
    {props.translation ? <InlineTranslationNotice state={props.translation} theme={props.theme} /> : null}
    {ready ? <View style={box}>
      <FoldedText id="task-question-note" language={props.language} tokens={tokens} line={line} limit={props.compact ? NOTE_LINES.compact : NOTE_LINES.wide}
        expanded={expanded} fadeColor={colors.surface1} touch={props.compact} onToggle={() => setExpanded((open) => !open)}>
        <HoverPreviewContext.Provider value>
          {props.translationAgentId ? <SelectionTranslationScope agentId={props.translationAgentId} kind="assistant_message" streaming={false}>
            <MarkdownView text={text!} codexDirectives={codex} tokens={prose} variant={preferences.markdownVariant} compact={props.compact === true} size={font} />
          </SelectionTranslationScope> : <MarkdownView text={text!} codexDirectives={codex} tokens={prose} variant={preferences.markdownVariant} compact={props.compact === true} size={font} />}
        </HoverPreviewContext.Provider>
      </FoldedText>
    </View> : <View testID="task-question-note-loading" accessible accessibilityRole="progressbar" accessibilityLabel={words.contextLoading} style={box}>
      {SKELETON_WIDTHS.map((width) => <View key={width} style={{ height: line, justifyContent: "center" }}>
        <View style={{ width, height: Math.round(font * 0.7), borderRadius: 3, backgroundColor: colors.surface2 }} />
      </View>)}
    </View>}
  </View>;
}
