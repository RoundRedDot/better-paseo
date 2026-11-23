import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEnhancerPreferences } from "../../../preferences";
import { resolveLanguage } from "../../../i18n/settings-strings";
import { ProseSpan, ProseText } from "../../../ui/prose-text";
import { PathText } from "../../../ui/path-text";
import { codexFileName, codexPath, type CodexToken } from "../codex";
import type { RenderContext } from "./context";
import { LocalLink } from "./local-link";
import { MarkdownProse } from "./prose";

const ARTIFACT_KINDS_ZH: Record<string, string> = {
  document: "文档", spreadsheet: "电子表格", presentation: "演示文稿", image: "图片", file: "文件",
};

export function CodexBlock({ token, context, renderBody }: { token: CodexToken; context: RenderContext; renderBody(body: string): React.ReactNode }) {
  const { tokens, metrics } = context;
  const { language } = useEnhancerPreferences();
  const zh = resolveLanguage(language) === "zh";
  const [expanded, setExpanded] = useState(false);
  const textStyle = { color: tokens.foreground, fontFamily: tokens.fontUi, fontSize: metrics.bodySize, lineHeight: metrics.bodyLineHeight };
  const muted = { ...textStyle, color: tokens.foregroundMuted, fontSize: metrics.bodySize - 1 };
  const artifact = token.attrs.artifact_kind;
  const artifactLabel = artifact && zh ? ARTIFACT_KINDS_ZH[artifact] ?? artifact : artifact;
  if (token.kind === "browser") return <View testID="codex-browser" style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 }}>
    <Icon name="Globe" size={16} color={tokens.foregroundMuted} />
    <ProseText style={[muted, { flexShrink: 1 }]}>{zh ? "浏览器操作已结束" : "Browser operation ended"} · <ProseSpan style={textStyle}>{token.attrs.title}</ProseSpan></ProseText>
  </View>;
  if (token.kind === "memory") return <View testID="codex-memory" style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 }}>
      <Icon name="History" size={15} color={tokens.foregroundMuted} />
      <Text style={muted}>{zh ? `参考了 ${token.entries!.length} 条记忆` : `${token.entries!.length} memory references`}</Text>
      <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={14} color={tokens.foregroundMuted} />
    </Pressable>
    {expanded ? <View style={{ backgroundColor: tokens.v2.surface1, borderRadius: 6, padding: 12, gap: 10 }}>
      {token.entries!.map((entry, index) => <View key={index} style={{ gap: 2 }}><MarkdownProse context={context} style={textStyle} text={entry.note} /><MarkdownProse context={context} style={muted} text={entry.source} /></View>)}
    </View> : null}
  </View>;
  if (token.kind === "template") return <View testID="codex-template" style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1, borderColor: tokens.v2.border, borderRadius: 6, alignSelf: "flex-start", maxWidth: "100%" }}>
    <Icon name="LayoutTemplate" size={16} color={tokens.foregroundMuted} />
    <ProseText style={[textStyle, { flexShrink: 1 }]}>{token.attrs.display_name} <ProseSpan style={muted}>· {artifactLabel}</ProseSpan></ProseText>
  </View>;
  if (token.kind === "citation") {
    const path = token.attrs.path!;
    const local = codexPath(path)!;
    return <View testID="codex-file-output" style={{ borderWidth: 1, borderColor: tokens.v2.border, borderRadius: 6, padding: 12, alignSelf: "flex-start", maxWidth: "100%", gap: 3 }}>
      <ProseText style={textStyle}><LocalLink path={local} context={context}>{codexFileName(local)}</LocalLink></ProseText>
      <Text style={muted}>{artifactLabel ?? (zh ? "文件" : "File")}</Text>
    </View>;
  }
  const priority = token.attrs.priority ?? token.attrs.severity ?? /^\[(P[0-3])\]/i.exec(token.attrs.title ?? "")?.[1];
  const number = priority?.replace(/^P/i, "");
  const level = number && /^[0-3]$/.test(number) ? `P${number}` : priority;
  const title = token.attrs.title?.replace(/^\[P[0-3]\]\s*/i, "") ?? (zh ? "代码评审" : "Code review");
  const start = token.attrs.start ?? token.attrs.line;
  const location = start && token.attrs.end && start !== token.attrs.end ? `${start}–${token.attrs.end}` : start ?? token.attrs.end;
  const body = token.attrs.body ?? token.body;
  return <View testID="codex-review" style={{ borderWidth: 1, borderColor: tokens.v2.border, borderRadius: 6, overflow: "hidden" }}>
    <View style={{ padding: 12, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        {level ? <Text style={{ color: level === "P0" || level === "P1" ? tokens.danger : level === "P2" ? tokens.warning : tokens.foregroundMuted, fontWeight: "600", fontSize: metrics.bodySize - 2 }}>{level}</Text> : null}
        <MarkdownProse context={context} style={[textStyle, { fontWeight: "600", flexShrink: 1, minWidth: 0 }]} text={title} />
      </View>
      {body ? renderBody(body) : null}
    </View>
    <View style={{ backgroundColor: tokens.v2.surface1, paddingHorizontal: 12, paddingVertical: 8 }}>
      <ProseText style={muted}><PathText path={token.attrs.file!} tokens={tokens} verbatim />{location ? `:${location}` : ""}</ProseText>
    </View>
  </View>;
}
