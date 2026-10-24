import React, { useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, useTasksFontScale, taskControlHeight } from "../typography";
import type { TasksLanguage } from "../i18n";
import type { TaskChild } from "../model";
import { subagentFacts } from "../subagent-type";
import { useHover } from "../../ui/use-hover";
import { withAlpha } from "../../components/theme-tokens";
import { cardStart, cardTimer } from "./card-time";
import { hintProps } from "./card-hints";
import { ChildMark } from "./child-mark";
import { ContextRing } from "./context-ring";
import { useTime, type TimeSource } from "./clock";
import { titlePrefix } from "./details-format";
import { contextRatio } from "./format";
import { modeIcon, THINKING_ICON } from "./mode-icons";
import { cardStrings } from "./strings";
import type { TaskTokens } from "./tokens";

/** One design for expanded board cards, the details sidebar and the mobile sheet. */
export interface SubtaskRowProps extends TimeSource {
  child: TaskChild;
  tokens: TaskTokens;
  theme: PluginTheme;
  language: TasksLanguage;
  /** Touch targets grow; structure, typography and metadata stay the same. */
  touch: boolean;
  backdrop: string;
  muted?: boolean;
  animated?: boolean;
  testIDPrefix?: string;
  accessibilityLabel?: string;
  statusHint?: string;
  openHint?: string;
  openLabel: string;
  onPress?(): void;
  onLongPress?(): void;
  onOpen?(): void;
}

