import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type TextStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useAgent, useWorkspace } from "@getpaseo/plugin/client";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { codeSurface } from "../components/host-font-escape";
import { unselectable } from "../components/selection";
import { ProseSpan } from "./prose-text";
import { useEnhancerPreferences } from "../preferences";
import {
  formatPath,
  pathRootsFor,
  type PathDisplayMode,
  type PathRoot,
} from "../paths/format-path";
import { budgetForWidth, fitMiddle, shownPath, truncateMiddle } from "../paths/truncate-middle";
import { useCopy } from "./use-copy";
import { useHover } from "./use-hover";
import { useInputCapabilities } from "./use-input-capabilities";
import { UI_SCALE } from "./tokens/typography";
import { liftStackingRow, placeTooltipNear, type DomBox, type TooltipPlacement } from "./tooltip-placement";
import { HoverPreview, HoverPreviewBody, HoverPreviewHeader, RowLongPressContext, useHoverPreview } from "./hover-preview";
import { ToolbarCopyButton } from "./toolbar-button";
import { RowPaletteContext } from "./disclosure-header";

/** Where paths are made relative to, for one renderer (plan §3.9 item 3). */
export interface PathContextValue {
  roots: readonly PathRoot[];
  cwd?: string;
  mode: PathDisplayMode;
  /** `file.reveal` with an absolute path; absent where the renderer has none. */
  reveal?(absolutePath: string): void;
}

const NO_ROOTS: PathContextValue = { roots: [], mode: "relative" };

export const PathContext = createContext<PathContextValue>(NO_ROOTS);

/**
 * Builds the context for one agent: its workspace directory, the project root
 * when that differs (a worktree), and the agent cwd as the last resort. Every
 * selector returns a string, so the value only changes when a root does —
 * not every time the host hands over a fresh snapshot object.
 */
export function usePathContextValue(
  agentId: string,
  reveal?: (absolutePath: string) => void,
): PathContextValue {
  const cwd = useAgent(agentId, (agent) => agent.cwd) ?? undefined;
  const workspaceId = useAgent(agentId, (agent) => agent.workspaceId) ?? "";
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const projectRootPath = useWorkspace(workspaceId, (workspace) => workspace.projectRootPath);
  const projectDisplayName = useWorkspace(
    workspaceId,
    (workspace) => workspace.projectDisplayName,
  );
  const mode = useEnhancerPreferences().pathDisplay;
  return useMemo(
    () => ({
      roots: pathRootsFor({ directory, projectRootPath, projectDisplayName, cwd }),
      cwd,
      mode,
      reveal,
    }),
    [cwd, directory, projectRootPath, projectDisplayName, mode, reveal],
  );
}

export function PathProvider({
  agentId,
  reveal,
  children,
}: {
  agentId: string;
  reveal?: (absolutePath: string) => void;
  children: ReactNode;
}) {
  const value = usePathContextValue(agentId, reveal);
  return <PathContext.Provider value={value}>{children}</PathContext.Provider>;
}

/** Full path appears after the pointer rests this long (plan §3.9 item 4). */
const TOOLTIP_DELAY_MS = 400;
const BUDGET = { desktop: 72, compact: 40 } as const;

export interface PathTextProps {
  path: string;
  tokens: ExtendedThemeTokens;
  compact?: boolean;
  /**
   * Draw the text as written, without making it relative; press and copy
   * still use the resolved absolute path. For paths inside Markdown prose.
   */
  verbatim?: boolean;
  /**
   * A bare pressable `Text` for use inside a paragraph: press only, no
   * long-press (the surrounding text is selectable), no hover extras.
   */
  inline?: boolean;
  /** Overrides the context's `reveal`. */
  onReveal?(absolutePath: string): void;
  /** Characters before middle truncation; defaults to 40 compact / 72 desktop. */
  budget?: number;
  /**
   * Fill the slot it sits in and truncate to its measured width, so the file
   * name is never cut by the row's tail ellipsis (plan §3.9). The slot is
   * measured once per width change. Use in a column-direction slot: a header
   * target, a list row.
   */
  fit?: boolean;
  /**
   * With `fit`, in a row: the slot takes the row's free width (`flex: 1`), so
   * no wrapper view is needed around it.
   */
  grow?: boolean;
  /** Show the hover copy icon. Off when the surrounding row has its own. */
  copyOnHover?: boolean;
  /** Text style overrides (size, colour). */
  style?: TextStyle;
}

