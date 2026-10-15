import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type TextProps } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { selectableTextStyle, unselectable } from "../components/selection";
import { selectionSurface } from "../components/selection-actions";
import { surfaceProps } from "../components/view-props";
import { Glyph } from "../components/glyph";
import { codeSurface } from "../components/host-font-escape";
import { truncateMiddle } from "../paths/truncate-middle";
import { TYPE } from "./tokens/typography";
import { useHover } from "./use-hover";
import { useInputCapabilities } from "./use-input-capabilities";
import { useEnhancerPreferences } from "../preferences";
import { TooltipAlignContext, TooltipSideContext } from "./toolbar-button";
import { HoverPreview, HoverPreviewContext, RowLongPressContext, useHoverPreview } from "./hover-preview";
import { useScrollAnchor, type ScrollAnchor } from "./scroll-anchor";

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

/**
 * How loud a row is (docs/prototypes/quiet-tool-rows.md). `quiet` is a call
 * that has finished: it sits one step behind the prose. `active` is one still
 * running, its target halfway back to `foreground`. `loud` is a row that waits
 * for the reader (an open question) and is never dimmed.
 */
export type RowTone = "quiet" | "active" | "loud";

/** The colours a row's parts are drawn in, for its tone and state. */
export interface RowPalette {
  target: string;
  meta: string;
  icon: string;
  diffAdd: string;
  diffDel: string;
}

/**
 * Hover, a press and an opened row raise a row to the full-contrast palette;
 * at rest it takes its tone.
 */
export function rowPalette(tokens: ExtendedThemeTokens, tone: RowTone, lit: boolean): RowPalette {
  if (lit || tone === "loud") {
    return {
      target: tokens.foreground,
      meta: tokens.foregroundMuted,
      icon: tokens.foregroundMuted,
      diffAdd: tokens.success,
      diffDel: tokens.danger,
    };
  }
  const row = tokens.row;
  return {
    target: tone === "active" ? row.targetActive : row.target,
    meta: tone === "active" ? tokens.foregroundMuted : row.meta,
    icon: row.icon,
    diffAdd: row.diffAdd,
    diffDel: row.diffDel,
  };
}

/**
 * The palette of the row a node is drawn in. Null outside a row, where a part
 * shared with bodies and previews (`PathText`) keeps its own colours.
 */
export const RowPaletteContext = createContext<RowPalette | null>(null);

/** A tool icon in the row's icon colour, unless `color` sets a status. */
export function RowIcon({ name, color, size = DISCLOSURE_HEADER.icon }: { name: string; color?: string; size?: number }) {
  const palette = useContext(RowPaletteContext);
  const drawn = color ?? palette?.icon ?? "currentColor";
  if (name.startsWith("brand:")) return <Glyph name={name.slice(6)} size={size} color={drawn} />;
  return <Icon name={name} size={size} color={drawn} />;
}

/** Text in one of the row's palette colours; a `style` colour still wins. */
export function RowText({ part, style, ...props }: TextProps & { part: keyof RowPalette }) {
  const palette = useContext(RowPaletteContext);
  return <Text {...props} style={[palette ? { color: palette[part] } : null, style]} />;
}

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
  /** Number of operations sharing this header; single calls have no badge. */
  count?: number;
  /**
   * Right-aligned facts: "L10–80", "exit 0", "1.2s". All of them are spans of
   * one monospace Text, so a nested `Text` may colour one (`+4` in success).
   */
  meta?: ReadonlyArray<string | ReactNode>;
  /** A view before the meta Text that cannot be a span (a pressable path). */
  metaLead?: ReactNode;
  /**
   * Buttons for the block (its copies). On a hover device they appear while the
   * row is hovered, over the end of the target, so the meta never moves; on
   * touch they sit at the end of the row while the block is expanded and are
   * absent when it is collapsed, where `onLongPress` is the entry instead.
   */
  actions?: ReactNode;
  /** Show `actions` regardless of hover and expansion. */
  actionsAlwaysVisible?: boolean;
  /** Keep hover actions shown without the pointer, e.g. while a menu of theirs is open. */
  actionsActive?: boolean;
  /**
   * Touch entry for the primary action (plan §3.8): long-press the row. On iOS
   * and Android a collapsed row with `previewContent` opens its preview on a
   * long press instead, and the preview carries the copy actions.
   */
  onLongPress?(): void;
  accessibilityLabel?: string;
  /**
   * Built only while hovered, or long-pressed on a phone; does not change the
   * disclosure state.
   */
  previewContent?(): ReactNode;
  /** The row's name across remounts, so a preview open as the host redraws the row stays open. */
  previewKey?: string;
  /** The preview opened, for content that is fetched only when it is shown. */
  onPreviewOpen?(): void;
  /** False when the preview holds no text to wrap, so it has no wrap toggle. */
  previewWraps?: boolean;
  /**
   * False keeps `onLongPress` on a phone instead of the long-press preview;
   * the hover preview on web is unchanged. An image read opens the picture.
   */
  pressPreview?: boolean;
  /**
   * Keeps the row in place when it toggles. The row brings its own; a card
   * whose row moves into another parent when it opens (`StickyCard`) passes
   * one that outlives the move, or the remounted row forgets the press.
   */
  scrollAnchor?: ScrollAnchor;
  /** How loud the row is at rest; see `RowTone`. */
  tone?: RowTone;
  /**
   * Nothing to open: the body would repeat the row. The row neither toggles
   * nor lights up on hover (no paint, chevron or preview); hover still shows
   * its actions, so the copy button stays in reach.
   */
  inert?: boolean;
}

