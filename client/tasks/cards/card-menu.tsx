import React, { useLayoutEffect, useRef, type ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { CascadeMenu, type MenuSection } from "../board/menu";
import { layoutMenu, MENU_EDGE } from "../board/menu-model";
import { useTasksFontScale } from "../typography";
import { openPointLayer } from "../../web";
import { getEnhancerPreferences } from "../../preferences";
import { copiedToast, toolbarLabel } from "../../i18n/toolbar-strings";
import { COPY_FAILED_MESSAGE } from "../../ui/copy-controller";
import type { TaskCard } from "../model";
import type { cardStrings } from "./strings";

export const CARD_MENU_WIDTH = 240;

export interface CardMenuActions {
  open?(): void;
  /** Copies `text`; `label` is the row's English name, which the toast echoes. */
  copy(text: string, label: string): void;
  /** Present only while the card can be stopped. */
  stop?(withChildren: boolean): void;
  /** A parent's running and waiting subtasks: Stop gets "only this / with subtasks". */
  children: number;
  /** "Stop with subtasks"'s mark, as the card's own stop menu draws it, in the danger colour. */
  stopAllLeading?: ReactNode;
  read?(): void;
  unarchive?(): void;
}

/**
 * A card's right-click menu: open its tab; copy its session ID, title,
 * workspace and project; then whatever the card can do right now (Stop,
 * Mark read, Unarchive). A copy whose value the card lacks is left out, and
 * so is an empty group.
 */
export function cardMenuSections(card: TaskCard, strings: ReturnType<typeof cardStrings>, actions: CardMenuActions): MenuSection[] {
  const location = card.location;
  const copies: [key: string, label: string, toast: string, icon: string, text: string | null][] = [
    ["copy-id", strings.copySessionId, "Copy session ID", "Hash", card.id],
    ["copy-title", strings.copyTitle, "Copy title", "Type", card.title.trim() || null],
    ["copy-workspace", strings.copyWorkspace, "Copy workspace name", "Folder", location.workspaceTitle ?? location.workspaceName],
    ["copy-project", strings.copyProject, "Copy project name", "Box", location.projectName],
  ];
  const stop = actions.stop;
  const sections: MenuSection[] = [
    { key: "open", items: actions.open ? [{ key: "open", label: strings.openTab, icon: "AppWindow", onSelect: actions.open }] : [] },
    {
      key: "copy",
      items: copies
        .filter((entry): entry is [string, string, string, string, string] => !!entry[4])
        .map(([key, label, toast, icon, text]) => ({ key, label, icon, onSelect: () => actions.copy(text, toast) })),
    },
    {
      key: "actions",
      items: [
        ...(stop
          ? [
              actions.children > 0
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
                : { key: "stop", label: strings.stop, icon: "Power", danger: true, onSelect: () => stop(false) },
            ]
          : []),
        ...(actions.read ? [{ key: "read", label: strings.markRead, icon: "CheckCheck", onSelect: actions.read }] : []),
        ...(actions.unarchive ? [{ key: "unarchive", label: strings.details.unarchive, icon: "ArchiveRestore", onSelect: actions.unarchive }] : []),
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
 * The menu at the pointer, in the top layer (web only: native has no right
 * click). It opens down and to the right of the point, and flips to the
 * side that has room near the window's right or bottom edge.
 */
export function CardContextMenu(props: {
  point: { x: number; y: number };
  card: TaskCard;
  strings: ReturnType<typeof cardStrings>;
  actions: Omit<CardMenuActions, "copy">;
  theme: PluginTheme;
  onClose(): void;
}) {
  const { point } = props;
  const copy = useMenuCopy();
  const sections = cardMenuSections(props.card, props.strings, { ...props.actions, copy });
  const scale = useTasksFontScale();
  const window = useWindowDimensions();
  const anchorRef = useRef<View>(null);
  useLayoutEffect(() => openPointLayer(anchorRef.current, point), [point.x, point.y]);
  const height = layoutMenu(sections, scale).height + 2 * StyleSheet.hairlineWidth;
  const right = point.x + CARD_MENU_WIDTH + MENU_EDGE > window.width && point.x - CARD_MENU_WIDTH >= MENU_EDGE;
  const up = point.y + height + MENU_EDGE > window.height && point.y - height >= MENU_EDGE;
  return (
    <View ref={anchorRef} collapsable={false} testID="task-card-menu-anchor">
      <CascadeMenu
        sections={sections}
        theme={props.theme}
        width={CARD_MENU_WIDTH}
        submenuWidth={STOP_SUBMENU_WIDTH}
        top={up ? -height : 0}
        align={right ? "right" : "left"}
        onClose={props.onClose}
        testID="task-card-menu"
      />
    </View>
  );
}

const STOP_SUBMENU_WIDTH = 220;