/**
 * A file path, shown relative to the workspace (plan §3.9, §3.11).
 *
 * | | hover device | touch device |
 * |---|---|---|
 * | press | reveal in the file manager | copy the absolute path + toast |
 * | long-press | — | copy the absolute path + toast; in a collapsed row, the row's preview |
 * | hover | full path after 400 ms, copy icon | — |
 *
 * Press copies on touch because `file.reveal` runs on the daemon's machine:
 * from a phone it would open a window on the desktop and show nothing here.
 */
export function PathText({
  path,
  tokens,
  compact = false,
  verbatim = false,
  inline = false,
  onReveal,
  budget,
  copyOnHover = true,
  style,
  fit = false,
  grow = false,
}: PathTextProps) {
  const context = useContext(PathContext);
  const capabilities = useInputCapabilities(compact);
  const { hovered, hoverProps } = useHover();
  const { copied, copy } = useCopy();
  const [tooltip, setTooltip] = useState<TooltipPlacement | null>(null);
  const rowRef = useRef<View>(null);
  const preview = useHoverPreview(!inline);
  // In a collapsed row on a phone the long press opens the row's preview: the
  // path fills most of a Read row, so it would otherwise swallow every one.
  const rowLongPress = useContext(RowLongPressContext);
  const palette = useContext(RowPaletteContext);

  const formatted = useMemo(() => formatPath(path, context), [path, context]);
  const reveal = onReveal ?? context.reveal;
  const touchFirst = capabilities.touch && !capabilities.hover;

  // `fit`: the slot's width, in whole points; 0 until the first layout.
  const [slotWidth, setSlotWidth] = useState(0);
  const onSlotLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    setSlotWidth((previous) => (previous === width ? previous : width));
  }, []);
  const flat = StyleSheet.flatten(style) ?? {};
  const fontSize = typeof flat.fontSize === "number" ? flat.fontSize : TEXT_SIZE;
  const family = typeof flat.fontFamily === "string" ? flat.fontFamily : tokens.fontMono;
  // The hover copy icon's reserved space comes out of the slot.
  const reserved = copyOnHover && capabilities.hover ? COPY_ICON + space.xs : 0;
  const measured = fit ? budgetForWidth(slotWidth - reserved, fontSize, family) : null;
  const fallback = budget ?? (compact ? BUDGET.compact : BUDGET.desktop);
  const limit = measured === null ? fallback : budget ? Math.min(budget, measured) : measured;
  const strict = measured !== null;

  useEffect(() => {
    if (!hovered || !capabilities.hover || inline || Platform.OS === "web") {
      setTooltip(null);
      return;
    }
    const timer = setTimeout(() => setTooltip(placeTooltip(rowRef.current)), TOOLTIP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hovered, capabilities.hover, inline]);

  useEffect(() => {
    if (tooltip !== "below" || Platform.OS !== "web") return;
    return liftStackingRow(rowRef.current as unknown as DomBox | null);
  }, [tooltip]);

  const copyAbsolute = () => void copy(formatted.absolutePath, { feedback: "toast", label: "Copy path" });
  const onPress = () => {
    if (touchFirst || !reveal) copyAbsolute();
    else reveal(formatted.absolutePath);
  };

  const shownParts = verbatim
    ? { label: null, text: strict ? fitMiddle(path.trim(), limit) : truncateMiddle(path.trim(), limit) }
    : shownPath(formatted, limit, strict);
  const label = shownParts.label;
  const shown = shownParts.text;
  const textStyle = [
    styles.text,
    { color: palette?.target ?? tokens.foreground, fontFamily: tokens.fontMono },
    style,
  ];

  if (inline) {
    return (
      <ProseSpan
        {...(codeSurface as object)}
        accessibilityRole="link"
        accessibilityLabel={formatted.absolutePath}
        onPress={onPress}
        style={textStyle}
      >
        {shown}
      </ProseSpan>
    );
  }

  const pressable = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={formatted.absolutePath}
        accessibilityHint={touchFirst || !reveal ? "Copies the path" : "Reveals the file"}
        onPress={onPress}
        onLongPress={rowLongPress ?? (capabilities.touch ? copyAbsolute : undefined)}
        {...hoverProps}
        ref={Platform.OS === "web" ? preview.anchorRef : rowRef}
        style={styles.row}
      >
        <Text
          {...(codeSurface as object)}
          selectable={false}
          numberOfLines={1}
          style={[...textStyle, unselectable, hovered && styles.hovered]}
        >
          {label ? <Text style={{ color: palette?.meta ?? tokens.foregroundMuted }}>{`${label}/`}</Text> : null}
          {shown}
        </Text>
        {copyOnHover && capabilities.hover ? (
          // Space is always reserved, so the icon appearing never shifts layout.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? "Copied" : "Copy path"}
            disabled={!hovered}
            hitSlop={6}
            onPress={() => void copy(formatted.absolutePath, { feedback: "icon", label: "Copy path" })}
            style={[styles.copyIcon, { opacity: hovered || copied ? 1 : 0 }]}
          >
            <Icon
              name={copied ? "Check" : "Copy"}
              size={12}
              color={copied ? tokens.foreground : tokens.foregroundMuted}
            />
          </Pressable>
      ) : null}
      {tooltip ? (
        <View
          pointerEvents="none"
          style={[
            styles.tooltip,
            tooltip === "above" ? styles.tooltipAbove : styles.tooltipBelow,
            { backgroundColor: tokens.v2.surface2, borderColor: tokens.v2.border },
          ]}
        >
          <Text
            {...(codeSurface as object)}
            selectable={false}
            style={[styles.tooltipText, { color: tokens.foreground, fontFamily: tokens.fontMono }]}
          >
            {formatted.absolutePath}
            {formatted.suffix}
          </Text>
        </View>
      ) : null}
    </Pressable>
      {preview.open ? <HoverPreview preview={preview} tokens={tokens}>
        {/* The same toolbar as every other preview: copy, and the window button. */}
        <HoverPreviewHeader tokens={tokens}>
          <ToolbarCopyButton text={formatted.absolutePath} icon="Link" tokens={tokens} label="Copy path" />
        </HoverPreviewHeader>
        <HoverPreviewBody>
          <Text {...(codeSurface as object)} selectable style={[styles.tooltipText, { color: tokens.foreground, fontFamily: tokens.fontMono }]}>
            {formatted.absolutePath}{formatted.suffix}
          </Text>
        </HoverPreviewBody>
      </HoverPreview> : null}
    </>
  );
  if (!fit) return pressable;
  // The slot stretches to the space it is given and is what gets measured;
  // the button inside keeps to the text, so a press beside the path still
  // reaches whatever row holds it.
  return (
    <View style={grow ? styles.fitSlotGrow : styles.fitSlot} onLayout={onSlotLayout}>
      {pressable}
    </View>
  );
}

