import React, { useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { CascadeMenu, type MenuSection } from "../board/menu";
import { layoutMenu, MENU, MENU_EDGE, menuWidth } from "../board/menu-model";
import { useTasksFontScale } from "../typography";

/** A tablet's card menu, measured in the transparent native overlay's coordinates. */
export function CardMenuPopover(props: {
  point: { x: number; y: number };
  sections: MenuSection[];
  theme: PluginTheme;
  closeLabel: string;
  onClose(): void;
}) {
  const scale = useTasksFontScale();
  const stageRef = useRef<View>(null);
  const [frame, setFrame] = useState<{ left: number; top: number; width: number } | null>(null);
  // Inline submenu choices keep the whole menu usable in narrow tablet windows.
  const sections = props.sections.map((section) => ({ ...section, items: section.items
    .flatMap((item) => item.submenu ? item.submenu.flatMap((group) => group.items) : [item])
    .map((item) => ({ ...item, minHeight: 44 })) }));
  const measure = () => {
    stageRef.current?.measureInWindow((sx, sy, sw, sh) => {
      const menu = menuWidth(280, scale, sw - MENU_EDGE * 2);
      const menuHeight = Math.min(layoutMenu(sections, scale).height + 2 * StyleSheet.hairlineWidth, MENU.maxHeight, sh - MENU_EDGE * 2);
      const x = props.point.x - sx;
      const y = props.point.y - sy;
      const left = x + 6 + menu <= sw - MENU_EDGE ? x + 6 : x - menu - 6;
      const top = y + 6 + menuHeight <= sh - MENU_EDGE ? y + 6 : y - menuHeight - 6;
      setFrame({
        left: Math.max(MENU_EDGE, Math.min(left, sw - menu - MENU_EDGE)),
        top: Math.max(MENU_EDGE, Math.min(top, sh - menuHeight - MENU_EDGE)),
        width: menu,
      });
    });
  };
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onShow={measure} onRequestClose={props.onClose}>
      <View ref={stageRef} collapsable={false} testID="task-card-menu-stage" onLayout={measure} style={{ flex: 1 }}>
        <Pressable accessibilityLabel={props.closeLabel} testID="task-card-menu-backdrop" onPress={props.onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal onAccessibilityEscape={props.onClose} pointerEvents={frame ? "box-none" : "none"} testID="task-card-menu-popover"
          style={{ position: "absolute", left: frame?.left ?? 0, top: frame?.top ?? 0, width: frame?.width ?? 0, opacity: frame ? 1 : 0 }}>
          <CascadeMenu sections={sections} theme={props.theme} width={frame?.width ?? 0} top={0} align="left" onClose={props.onClose} testID="task-card-menu" />
        </View>
      </View>
    </Modal>
  );
}
