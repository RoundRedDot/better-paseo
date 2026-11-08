import React, { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Platform, View } from "react-native";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { TASKS_SETTINGS, effectiveCard, type SidebarCount, type TasksSettings } from "../../../shared/tasks-settings";
import { StatusIcon, useTaskTokens } from "../cards";
import { useTaskCounts, type CountScope } from "../data";
import { firstPromptStoreFor } from "../data/first-prompt";
import { subagentFirstPrompts } from "../data/subagent-timeline";
import { conversationSearchFor } from "../data/search-conversations";
import { useDeviceTasksPreferences } from "../device-preferences";
import { LANE_STATUS, type TaskCard } from "../model";
import { HOST_FONT, TaskText as Text, TasksTypography } from "../typography";
import { useTasksLanguage } from "../i18n";
import { useTasksSettings } from "./enabled";
import { sidebarCountParts, sidebarCountText, type SidebarCountPart } from "./navigation";
import { encodeBoardParams, lastBoardParams, rememberBoardParams, resolveBoardParams, subscribeBoardParams } from "./params";
import { useBoardIntent } from "./prefetch";
import { BOARD_STRINGS } from "./strings";
import { loadMark } from "../../debug/load-marks";
import { HiddenCount } from "./hidden-count";
import { clearedParams } from "./filter-options";

/** The board's screen id; mirrors `TASKS_SCREEN_ID` in `contribute.tsx`, which imports this file. */
const SCREEN_ID = "tasks";

/**
 * The sidebar's Tasks row (prototype 03): highlighted while the board is
 * open, with "input · running · review" counts on the right per `sidebar.count`.
 * Opens the board with the filters it showed last in this session.
 *
 * While the settings load it draws `placeholder` (the bundle's plain row,
 * `chunk/sidebar-placeholder.tsx`), so the row that showed before this
 * chunk arrived stays; nothing once the board is off. Neither subscribes to
 * agents (the counts live in a child that mounts only when the row shows
 * counts; only `all` lists the unread and failed agents). The host wraps an
 * item only in providers, so a null item leaves no gap.
 */
export function TasksSidebarEntry(props: PluginSidebarItemProps & { placeholder?: ReactNode }) {
  const settings = useTasksSettings(props.host.id);
  const language = useTasksLanguage();
  if (!settings) return props.placeholder ?? null;
  if (!settings.enabled) return null;
  loadMark("sidebar.full");
  const mode = settings.sidebar.count;
  const label = BOARD_STRINGS[language].name;
  return mode === "none" ? <TasksRow {...props} label={label} /> : <CountedTasksRow {...props} label={label} mode={mode} settings={settings} />;
}

/**
 * The row in a plain wrapper that warms the board on intent (`prefetch.ts`):
 * pointer over it or focus on web, a touch on iOS and Android. The host's
 * row takes no hover or press-in handler of its own.
 */
function TasksRow(props: PluginSidebarItemProps & { label: string; trailing?: ReactNode }) {
  const intent = useBoardIntent(usePaseo());
  return (
    <View {...intent}>
      <SidebarRow
        icon="SquareKanban"
        label={props.label}
        active={props.currentScreen?.screenId === SCREEN_ID}
        trailing={props.trailing}
        onPress={() => props.openScreen({ screenId: SCREEN_ID, params: encodeBoardParams(lastBoardParams(props.host.id)) })}
      />
    </View>
  );
}

/**
 * The board's filters as it shows them on this host: the ones it remembered
 * last, and this device's hidden subtasks. A search counts the first
 * prompts loaded already, and follows them as they land.
 */