function placeTooltip(row: unknown): TooltipPlacement {
  return placeTooltipNear(row, Platform.OS);
}

/** Default path text size. */
const TEXT_SIZE = 13;
/** Space the hover copy icon reserves beside the path. */
const COPY_ICON = 12;

const styles = StyleSheet.create({
  fitSlot: {
    alignSelf: "stretch",
    alignItems: "flex-start",
    minWidth: 0,
  },
  fitSlotGrow: {
    flex: 1,
    alignSelf: "stretch",
    alignItems: "flex-start",
    justifyContent: "center",
    minWidth: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    minWidth: 0,
    flexShrink: 1,
    position: "relative",
  },
  text: {
    fontSize: TEXT_SIZE,
    flexShrink: 1,
  },
  hovered: {
    textDecorationLine: "underline",
  },
  copyIcon: {
    width: COPY_ICON,
    height: COPY_ICON,
    flexShrink: 0,
  },
  tooltip: {
    position: "absolute",
    left: 0,
    maxWidth: 560,
    paddingHorizontal: 6,
    paddingVertical: space.xs,
    borderRadius: radiusV2.chip,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  tooltipAbove: {
    bottom: "100%",
    marginBottom: 2,
  },
  tooltipBelow: {
    top: "100%",
    marginTop: 2,
  },
  tooltipText: {
    fontSize: UI_SCALE.base,
  },
});
