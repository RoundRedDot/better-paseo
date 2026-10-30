import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { effectiveCard, type TasksSettings } from "../../../shared/tasks-settings";
import { DEFAULT_CARD_TITLE_LINES, type CardTitleLineCount } from "../device-store";
import { permissionButtons } from "../actions";
import { HAIRLINE, PANEL_RADIUS, boardPalette } from "../board/board-style";
import { LANES, boardLaneLayout } from "../board/navigation";
import { TaskText as Text, HOST_FONT as F, laneTitle, taskControlHeight, useTasksFontScale } from "../typography";
import { BOARD_STRINGS } from "../board/strings";
import { StatusIcon, TaskCardView } from "../cards";
import { taskTokens } from "../cards/tokens";
import type { TasksLanguage } from "../i18n";
import { LANE_STATUS, boardLaneOrder, isHistoryLane, type LaneId, type TaskCard } from "../model";
import { previewSampleCards } from "../sample-cards";

/**
 * The lanes scroll inside this height, so the switches under the preview
 * share a screen with the cards they change.
 */
export const PREVIEW_LANES_MAX_HEIGHT = 440;

const noop = () => {};
const SETTING_PREVIEW_TITLES: Record<string, string> = {
  "sample-input": "Run the staging database migration after confirming the rollback plan with every service owner, checking all affected deployment targets, and recording recovery steps for the release",
  "sample-question": "Choose a consistent date format for CSV exports across locales, then confirm it reads clearly in spreadsheets and matches each region's expected display preferences",
  "sample-running": "Port the task status ring to React Native while preserving its accessible labels, animation behavior, and layout on small phone screens with larger text settings",
  "sample-failed": "Regenerate the Shiki syntax highlighting baselines after the renderer upgrade and compare every changed theme against the release snapshots in supported browsers",
  "sample-done": "Upgrade the plugin SDK to its latest stable release and verify that existing task cards still render all metadata fields correctly on desktop and mobile",
  "sample-archived": "Investigate sidebar drag behavior across desktop, tablet, and mobile layouts, then document which interaction should stay consistent in every supported interface",
};

/** The sample cards by lane, in the board's order, the stopped one saying so in the board's words. */
export function previewLanes(now: number, language: TasksLanguage): Record<LaneId, TaskCard[]> {
  const stopped = BOARD_STRINGS[language].stoppedManually;
  const lanes = { needs_input: [], running: [], review: [], done: [], archived: [] } as Record<LaneId, TaskCard[]>;
  for (const card of previewSampleCards(now)) {
    const title = SETTING_PREVIEW_TITLES[card.id];
    const sample = title ? { ...card, title } : card;
    lanes[card.lane].push(sample.stoppedManually ? { ...sample, error: stopped } : sample);
  }
  return lanes;
}

/**
 * The Tasks board in miniature, on the settings page: the real card drawn
 * from the made-up agents in `sample-cards.ts`, with the density and field
 * switches being edited. Static: it reads no agents, opens no subscription
 * and sends nothing (the data layer is never imported here), its times are
 * frozen at mount, and its action buttons do nothing. Copyable pills copy their sample values. Desktop and tablet previews
 * keep the real board's lane widths and scroll sideways when needed; only
 * the phone preview draws one lane under tabs.
 */
