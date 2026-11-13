import React, { useEffect, useMemo, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { TasksTypography, HOST_FONT as F, HOST_LINE } from "../typography";
import { usePaseo, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useDeviceTasksPreferences } from "../device-preferences";
import { useTasksLanguage } from "../i18n";
import { pluginRoot } from "../../components/focus-ring";
import { HAIRLINE } from "./board-style";
import { SearchCoverageProvider } from "./search-loading";
import { DesktopBoard } from "./desktop-board";
import { MenuBoundsContext } from "./menu";
import { carriedSettings } from "./carry";
import { tasksSettingsOpener, useTasksEnabledStore, useTasksSettings } from "./enabled";
import { boardIsCompact } from "./navigation";
import { PhoneBoard } from "./phone-board";
import { BOARD_STRINGS } from "./strings";
import { useBoard, type BoardLayoutHandlers } from "./use-board";
import { TaskQuestionDialog } from "../cards/question-dialog";
import { consumeBoardOpen } from "./params";
import { openedTask } from "../data";

/**
 * The Tasks board (`addScreen` id `tasks`): the lanes side by side, scrolling
 * sideways when the board is narrow; one lane behind a tab bar only on a
 * phone, the host's compact layout (`boardIsCompact`). Filters
 * live in the session per host and travel as the screen's params; see
 * `params.ts`.
 *
 * Always registered, so a reload, a restored tab or a link resolves before
 * the settings arrive (the host resolves the route once). It mounts only
 * when open. Off, it says so and how to turn it on, from what the startup
 * read or the settings page already told the store: no read of its own.
 * While the startup read is out it draws an empty page and waits for it;
 * without one (or after it failed) it reads the settings itself.
 */
export function TasksBoardScreen(props: PluginScreenProps) {
  const toast = useToast();
  const language = useTasksLanguage();
  const navigation = props.navigation;
  const paseo = usePaseo();
  const token = props.params.openRequest;
  useEffect(() => {
    const agentId = consumeBoardOpen(props.host.id, token);
    if (!agentId) return;
    if (!navigation) {
      toast.error(language === "zh" ? "无法打开任务：当前客户端不支持导航" : "Cannot open task: navigation is unavailable in this client");
      return;
    }
    navigation.openAgent({ agentId });
    openedTask(paseo, agentId);
  }, [props.host.id, token, navigation, toast, language, paseo]);
  const store = useTasksEnabledStore();
  // Off, as the startup read or the settings page said: say so, and read nothing more.
  if (store.enabled === false) return <BoardOff {...props} />;
  // The startup read is still out: wait for it rather than read a second time,
  // unless this host's board was on before a reconnect (`carry.ts`): then draw
  // it now, from what it carried, and let the board's own read catch up.
  if (store.enabled === null && store.startupRead === "pending" && carriedSettings(props.host.id)?.enabled !== true) {
    return <BoardBlank {...props} />;
  }
  return <BoardReader {...props} />;
}

/** The settings, read (or shared with the board's own read when on), and followed. */
function BoardReader(props: PluginScreenProps) {
  const settings = useTasksSettings(props.host.id);
  const device = useDeviceTasksPreferences(settings);
  if (!device.ready && device.error) throw new Error(device.error);
  if (!device.ready) return <BoardBlank {...props} />;
  if (!settings) return <BoardBlank {...props} />;
  if (!settings.enabled) return <BoardOff {...props} />;
  return <BoardContent {...props} />;
}

function BoardBlank(props: PluginScreenProps) {
  return <View style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }} />;
}

/** The layout follows the host's: the phone layout on its compact layout, the lanes everywhere else. */
function BoardContent(props: PluginScreenProps) {
  const rootRef = useRef<View>(null);
  const handlers = useRef<BoardLayoutHandlers | null>(null);
  const compact = boardIsCompact(props.layout.compact);
  const board = useBoard(props, rootRef, handlers, compact);
  const Layout = compact ? PhoneBoard : DesktopBoard;
  const layout = useMemo(() => <Layout screen={props} board={board} rootRef={rootRef} handlers={handlers} />, [Layout, props, board]);
  return (
    <TasksTypography theme={props.theme}>
      <View {...pluginRoot} style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }}>
        <SearchCoverageProvider cancelled={board.searchCancelled} setCancelled={board.setSearchCancelled} cancelText={board.strings.cancelSearch} resumeText={board.strings.resumeSearch} stoppedText={board.strings.searchStopped} status={board.searchStatus} historyLoading={board.searchHistoryLoading} historyError={board.tasks.historyError} retryHistory={board.tasks.clearHistoryError} historyLoadingText={board.strings.historyLoading} historyFailedText={board.strings.historyFailed} query={board.params.query} strings={board.fullConversationSearch ? board.strings.conversationSearchCoverage : board.strings.searchCoverage} fullConversation={board.fullConversationSearch} onFullConversationChange={board.setFullConversationSearch} fullConversationLabel={board.strings.fullConversationSearch} fullConversationShortLabel={board.strings.fullConversationShort} fullConversationHint={board.strings.fullConversationHint(board.fullConversationSearch)}>
          <MenuBoundsContext.Provider value={rootRef}>
            {board.hostNotice ? <HostNotice text={board.hostNotice.text} failed={board.hostNotice.failed} theme={props.theme} /> : null}
            {layout}
            <TaskQuestionDialog store={board.questionDialog} cardById={board.cardById} submit={board.submitQuestions} compact={compact} onOpen={board.callbacks.onOpen} theme={props.theme} language={board.language} />
          </MenuBoundsContext.Provider>
        </SearchCoverageProvider>
      </View>
    </TasksTypography>
  );
}

/**
 * One quiet line above the board while another Paseo host's cards are
 * missing: it is offline or reconnecting, or online but its tasks could not
 * be read (`failed`, with a warning mark). It goes once every host is read
 * again (`data/hosts.ts`).
 */
function HostNotice(props: { text: string; failed: boolean; theme: PluginScreenProps["theme"] }) {
  const colors = props.theme.colors;
  return (
    <View
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      testID="host-notice"
      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 4, borderBottomWidth: HAIRLINE, borderBottomColor: colors.border }}
    >
      <Icon name={props.failed ? "CircleAlert" : "CloudOff"} size={13} color={props.failed ? colors.statusWarning : colors.foregroundMuted} />
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: F.sm, lineHeight: HOST_LINE.sm, color: colors.foregroundMuted }}>{props.text}</Text>
    </View>
  );
}

function BoardOff(props: PluginScreenProps) {
  const strings = BOARD_STRINGS[useTasksLanguage()];
  const colors = props.theme.colors;
  const open = tasksSettingsOpener();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.surface0 }}>
      <View style={{ maxWidth: 360, alignItems: "center", gap: 8 }}>
        <Icon name="SquareKanban" size={20} color={colors.foregroundMuted} />
        <Text style={{ fontSize: F.lg, fontWeight: "600", color: colors.foreground, textAlign: "center" }}>{strings.boardOff}</Text>
        <Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: colors.foregroundMuted, textAlign: "center" }}>{strings.boardOffHint}</Text>
        {open ? (
          <Pressable
            accessibilityRole="button"
            onPress={open}
            style={{ marginTop: 6, height: 32, paddingHorizontal: 14, borderRadius: 6, borderWidth: HAIRLINE, borderColor: colors.border, justifyContent: "center" }}
          >
            <Text style={{ fontSize: F.base, fontWeight: "500", color: colors.foreground }}>{strings.openSettings}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
