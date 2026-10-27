import React, { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Icon, Modal, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { CascadeMenu, type MenuSection } from "../board/menu";
import { layoutMenu, MENU_EDGE } from "../board/menu-model";
import { TaskText as Text, TasksTypography, HOST_FONT as F, HOST_LINE, useTasksFontScale, taskControlHeight } from "../typography";
import { openPointLayer } from "../../web";
import { getEnhancerPreferences } from "../../preferences";
import { copiedToast, toolbarLabel } from "../../i18n/toolbar-strings";
import { COPY_FAILED_MESSAGE } from "../../ui/copy-controller";
import type { TaskCard } from "../model";
import type { CardFilterKind, CardFilterState } from "../board/filter-options";
import type { cardStrings } from "./strings";
import { TaskRenameDialog } from "./rename-dialog";

export const CARD_MENU_WIDTH = 240;

export interface CardMenuActions {
  open?(): void;
  rename?(): void;
  autoTitle?(): void;
  autoTitlePending?: boolean;
  autoTitleLeading?: ReactNode;
  /** A subtask's card: its parent task's tab, unless the parent is archived. */
  openParent?(): void;
  /** A subtask's card: scrolls the board to its parent's card, as the parent link does. */
  revealParent?(): void;
  /** Copies `text`; `label` is the row's English name, which the toast echoes. */
  copy(text: string, label: string): void;
  /** The board's Filter rows: which apply to this card and are on, and choosing one. */
  filters?: { state: CardFilterState; select(by: CardFilterKind): void };
  /** Present only while the card can be stopped. */
  stop?(withChildren: boolean): void;
  /** A parent's running and waiting subtasks: Stop gets "only this / with subtasks". */
  children: number;
  childrenOnly?: boolean;
  /** "Stop with subtasks"'s mark, as the card's own stop menu draws it, in the danger colour. */
  stopAllLeading?: ReactNode;
  read?(): void;
  unarchive?(): void;
  /** A done task: Archive, as Paseo's own. */
  archive?(): void;
}

/**
 * A card's right-click menu: open its tab (a subtask's also opens its
 * parent's, or shows the parent's card); copy its session ID, title,
 * workspace and project; filter the board to its agent, workspace or
 * project; then whatever the card can do right now (Stop, Mark read,
 * Unarchive, Archive). A copy whose value the card lacks is left out, and
 * so is an empty group.
 */
export function cardMenuSections(card: TaskCard, strings: ReturnType<typeof cardStrings>, actions: CardMenuActions): MenuSection[] {
  const location = card.location;
  const copies: [key: string, label: string, toast: string, icon: string, text: string | null][] = [
    // A provider subagent's id is its tool call's, not a session's.
    ["copy-id", strings.copySessionId, "Copy session ID", "Hash", card.subagent ? null : card.id],
    ["copy-title", strings.copyTitle, "Copy title", "Type", card.title.trim() || null],
    ["copy-workspace", strings.copyWorkspace, "Copy workspace name", "Folder", location.workspaceTitle ?? location.workspaceName],
    ["copy-project", strings.copyProject, "Copy project name", "Box", location.projectName],
  ];
  const stop = actions.stop;
  const filters = actions.filters;
  // Each row's second line names the value it filters to.
  const filterRows: [CardFilterKind, string, string, string | null][] = [
    ["agent", strings.filterAgent, "Bot", card.providerLabel || card.provider],
    ["project", strings.filterProject, "Box", location.projectName],
    ["workspace", strings.filterWorkspace, "Folder", location.workspaceTitle ?? location.workspaceName ?? location.branch],
  ];
  const filterItems = filters
    ? filterRows.flatMap(([by, label, icon, detail]) => {
        const on = filters.state[by];
        return on === null ? [] : [{ key: `filter-${by}`, label, icon, detail: detail ?? undefined, checked: on, onSelect: () => filters.select(by) }];
      })
    : [];
  const sections: MenuSection[] = [
    {
      key: "open",
      items: [
        ...(actions.open ? [{ key: "open", label: strings.openTab, icon: "ArrowUpRight", onSelect: actions.open }] : []),
        ...(!card.subagent && actions.rename ? [{ key: "rename", label: strings.renameTitle, icon: "Pencil", keepOpen: true, onSelect: actions.rename }] : []),
        ...(!card.subagent && card.lane !== "archived" && actions.autoTitle ? [{ key: "auto-title", label: strings.autoTitle, icon: "Sparkles", leading: actions.autoTitleLeading, disabled: actions.autoTitlePending, onSelect: actions.autoTitle }] : []),
        ...(actions.openParent ? [{ key: "open-parent", label: strings.openParent, icon: "CornerLeftUp", onSelect: actions.openParent }] : []),
        ...(actions.revealParent ? [{ key: "reveal-parent", label: strings.revealParentCard, icon: "LocateFixed", onSelect: actions.revealParent }] : []),
      ],
    },
    {
      key: "copy",
      items: copies
        .filter((entry): entry is [string, string, string, string, string] => !!entry[4])
        .map(([key, label, toast, icon, text]) => ({ key, label, icon, onSelect: () => actions.copy(text, toast) })),
    },
    {
      key: "filter",
      items: filterItems.length
        ? [{ key: "filter", label: strings.filter, icon: "ListFilter", submenu: [{ key: "filter", items: filterItems }] }]
        : [],
    },
    {
      key: "actions",
      items: [
        ...(stop
          ? [
              !actions.childrenOnly && actions.children > 0
                ? {
                    key: "stop",
                    label: strings.stop,
                    icon: "Power",
                    danger: true,
                    submenu: [
                      {
                        key: "stop",
                        items: [
                          { key: "stop-only", label: strings.stopOnlyThis, icon: "Power", danger: true, onSelect: () => stop(false) },
                          { key: "stop-all", label: strings.stopWithChildren, icon: "ListTree", leading: actions.stopAllLeading, hint: String(actions.children), danger: true, onSelect: () => stop(true) },
                        ],
                      },
                    ],
                  }
                : { key: "stop", label: actions.childrenOnly ? strings.stopChildren : strings.stop, icon: "Power", danger: true, onSelect: () => stop(actions.childrenOnly === true) },
            ]
          : []),
        ...(actions.read ? [{ key: "read", label: strings.markRead, icon: "CheckCheck", onSelect: actions.read }] : []),
        ...(actions.unarchive ? [{ key: "unarchive", label: strings.details.unarchive, icon: "ArchiveRestore", onSelect: actions.unarchive }] : []),
        ...(actions.archive ? [{ key: "archive", label: strings.details.archive, icon: "Archive", onSelect: actions.archive }] : []),
      ],
    },
  ];
  return sections.filter((section) => section.items.length > 0);
}

/**
 * Copy from a menu that closes as the row is chosen: straight through the
 * SDK, so the toast still comes after the menu has gone (`useCopy` drops a
 * copy whose owner unmounted). The toast speaks the settings page's
 * language, as every other copy does.
 */
export function useMenuCopy(): (text: string, label: string) => void {
  const toast = useToast();
  const latest = useRef(toast);
  latest.current = toast;
  return useRef((text: string, label: string) => {
    const language = getEnhancerPreferences().language;
    copyText(text).then(
      () => latest.current.show(copiedToast(label, language)),
      () => latest.current.error(toolbarLabel(COPY_FAILED_MESSAGE, language)),
    );
  }).current;
}

/**
 * Right click opens at the pointer in the web top layer. A long press has
 * no pointer anchor and uses the host's modal, with submenu actions inline
 * so all choices fit a phone's width.
 */
export function CardContextMenu(props: {
  point: { x: number; y: number } | null;
  card: TaskCard;
  strings: ReturnType<typeof cardStrings>;
  actions: Omit<CardMenuActions, "copy">;
  theme: PluginTheme;
  onClose(): void;
}) {
  const { point } = props;
  const copy = useMenuCopy();
  const [editing, setEditing] = useState(false);
  const sections = cardMenuSections(props.card, props.strings, { ...props.actions, copy, rename: () => setEditing(true) });
  const scale = useTasksFontScale();
  const window = useWindowDimensions();
  const anchorRef = useRef<View>(null);
  useLayoutEffect(() => point && !editing ? openPointLayer(anchorRef.current, point) : undefined, [point?.x, point?.y, editing]);
  if (editing) {
    return <TaskRenameDialog agentId={props.card.id} title={props.card.title} strings={props.strings} theme={props.theme} onClose={props.onClose} />;
  }
  if (!point) {
    const colors = props.theme.colors;
    return (
      <Modal title={props.card.title} open onOpenChange={(open) => !open && props.onClose()}>
        <Modal.Content contentContainerStyle={{ padding: 8, gap: 0 }}>
          <TasksTypography theme={props.theme}>
            <View testID="task-card-menu">
              {sections.map((section, index) => (
                <View key={section.key} style={index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 6, paddingTop: 6 } : undefined}>
                  {section.items.flatMap((item) => item.submenu ? item.submenu.flatMap((group) => group.items) : [item]).map((item) => {
                    const color = item.danger ? colors.statusDanger : colors.foreground;
                    return (
                      <Pressable
                        key={item.key}
                        accessibilityRole="menuitem"
                        accessibilityLabel={item.label}
                        accessibilityState={{ disabled: item.disabled }}
                        disabled={item.disabled}
                        onPress={() => {
                          item.onSelect?.();
                          if (!item.keepOpen) props.onClose();
                        }}
                        style={{ minHeight: taskControlHeight(44, scale), paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 }}
                      >
                        {(typeof item.leading === "function" ? item.leading(color) : item.leading) ?? (item.icon ? <Icon name={item.icon} size={18} color={color} /> : null)}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ fontSize: F.base, lineHeight: HOST_LINE.base, color }}>{item.label}</Text>
                          {item.detail ? <Text numberOfLines={1} style={{ fontSize: F.sm, color: colors.foregroundMuted }}>{item.detail}</Text> : null}
                        </View>
                        {item.hint ? <Text style={{ fontSize: F.sm, color: colors.foregroundMuted }}>{item.hint}</Text> : null}
                        {item.checked ? <Icon name="Check" size={18} color={colors.accent} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </TasksTypography>
        </Modal.Content>
      </Modal>
    );
  }
  const height = layoutMenu(sections, scale).height + 2 * StyleSheet.hairlineWidth;
  const right = point.x + CARD_MENU_WIDTH + MENU_EDGE > window.width && point.x - CARD_MENU_WIDTH >= MENU_EDGE;
  const up = point.y + height + MENU_EDGE > window.height && point.y - height >= MENU_EDGE;
  return (
    <View ref={anchorRef} collapsable={false} testID="task-card-menu-anchor">
      <CascadeMenu
        sections={sections}
        theme={props.theme}
        width={CARD_MENU_WIDTH}
        submenuWidth={SUBMENU_WIDTH}
        top={up ? -height : 0}
        align={right ? "right" : "left"}
        onClose={props.onClose}
        testID="task-card-menu"
      />
    </View>
  );
}

/** Stop's and Filter's submenus. */
const SUBMENU_WIDTH = 220;
