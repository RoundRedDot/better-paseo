import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type TextStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useAgent, useWorkspace } from "@getpaseo/plugin/client";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { codeSurface } from "../components/host-font-escape";
import { unselectable } from "../components/selection";
import { useEnhancerPreferences } from "../preferences";
import {
  formatPath,
  pathRootsFor,
  type PathDisplayMode,
  type PathRoot,
} from "../paths/format-path";
import { truncateMiddle } from "../paths/truncate-middle";
import { useCopy } from "./use-copy";
import { useHover } from "./use-hover";
import { useInputCapabilities } from "./use-input-capabilities";

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
 * | long-press | — | copy the absolute path + toast |
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
}: PathTextProps) {
  const context = useContext(PathContext);
  const capabilities = useInputCapabilities(compact);
  const { hovered, hoverProps } = useHover();
  const { copied, copy } = useCopy();
  const [tooltip, setTooltip] = useState(false);

  const formatted = useMemo(() => formatPath(path, context), [path, context]);
  const reveal = onReveal ?? context.reveal;
  const touchFirst = capabilities.touch && !capabilities.hover;
  const limit = budget ?? (compact ? BUDGET.compact : BUDGET.desktop);

  useEffect(() => {
    if (!hovered || !capabilities.hover || inline) {
      setTooltip(false);
      return;
    }
    const timer = setTimeout(() => setTooltip(true), TOOLTIP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hovered, capabilities.hover, inline]);

  const copyAbsolute = () => void copy(formatted.absolutePath, { feedback: "toast" });
  const onPress = () => {
    if (touchFirst || !reveal) copyAbsolute();
    else reveal(formatted.absolutePath);
  };

  const label = verbatim ? null : formatted.label;
  const shown = verbatim
    ? truncateMiddle(path.trim(), limit)
    : label
      ? truncateMiddle(
          `${formatted.displayPath.slice(label.length + 1)}${formatted.suffix}`,
          Math.max(8, limit - label.length - 1),
        )
      : truncateMiddle(`${formatted.displayPath}${formatted.suffix}`, limit);
  const textStyle = [
    styles.text,
    { color: tokens.foreground, fontFamily: tokens.fontMono },
    style,
  ];

  if (inline) {
    return (
      <Text
        {...(codeSurface as object)}
        accessibilityRole="link"
        accessibilityLabel={formatted.absolutePath}
        onPress={onPress}
        style={textStyle}
      >
        {shown}
      </Text>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={formatted.absolutePath}
      accessibilityHint={touchFirst || !reveal ? "Copies the path" : "Reveals the file"}
      onPress={onPress}
      onLongPress={capabilities.touch ? copyAbsolute : undefined}
      {...hoverProps}
      style={styles.row}
    >
      <Text
        {...(codeSurface as object)}
        selectable={false}
        numberOfLines={1}
        style={[...textStyle, unselectable, hovered && styles.hovered]}
      >
        {label ? <Text style={{ color: tokens.foregroundMuted }}>{`${label}/`}</Text> : null}
        {shown}
      </Text>
      {copyOnHover && capabilities.hover ? (
        // Space is always reserved, so the icon appearing never shifts layout.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? "Copied" : "Copy path"}
          disabled={!hovered}
          hitSlop={6}
          onPress={() => void copy(formatted.absolutePath, { feedback: "icon" })}
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
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    minWidth: 0,
    flexShrink: 1,
    position: "relative",
  },
  text: {
    fontSize: 13,
    flexShrink: 1,
  },
  hovered: {
    textDecorationLine: "underline",
  },
  copyIcon: {
    width: 12,
    height: 12,
    flexShrink: 0,
  },
  tooltip: {
    position: "absolute",
    top: "100%",
    left: 0,
    marginTop: 2,
    maxWidth: 560,
    paddingHorizontal: 6,
    paddingVertical: space.xs,
    borderRadius: radiusV2.chip,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  tooltipText: {
    fontSize: 12,
  },
});
