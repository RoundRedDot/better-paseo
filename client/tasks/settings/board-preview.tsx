import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { effectiveCard, type TasksSettings } from "../../../shared/tasks-settings";
import { permissionButtons } from "../actions";
import { HAIRLINE, PANEL_RADIUS, boardPalette } from "../board/board-style";
import { BOARD_STRINGS } from "../board/strings";
import { StatusIcon, TaskCardView } from "../cards";
import type { TasksLanguage } from "../i18n";
import { LANE_STATUS, boardLaneOrder, isHistoryLane, type LaneId, type TaskCard } from "../model";
import { previewSampleCards } from "../sample-cards";

/** Four lanes side by side from this width on; narrower, one lane under tabs, as a phone draws the board. */
export const PREVIEW_LANES_MIN = 840;

/** The width the preview's lanes need side by side: 210 each, so five (with the archived lane) need 1050. */
export function previewLanesMin(lanes: number): number {
  return (PREVIEW_LANES_MIN / 4) * lanes;
}
/**
 * The lanes scroll inside this height, so the switches under the preview
 * share a screen with the cards they change.
 */
export const PREVIEW_LANES_MAX_HEIGHT = 440;
const GAP = 8;

const noop = () => {};

/** The sample cards by lane, in the board's order, the stopped one saying so in the board's words. */
export function previewLanes(now: number, language: TasksLanguage): Record<LaneId, TaskCard[]> {
  const stopped = BOARD_STRINGS[language].stoppedManually;
  const lanes = { needs_input: [], running: [], review: [], done: [], archived: [] } as Record<LaneId, TaskCard[]>;
  for (const card of previewSampleCards(now)) lanes[card.lane].push(card.stoppedManually ? { ...card, error: stopped } : card);
  return lanes;
}

/**
 * The Tasks board in miniature, on the settings page: the real card drawn
 * from the made-up agents in `sample-cards.ts`, with the density and field
 * switches being edited. Static: it reads no agents, opens no subscription
 * and sends nothing (the data layer is never imported here), its times are
 * frozen at mount, and its buttons do nothing. Wide, it draws the four lanes
 * (five with `board.showArchived`) as the desktop board does; narrow or on a
 * phone, one lane under tabs.
 */
export function TasksBoardPreview(props: {
  theme: PluginTheme;
  values: TasksSettings;
  language: TasksLanguage;
  /** Phone layout: the phone's tabs and its card (`mobile.compactCards`). */
  phone: boolean;
  /** Under the tabs, the cards scroll inside this height; unset, they run on with the page. */
  listMaxHeight?: number;
  hostId?: string;
}) {
  const { theme, values, language, phone } = props;
  const colors = theme.colors;
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
  const side = !phone && width >= previewLanesMin(order.length);

  const card = (item: TaskCard) => (
    <TaskCardView
      key={item.id}
      card={item}
      fields={fields}
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
      copyable={false}
    />
  );

  const header = (id: LaneId) => (
    <View style={{ height: 36, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }}>
      <StatusIcon kind={LANE_STATUS[id]} size={14} theme={theme} animated={false} />
      <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "500", color: colors.foreground }}>
        {strings.lanes[id]}
      </Text>
      <Text style={{ fontSize: 14, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{lanes[id].length}</Text>
      <View style={{ flex: 1 }} />
      {isHistoryLane(id) ? (
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.foregroundMuted }}>
          {strings.windows[values.board.doneWindow]}
        </Text>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (side) {
    const laneWidth = Math.floor((width - GAP * (order.length - 1)) / order.length);
    body = (
      <ScrollView style={{ maxHeight: PREVIEW_LANES_MAX_HEIGHT }} nestedScrollEnabled>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: GAP }} testID="tasks-preview-lanes">
          {order.map((id) => (
            <View
              key={id}
              testID={`tasks-preview-lane-${id}`}
              style={{ width: laneWidth, borderRadius: PANEL_RADIUS, backgroundColor: palette.panel, overflow: "hidden" }}
            >
              {header(id)}
              <View style={{ paddingHorizontal: 8, paddingBottom: 8, gap: 8 }}>{lanes[id].map(card)}</View>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  } else {
    body = (
      <View testID="tasks-preview-tabs">
        <View
          accessibilityRole="tablist"
          style={{ flexDirection: "row", borderBottomWidth: HAIRLINE, borderBottomColor: colors.border }}
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
                  flex: 1,
                  minHeight: 40,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  borderBottomWidth: 2,
                  borderBottomColor: on ? colors.accent : "transparent",
                }}
              >
                <StatusIcon kind={LANE_STATUS[id]} size={13} theme={theme} animated={false} />
                <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: on ? "600" : "500", color: on ? colors.foreground : colors.foregroundMuted }}>
                  {strings.tabs[id]}
                </Text>
                <Text style={{ fontSize: 12, fontVariant: ["tabular-nums"], color: on ? colors.foreground : colors.foregroundMuted }}>
                  {lanes[id].length}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <ScrollView style={props.listMaxHeight ? { maxHeight: props.listMaxHeight } : null} nestedScrollEnabled>
          <View style={{ paddingTop: 10, gap: 10 }} testID={`tasks-preview-lane-${selected}`}>
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
