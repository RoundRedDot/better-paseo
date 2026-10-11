import React, { type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { unselectable } from "../components/selection";
import { codeSurface } from "../components/host-font-escape";
import { truncateMiddle } from "../paths/truncate-middle";
import { useHover } from "./use-hover";
import { useInputCapabilities } from "./use-input-capabilities";

/** Header geometry (plan §3.6 item 4). Fixed until host typography (H1) lands. */
export const DISCLOSURE_HEADER = {
  height: { desktop: 30, compact: 28 },
  paddingX: space.sm,
  gap: 6,
  iconSlot: 16,
  icon: 14,
  verb: 14,
  target: 13,
  meta: 12,
  chevron: 14,
  /** Middle-truncation budget for a string target, in characters. */
  targetBudget: { desktop: 72, compact: 40 },
} as const;

/** A 28/30 header grows to a 32px touch target through hitSlop. */
const TOUCH_TARGET = 32;

export interface DisclosureHeaderProps {
  expanded: boolean;
  onToggle(): void;
  tokens: ExtendedThemeTokens;
  /** `layout.compact`. */
  compact?: boolean;
  /** The 16px status slot: a muted tool icon, a `RunningDot`, a failure mark. */
  icon?: ReactNode;
  /** What happened: "Read", "Bash", "Thought". */
  verb: string;
  /** What it happened to. A string is drawn monospace and middle-truncated; pass a `PathText` for paths. */
  target?: ReactNode;
  /** Right-aligned facts: "L10–80", "exit 0", "1.2s". Muted, tabular digits. */
  meta?: ReadonlyArray<string | ReactNode>;
  /** `danger` draws the verb and meta in the danger colour (a failure). */
  tone?: "default" | "danger";
  /**
   * Buttons for the block (copy, `⋯`). On a hover device they appear while
   * the header is hovered, laid over the meta so nothing moves; on touch they
   * sit beside the header while the block is expanded and are absent when it
   * is collapsed, where `onLongPress` is the entry instead.
   */
  actions?: ReactNode;
  /** Show `actions` regardless of hover and expansion. */
  actionsAlwaysVisible?: boolean;
  /**
   * Keep hover actions shown without the pointer, e.g. while the `⋯` menu
   * they opened is open. Laid over the meta as on hover; nothing moves.
   */
  actionsActive?: boolean;
  /** Touch entry for the primary action (plan §3.8): long-press the header. */
  onLongPress?(): void;
  accessibilityLabel?: string;
}

/**
 * The single-line header every collapsible block uses (plan §3.6 item 4):
 *
 *   [status] Verb  target……………………  meta  ›
 *
 * It draws no frame and no fill of its own: collapsed it is a bare row, and
 * the expanded block around it supplies the border. Hover paints `surface1`
 * and press `surface2` (the host's colours). The chevron is static — right
 * when collapsed, down when expanded — with no rotation to animate.
 *
 * All text is non-selectable: the header is a press target, and a long press
 * must never compete with text selection.
 */
export function DisclosureHeader({
  expanded,
  onToggle,
  tokens,
  compact = false,
  icon,
  verb,
  target,
  meta,
  tone = "default",
  actions,
  actionsAlwaysVisible = false,
  actionsActive = false,
  onLongPress,
  accessibilityLabel,
}: DisclosureHeaderProps) {
  const capabilities = useInputCapabilities(compact);
  const { hovered, hoverProps } = useHover();
  const height = compact ? DISCLOSURE_HEADER.height.compact : DISCLOSURE_HEADER.height.desktop;
  const slop = Math.max(0, (TOUCH_TARGET - height) / 2);
  const danger = tone === "danger";

  // Persistent actions (touch, expanded; or pinned) sit in the row beside the
  // button. Hover actions are laid over the meta, which is hidden meanwhile,
  // so revealing them moves nothing.
  const persistentActions =
    actions !== undefined &&
    (actionsAlwaysVisible || (capabilities.touch && !capabilities.hover && expanded));
  const hoverActions =
    actions !== undefined && !persistentActions && capabilities.hover && (hovered || actionsActive);

  const label =
    accessibilityLabel ?? (typeof target === "string" && target ? `${verb} ${target}` : verb);
  const budget = compact
    ? DISCLOSURE_HEADER.targetBudget.compact
    : DISCLOSURE_HEADER.targetBudget.desktop;

  const wrapStyle = [styles.wrap, persistentActions && styles.wrapRow];
  const content = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded }}
        // React Native Web reads the ARIA prop, not `accessibilityState`.
        aria-expanded={expanded}
        onPress={onToggle}
        onLongPress={onLongPress}
        hitSlop={{ top: slop, bottom: slop }}
        style={({ pressed }) => [
          styles.header,
          { height },
          persistentActions && styles.headerInRow,
          hovered && { backgroundColor: tokens.v2.surface1 },
          pressed && { backgroundColor: tokens.v2.surface2 },
        ]}
      >
        <View style={styles.iconSlot}>{icon}</View>
        <Text
          selectable={false}
          numberOfLines={1}
          style={[
            styles.verb,
            unselectable,
            { color: danger ? tokens.danger : tokens.foreground, fontFamily: tokens.fontUi },
          ]}
        >
          {verb}
        </Text>
        <View style={styles.target}>
          {typeof target === "string" ? (
            <Text
              {...(codeSurface as object)}
              selectable={false}
              numberOfLines={1}
              style={[
                styles.targetText,
                unselectable,
                { color: tokens.foreground, fontFamily: tokens.fontMono },
              ]}
            >
              {truncateMiddle(target, budget)}
            </Text>
          ) : (
            target
          )}
        </View>
        {meta && meta.length > 0 ? (
          <View style={[styles.meta, hoverActions && styles.hidden]}>
            {meta.map((entry, index) =>
              typeof entry === "string" ? (
                <Text
                  // Meta entries are positional and never reorder.
                  key={index}
                  selectable={false}
                  numberOfLines={1}
                  style={[
                    styles.metaText,
                    unselectable,
                    {
                      color: danger ? tokens.danger : tokens.foregroundMuted,
                      fontFamily: tokens.fontUi,
                    },
                  ]}
                >
                  {entry}
                </Text>
              ) : (
                <React.Fragment key={index}>{entry}</React.Fragment>
              ),
            )}
          </View>
        ) : null}
        <View style={styles.chevron}>
          <Icon
            name={expanded ? "ChevronDown" : "ChevronRight"}
            size={DISCLOSURE_HEADER.chevron}
            color={tokens.foregroundMuted}
          />
        </View>
      </Pressable>
      {persistentActions ? <View style={styles.inlineActions}>{actions}</View> : null}
      {hoverActions ? (
        <View style={[styles.overlayActions, { backgroundColor: tokens.v2.surface1 }]}>
          {actions}
        </View>
      ) : null}
    </>
  );

  // The wrapper only tracks hover, so moving onto the actions laid over the
  // header does not count as leaving it; the inner Pressable is the button.
  //
  // On web this is DOM mouseenter/leave on a plain View. A Pressable cannot
  // do it there: React Native Web contains hover, so the header button
  // inside ends the outer Pressable's hover the moment the pointer enters it
  // — and the button fills the row, so the row never read as hovered.
  // Native has no such containment, and its pointer hover (iPad) arrives
  // only through Pressable.
  if (IS_WEB) {
    const mouseProps = { onMouseEnter: hoverProps.onHoverIn, onMouseLeave: hoverProps.onHoverOut };
    return (
      <View {...(mouseProps as object)} style={wrapStyle}>
        {content}
      </View>
    );
  }
  return (
    <Pressable accessible={false} focusable={false} {...hoverProps} style={wrapStyle}>
      {content}
    </Pressable>
  );
}

