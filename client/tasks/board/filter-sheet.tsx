import React, { useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, View, type LayoutChangeEvent, type ScrollView as NativeScrollView } from "react-native";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { LANE_WIDTHS, type LaneWidth } from "../../../shared/tasks-settings";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, useTasksFontScale, taskControlHeight } from "../typography";
import { BrandMark, ProjectIcon, TagMark, taskTokens } from "../cards";
import { Segments, WindowSegments } from "./board-parts";
import { HAIRLINE } from "./board-style";
import { SwitchTrack } from "../../ui/switch-track";
import { clearedParams, searchWorkspaceGroups, shownFilterOptions, type FilterOption, type FilterOptions } from "./filter-options";
import { iconlessProjects, useRequestProjectIcons } from "./project-icons";
import { resolveBoardParams, toggleItem } from "./params";
import { SORT_GROUPS, SORT_ICONS, sortDirectionIcon, sortDirections } from "./board-menus";
import { sameSort, type BoardSort, type SortKey } from "./sort";
import { sortOrderLabel } from "./strings";
import type { BoardController } from "./use-board";

/**
 * The phone's filters (prototype 04 sheet), drawn inside the host's bottom
 * sheet as a bounded body (`Modal.Content scrollable={false}`): the options
 * scroll, Reset and "Show N tasks" stay pinned under them. The short
 * filters come first; the workspaces, often dozens, come last, under a
 * search field. With `board.showEmptyGroups` off, only the options with an
 * active task or picked are listed.
 */
