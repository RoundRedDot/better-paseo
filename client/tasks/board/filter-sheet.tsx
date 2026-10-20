import React, { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { BrandMark, taskTokens } from "../cards";
import { Checkbox, LetterAvatar, WindowSegments } from "./board-parts";
import { HAIRLINE } from "./board-style";
import { clearedParams, type FilterOption, type FilterOptions } from "./filter-options";
import { resolveBoardParams, toggleItem } from "./params";
import { SORT_GROUPS, SORT_ICONS, sortDirectionIcon, sortDirections } from "./board-menus";
import { sameSort, type BoardSort, type SortKey } from "./sort";
import { sortOrderLabel } from "./strings";
import type { BoardController } from "./use-board";

/**
 * The phone's filters (prototype 04 sheet), drawn inside the host's bottom
 * sheet as a bounded body (`Modal.Content scrollable={false}`): the options
 * scroll, the "Show N tasks" button stays pinned under them.
 */
export function FilterSheetBody(props: {
  board: BoardController;
  theme: PluginTheme;
  options: FilterOptions;
  onDone(): void;
  /**
   * Opened from the header's sort pill: the sort comes first. (Scrolling
   * there does not hold: the host's sheet opens half high and keeps its
   * scroller at the top until it is dragged up.)
   */
  focus?: "sort";
}) {
  const { board, theme, options } = props;
  const sortFirst = props.focus === "sort";
  const colors = theme.colors;
  const strings = board.strings;
  const { setParams, defaults } = board;
  const resolved = resolveBoardParams(board.params, defaults);
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" testID="filter-sheet-scroll">
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <Pressable accessibilityRole="button" onPress={() => setParams(clearedParams)} style={{ height: 36, paddingHorizontal: 4, justifyContent: "center" }}>
              <Text style={{ fontSize: 15, color: colors.foregroundMuted }}>{strings.reset}</Text>
            </Pressable>
          </View>
          {sortFirst ? (
            <View testID="filter-sheet-sort" style={{ paddingBottom: 8 }}>
              <View style={{ paddingBottom: 8 }}>
                <SectionTitle text={strings.sort} theme={theme} first />
              </View>
              <SortDrillDown board={board} theme={theme} />
            </View>
          ) : null}
          <SectionTitle text={strings.workspace} theme={theme} first={!sortFirst} />
          {options.workspaceGroups.length === 0 ? <Muted text={strings.noOptions} theme={theme} /> : null}
          {options.workspaceGroups.map((group) => (
            <View key={group.projectId || "missing"}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 10, paddingBottom: 6 }}>
                <LetterAvatar name={group.projectName} theme={theme} size={16} />
                <Text style={{ fontSize: 13, color: colors.foreground }}>{group.projectName}</Text>
              </View>
              <ChipWrap>
                {group.items.map((item) => (
                  <Chip
                    key={item.id}
                    option={item}
                    theme={theme}
                    onPress={() => setParams((p) => ({ ...p, workspaceIds: toggleItem(p.workspaceIds, item.id) }))}
                  />
                ))}
              </ChipWrap>
            </View>
          ))}
          <SectionTitle text={strings.agent} theme={theme} />
          {options.agents.length === 0 ? <Muted text={strings.noOptions} theme={theme} /> : null}
          <ChipWrap>
            {options.agents.map((agent) => (
              <Chip
                key={agent.id}
                option={agent}
                theme={theme}
                leading={<BrandMark provider={agent.id} size={16} tokens={taskTokens(theme)} />}
                hideCount
                onPress={() => setParams((p) => ({ ...p, providers: toggleItem(p.providers, agent.id) }))}
              />
            ))}
          </ChipWrap>
          <SectionTitle text={strings.labels} theme={theme} />
          {options.labels.length === 0 ? <Muted text={strings.noOptions} theme={theme} /> : null}
          <ChipWrap>
            {options.labels.map((label) => (
              <Chip
                key={label.id}
                option={label}
                theme={theme}
                leading={<View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: label.color ?? colors.foregroundMuted }} />}
                onPress={() => setParams((p) => ({ ...p, labels: toggleItem(p.labels, label.id) }))}
              />
            ))}
          </ChipWrap>
          <View style={{ height: HAIRLINE, marginTop: 16, marginBottom: 4, backgroundColor: colors.border }} />
          <ToggleRow
            icon="AppWindow"
            label={strings.openTabs}
            hint={strings.openTabsHint}
            on={resolved.filters.openTabsOnly}
            theme={theme}
            onPress={() => setParams((p) => ({ ...p, openTabsOnly: !p.openTabsOnly }))}
          />
          <ToggleRow
            icon="ListTree"
            label={strings.hideSubtasks}
            hint={strings.hideSubtasksHint}
            on={resolved.filters.hideSubtasks}
            theme={theme}
            onPress={() => setParams((p) => ({ ...p, hideSubtasks: !(p.hideSubtasks ?? defaults.hideSubtasks) }))}
          />
          <Text style={{ paddingTop: 12, paddingBottom: 8, fontSize: 12, fontWeight: "500", color: colors.foregroundMuted }}>{strings.doneRange}</Text>
          <WindowSegments value={resolved.doneWindow} onChange={(doneWindow) => setParams((p) => ({ ...p, doneWindow }))} theme={theme} strings={strings} large stretch />
          {sortFirst ? null : (
            <View testID="filter-sheet-sort">
              <SectionTitle text={strings.sort} theme={theme} />
              <SortDrillDown board={board} theme={theme} />
            </View>
          )}
        </View>
      </ScrollView>
      <View testID="filter-sheet-footer" style={{ paddingTop: 12, paddingHorizontal: 16, borderTopWidth: HAIRLINE, borderTopColor: colors.border }}>
        <Pressable
          accessibilityRole="button"
          onPress={props.onDone}
          style={{ height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.accentForeground, fontVariant: ["tabular-nums"] }}>{strings.show(board.total)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SectionTitle({ text, theme, first }: { text: string; theme: PluginTheme; first?: boolean }) {
  return (
    <Text style={{ paddingTop: first ? 0 : 16, paddingBottom: first ? 0 : 8, fontSize: 12, fontWeight: "500", color: theme.colors.foregroundMuted }}>{text}</Text>
  );
}

function Muted({ text, theme }: { text: string; theme: PluginTheme }) {
  return <Text style={{ paddingVertical: 6, fontSize: 13, color: theme.colors.foregroundMuted }}>{text}</Text>;
}

function ChipWrap({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}

function Chip(props: { option: FilterOption; theme: PluginTheme; onPress(): void; leading?: ReactNode; hideCount?: boolean }) {
  const colors = props.theme.colors;
  const on = props.option.on;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={props.onPress}
      style={{
        height: 32,
        maxWidth: "100%",
        paddingLeft: props.leading ? 8 : 12,
        paddingRight: 12,
        borderWidth: HAIRLINE,
        borderColor: on ? colors.accent : colors.border,
        borderRadius: 4,
        backgroundColor: on ? taskTokens(props.theme).accentSoft : "transparent",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {props.leading}
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, color: on ? taskTokens(props.theme).accentText : colors.foreground }}>
        {props.option.label}
      </Text>
      {props.hideCount ? null : (
        <Text style={{ fontSize: 12, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{props.option.count}</Text>
      )}
    </Pressable>
  );
}

function ToggleRow(props: { icon: string; label: string; hint?: string; on: boolean; theme: PluginTheme; onPress(): void }) {
  const colors = props.theme.colors;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.on }}
      onPress={props.onPress}
      style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 }}
    >
      <Icon name={props.icon} size={18} color={colors.foregroundMuted} />
      <View style={{ flex: 1, paddingVertical: 6 }}>
        <Text style={{ fontSize: 15, color: colors.foreground }}>{props.label}</Text>
        {props.hint ? <Text style={{ fontSize: 12, lineHeight: 16, color: colors.foregroundMuted }}>{props.hint}</Text> : null}
      </View>
      <Checkbox on={props.on} theme={props.theme} size={20} />
    </Pressable>
  );
}