const IS_WEB = Platform.OS === "web";

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
  },
  wrapRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  headerInRow: {
    flex: 1,
    minWidth: 0,
  },
  hidden: {
    opacity: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: DISCLOSURE_HEADER.gap,
    paddingHorizontal: DISCLOSURE_HEADER.paddingX,
    borderRadius: radiusV2.block,
  },
  iconSlot: {
    width: DISCLOSURE_HEADER.iconSlot,
    alignItems: "center",
    justifyContent: "center",
  },
  verb: {
    fontSize: DISCLOSURE_HEADER.verb,
    fontWeight: "500",
    flexShrink: 0,
  },
  target: {
    flex: 1,
    minWidth: 0,
  },
  targetText: {
    fontSize: DISCLOSURE_HEADER.target,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: DISCLOSURE_HEADER.gap,
    flexShrink: 0,
  },
  metaText: {
    fontSize: DISCLOSURE_HEADER.meta,
    fontVariant: ["tabular-nums"],
  },
  chevron: {
    width: DISCLOSURE_HEADER.chevron,
    alignItems: "center",
  },
  inlineActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingRight: space.xs,
  },
  overlayActions: {
    position: "absolute",
    top: 0,
    bottom: 0,
    // Clear of the chevron, which stays visible.
    right: DISCLOSURE_HEADER.paddingX + DISCLOSURE_HEADER.chevron + DISCLOSURE_HEADER.gap,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingLeft: space.xs,
  },
});
