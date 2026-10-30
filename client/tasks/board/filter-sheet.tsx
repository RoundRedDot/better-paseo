import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, Pressable, View, type LayoutChangeEvent, type ScrollView as NativeScrollView } from "react-native";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { LANE_WIDTHS, type LaneWidth } from "../../../shared/tasks-settings";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, useTasksFontScale, taskControlHeight } from "../typography";
import { BrandMark, ProjectIcon, TagMark, taskTokens } from "../cards";
import { Segments, WindowSegments } from "./board-parts";
import { HAIRLINE } from "./board-style";
import { SwitchTrack } from "../../ui/switch-track";
import { useSwitchSpace } from "../../ui/use-switch-space";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { easing } from "../../ui/tokens/motion";
import { clearedParams, emptyGroupsIcon, searchWorkspaceGroups, shownFilterOptions, type FilterOption, type FilterOptions } from "./filter-options";
import { iconlessProjects, useRequestProjectIcons } from "./project-icons";
import { detailScrollProps } from "../cards/detail-scrollbar";
import { useLaneScrollbar } from "./lane-scrollbar";
import { resolveBoardParams, toggleItem } from "./params";
import { SORT_GROUPS, SORT_ICONS, sortDirectionIcon, sortDirections } from "./board-menus";
import { sameSort, type BoardSort, type SortKey } from "./sort";
import { sortOrderLabel } from "./strings";
import type { BoardController } from "./use-board";
import { tasksSettingsOpener } from "./enabled";

/**
 * The phone's filters (prototype 04 sheet), drawn inside the host's bottom
 * sheet as a bounded body (`Modal.Content scrollable={false}`): the options
 * scroll, Reset and "Show N tasks" stay pinned under them. The short
 * filters follow the desktop order; workspaces sit under a search field. With `board.showEmptyGroups` off, only the options with a
 * card on the board, including done and archived, or that are picked, are listed.
 */
