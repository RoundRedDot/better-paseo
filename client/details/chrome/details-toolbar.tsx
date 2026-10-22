/**
 * The details panel's toolbar (docs/prototypes/block-details-sheet.md,
 * "工具栏"; tables 5.2 and 5.8): line wrap and the content's own controls
 * (pager, render / raw, a question's raw toggle) at the left; its copy
 * buttons, "⋯" for those that do not fit, and full screen at the right. 44
 * tall on touch, 36 with a pointer. Only presses: it does not drag the panel.
 *
 * The title the hover bar carries in its middle is not repeated here; the
 * header above names the block.
 */
import { useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import type { ExtendedThemeTokens } from "../../components/theme-tokens";
import { space } from "../../components/theme-tokens";
import { CopyOverflowContext, SpokenLabelsContext, ToolbarButton, ToolbarMetricsContext, TooltipAlignContext } from "../../ui/toolbar-button";
import type { DetailsShellValue } from "../contracts";
import { HEADER_BUTTONS } from "./details-header";
import { copySlots, CopyOverflowMenu, useCopyOverflow } from "./copy-overflow";

export const DETAILS_TOOLBAR = { touch: 44, pointer: 36 } as const;
const PADDING = space.md;
const GAP = space.xs;
/** Between the left group and the copies. */
const SPLIT = space.sm;

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
  const fullscreen = fullscreenButton(shell);
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
 * Full screen, the hover panel's maximize: the drawer and the floating panel
 * grow to full height, the side panel widens. Absent where the content fits.
 */
function fullscreenButton(shell: DetailsShellValue): { icon: string; label: string; onPress(): void } | null {
  const toggle = shell.toggleFullscreen;
  if (!toggle) return null;
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
