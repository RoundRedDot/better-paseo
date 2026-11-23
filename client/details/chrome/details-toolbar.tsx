/**
 * The details panel's toolbar (https://github.com/RoundRedDot/better-paseo/blob/f2ab453297c4ccb88a08e2129af0cb3528c4e628/docs/prototypes/block-details-sheet.md,
 * "工具栏"; tables 5.2 and 5.8): line wrap and the content's own controls
 * (pager, render / raw, a question's raw toggle) at the left; its copy
 * buttons, "⋯" for those that do not fit, and full screen at the right. 44
 * tall on touch, 36 with a pointer. Only presses: it does not drag the panel.
 *
 * The title the hover bar carries in its middle is not repeated here; the
 * header above names the block.
 */
import { useState, type ReactNode } from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import type { PluginIcon } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ExtendedThemeTokens } from "../../components/theme-tokens";
import { space } from "../../components/theme-tokens";
import { CopyOverflowContext, SpokenLabelsContext, ToolbarButton, ToolbarItem, ToolbarMetricsContext, TooltipAlignContext } from "../../ui/toolbar-button";
import { useEnhancerPreferences } from "../../preferences";
import { DETAILS_FONT_SIZE_MIN, DETAILS_FONT_SIZE_MAX } from "../../../shared/preferences-settings";
import type { DetailsShellValue } from "../contracts";
import { DETAILS_BREAKPOINTS } from "../layout-model";
import { HEADER_BUTTONS } from "./details-header";
import { copySlots, CopyOverflowMenu, useCopyOverflow } from "./copy-overflow";

export const DETAILS_TOOLBAR = { touch: 44, pointer: 36 } as const;
const PADDING = space.md;
const GAP = space.xs;
/** Between the left group and the copies. */
const SPLIT = space.sm;
const TEXT_SMALLER: PluginIcon = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19 8 5l5 14M5 14h6"/><path d="M16 9h5"/></svg>',
};
const TEXT_LARGER: PluginIcon = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19 8 5l5 14M5 14h6"/><path d="M16 9h5m-2.5-2.5v5"/></svg>',
};

export interface DetailsWrap {
  on: boolean;
  disabled: boolean;
  toggle(): void;
}

export function DetailsToolbar({ shell, tokens, wrap, left, children }: {
  shell: DetailsShellValue;
  tokens: ExtendedThemeTokens;
  /** The line-wrap toggle; absent for content without lines (a picture). */
  wrap?: DetailsWrap;
  /** The content's controls after the wrap toggle. */
  left?: ReactNode;
  /** The content's copy buttons. */
  children?: ReactNode;
}) {
  const metrics = HEADER_BUTTONS[shell.pointer ? "pointer" : "touch"];
  const [width, setWidth] = useState<number | null>(null);
  const [leftWidth, setLeftWidth] = useState(0);
  const { detailsFontSize } = useEnhancerPreferences();
  const window = useWindowDimensions();
  const fullscreen = Math.min(window.width, window.height) < DETAILS_BREAKPOINTS.drawerEnter
    ? null : fullscreenButton(shell);
  const free = width === null ? null
    : width - 2 * PADDING - leftWidth - SPLIT - (fullscreen ? metrics.button + GAP : 0);
  const slots = copySlots(free, metrics.button, GAP);
  const { overflow, folded } = useCopyOverflow(slots, tokens.success);
  return (
    <SpokenLabelsContext.Provider value><ToolbarMetricsContext.Provider value={metrics}>
      <View
        testID="details-toolbar"
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        style={[styles.toolbar, { minHeight: DETAILS_TOOLBAR[shell.pointer ? "pointer" : "touch"], borderBottomColor: tokens.v2.borderSubtle }]}
      >
        <View testID="details-toolbar-start" onLayout={(event: LayoutChangeEvent) => setLeftWidth(event.nativeEvent.layout.width)}
          style={styles.start}>
          {/* At the panel's left edge: its name opens rightwards. */}
          <TooltipAlignContext.Provider value="start">
            {wrap ? (
              <ToolbarButton
                icon={wrap.on ? "WrapText" : "AlignLeft"}
                label={wrap.on ? "Do not wrap lines" : "Wrap lines"}
                checked={wrap.on}
                disabled={wrap.disabled}
                onPress={wrap.toggle}
                tokens={tokens}
              />
            ) : null}
            {Platform.OS === "web" && shell.pointer && shell.zoom ? <>
              <ToolbarItem label="Decrease text size" disabled={detailsFontSize <= DETAILS_FONT_SIZE_MIN}
                onPress={() => shell.zoom!.commit(detailsFontSize - 1)} tokens={tokens} iconSize={metrics.icon}>
                <Icon icon={TEXT_SMALLER} size={metrics.icon} color={tokens.foregroundMuted} />
              </ToolbarItem>
              <ToolbarItem label="Reset zoom" onPress={() => shell.zoom!.commit(shell.zoom!.base)} tokens={tokens}>
                <Text selectable={false} style={{ color: tokens.foregroundMuted, fontFamily: tokens.fontUi, fontSize: 12 }}>{detailsFontSize}</Text>
              </ToolbarItem>
              <ToolbarItem label="Increase text size" disabled={detailsFontSize >= DETAILS_FONT_SIZE_MAX}
                onPress={() => shell.zoom!.commit(detailsFontSize + 1)} tokens={tokens} iconSize={metrics.icon}>
                <Icon icon={TEXT_LARGER} size={metrics.icon} color={tokens.foregroundMuted} />
              </ToolbarItem>
            </> : null}
            {left}
          </TooltipAlignContext.Provider>
        </View>
        <View testID="details-toolbar-end" style={styles.end}>
          {/* The group ends at the panel's right edge: names open leftwards. */}
          <TooltipAlignContext.Provider value="end">
            <CopyOverflowContext.Provider value={overflow}>{children}</CopyOverflowContext.Provider>
            <CopyOverflowMenu items={folded} tokens={tokens} />
            {fullscreen ? (
              <ToolbarButton icon={fullscreen.icon} label={fullscreen.label} checked={shell.fullscreen}
                onPress={fullscreen.onPress} tokens={tokens} />
            ) : null}
          </TooltipAlignContext.Provider>
        </View>
      </View>
    </ToolbarMetricsContext.Provider></SpokenLabelsContext.Provider>
  );
}

/**
 * Outside phone layouts, the floating panel grows to full height and the
 * side panel widens. The drawer uses its handle instead.
 */
function fullscreenButton(shell: DetailsShellValue): { icon: string; label: string; onPress(): void } | null {
  const toggle = shell.toggleFullscreen;
  if (!toggle || shell.form === "drawer") return null;
  if (shell.form === "side") {
    return shell.fullscreen
      ? { icon: "ChevronsRight", label: "Restore panel width", onPress: toggle }
      : { icon: "ChevronsLeft", label: "Widen panel", onPress: toggle };
  }
  return shell.fullscreen
    ? { icon: "Minimize2", label: "Exit full screen", onPress: toggle }
    : { icon: "Maximize2", label: "Full screen", onPress: toggle };
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPLIT,
    paddingHorizontal: PADDING,
    borderBottomWidth: 1,
    flexShrink: 0,
    // Raised over the body, so a button's name and the "More" menu can hang down across it.
    zIndex: 1,
  },
  start: { flexDirection: "row", alignItems: "center", gap: GAP, flexShrink: 0 },
  end: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: GAP },
});
