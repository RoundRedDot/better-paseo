import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, View, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { TaskIssue } from "../../../shared/task-availability";
import type { TasksLanguage } from "../i18n";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, TASK_MONO, taskControlHeight, useTasksFontScale } from "../typography";
import { useHover } from "../../ui/use-hover";
import { pillTint, readableOn, type TaskTokens } from "./tokens";
import { tildePath } from "./format";
import { breakable } from "./details-format";
import { HINT_DELAY_MS } from "./card-hints";
import { panelChrome } from "./panel";

const labels: Record<TasksLanguage, Record<TaskIssue["code"], string>> = {
  zh: {
    checking: "正在检查可用性", host_unavailable: "主机暂时不可用", unsupported: "操作不可用", agent_missing: "任务已不存在",
    directory_missing: "工作目录不存在", directory_not_directory: "工作路径无效", directory_inaccessible: "目录无法访问",
    workspace_unavailable: "工作区已不可用", project_unavailable: "项目归属不可用", title_settings_invalid: "标题生成配置无效",
    provider_unavailable: "Provider 不可用", model_unavailable: "标题模型不可用",
  },
  en: {
    checking: "Checking availability", host_unavailable: "Host temporarily unavailable", unsupported: "Operation unavailable", agent_missing: "Task no longer exists",
    directory_missing: "Working directory missing", directory_not_directory: "Invalid working path", directory_inaccessible: "Directory inaccessible",
    workspace_unavailable: "Workspace unavailable", project_unavailable: "Project unavailable", title_settings_invalid: "Invalid title settings",
    provider_unavailable: "Provider unavailable", model_unavailable: "Title model unavailable",
  },
};

export function taskIssueText(issue: TaskIssue, language: TasksLanguage): string {
  return `${labels[language][issue.code]}${issue.detail ? `\n${issue.detail}` : ""}`;
}