export function SubtaskRow(props: SubtaskRowProps) {
  const { child, tokens, touch } = props;
  const scale = useTasksFontScale();
  const rowRef = useRef<View>(null);
  const { hovered, hoverProps } = useHover(rowRef);
  const web = Platform.OS === "web";
  const showOpen = !!props.onOpen && (touch || !web || hovered || child.kind === "provider");
  const prefix = props.testIDPrefix ?? "subtask";
  const fill = hovered && props.onPress ? tokens.card.controlHover : props.backdrop;
  const line = Math.round(HOST_LINE.smRead * scale);
  const target = touch ? 32 : 22;
  const { prefix: tag, rest } = titlePrefix(child.title);
  return (
    <Pressable
      {...(web ? { role: "group" as const } : { accessibilityRole: "button" as const })}
      accessibilityLabel={props.accessibilityLabel ?? child.title}
      disabled={!props.onPress && !props.onOpen}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      delayLongPress={450}
      ref={rowRef}
      {...(web ? null : hoverProps)}
      testID={`${prefix}-${child.id}`}
      style={{
        minHeight: taskControlHeight(touch ? 44 : 32, scale),
        paddingVertical: touch ? 10 : 7,
        paddingHorizontal: 6,
        borderRadius: 6,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        backgroundColor: fill,
      }}
    >
      <View style={{ width: 18, height: line, flexShrink: 0, alignItems: "center", justifyContent: "center" }} testID={`${prefix}-status-${child.id}`} {...hintProps(props.statusHint)}>
        <ChildMark child={child} tokens={tokens} theme={props.theme} backdrop={fill} animated={props.animated} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }} testID={`${prefix}-content-${child.id}`}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={{ fontSize: F.sm, lineHeight: HOST_LINE.smRead, color: props.muted ? tokens.foregroundMuted : tokens.foreground }} testID={`${prefix}-title-${child.id}`}>
          {tag ? <Text style={{ color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{`${tag} `}</Text> : null}
          {rest}
        </Text>
        <SubtaskMetadata child={child} tokens={tokens} language={props.language} now={props.now} clock={props.clock} testIDPrefix={prefix} />
      </View>
      {props.onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.openLabel}
          disabled={!showOpen}
          onPress={props.onOpen}
          testID={child.kind === "provider" ? `${prefix}-parent-tab-${child.id}` : `${prefix}-open-${child.id}`}
          {...hintProps(showOpen ? props.openHint : undefined)}
          style={{
            width: target,
            height: target,
            flexShrink: 0,
            marginVertical: (line - target) / 2,
            borderRadius: 5,
            alignItems: "center",
            justifyContent: "center",
            opacity: showOpen ? 1 : 0,
          }}
        >
          <Icon name={child.kind === "provider" ? "CornerLeftUp" : "ArrowUpRight"} size={touch ? 16 : 14} color={tokens.foregroundMuted} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** Shared by expanded cards and details: icon-led facts wrap below the title and alone follow the clock. */
export function SubtaskMetadata(props: TimeSource & { child: TaskChild; tokens: TaskTokens; language: TasksLanguage; testIDPrefix?: string }) {
  const { child, tokens, language } = props;
  const scale = useTasksFontScale();
  const [width, setWidth] = useState<number | null>(null);
  // Measure the content column, not the screen: a wide tablet can have narrow lanes.
  const narrow = width !== null && width > 0 && width <= 240 * scale;
  const hideRunTime = narrow && child.status === "running";
  const words = cardStrings(language).details;
  const status = child.status === "needs_input" ? words.subtaskWaiting : child.status === "failed" ? words.subtaskFailed : child.status === "unread" ? words.subtaskUnread : null;
  const ratio = contextRatio(child.context ?? null);
  const timed = child.lane && child.timing ? { lane: child.lane, timing: child.timing, waitingOnSubtasks: child.waitingOnSubtasks } : null;
  const start = useTime(props, (now) => !hideRunTime && timed ? cardStart(timed, now) ?? "" : "");
  const timer = useTime(props, (now) => !hideRunTime && timed ? cardTimer(timed, now, language, true)?.text ?? "" : "");
  const iconSize = 12;
  const muted = tokens.foregroundMuted;
  const prefix = props.testIDPrefix ?? "subtask";
  const icon = (name: string, color = muted) => <Icon name={name} size={iconSize} color={color} />;
  const part = (key: string, label: string, lead: ReactNode = null, color = muted, showLabel = true) => (
    <View key={key} accessible={showLabel ? undefined : true} accessibilityLabel={showLabel ? undefined : label} style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, minWidth: 0, flexShrink: 1 }}>
      {lead ? <View style={{ height: Math.round(HOST_LINE.smRead * scale), justifyContent: "center" }}>{lead}</View> : null}
      {showLabel && label ? <Text style={[{ fontSize: F.sm, lineHeight: HOST_LINE.smRead, color, flexShrink: 1 }, { fontVariant: ["tabular-nums"] }]}>{label}</Text> : null}
    </View>
  );
  const parts: ReactNode[] = [];
  // The provider and status are already combined in the row's ChildMark.
  if (child.kind === "provider") {
    const facts = subagentFacts(child.subtitle, child.subagentType);
    // ChildMark already carries the type icon; keep only the supplied facts here.
    if (facts.text) parts.push(part("facts", facts.text));
  }
  if (child.modelLabel) parts.push(part("model", child.modelLabel));
  if (child.thinkingLabel) parts.push(part("thinking", child.thinkingLabel, icon(THINKING_ICON)));
  if (child.modeLabel) {
    const mode = modeIcon(child.provider ?? "", child.modeLabel);
    parts.push(part("mode", child.modeLabel, icon(mode, mode === "ShieldOff" ? tokens.warning : muted), muted, !(narrow && child.modeLabel === "Full Access")));
  }
  if (status) parts.push(part("status", status, null, child.status === "failed" ? tokens.danger : child.status === "needs_input" ? tokens.warning : muted));
  if (ratio !== null) {
    const color = ratio >= 0.9 ? tokens.danger : ratio >= 0.75 ? tokens.warning : muted;
    parts.push(
      <View key="context" accessibilityLabel={words.subtaskContext(Math.round(ratio * 100))} style={{ height: Math.round(HOST_LINE.smRead * scale), justifyContent: "center" }}>
        <ContextRing ratio={ratio} color={color} track={withAlpha(muted, 0.25)} variant="subtask" />
      </View>,
    );
  }
  if (start || timer) parts.push(
    <View key="time" style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 2, minWidth: 0, flexShrink: 1 }} testID={`${prefix}-time-${child.id}`}>
      {start ? part("start", start, icon("Clock")) : null}
      {timer ? part("timer", timer, icon(child.lane === "needs_input" ? "Clock" : "Hourglass")) : null}
    </View>,
  );
  // Keep measuring when the optional fields are hidden, so widening restores them.
  return parts.length > 0 || hideRunTime ? (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 2 }} testID={`${prefix}-meta-${child.id}`}>
      {parts}
    </View>
  ) : null;
}
