import React, { type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { unselectable } from "../components/selection";
import { codeSurface } from "../components/host-font-escape";
import { truncateMiddle } from "../paths/truncate-middle";
import { TYPE } from "./tokens/typography";
import { useHover } from "./use-hover";
import { useInputCapabilities } from "./use-input-capabilities";
import { useEnhancerPreferences } from "../preferences";

/**
 * Row geometry (S7 design spec §2.5, F0 "Row heights and hit areas").
 *
 * A row is outdented by `bleed` on both sides and padded back by the same
 * amount, so its status slot starts on the prose edge and every row's verb,
 * a failed row's error line and an opened body share one text column at
 * `textColumn`. The slot is exactly as wide as the 14pt icon, so the icon's
 * left edge sits on the prose edge rather than centred a few points in; the
 * slot's trailing pad keeps the icon-to-text gap at 10. Rows are 26 tall on desktop and 28 on touch, tighter than
 * the host's own 30, and touch rows reach 44 through `hitSlop`.
 */
export const DISCLOSURE_HEADER = {
  height: { desktop: 26, compact: 28 },
  hit: 44,
  paddingX: space.sm,
  bleed: space.sm,
  gap: space.sm,
  iconSlot: 16,
  /** The slot's trailing pad: the slot's content box is the icon's 14pt square. */
  iconSlotPad: 2,
  icon: 14,
  verb: TYPE.label.size,
  target: TYPE.target,
  meta: TYPE.meta.size,
  chevron: 14,
  /** Slot + gap: where the verb, an error line and an opened body start. */
  textColumn: 16 + space.sm,
  /** Middle-truncation budget for a string target, in characters. */
  targetBudget: { desktop: 72, compact: 40 },
} as const;

/** The hover actions' backing, laid over the end of the target. */
const ACTION_GAP = space.xs;

export interface DisclosureHeaderProps {
  expanded: boolean;
  onToggle(): void;
  tokens: ExtendedThemeTokens;
  /** `layout.compact`. */
  compact?: boolean;
  /** The status slot: a muted tool icon, a `RunningDot`, a failure mark. */
  icon?: ReactNode;
  /**
   * The icon reports status (running, failed) rather than the kind of row, so
   * it stays when the reader chose label-only rows.
   */
  iconIsStatus?: boolean;
  /**
   * What happened: "Read", "Bash", "Thought". Drawn unless the reader chose
   * icon-only rows and a target stands in for it; it always opens the
   * accessibility label.
   */
  verb: string;
  /**
   * What it happened to. A string is drawn monospace and middle-truncated. A
   * node (a `PathText` with `grow`, a preview `Text`) must take the free width
   * itself (`flex: 1`, `minWidth: 0`).
   */
  target?: ReactNode;
  /**
   * Right-aligned facts: "L10–80", "exit 0", "1.2s". All of them are spans of
   * one monospace Text, so a nested `Text` may colour one (`+4` in success).
   */
  meta?: ReadonlyArray<string | ReactNode>;
  /** A view before the meta Text that cannot be a span (a pressable path). */
  metaLead?: ReactNode;
  /**
   * Buttons for the block (copy, `⋯`). On a hover device they appear while the
   * row is hovered, over the end of the target, so the meta never moves; on
   * touch they sit at the end of the row while the block is expanded and are
   * absent when it is collapsed, where `onLongPress` is the entry instead.
   */
  actions?: ReactNode;
  /** Show `actions` regardless of hover and expansion. */
  actionsAlwaysVisible?: boolean;
  /** Keep hover actions shown without the pointer, e.g. while their `⋯` menu is open. */
  actionsActive?: boolean;
  /** Touch entry for the primary action (plan §3.8): long-press the row. */
  onLongPress?(): void;
  accessibilityLabel?: string;
}

const IS_WEB = Platform.OS === "web";

/**
 * The single row every collapsible block uses (S7 design spec §3.1):
 *
 *   [slot] Verb  target……………………  meta
 *
 * No frame and no fill of its own. Hover paints `surface1`, a press or a held
 * long-press `surface2`. There is no chevron at rest: the whole row is the
 * control. Where the pointer can hover, the slot shows a chevron while the row
 * is hovered, in place of the icon, so nothing moves.
 *
 * Six views for a row with a string target: the row, the slot, its icon, the
 * verb (unless the reader chose icon-only rows), the target and the meta. Hover adds the actions only while hovered.
 * Label-only rows keep the slot empty, so the text column never moves.
 *
 * All text is non-selectable: the row is a press target, and a long press
 * must never compete with text selection.
 */
export function DisclosureHeader({
  expanded,
  onToggle,
  tokens,
  compact = false,
  icon,
  iconIsStatus = false,
  verb,
  target,
  meta,
  metaLead,
  actions,
  actionsAlwaysVisible = false,
  actionsActive = false,
  onLongPress,
  accessibilityLabel,
}: DisclosureHeaderProps) {
  const capabilities = useInputCapabilities(compact);
  const { hovered, hoverProps } = useHover();
  const rowLabelStyle = useEnhancerPreferences().rowLabelStyle;
  // Icon-only rows still need words: a row with no target keeps its verb.
  const hasTarget = target !== undefined && target !== null && target !== "";
  const showVerb = rowLabelStyle !== "icon" || !hasTarget;
  const showIcon = rowLabelStyle !== "label" || iconIsStatus;
  const height = compact ? DISCLOSURE_HEADER.height.compact : DISCLOSURE_HEADER.height.desktop;
  const slop = capabilities.touch ? Math.max(0, (DISCLOSURE_HEADER.hit - height) / 2) : 0;
  const targetType = compact ? DISCLOSURE_HEADER.target.compact : DISCLOSURE_HEADER.target.desktop;

  const persistentActions =
    actions !== undefined &&
    (actionsAlwaysVisible || (capabilities.touch && !capabilities.hover && expanded));
  const hoverActions =
    actions !== undefined && !persistentActions && capabilities.hover && (hovered || actionsActive);
  const showChevron = capabilities.hover && hovered;

  const label =
    accessibilityLabel ?? (typeof target === "string" && target ? `${verb} ${target}` : verb);
  const budget = compact
    ? DISCLOSURE_HEADER.targetBudget.compact
    : DISCLOSURE_HEADER.targetBudget.desktop;

  const targetNode =
    typeof target === "string" ? (
      <Text
        {...(codeSurface as object)}
        selectable={false}
        numberOfLines={1}
        style={[
          styles.targetText,
          unselectable,
          {
            color: tokens.foreground,
            fontFamily: tokens.fontMono,
            fontSize: targetType.size,
            lineHeight: targetType.lineHeight,
          },
        ]}
      >
        {truncateMiddle(target, budget)}
      </Text>
    ) : (
      target
    );

  const metaEntries = meta?.filter((entry) => entry !== null && entry !== undefined && entry !== "") ?? [];
  const metaText =
    metaEntries.length > 0 ? (
      <Text
        selectable={false}
        numberOfLines={1}
        style={[
          styles.metaText,
          unselectable,
          { color: tokens.foregroundMuted, fontFamily: tokens.fontMono },
          target === undefined && metaLead === undefined ? styles.pushRight : null,
        ]}
      >
        {metaEntries.map((entry, index) => (
          // Meta entries are positional and never reorder.
          <React.Fragment key={index}>
            {index > 0 ? "  " : null}
            {entry}
          </React.Fragment>
        ))}
      </Text>
    ) : null;

  // Web tracks the pointer with DOM mouseenter/leave, which do not end when the
  // pointer moves onto the actions inside the row; React Native Web's hover
  // does. Native pointers (iPad) arrive only through the Pressable's hover.
  const pointerProps = IS_WEB
    ? { onMouseEnter: hoverProps.onHoverIn, onMouseLeave: hoverProps.onHoverOut }
    : hoverProps;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
      // React Native Web reads the ARIA prop, not `accessibilityState`.
      aria-expanded={expanded}
      onPress={onToggle}
      onLongPress={onLongPress}
      hitSlop={slop > 0 ? { top: slop, bottom: slop } : undefined}
      {...(pointerProps as object)}
      style={({ pressed }) => [
        styles.row,
        { height },
        hovered && { backgroundColor: tokens.v2.surface1 },
        pressed && { backgroundColor: tokens.v2.surface2 },
      ]}
    >
      <View style={styles.slot}>
        {showChevron ? (
          <Icon
            name={expanded ? "ChevronDown" : "ChevronRight"}
            size={DISCLOSURE_HEADER.chevron}
            color={tokens.foregroundMuted}
          />
        ) : showIcon ? (
          icon
        ) : null}
      </View>
      {showVerb ? (
        <Text
          selectable={false}
          numberOfLines={1}
          style={[styles.verb, unselectable, { color: tokens.foreground, fontFamily: tokens.fontUi }]}
        >
          {verb}
        </Text>
      ) : null}
      {hoverActions ? (
        <View style={styles.targetBox}>
          {targetNode ?? <View style={styles.fill} />}
          <View style={[styles.overlay, { backgroundColor: tokens.v2.surface1 }]}>{actions}</View>
        </View>
      ) : (
        targetNode
      )}
      {metaLead}
      {metaText}
      {persistentActions ? <View style={styles.inlineActions}>{actions}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: DISCLOSURE_HEADER.gap,
    paddingHorizontal: DISCLOSURE_HEADER.paddingX,
    marginHorizontal: -DISCLOSURE_HEADER.bleed,
    borderRadius: radiusV2.block,
  },
  slot: {
    width: DISCLOSURE_HEADER.iconSlot,
    paddingRight: DISCLOSURE_HEADER.iconSlotPad,
    alignItems: "center",
    justifyContent: "center",
  },
  verb: {
    fontSize: TYPE.label.size,
    lineHeight: TYPE.label.lineHeight,
    fontWeight: "500",
    flexShrink: 0,
  },
  targetText: {
    flex: 1,
    minWidth: 0,
  },
  targetBox: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
  },
  fill: {
    flex: 1,
  },
  overlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: ACTION_GAP,
    paddingLeft: ACTION_GAP,
  },
  metaText: {
    flexShrink: 0,
    maxWidth: "45%",
    fontSize: TYPE.meta.size,
    lineHeight: TYPE.meta.lineHeight,
    fontVariant: ["tabular-nums"],
  },
  pushRight: {
    marginLeft: "auto",
  },
  inlineActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: ACTION_GAP,
  },
});