/**
 * The phone's sort: no hover, so the menu's two levels become a drill-down.
 * The fields, grouped as on desktop, each with its active direction; a tap
 * opens that field's two directions under a back row.
 */
function SortDrillDown({ board, theme }: { board: BoardController; theme: PluginTheme }) {
  const [field, setField] = useState<SortKey | null>(null);
  // The directions keep the fields' height, so drilling in or out does not
  // shorten the sheet's content and make its scroll position jump.
  const [fieldsHeight, setFieldsHeight] = useState(0);
  const colors = theme.colors;
  const strings = board.strings;
  const current = board.params.sort;
  const choose = (sort: BoardSort | null) => {
    board.setParams((p) => ({ ...p, sort }));
    setField(null);
  };
  const rule = <View style={{ height: HAIRLINE, marginVertical: 4, backgroundColor: colors.border }} />;
  if (field) {
    return (
      <View testID="sort-directions" style={{ minHeight: fieldsHeight }}>
        <SortRow icon="ChevronLeft" label={strings.back} hint={strings.sortKeys[field]} theme={theme} onPress={() => setField(null)} />
        {rule}
        {sortDirections(field).map((direction) => {
          const sort: BoardSort = { key: field, direction };
          return (
            <SortRow
              key={direction}
              icon={sortDirectionIcon(field, direction)}
              label={sortOrderLabel(sort, strings)}
              checked={sameSort(sort, current)}
              theme={theme}
              onPress={() => choose(sort)}
            />
          );
        })}
      </View>
    );
  }
  return (
    <View testID="sort-fields" onLayout={(event) => setFieldsHeight(event.nativeEvent.layout.height)}>
      <SortRow icon={SORT_ICONS.default} label={strings.sortDefault} checked={current === null} theme={theme} onPress={() => choose(null)} />
      {SORT_GROUPS.map((keys) => (
        <View key={keys.join()}>
          {rule}
          {keys.map((key) => (
            <SortRow
              key={key}
              icon={SORT_ICONS[key]}
              label={strings.sortKeys[key]}
              hint={current?.key === key ? sortOrderLabel(current, strings) : undefined}
              drills
              theme={theme}
              onPress={() => setField(key)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function SortRow(props: { icon: string; label: string; hint?: string; checked?: boolean; drills?: boolean; theme: PluginTheme; onPress(): void }) {
  const colors = props.theme.colors;
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityState={{ checked: props.checked }}
      onPress={props.onPress}
      style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 12 }}
    >
      <Icon name={props.icon} size={18} color={colors.foregroundMuted} />
      <Text style={{ flex: 1, fontSize: 15, color: colors.foreground }}>{props.label}</Text>
      {props.hint ? <Text style={{ fontSize: 14, color: colors.foregroundMuted }}>{props.hint}</Text> : null}
      {props.checked ? <Icon name="Check" size={18} color={colors.accent} /> : null}
      {props.drills ? <Icon name="ChevronRight" size={16} color={colors.foregroundMuted} /> : null}
    </Pressable>
  );
}