function useBoardCountScope(paseo: PaseoApi, hostId: string, settings: TasksSettings): CountScope {
  const params = useSyncExternalStore(subscribeBoardParams, () => lastBoardParams(hostId), () => lastBoardParams(hostId));
  const shared = useSettings(TASKS_SETTINGS);
  const device = useDeviceTasksPreferences(shared.status === "ready" ? shared.values : null);
  const board = device.settings?.board ?? settings.board;
  const searching = params.query.trim() !== "";
  const prompts = firstPromptStoreFor(paseo);
  const conversations = conversationSearchFor(paseo);
  const conversationVersion = useSyncExternalStore(conversations.subscribe, conversations.version, conversations.version);
  const subscribePrompts = useMemo(() => (listener: () => void) => {
    if (!searching) return () => {};
    const own = prompts.subscribe(listener);
    const subs = subagentFirstPrompts.subscribe(listener);
    return () => { own(); subs(); };
  }, [prompts, searching]);
  const promptsSnapshot = () => (searching ? `${prompts.version()}:${subagentFirstPrompts.version()}` : "");
  const promptsVersion = useSyncExternalStore(subscribePrompts, promptsSnapshot, promptsSnapshot);
  // A new scope (`promptsVersion` included) counts again.
  return useMemo(() => {
    const { filters } = resolveBoardParams(params, { hideSubtasks: board.hideSubtasks, doneWindow: board.doneWindow });
    if (!searching) return { filters };
    const firstMessage = (card: TaskCard) => {
      if (conversations.query() === params.query.trim().toLowerCase()) return conversations.messages().get(card.id);
      const prompt = (card.subagent ? subagentFirstPrompts : prompts).read(card.id);
      return prompt.state === "ready" ? prompt.text : undefined;
    };
    return { filters, firstMessage };
  }, [params, board.hideSubtasks, board.doneWindow, searching, prompts, promptsVersion, conversations, conversationVersion]);
}

/** Needs input, running and review, in the board's lane order, as the board's filters leave them; needs input in the warning colour. */
function CountedTasksRow(props: PluginSidebarItemProps & { label: string; mode: Exclude<SidebarCount, "none">; settings: TasksSettings }) {
  const paseo = usePaseo();
  const scope = useBoardCountScope(paseo, props.host.id, props.settings);
  const counts = useTaskCounts(paseo, props.mode === "all", scope);
  if (counts.ready) loadMark("counts.ready");
  const language = useTasksLanguage();
  const parts = sidebarCountParts(counts, counts.ready ? props.mode : "none");
  const hidden = counts.ready ? (counts.hidden ?? []).filter((card) => props.mode === "all" || card.lane === "needs_input") : [];
  const countsAnchor = useRef<View>(null);
  const hint = [
    ...(hidden.length ? [language === "zh" ? `${hidden.length} 个被隐藏的任务` : `${hidden.length} hidden ${hidden.length === 1 ? "task" : "tasks"}`] : []),
    sidebarCountText(parts, language),
  ].filter(Boolean).join(language === "zh" ? "，" : ", ");
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = countsAnchor.current as unknown as HTMLElement | null;
    node?.setAttribute("title", hint);
  }, [hint]);
  const colors = props.theme.colors;
  const warning = useTaskTokens(props.theme).status.warning;
  const trailing =
    parts.length > 0 || hidden.length > 0 ? (
      // The host's row scales its own label with the interface size; the counts follow the same ramp.
      <TasksTypography theme={props.theme}>
        <View ref={countsAnchor} testID="sidebar-counts-area" style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, marginVertical: -6, paddingLeft: 16, marginLeft: -16, paddingRight: 8, marginRight: -8 }}>
          {hidden.length > 0 ? <HiddenCount tasks={hidden} theme={props.theme} language={language} fields={effectiveCard(props.settings, props.layout.compact)} compact={props.layout.compact} hostId={props.host.id} clearLabel={BOARD_STRINGS[language].clearFilters} onClearFilters={() => {
            // The board screen reads these params on open and applies an explicit route; the store covers the counts here.
            const cleared = clearedParams(lastBoardParams(props.host.id));
            rememberBoardParams(props.host.id, cleared);
            props.openScreen({ screenId: SCREEN_ID, params: encodeBoardParams(cleared) });
          }} /> : null}
          <View accessible accessibilityLabel={sidebarCountText(parts, language)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {parts.map((part) => <SidebarCountIndicator key={part.lane} part={part} theme={props.theme} language={language} color={part.lane === "needs_input" ? warning : colors.foregroundMuted} />)}
          </View>
        </View>
      </TasksTypography>
    ) : undefined;
  return <TasksRow {...props} trailing={trailing} />;
}

function SidebarCountIndicator({ part, theme, language, color }: { part: SidebarCountPart; theme: PluginSidebarItemProps["theme"]; language: "en" | "zh"; color: string }) {
  const anchor = useRef<View>(null);
  const label = sidebarCountText([part], language);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = anchor.current as unknown as HTMLElement | null;
    node?.setAttribute("title", label);
  }, [label]);
  return <View ref={anchor} testID={`sidebar-count-${part.lane}`} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
    <StatusIcon kind={LANE_STATUS[part.lane]} size={14} theme={theme} />
    <Text style={{ fontSize: HOST_FONT.sm, ...(part.lane === "needs_input" ? { fontWeight: "600" as const } : null), color, fontVariant: ["tabular-nums"] }}>{part.count}</Text>
  </View>;
}