export function FilterSheetBody(props: {
  board: BoardController;
  theme: PluginTheme;
  options: FilterOptions;
  onDone(): void;
  /** The lane width, on a tablet's narrow board (its lanes scroll); a phone shows one lane and has none. */
  laneWidth?: { value: LaneWidth; onChange(width: LaneWidth): void };
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
  const shown = shownFilterOptions(options, board.showEmptyGroups);
  useRequestProjectIcons(iconlessProjects(shown.workspaceGroups), board.tasks.requestProjectIcon);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const scrollRef = useRef<NativeScrollView>(null);
  // Where the workspaces start in the scroll, and the scroller's height.
  const [workspacesY, setWorkspacesY] = useState(0);
  const [viewport, setViewport] = useState(0);
  const groups = searchWorkspaceGroups(shown.workspaceGroups, query);
  // While searching, the workspaces fill the scroller at least, so their field
  // can stay at its top above the keyboard however few rows match.
  const holdTop = searching || query.trim() !== "";
  const sort = (
    <View testID="filter-sheet-sort">
      <SectionTitle text={strings.sort} theme={theme} first={sortFirst} />
      <SortDrillDown board={board} theme={theme} />
    </View>
  );
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        onLayout={(event: LayoutChangeEvent) => setViewport(event.nativeEvent.layout.height)}
        testID="filter-sheet-scroll"
      >
        <View style={{ paddingHorizontal: 16, paddingTop: sortFirst ? 0 : 4, paddingBottom: 8 }}>
          {sortFirst ? <View style={{ paddingBottom: 8 }}>{sort}</View> : null}
          <ToggleRow
            icon="ListTree"
            label={strings.showSubtasks}
            hint={strings.showSubtasksHint}
            on={!resolved.filters.hideSubtasks}
            theme={theme}
            onPress={() => setParams((p) => ({ ...p, hideSubtasks: !(p.hideSubtasks ?? defaults.hideSubtasks) }))}
          />
          <SectionTitle text={strings.agent} theme={theme} />
          {shown.agents.length === 0 ? <Muted text={strings.noOptions} theme={theme} /> : null}
          <ChipWrap>
            {shown.agents.map((agent) => (
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
          {shown.labels.length === 0 ? <Muted text={strings.noOptions} theme={theme} /> : null}
          <ChipWrap>
            {shown.labels.map((label) => (
              <Chip
                key={label.id}
                option={label}
                theme={theme}
                leading={<TagMark size={14} color={label.color ?? colors.foregroundMuted} hole={label.on ? taskTokens(theme).accentSoft : colors.surface0} />}
                onPress={() => setParams((p) => ({ ...p, labels: toggleItem(p.labels, label.id) }))}
              />
            ))}
          </ChipWrap>
          <SectionTitle text={strings.doneRange} theme={theme} />
          <WindowSegments value={resolved.doneWindow} onChange={(doneWindow) => setParams((p) => ({ ...p, doneWindow }))} theme={theme} strings={strings} large stretch />
          {props.laneWidth ? (
            <>
              <SectionTitle text={strings.laneWidth.title} theme={theme} />
              <Segments
                items={LANE_WIDTHS}
                label={(width) => strings.laneWidth.names[width]}
                value={props.laneWidth.value}
                onChange={props.laneWidth.onChange}
                theme={theme}
                large
                stretch
                testID="filter-sheet-lane-width"
              />
            </>
          ) : null}
          {sortFirst ? null : sort}
          <View
            testID="filter-sheet-workspaces"
            onLayout={(event: LayoutChangeEvent) => setWorkspacesY(event.nativeEvent.layout.y)}
            style={holdTop && viewport > 0 ? { minHeight: viewport } : undefined}
          >
            <SectionTitle text={strings.workspace} theme={theme} />
            {shown.workspaceGroups.length === 0 ? <Muted text={strings.noOptions} theme={theme} /> : null}
            {shown.workspaceGroups.length > 0 ? (
              <SheetSearch
                value={query}
                onChange={setQuery}
                placeholder={strings.sheetSearch}
                clear={strings.menuSearch.clear}
                theme={theme}
                // The keyboard covers the sheet's lower half, where the workspaces sit: bring the field to the top.
                onFocus={() => {
                  setSearching(true);
                  setTimeout(() => scrollRef.current?.scrollTo({ y: workspacesY, animated: true }), 0);
                }}
                onBlur={() => setSearching(false)}
              />
            ) : null}
            {shown.workspaceGroups.length > 0 && groups.length === 0 ? <Muted text={strings.menuSearch.empty} theme={theme} /> : null}
            {groups.map((group, index) => (
              <View key={group.projectId || "missing"}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: index === 0 ? 0 : 10, paddingBottom: 6 }}>
                  {group.projectId ? <ProjectIcon location={group} size={16} hostId={board.hostId} /> : null}
                  <Text style={{ fontSize: F.sm, color: colors.foreground }}>{group.projectName}</Text>
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
          </View>
        </View>
      </ScrollView>
      <View testID="filter-sheet-footer" style={{ paddingTop: 12, paddingHorizontal: 16, flexDirection: "row", gap: 10, borderTopWidth: HAIRLINE, borderTopColor: colors.border }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setParams(clearedParams)}
          testID="filter-sheet-reset"
          style={{ height: 44, paddingHorizontal: 18, borderRadius: 22, borderWidth: HAIRLINE, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontSize: F.base, fontWeight: "500", color: colors.foreground }}>{strings.reset}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={props.onDone}
          style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontSize: F.base, fontWeight: "600", color: colors.accentForeground, fontVariant: ["tabular-nums"] }}>{strings.show(board.total)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The workspaces' search: the board's own search field, a pill with a search glyph and an X while it holds text. */
function SheetSearch(props: { value: string; onChange(text: string): void; placeholder: string; clear: string; theme: PluginTheme; onFocus(): void; onBlur(): void }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  return (
    <View
      testID="filter-sheet-search"
      style={{ minHeight: 36, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderWidth: HAIRLINE, borderColor: colors.border, borderRadius: 18 }}
    >
      <Icon name="Search" size={15} color={colors.foregroundMuted} />
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        placeholder={props.placeholder}
        placeholderTextColor={colors.foregroundMuted}
        accessibilityLabel={props.placeholder}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={{
          flex: 1,
          minWidth: 0,
          padding: 0,
          fontSize: Math.round(F.base * scale),
          color: colors.foreground,
          // The pill is the field's frame: no focus ring inside it.
          ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null),
        }}
      />
      {props.value ? (
        <Pressable accessibilityRole="button" accessibilityLabel={props.clear} testID="filter-sheet-search-clear" hitSlop={10} onPress={() => props.onChange("")}>
          <Icon name="X" size={15} color={colors.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function SectionTitle({ text, theme, first }: { text: string; theme: PluginTheme; first?: boolean }) {
  return (
    <Text style={{ paddingTop: first ? 0 : 16, paddingBottom: 8, fontSize: F.sm, fontWeight: "500", color: theme.colors.foregroundMuted }}>{text}</Text>
  );
}

function Muted({ text, theme }: { text: string; theme: PluginTheme }) {
  return <Text style={{ paddingVertical: 6, fontSize: F.sm, color: theme.colors.foregroundMuted }}>{text}</Text>;
}

function ChipWrap({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}

function Chip(props: { option: FilterOption; theme: PluginTheme; onPress(): void; leading?: ReactNode; hideCount?: boolean }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  const on = props.option.on;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={props.onPress}
      style={{
        height: taskControlHeight(32, scale),
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
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: F.base, color: on ? taskTokens(props.theme).accentText : colors.foreground }}>
        {props.option.label}
      </Text>
      {props.hideCount ? null : (
        <Text style={{ fontSize: F.sm, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{props.option.count}</Text>
      )}
    </Pressable>
  );
}

/** A filter that is on or off: the whole row is the switch, drawn as the settings page's at its end. */
function ToggleRow(props: { icon: string; label: string; hint?: string; on: boolean; theme: PluginTheme; onPress(): void; testID?: string }) {
  const colors = props.theme.colors;
  return (
    <Pressable
      accessibilityRole="switch"
      aria-checked={props.on}
      accessibilityState={{ checked: props.on }}
      onPress={props.onPress}
      testID={props.testID}
      style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 }}
    >
      <Icon name={props.icon} size={18} color={colors.foregroundMuted} />
      <View style={{ flex: 1, paddingVertical: 6 }}>
        <Text style={{ fontSize: F.base, color: colors.foreground }}>{props.label}</Text>
        {props.hint ? <Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: colors.foregroundMuted }}>{props.hint}</Text> : null}
      </View>
      <SwitchTrack value={props.on} colors={colors} />
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
      <Text style={{ flex: 1, fontSize: F.base, color: colors.foreground }}>{props.label}</Text>
      {props.hint ? <Text style={{ fontSize: F.base, color: colors.foregroundMuted }}>{props.hint}</Text> : null}
      {props.checked ? <Icon name="Check" size={18} color={colors.accent} /> : null}
      {props.drills ? <Icon name="ChevronRight" size={16} color={colors.foregroundMuted} /> : null}
    </Pressable>
  );
}