export function FilterSheetBody(props: {
  board: BoardController;
  theme: PluginTheme;
  options: FilterOptions;
  onDone(): void;
  /** Phones keep the subtasks switch in their toolbar. */
  hideSubtasksToggle?: boolean;
  /** Use pill-shaped agent and label options on phones. */
  phone?: boolean;
  /** Phones and tablets keep the empty-groups switch here instead of the toolbar. */
  showEmptyGroupsToggle?: boolean;
  /** Tablet toolbars keep the archived-lane control in this panel. */
  showArchivedToggle?: boolean;
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
  useLaneScrollbar(theme);
  const sortFirst = props.focus === "sort";
  const colors = theme.colors;
  const strings = board.strings;
  const openSettings = tasksSettingsOpener();
  const { setParams, defaults } = board;
  const resolved = resolveBoardParams(board.params, defaults);
  const shown = shownFilterOptions(options, board.showEmptyGroups);
  useRequestProjectIcons(iconlessProjects(shown.workspaceGroups), board.tasks.requestProjectIcon);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const scrollRef = useRef<NativeScrollView>(null);
  // Where the workspaces start in the scroll: read only when the search field
  // takes focus. A ref, not state: it changes on every frame while a group
  // folds, and a render per frame of the whole sheet drops the fold's frames.
  const workspacesY = useRef(0);
  // The scroller's height.
  const [viewport, setViewport] = useState(0);
  const groups = searchWorkspaceGroups(shown.workspaceGroups, query);
  // While searching, the workspaces fill the scroller at least, so their field
  // can stay at its top above the keyboard however few rows match.
  const holdTop = searching || query.trim() !== "";
  const range = (
    <CollapsibleGroup title={strings.doneRange} icon="Clock" theme={theme} testID="filter-sheet-range" initiallyOpen={Boolean(props.laneWidth)}>
      <WindowSegments value={resolved.doneWindow} onChange={(doneWindow) => setParams((p) => ({ ...p, doneWindow }))} theme={theme} strings={strings} large stretch />
    </CollapsibleGroup>
  );
  const sort = (
    <View testID="filter-sheet-sort">
      <CollapsibleGroup title={strings.sort} icon="ArrowDownWideNarrow" theme={theme} testID="filter-sheet-sort-group" first={sortFirst} initiallyOpen={sortFirst}>
        <SortDrillDown board={board} theme={theme} />
      </CollapsibleGroup>
    </View>
  );
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView
        ref={scrollRef}
        {...detailScrollProps("inset")}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={[1, 3]}
        onLayout={(event: LayoutChangeEvent) => setViewport(event.nativeEvent.layout.height)}
        testID="filter-sheet-scroll"
      >
        <View onLayout={(event: LayoutChangeEvent) => (workspacesY.current = event.nativeEvent.layout.height)} style={{ paddingHorizontal: 16, paddingTop: sortFirst ? 0 : 4 }}>
          {sortFirst ? <View style={{ paddingBottom: 8 }}>{sort}</View> : null}
          {props.hideSubtasksToggle ? null : (
            <ToggleRow
              icon={resolved.filters.hideSubtasks ? "List" : "Network"}
              testID="filter-sheet-subtasks"
              label={strings.showSubtasks}
              hint={strings.showSubtasksHint}
              on={!resolved.filters.hideSubtasks}
              theme={theme}
              onPress={() => setParams((p) => ({ ...p, hideSubtasks: !(p.hideSubtasks ?? defaults.hideSubtasks) }))}
            />
          )}
          {props.showArchivedToggle ? (
            <ToggleRow
              icon="Archive"
              label={strings.archivedLane.row}
              hint={strings.archivedLane.hint}
              on={board.showArchived}
              theme={theme}
              onPress={() => board.setShowArchived(!board.showArchived)}
              testID="filter-sheet-archived"
            />
          ) : null}
          {props.showEmptyGroupsToggle ? (
            <ToggleRow
              icon={emptyGroupsIcon(board.showEmptyGroups)}
              label={strings.emptyGroups.sheetLabel(board.showEmptyGroups)}
              hint={strings.emptyGroups.hint(board.showEmptyGroups)}
              on={board.showEmptyGroups}
              theme={theme}
              onPress={() => board.setShowEmptyGroups(!board.showEmptyGroups)}
              testID="filter-sheet-empty-groups"
            />
          ) : null}
          {props.laneWidth ? (
            <>
              <SectionTitle text={strings.laneWidth.title} icon="Columns3" theme={theme} />
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
          {props.laneWidth ? range : null}
          <CollapsibleGroup title={strings.agent} icon="Bot" theme={theme} testID="filter-sheet-agents">
            {shown.agents.length === 0 ? <Muted text={strings.noOptions} theme={theme} /> : null}
            <ChipWrap>
              {shown.agents.map((agent) => (
                <Chip
                  key={agent.id}
                  option={agent}
                  theme={theme}
                  pill={props.phone}
                  leading={<BrandMark provider={agent.id} size={16} tokens={taskTokens(theme)} />}
                  hideCount
                  onPress={() => setParams((p) => ({ ...p, providers: toggleItem(p.providers, agent.id) }))}
                />
              ))}
            </ChipWrap>
          </CollapsibleGroup>
        </View>
        <View testID="filter-sheet-workspace-header" style={{ paddingHorizontal: 16, backgroundColor: colors.surface0 }}>
          <CollapsibleTitle text={strings.workspace} icon="FolderGit2" theme={theme} open={workspacesOpen} onPress={() => { setSearching(false); setWorkspacesOpen((value) => !value); }} testID="filter-sheet-workspaces-toggle" />
          {workspacesOpen && shown.workspaceGroups.length === 0 ? <Muted text={strings.noOptions} theme={theme} /> : null}
          {workspacesOpen && shown.workspaceGroups.length > 0 ? (
            <SheetSearch
              value={query}
              onChange={setQuery}
              placeholder={strings.sheetSearch}
              clear={strings.menuSearch.clear}
              theme={theme}
              // The keyboard covers the sheet's lower half, where the workspaces sit: bring the field to the top.
              onFocus={() => {
                setSearching(true);
                setTimeout(() => scrollRef.current?.scrollTo({ y: workspacesY.current, animated: true }), 0);
              }}
              onBlur={() => setSearching(false)}
            />
          ) : null}
        </View>
        <View testID="filter-sheet-workspaces" style={{ paddingHorizontal: 16, paddingBottom: workspacesOpen ? 8 : 0, ...(workspacesOpen && holdTop && viewport > 0 ? { minHeight: viewport } : null) }}>
          {workspacesOpen && shown.workspaceGroups.length > 0 && groups.length === 0 ? <Muted text={strings.menuSearch.empty} theme={theme} /> : null}
          {workspacesOpen ? groups.map((group, index) => (
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
          )) : null}
        </View>
        {/* End the workspace sticky header before the following groups. */}
        <View />
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <CollapsibleGroup title={strings.labels} icon="Tag" theme={theme} testID="filter-sheet-labels">
            {shown.labels.length === 0 ? <Muted text={strings.noOptions} theme={theme} /> : null}
            <ChipWrap>
              {shown.labels.map((label) => (
                <Chip
                  key={label.id}
                  option={label}
                  theme={theme}
                  pill={props.phone}
                  leading={<TagMark size={14} color={label.color ?? colors.foregroundMuted} hole={label.on ? taskTokens(theme).accentSoft : colors.surface0} />}
                  onPress={() => setParams((p) => ({ ...p, labels: toggleItem(p.labels, label.id) }))}
                />
              ))}
            </ChipWrap>
          </CollapsibleGroup>
          {props.laneWidth ? null : range}
          {sortFirst ? null : sort}
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
        {openSettings ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.openSettings}
            onPress={() => { props.onDone(); openSettings(); }}
            testID="filter-sheet-settings"
            style={{ height: 44, paddingHorizontal: 18, borderRadius: 22, borderWidth: HAIRLINE, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ fontSize: F.base, fontWeight: "500", color: colors.foreground }}>{strings.settings}</Text>
          </Pressable>
        ) : null}
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

function SectionTitle({ text, icon, theme }: { text: string; icon: string; theme: PluginTheme }) {
  return (
    <View style={{ paddingTop: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Icon name={icon} size={16} color={theme.colors.foregroundMuted} />
      <Text style={{ fontSize: F.sm, fontWeight: "500", color: theme.colors.foregroundMuted }}>{text}</Text>
    </View>
  );
}

/**
 * A titled group that folds. It holds its own open state, so a fold renders
 * the group alone: the sheet's other rows, often dozens of workspaces, stay
 * as they are.
 */
function CollapsibleGroup({ title, icon, theme, testID, first, initiallyOpen = false, children }: { title: string; icon: string; theme: PluginTheme; testID: string; first?: boolean; initiallyOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <CollapsibleTitle text={title} icon={icon} theme={theme} open={open} onPress={() => setOpen((value) => !value)} testID={`${testID}-toggle`} first={first} />
      <CollapsibleContent open={open} testID={`${testID}-content`}>
        {children}
      </CollapsibleContent>
    </>
  );
}

function CollapsibleContent({ open, children, testID }: { open: boolean; children: ReactNode; testID: string }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (reduced) {
      progress.setValue(open ? 1 : 0);
      return;
    }
    const animation = Animated.timing(progress, { toValue: open ? 1 : 0, duration: open ? 180 : 140, easing: easing.out, useNativeDriver: false, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [open, progress, reduced]);
  return (
    <Animated.View
      testID={testID}
      pointerEvents={open ? "auto" : "none"}
      accessibilityElementsHidden={!open}
      aria-hidden={!open || undefined}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      style={{ overflow: "hidden", height: height === null ? (open ? undefined : 0) : progress.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) }}
    >
      <View onLayout={(event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height)} style={height === null ? undefined : { position: "absolute", top: 0, left: 0, right: 0 }}>
        {children}
      </View>
    </Animated.View>
  );
}

function CollapsibleTitle(props: { text: string; icon: string; theme: PluginTheme; open: boolean; onPress(): void; testID: string; first?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={props.text} accessibilityState={{ expanded: props.open }} onPress={props.onPress} testID={props.testID} style={{ paddingTop: props.first ? 0 : 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Icon name={props.icon} size={16} color={props.theme.colors.foregroundMuted} />
      <Text style={{ flex: 1, fontSize: F.sm, fontWeight: "500", color: props.theme.colors.foregroundMuted }}>{props.text}</Text>
      <Icon name={props.open ? "ChevronUp" : "ChevronDown"} size={16} color={props.theme.colors.foregroundMuted} />
    </Pressable>
  );
}

function Muted({ text, theme }: { text: string; theme: PluginTheme }) {
  return <Text style={{ paddingVertical: 6, fontSize: F.sm, color: theme.colors.foregroundMuted }}>{text}</Text>;
}

function ChipWrap({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}

function Chip(props: { option: FilterOption; theme: PluginTheme; onPress(): void; leading?: ReactNode; hideCount?: boolean; pill?: boolean }) {
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
        borderRadius: props.pill ? taskControlHeight(32, scale) / 2 : 4,
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
  const spaceKeys = useSwitchSpace(props.onPress);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={props.label}
      aria-checked={props.on}
      accessibilityState={{ checked: props.on }}
      onPress={props.onPress}
      {...spaceKeys}
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