/**
 * The single row every collapsible block uses (S7 design spec §3.1):
 *
 *   [slot] Verb  target……………………  meta
 *
 * No frame and no fill of its own. Hover paints `surface1`, a press or a held
 * long-press `surface2`. There is no chevron at rest: the whole row is the
 * control. Where the pointer can hover, the slot shows a chevron while the row
 * is hovered, in place of the icon, so nothing moves; an opened row keeps a
 * down chevron there.
 *
 * At rest the row draws in its `tone`'s quiet palette, one step behind the
 * prose; hover, a press and an opened body raise it to full contrast. Parts a
 * caller supplies (`RowIcon`, `RowText`, a `PathText` target) read the palette
 * from `RowPaletteContext`.
 *
 * Six views for a row with a string target: the row, the slot, its icon, the
 * verb (unless the reader chose icon-only rows), the target and the meta. Hover adds the actions only while hovered.
 * Label-only rows keep the slot empty, so the text column never moves.
 *
 * All text is non-selectable: the row is a press target, and a long press
 * must never compete with text selection. An inert row presses nothing, so
 * its verb and target are selectable: they are all there is to copy.
 *
 * The row stays where it was pressed and the body opens below it. The native
 * timeline is an inverted list that holds its bottom still, so without
 * `useScrollAnchor` a body opening near the end would push the row up by its
 * whole height, and closing one would drop the row down the screen.
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
  count,
  meta,
  metaLead,
  actions,
  actionsAlwaysVisible = false,
  actionsActive = false,
  onLongPress,
  accessibilityLabel,
  previewContent,
  previewKey,
  onPreviewOpen,
  previewWraps = true,
  pressPreview = true,
  scrollAnchor,
  tone = "quiet",
  inert = false,
}: DisclosureHeaderProps) {
  const previewOwner = useContext(HoverPreviewContext);
  const preview = useHoverPreview(Boolean(previewContent) && !expanded && !actionsActive && !inert, previewKey);
  useEffect(() => {
    if (preview.open) onPreviewOpen?.();
  }, [preview.open, onPreviewOpen]);
  const ownAnchor = useScrollAnchor(expanded);
  const anchor = scrollAnchor ?? ownAnchor;
  const { anchorRef } = preview;
  const longPress = (pressPreview ? preview.press : undefined) ?? onLongPress;
  const rowRef = useCallback(
    (node: View | null) => {
      anchorRef.current = node;
      anchor.ref.current = node;
    },
    [anchorRef, anchor.ref],
  );
  const toggle = useCallback(() => {
    anchor.arm();
    onToggle();
  }, [anchor, onToggle]);
  const capabilities = useInputCapabilities(compact);
  const hover = useHover(anchorRef);
  // An inert row's hover only brings up its actions.
  const hovered = hover.hovered && !inert;
  const { hoverProps } = hover;
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => {
    setPressed(true);
    anchor.hold();
  }, [anchor]);
  const pressOut = useCallback(() => setPressed(false), []);
  const palette = rowPalette(tokens, tone, hovered || pressed || expanded);
  const rowLabelStyle = useEnhancerPreferences().rowLabelStyle;
  // Icon-only rows still need words: a row with no target keeps its verb.
  const hasTarget = target !== undefined && target !== null && target !== "";
  const showVerb = rowLabelStyle !== "icon" || !hasTarget;
  const showIcon = rowLabelStyle !== "label" || iconIsStatus;
  const block = tokens.typography.block;
  const height = compact ? block.rowHeight.compact : block.rowHeight.desktop;
  const slop = capabilities.touch ? Math.max(0, (DISCLOSURE_HEADER.hit - height) / 2) : 0;
  const targetType = block.target;
  const textSelect = inert ? selectableTextStyle : unselectable;

  const persistentActions =
    actions !== undefined &&
    (actionsAlwaysVisible || (capabilities.touch && !capabilities.hover && expanded));
  const hoverActions =
    actions !== undefined && !persistentActions && capabilities.hover && (hover.hovered || actionsActive);
  // An opened row shows which way it went; a status icon (running, failed)
  // keeps its place, since it says more than the direction.
  const showChevron = !inert && ((capabilities.hover && hovered) || (expanded && !iconIsStatus));

  const baseLabel = accessibilityLabel ?? (typeof target === "string" && target ? `${verb} ${target}` : verb);
  const label = count && count > 1 ? `${baseLabel}, ${count} operations` : baseLabel;
  const budget = compact
    ? DISCLOSURE_HEADER.targetBudget.compact
    : DISCLOSURE_HEADER.targetBudget.desktop;

  const targetNode =
    typeof target === "string" ? (
      <Text
        {...((inert ? surfaceProps(selectionSurface, codeSurface) : codeSurface) as object)}
        selectable={inert}
        numberOfLines={1}
        style={[
          styles.targetText,
          textSelect,
          {
            color: palette.target,
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
  const countedTarget = count && count > 1 ? (
    <View style={styles.countedTarget}>
      <View style={styles.countedTitle}>{targetNode}</View>
      <View style={[styles.countBadge, { backgroundColor: tokens.v2.surface2 }]}>
        <Text selectable={false} style={[styles.countText, unselectable, { color: palette.meta, fontFamily: tokens.fontUi }]}>{count}</Text>
      </View>
    </View>
  ) : targetNode;
  const metaText =
    metaEntries.length > 0 ? (
      <Text
        selectable={false}
        numberOfLines={1}
        style={[
          styles.metaText,
          unselectable,
          { color: palette.meta, fontFamily: tokens.fontMono, fontSize: block.meta.size, lineHeight: block.meta.lineHeight },
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

  // Web binds the whole row through its DOM ref, including nested actions.
  // Native pointers (iPad) arrive through the Pressable's hover.
  const pointerProps = Platform.OS === "web" ? {} : hoverProps;

  return (
    <>
      <RowPaletteContext.Provider value={palette}>
        <HoverPreviewContext.Provider value={previewOwner || (Boolean(previewContent) && !expanded)}>
          <RowLongPressContext.Provider value={pressPreview ? preview.press : longPress}>
            <Pressable
              ref={rowRef}
              accessibilityRole={inert ? undefined : "button"}
              accessibilityLabel={label}
              accessibilityState={inert ? undefined : { expanded }}
              // React Native Web reads the ARIA prop, not `accessibilityState`.
              aria-expanded={inert ? undefined : expanded}
              disabled={inert}
              onPressIn={pressIn}
              onPressOut={pressOut}
              onPress={toggle}
              onLongPress={longPress}
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
                    color={palette.icon}
                  />
                ) : showIcon ? (
                  icon
                ) : null}
              </View>
              {showVerb ? (
                <Text
                  {...((inert ? selectionSurface : {}) as object)}
                  selectable={inert}
                  numberOfLines={1}
                  style={[
                    styles.verb,
                    textSelect,
                    {
                      color: palette.target,
                      fontFamily: tokens.fontUi,
                      fontSize: block.label.size,
                      lineHeight: block.label.lineHeight,
                    },
                  ]}
                >
                  {verb}
                </Text>
              ) : null}
              {hoverActions ? (
                <View style={styles.targetBox}>
                  {countedTarget ?? <View style={styles.fill} />}
                  <View style={[styles.overlay, { backgroundColor: inert ? tokens.v2.surface0 : tokens.v2.surface1 }]}>
                    <RowTooltips>{actions}</RowTooltips>
                  </View>
                </View>
              ) : (
                countedTarget
              )}
              {metaLead}
              {metaText}
              {persistentActions ? (
                <View style={styles.inlineActions}>
                  <RowTooltips>{actions}</RowTooltips>
                </View>
              ) : null}
            </Pressable>
          </RowLongPressContext.Provider>
        </HoverPreviewContext.Provider>
      </RowPaletteContext.Provider>
      {preview.open && previewContent ? (
        <HoverPreview preview={preview} tokens={tokens} wraps={previewWraps}>{previewContent()}</HoverPreview>
      ) : null}
    </>
  );
}

/**
 * The names of a row's buttons open above the row (the next row would paint
 * over them below) and towards the row's start: the buttons sit at its end.
 */
function RowTooltips({ children }: { children: ReactNode }) {
  return (
    <TooltipSideContext.Provider value="auto">
      <TooltipAlignContext.Provider value="end">{children}</TooltipAlignContext.Provider>
    </TooltipSideContext.Provider>
  );
}

const styles = StyleSheet.create({
  countedTarget: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.xs },
  countedTitle: { flexShrink: 1, minWidth: 0 },
  countBadge: { width: 22, height: 22, borderRadius: 11, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  countText: { fontSize: 11, lineHeight: 14, fontVariant: ["tabular-nums"] },
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