export function TasksBoardPreview(props: {
  theme: PluginTheme;
  values: TasksSettings;
  titleLines?: CardTitleLineCount;
  language: TasksLanguage;
  /** Phone layout: the phone's tabs and its card (`mobile.compactCards`). */
  phone: boolean;
  /** Under the tabs, the cards scroll inside this height; unset, they run on with the page. */
  listMaxHeight?: number;
  hostId?: string;
}) {
  const { theme, values, language, phone } = props;
  const titleLines = props.titleLines ?? DEFAULT_CARD_TITLE_LINES;
  const colors = theme.colors;
  const scale = useTasksFontScale();
  const title = laneTitle();
  const palette = boardPalette(theme);
  const strings = BOARD_STRINGS[language];
  const [now] = useState(() => Date.now());
  const lanes = useMemo(() => previewLanes(now, language), [now, language]);
  const fields = useMemo(() => effectiveCard(values, phone), [values, phone]);
  const [width, setWidth] = useState(0);
  // The board's lanes as the settings being edited draw them: the archived lane follows its switch at once.
  const order = boardLaneOrder(values.board.showArchived);
  const [picked, setSelected] = useState<LaneId>("needs_input");
  const selected = order.includes(picked) ? picked : "needs_input";
  const layout = boardLaneLayout(width, order, [], values.board.laneWidth);

  const card = (item: TaskCard) => (
    <TaskCardView
      key={item.id}
      card={item}
      fields={fields}
      titleLines={Number(titleLines)}
      theme={theme}
      compact={phone}
      permissionButtons={item.permission ? permissionButtons(item.permission, language) : []}
      language={language}
      stopPhase="idle"
      focused={false}
      highlighted={false}
      now={now}
      hostId={props.hostId}
      onReveal={noop}
      animated={false}
    />
  );

  const header = (id: LaneId) => (
    <View style={{ height: taskControlHeight(36, scale), flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }}>
      <StatusIcon kind={LANE_STATUS[id]} size={14} theme={theme} animated={false} />
      <Text numberOfLines={1} style={{ fontSize: title.size, fontWeight: "500", color: colors.foreground }}>
        {strings.lanes[id]}
      </Text>
      <Text style={{ fontSize: title.size, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{lanes[id].length}</Text>
      <View style={{ flex: 1 }} />
      {isHistoryLane(id) ? (
        <Text numberOfLines={1} style={{ fontSize: F.sm, color: colors.foregroundMuted }}>
          {strings.windows[values.board.doneWindow]}
        </Text>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (!phone) {
    body = (
      <ScrollView style={{ maxHeight: PREVIEW_LANES_MAX_HEIGHT }} nestedScrollEnabled>
        <ScrollView horizontal nestedScrollEnabled style={{ flexGrow: 0 }} testID="tasks-preview-lanes-scroll">
          <View style={{ width: layout.contentWidth, paddingHorizontal: LANES.edge, flexDirection: "row", alignItems: "flex-start", gap: LANES.gap }} testID="tasks-preview-lanes">
            {order.map((id) => (
              <View
                key={id}
                testID={`tasks-preview-lane-${id}`}
                style={{ width: layout.laneWidth, borderRadius: PANEL_RADIUS, backgroundColor: palette.panel, overflow: "hidden" }}
              >
                {header(id)}
                <View style={{ paddingHorizontal: 8, paddingBottom: 8, gap: 8 }}>{lanes[id].map(card)}</View>
              </View>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    );
  } else {
    body = (
      <View testID="tasks-preview-tabs">
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          testID="tasks-preview-tabs-scroll"
          style={{ flexGrow: 0, borderBottomWidth: HAIRLINE, borderBottomColor: colors.border, backgroundColor: palette.panel }}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 8, paddingVertical: 4, gap: 4 }}
          accessibilityRole="tablist"
        >
          {order.map((id) => {
            const on = id === selected;
            return (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                aria-selected={on}
                accessibilityLabel={`${strings.lanes[id]} ${lanes[id].length}`}
                onPress={() => setSelected(id)}
                style={{
                  flexGrow: 1,
                  flexShrink: 0,
                  minHeight: taskControlHeight(36, scale),
                  paddingHorizontal: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  borderRadius: 8,
                  borderWidth: HAIRLINE,
                  borderColor: on ? taskTokens(theme).card.border : "transparent",
                  backgroundColor: on ? taskTokens(theme).card.background : "transparent",
                  boxShadow: on ? taskTokens(theme).card.shadow : undefined,
                }}
              >
                <StatusIcon kind={LANE_STATUS[id]} size={13} theme={theme} animated={false} />
                <Text numberOfLines={1} style={{ fontSize: F.base, fontWeight: on ? "600" : "500", color: on ? colors.foreground : colors.foregroundMuted }}>
                  {strings.tabs[id]}
                </Text>
                <Text style={{ fontSize: F.base, fontVariant: ["tabular-nums"], color: on ? colors.foreground : colors.foregroundMuted }}>
                  {lanes[id].length}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <ScrollView style={props.listMaxHeight ? { maxHeight: props.listMaxHeight } : null} nestedScrollEnabled>
          <View style={{ padding: 12, gap: 10, backgroundColor: palette.panel }} testID={`tasks-preview-lane-${selected}`}>
            {lanes[selected].map(card)}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      testID="tasks-board-preview"
      onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width))}
      style={{ alignSelf: "stretch" }}
    >
      {body}
    </View>
  );
}
