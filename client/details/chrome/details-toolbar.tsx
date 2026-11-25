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
import { SHEET_TOOLBAR_INSET } from "../../ui/tokens/sheet";
import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
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
import type { DetailsZoomControls, ZoomControls } from "../shell/zoom-controls";

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

/** One button for the text size where − / size / + leave no room for the copies. */
const TEXT_SIZE: PluginIcon = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2 19 7 5l5 14M4 14h6"/><path d="m14 19 3.5-9 3.5 9M15.2 16h4.6"/></svg>',
};

/**
 * How the phone toolbar shows the text size: − / size / + as on the desktop,
 * or folded into one button (it raises the body's size badge) when the three
 * would leave the copies no room for even their "⋯".
 */
export function zoomGroupMode({ width, others, button, gap, fullscreen, insets, startGap }: {
  /** The toolbar's width; null before its first layout. */
  width: number | null;
  /** The left group's width without the text size controls. */
  others: number;
  button: number;
  gap: number;
  /** The full screen button's width and gap, or 0. */
  fullscreen: number;
  insets: number;
  startGap: number;
}): "full" | "folded" {
  if (width === null) return "full";
  const full = 3 * button + 2 * gap;
  const free = width - insets - others - startGap - full - SPLIT - fullscreen;
  return free >= button ? "full" : "folded";
}

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
  const desktopSide = Platform.OS === "web" && shell.pointer && shell.form === "side";
  const [width, setWidth] = useState<number | null>(null);
  const [leftWidth, setLeftWidth] = useState(0);
  const [zoomWidth, setZoomWidth] = useState(0);
  const { detailsFontSize } = useEnhancerPreferences();
  const window = useWindowDimensions();
  const fullscreen = Math.min(window.width, window.height) < DETAILS_BREAKPOINTS.drawerEnter
    ? null : fullscreenButton(shell);
  const fullscreenWidth = fullscreen ? metrics.button + GAP : 0;
  const drawer = shell.form === "drawer";
  const inset = drawer ? SHEET_TOOLBAR_INSET : PADDING;
  const startGap = drawer ? 0 : GAP;
  const insets = 2 * inset;
  const free = width === null ? null
    : width - insets - leftWidth - SPLIT - fullscreenWidth;
  // A phone body publishes its pinch's controls; the desktop commits sizes directly.
  const native = useNativeZoomControls(Platform.OS === "web" ? undefined : shell.zoomControls);
  const zoomMode = zoomGroupMode({ width, others: Math.max(0, leftWidth - (zoomWidth ? zoomWidth + startGap : 0)),
    button: metrics.button, gap: GAP, fullscreen: fullscreenWidth, insets, startGap });
  const slots = copySlots(free, metrics.button, GAP);
  const { overflow, folded } = useCopyOverflow(slots, tokens.success);
  return (
    <SpokenLabelsContext.Provider value><ToolbarMetricsContext.Provider value={metrics}>
      <View
        testID="details-toolbar"
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        style={[styles.toolbar, { minHeight: DETAILS_TOOLBAR[shell.pointer ? "pointer" : "touch"],
          paddingHorizontal: inset, borderBottomColor: desktopSide ? tokens.border : tokens.v2.borderSubtle }]}
      >
        <View testID="details-toolbar-start" onLayout={(event: LayoutChangeEvent) => setLeftWidth(event.nativeEvent.layout.width)}
          style={[styles.start, { gap: startGap }]}>
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
            {native ? (
              <View testID="details-toolbar-zoom" style={styles.zoom}
                onLayout={(event: LayoutChangeEvent) => setZoomWidth(event.nativeEvent.layout.width)}>
                {zoomMode === "full" ? <>
                  <ToolbarItem label="Decrease text size" disabled={!native.canDecrease}
                    onPress={() => native.step(-1)} tokens={tokens} iconSize={metrics.icon}>
                    <Icon icon={TEXT_SMALLER} size={metrics.icon} color={tokens.foregroundMuted} />
                  </ToolbarItem>
                  <ToolbarItem label="Reset zoom" onPress={() => native.reset()} tokens={tokens}>
                    <Text selectable={false} style={{ color: tokens.foregroundMuted, fontFamily: tokens.fontUi, fontSize: 13, fontVariant: ["tabular-nums"] }}>{native.size}</Text>
                  </ToolbarItem>
                  <ToolbarItem label="Increase text size" disabled={!native.canIncrease}
                    onPress={() => native.step(1)} tokens={tokens} iconSize={metrics.icon}>
                    <Icon icon={TEXT_LARGER} size={metrics.icon} color={tokens.foregroundMuted} />
                  </ToolbarItem>
                </> : (
                  <ToolbarItem label="Text size" onPress={() => native.showBadge()} tokens={tokens} iconSize={metrics.icon}>
                    <Icon icon={TEXT_SIZE} size={metrics.icon} color={tokens.foregroundMuted} />
                  </ToolbarItem>
                )}
              </View>
            ) : null}
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

const UNSUBSCRIBED = () => {};
const NONE = () => null;

/** The phone body's text size controls, while one publishes them. */
function useNativeZoomControls(controls: DetailsZoomControls | undefined): ZoomControls | null {
  const subscribe = useCallback((listener: () => void) => (controls ? controls.subscribe(listener) : UNSUBSCRIBED), [controls]);
  return useSyncExternalStore(subscribe, controls?.read ?? NONE, controls?.read ?? NONE);
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
    borderBottomWidth: 1,
    flexShrink: 0,
    // Raised over the body, so a button's name and the "More" menu can hang down across it.
    zIndex: 1,
  },
  start: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  zoom: { flexDirection: "row", alignItems: "center", gap: GAP, flexShrink: 0 },
  end: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: GAP },
});