/** A persistent warning; hover, keyboard focus and touch expose the same explanation. */
export function AvailabilityTag(props: { issue: TaskIssue | null | undefined; language: TasksLanguage; tokens: TaskTokens; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  const { hovered, hoverProps } = useHover();
  const scale = useTasksFontScale();
  if (!props.issue || props.issue.code === "checking") return null;
  const text = taskIssueText(props.issue, props.language);
  const label = labels[props.language][props.issue.code];
  const tint = pillTint(props.tokens, props.tokens.warning);
  const color = readableOn(props.tokens.warning, [tint.background], props.tokens.foreground);
  return (
    <View style={{ marginTop: 8, alignItems: "flex-start", maxWidth: "100%", zIndex: hovered || focused ? 5 : undefined }} testID="task-availability">
      <Pressable accessibilityRole="button" accessibilityLabel={text} accessibilityState={{ expanded: expanded || hovered || focused }}
        onPress={(event) => { event.stopPropagation(); setExpanded((value) => !value); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} {...hoverProps}
        testID="task-availability-tag" style={{ maxWidth: "100%", minHeight: taskControlHeight(props.compact ? 32 : 24, scale), paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: tint.border, backgroundColor: tint.background, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="TriangleAlert" size={15} color={color} />
        <Text style={{ flexShrink: 1, fontSize: F.sm, lineHeight: HOST_LINE.sm, fontWeight: "600", color }}>{label}</Text>
      </Pressable>
      {expanded || hovered || focused ? <View pointerEvents="none" testID="task-availability-hint" style={{ ...(expanded ? { marginTop: 4 } : { position: "absolute", top: "100%", left: 0, right: 0 }), padding: 8, borderRadius: 6, borderWidth: 1, borderColor: tint.border, backgroundColor: props.tokens.card.background }}><Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: props.tokens.foreground }}>{text}{"\n"}{props.language === "zh" ? "相关写操作已禁用；状态恢复后自动重新检查。" : "Affected write actions are disabled; availability is checked again automatically."}</Text></View> : null}
    </View>
  );
}

/** A card's warning: an issue the card shows, as opposed to "checking", which passes unmarked. */
export function shownIssue(issue: TaskIssue | null | undefined): TaskIssue | null {
  return issue && issue.code !== "checking" ? issue : null;
}

/** The hint's prose under the reason. */
const NOTE: Record<TasksLanguage, string> = {
  zh: "相关写操作暂不可用，恢复后自动重新检查。",
  en: "Write actions are unavailable; availability is checked again automatically.",
};

/** The hint's distance from the card's edges and from the corner's hit area (`card-hints`). */
const HINT_EDGE = 6;
const HINT_GAP = 4;

/** The cut corner's hover, focus and touch target; its hint stays outside the surface clips. */
export function AvailabilityCorner(props: {
  issue: TaskIssue;
  language: TasksLanguage;
  theme: PluginTheme;
  tokens: TaskTokens;
  hit: number;
  onOpenChange?(open: boolean): void;
}) {
  const { issue, language, hit } = props;
  const [pinned, setPinned] = useState(false);
  const [focusShown, setFocusShown] = useState(false);
  const [hoverShown, setHoverShown] = useState(false);
  const { hovered, hoverProps } = useHover();
  const scale = useTasksFontScale();
  const hitRef = useRef<View>(null);
  const tipRef = useRef<View>(null);
  const open = pinned || focusShown || hoverShown;
  useEffect(() => {
    if (!hovered) return setHoverShown(false);
    const timer = setTimeout(() => setHoverShown(true), HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hovered]);
  const { onOpenChange } = props;
  useEffect(() => {
    onOpenChange?.(open);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);
  // Escape puts the hint away; on web a press outside the corner and its hint unpins it.
  useEffect(() => {
    if (Platform.OS !== "web" || !open || typeof document === "undefined") return;
    const owns = (target: EventTarget | null) => [hitRef.current, tipRef.current].some((node) => (node as unknown as Element | null)?.contains?.(target as Node));
    const down = (event: PointerEvent) => {
      if (!owns(event.target)) setPinned(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPinned(false);
      setFocusShown(false);
      setHoverShown(false);
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  const label = labels[language][issue.code];
  const detail = issue.detail ? tildePath(issue.detail) : null;
  const accessibilityLabel = [label, detail, NOTE[language]].filter(Boolean).join("\n");
  // The rotated square's lower-left half, inside the clip, is the hit triangle.
  const diamond = hit * Math.SQRT2;
  return (
    <>
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", top: 0, right: 0, width: hit, height: hit, overflow: "hidden", zIndex: 4 }}
        testID="task-availability-corner-hit-area"
      >
        <Pressable
          ref={hitRef}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ expanded: open }}
          onPress={(event) => {
            event?.stopPropagation?.();
            setHoverShown(false);
            setPinned((value) => !value);
          }}
          onFocus={(event) => {
            const target = (event?.nativeEvent as { target?: { matches?(selector: string): boolean } } | undefined)?.target ?? (event as { target?: { matches?(selector: string): boolean } } | undefined)?.target;
            // A click focuses the corner too; only keyboard focus shows the hint by itself.
            if (Platform.OS !== "web" || typeof target?.matches !== "function" || target.matches(":focus-visible")) setFocusShown(true);
          }}
          onBlur={() => setFocusShown(false)}
          {...hoverProps}
          style={{ position: "absolute", top: -diamond / 2, right: -diamond / 2, width: diamond, height: diamond, transform: [{ rotate: "45deg" }] }}
          testID="task-availability-corner-hit"
        />
      </View>
      {open ? (
        <View
          ref={tipRef}
          pointerEvents={pinned ? "box-none" : "none"}
          style={{ position: "absolute", top: hit + HINT_GAP, left: HINT_EDGE, right: HINT_EDGE, alignItems: "flex-end", zIndex: 40 }}
          testID="task-availability-hint"
        >
          <Pressable
            disabled={!pinned}
            accessible={false}
            onPress={(event) => {
              event?.stopPropagation?.();
              setPinned(false);
            }}
            style={{ maxWidth: Math.round(300 * Math.max(1, scale)), paddingHorizontal: 10, paddingTop: 8, paddingBottom: 9, gap: 4, ...panelChrome(props.theme), borderRadius: 8 } as ViewStyle}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Icon name="TriangleAlert" size={13} color={props.tokens.foregroundMuted} />
              <Text style={{ flexShrink: 1, fontSize: F.sm, lineHeight: HOST_LINE.sm, fontWeight: "600", color: props.tokens.foreground }} testID="task-availability-hint-title">{label}</Text>
            </View>
            {detail ? (
              <Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, fontFamily: TASK_MONO, color: props.tokens.foreground }} testID="task-availability-hint-path">{breakable(detail)}</Text>
            ) : null}
            <Text style={{ marginTop: 2, fontSize: F.sm, lineHeight: HOST_LINE.sm, color: props.tokens.foregroundMuted }}>{NOTE[language]}</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}
