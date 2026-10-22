import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type TextProps } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { selectableTextStyle, unselectable } from "../components/selection";
import { selectionSurface } from "../components/selection-actions";
import { surfaceProps } from "../components/view-props";
import { BrandMark } from "../components/glyph";
import { ProviderLogo } from "../components/provider-logo";
import { codeSurface } from "../components/host-font-escape";
import { truncateMiddle } from "../paths/truncate-middle";
import { TYPE } from "./tokens/typography";
import { useHover } from "./use-hover";
import { useInputCapabilities } from "./use-input-capabilities";
import { useEnhancerPreferences } from "../preferences";
import { TooltipAlignContext, TooltipSideContext } from "./toolbar-button";
import { HoverPreview, HoverPreviewContext, RowLongPressContext, useHoverPreview } from "./hover-preview";
import { useScrollAnchor, type ScrollAnchor } from "./scroll-anchor";
import { useContainerButton } from "./container-button";
import { BlockPlacementContext, type BlockEntry, type CopyItem } from "../details/contracts";
import { registerBlock, type BlockRegistration } from "../details/block-registry";
import { detailsApi, useDetails } from "../details/details-store";
import { rowPressAction } from "../details/click-model";
import { CurrentMarker } from "../details/current-marker";
import { RowMenu, type RowMenuAnchor } from "../details/row-menu";
import { toolbarLabel } from "../i18n/toolbar-strings";

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

/** Paths inside a details row share its body press instead of taking the tap. */
export const RowBodyPressContext = createContext<((event?: GestureResponderEvent) => void) | undefined>(undefined);

/**
 * A tool icon in the row's icon colour, unless `color` sets a status. A
 * `provider:*` name draws that harness's mark as a one-colour silhouette, so
 * it sits among the Lucide icons rather than in its brand hue.
 */
export function RowIcon({ name, color, size = DISCLOSURE_HEADER.icon }: { name: string; color?: string; size?: number }) {
  const palette = useContext(RowPaletteContext);
  const drawn = color ?? palette?.icon ?? "currentColor";
  // Drawn bare, without Glyph's box: a row's icon is one view whichever set it comes from.
  // `tintColor` takes no `currentColor`; Glyph's default grey stands in for it.
  if (name.startsWith("brand:")) {
    return <BrandMark id={name.toLowerCase()} size={size} color={drawn === "currentColor" ? "#94a3b8" : drawn} />;
  }
  if (name.startsWith("provider:")) {
    return <ProviderLogo provider={name.slice(9)} size={size} color={drawn === "currentColor" ? undefined : drawn} />;
  }
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
  detailsTitle?: string | { text: string; mono: boolean };
  detailsSubtitle?: readonly string[];
  detailsTone?: BlockEntry["tone"];
  detailsIcon?: string;
  copyItems?(): CopyItem[];
  readsImage?: boolean;
  onViewImage?(): void;
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
   * The verb carries the outcome ("Finished", "Needs permission"), so it stays
   * beside the target whatever the reader's row label style.
   */
  keepVerb?: boolean;
  /** The verb's colour for a row that reports a state (danger, warning). */
  verbColor?: string;
  /** `ui` draws the meta in the interface face, as agent rows read as words. */
  metaFont?: "mono" | "ui";
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
  keepVerb = false,
  verbColor,
  metaFont = "mono",
  detailsTitle,
  detailsSubtitle,
  detailsTone,
  detailsIcon,
  copyItems,
  readsImage = false,
  onViewImage,
}: DisclosureHeaderProps) {
  const preferences = useEnhancerPreferences();
  const placement = useContext(BlockPlacementContext);
  const previewOwner = useContext(HoverPreviewContext);
  const detailsEnabled = Boolean(preferences.blockDetails && placement && previewKey && !previewOwner);
  const details = useDetails(detailsEnabled ? placement!.agentId : "");
  const isCurrent = detailsEnabled && details.openId === previewKey;
  const [menuAnchor, setMenuAnchor] = useState<RowMenuAnchor | null>(null);
  const menuOpen = menuAnchor !== null;
  useEffect(() => { if (!detailsEnabled) setMenuAnchor(null); }, [detailsEnabled]);
  const preview = useHoverPreview(Boolean(previewContent) && !expanded && !actionsActive && !inert && !isCurrent && !menuOpen, previewKey);
  useEffect(() => {
    if (preview.open) onPreviewOpen?.();
  }, [preview.open, onPreviewOpen]);
  const ownAnchor = useScrollAnchor(expanded);
  const anchor = scrollAnchor ?? ownAnchor;
  const { anchorRef } = preview;
  const legacyLongPress = (pressPreview ? preview.press : undefined) ?? onLongPress;
  const rowRef = useCallback(
    (node: View | null) => {
      anchorRef.current = node;
      anchor.ref.current = node;
    },
    [anchorRef, anchor.ref],
  );
  // The row holds its copy buttons and a pressable path, so on web it is a
  // <div> with role="button" rather than a <button> (see `useContainerButton`).
  const button = useContainerButton(detailsEnabled || !inert, rowRef);
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
  const palette = rowPalette(tokens, tone, hovered || pressed || expanded || menuOpen || isCurrent);
  const rowLabelStyle = preferences.rowLabelStyle;
  // Icon-only rows still need words: a row with no target keeps its verb.
  const hasTarget = target !== undefined && target !== null && target !== "";
  const showVerb = keepVerb || rowLabelStyle !== "icon" || !hasTarget;
  const showIcon = rowLabelStyle !== "label" || iconIsStatus;
  const block = tokens.typography.block;
  const height = compact ? block.rowHeight.compact : block.rowHeight.desktop;
  const slop = capabilities.touch ? Math.max(0, (DISCLOSURE_HEADER.hit - height) / 2) : 0;
  const targetType = block.target;
  const textSelect = inert && !detailsEnabled ? selectableTextStyle : unselectable;

  const persistentActions =
    actions !== undefined &&
    (actionsAlwaysVisible || (capabilities.touch && !capabilities.hover && expanded));
  // A row whose actions show on hover keeps its target in their box from the
  // start: wrapping it as the pointer arrived remounted the text under it, and
  // a click that came with the pointer (its press before that commit, its
  // release after) lost its target and never fired.
  const hoverSlot = actions !== undefined && !persistentActions && capabilities.hover;
  const hoverActions = hoverSlot && (hover.hovered || actionsActive);
  // An opened row shows which way it went; a status icon (running, failed)
  // keeps its place, since it says more than the direction.
  const showChevron = !inert && ((capabilities.hover && hovered) || (expanded && !iconIsStatus));

  const baseLabel = accessibilityLabel ?? (typeof target === "string" && target ? `${verb} ${target}` : verb);
  const label = count && count > 1 ? `${baseLabel}, ${count} operations` : baseLabel;
  const title = typeof detailsTitle === "object" ? detailsTitle.text : detailsTitle ?? baseLabel;
  const registration = useRef<BlockRegistration | null>(null);
  const entry = useRef<BlockEntry | null>(null);
  entry.current = detailsEnabled ? {
    id: previewKey!, agentId: placement!.agentId, at: placement!.at, kind: placement!.kind,
    seq: 0, mounted: true, navigable: !inert, hasBody: !inert,
    title, titleMono: typeof detailsTitle === "object" ? detailsTitle.mono : typeof target === "string",
    subtitle: (detailsSubtitle ?? meta?.filter((part): part is string => typeof part === "string") ?? [])
      .map((part) => toolbarLabel(part, preferences.language)),
    tone: detailsTone, icon: detailsIcon ?? "FileText", readsImage,
    render: previewContent ?? (() => null), copies: copyItems ?? (() => []), onOpen: onPreviewOpen,
    measure: () => new Promise((resolve) => {
      const node = anchorRef.current;
      if (!node) return resolve(null);
      node.measureInWindow((_x, top, _width, height) => resolve({ top, height }));
    }),
  } : null;
  useEffect(() => {
    if (!entry.current) return;
    const handle = registerBlock(entry.current);
    registration.current = handle;
    return () => { handle.release(); registration.current = null; };
  }, [detailsEnabled, placement?.agentId, previewKey]);
  useEffect(() => {
    if (entry.current) registration.current?.update(entry.current);
  });
  const pressedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pressedTimer.current) clearTimeout(pressedTimer.current); }, []);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const openMenu = useCallback(() => {
    if (moved.current) return;
    const node = anchorRef.current;
    node?.measureInWindow((x, y, width, height) => setMenuAnchor({ x, y, width, height }));
  }, [anchorRef]);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);
  useEffect(() => { if (menuOpen && readsImage) onPreviewOpen?.(); }, [menuOpen, readsImage, onPreviewOpen]);
  const longPress = detailsEnabled ? openMenu : legacyLongPress;
  const bodyPress = () => {
    if (menuOpen || moved.current) return;
    const action = rowPressAction({ pointer: capabilities.hover, hasBody: !inert, readsImage,
      isCurrent, form: details.openId ? details.form : null });
    switch (action) {
      case "details": preview.close(); detailsApi.open(placement!.agentId, previewKey!); break;
      case "viewer": preview.close(); onViewImage?.(); break;
      case "expand": toggle(); break;
      case "close": detailsApi.close(placement!.agentId); break;
      case "none":
        setPressed(true);
        if (pressedTimer.current) clearTimeout(pressedTimer.current);
        pressedTimer.current = setTimeout(() => setPressed(false), 120);
        break;
    }
  };
  useEffect(() => {
    if (!detailsEnabled || Platform.OS !== "web") return;
    const node = anchorRef.current as unknown as HTMLElement | null;
    const contextMenu = (event: MouseEvent) => {
      event.preventDefault(); event.stopPropagation(); moved.current = false; openMenu();
    };
    node?.addEventListener?.("contextmenu", contextMenu);
    return () => node?.removeEventListener?.("contextmenu", contextMenu);
  }, [detailsEnabled, anchorRef, openMenu]);
  const budget = compact
    ? DISCLOSURE_HEADER.targetBudget.compact
    : DISCLOSURE_HEADER.targetBudget.desktop;

  const targetNode =
    typeof target === "string" ? (
      <Text
        {...((inert ? surfaceProps(selectionSurface, codeSurface) : codeSurface) as object)}
        selectable={inert && !detailsEnabled}
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
          { color: palette.meta, fontFamily: metaFont === "ui" ? tokens.fontUi : tokens.fontMono, fontSize: block.meta.size, lineHeight: block.meta.lineHeight },
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
          <RowBodyPressContext.Provider value={detailsEnabled ? bodyPress : undefined}>
            <RowLongPressContext.Provider value={detailsEnabled ? openMenu : pressPreview ? preview.press : longPress}>
              <Pressable
                ref={button.ref}
                accessibilityRole={button.accessibilityRole}
                accessibilityLabel={label}
                accessibilityState={inert ? undefined : { expanded }}
                // React Native Web reads the ARIA prop, not `accessibilityState`.
                aria-expanded={inert ? undefined : expanded}
                disabled={inert && !detailsEnabled}
                onPressIn={pressIn}
                onPressOut={pressOut}
                onPress={detailsEnabled ? bodyPress : toggle}
                onLongPress={longPress}
                {...(detailsEnabled ? {
                  delayLongPress: 500,
                  onTouchStart: (event: GestureResponderEvent) => {
                    touchStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
                    moved.current = false;
                  },
                  onTouchMove: (event: GestureResponderEvent) => {
                    const start = touchStart.current;
                    if (start && Math.hypot(event.nativeEvent.pageX - start.x, event.nativeEvent.pageY - start.y) >= 10) moved.current = true;
                  },
                } : {})}
                hitSlop={slop > 0 ? { top: slop, bottom: slop } : undefined}
                {...(pointerProps as object)}
                style={({ pressed: pressedState }) => [
                  styles.row,
                  { height },
                  hovered && { backgroundColor: tokens.v2.surface1 },
                  (pressedState || (detailsEnabled && (menuOpen || actionsActive || pressed))) && { backgroundColor: tokens.v2.surface2 },
                ]}
              >
                {detailsEnabled ? <CurrentMarker agentId={placement!.agentId} id={previewKey!} tokens={tokens} /> : null}
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
                    selectable={inert && !detailsEnabled}
                    numberOfLines={1}
                    style={[
                      styles.verb,
                      textSelect,
                      {
                        color: verbColor ?? palette.target,
                        fontFamily: tokens.fontUi,
                        fontSize: block.label.size,
                        lineHeight: block.label.lineHeight,
                      },
                    ]}
                  >
                    {verb}
                  </Text>
                ) : null}
                {hoverActions || (hoverSlot && countedTarget) ? (
                  <View style={styles.targetBox}>
                    {countedTarget ?? <View style={styles.fill} />}
                    {hoverActions ? (
                      <View style={[styles.overlay, { backgroundColor: inert ? tokens.v2.surface0 : tokens.v2.surface1 }]}>
                        <RowTooltips>{actions}</RowTooltips>
                      </View>
                    ) : null}
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
                {detailsEnabled && !inert ? (
                  <Pressable testID="details-chevron" accessibilityRole="button"
                    accessibilityLabel={toolbarLabel(expanded ? "Collapse in timeline" : "Expand in timeline", preferences.language)}
                    onLongPress={openMenu} delayLongPress={500}
                    onPress={(event) => { event.stopPropagation(); toggle(); }}
                    hitSlop={slop > 0 ? { top: slop, bottom: slop } : undefined}
                    style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: capabilities.hover ? 28 : 44 }} />
                ) : null}
              </Pressable>
            </RowLongPressContext.Provider>
          </RowBodyPressContext.Provider>
        </HoverPreviewContext.Provider>
      </RowPaletteContext.Provider>
      {detailsEnabled && menuAnchor ? <RowMenu anchor={menuAnchor} title={title}
        subtitle={detailsSubtitle} hasBody={!inert} readsImage={readsImage} copyItems={copyItems?.() ?? []}
        expanded={expanded} detailsOpen={isCurrent}
        tokens={tokens} onOpen={() => detailsApi.open(placement!.agentId, previewKey!)}
        onToggle={toggle} onViewImage={onViewImage} onClose={closeMenu} /> : null}
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
    // Android font padding can offset glyphs inside a vertically centered row.
    includeFontPadding: false,
    textAlignVertical: "center",
    fontSize: TYPE.label.size,
    lineHeight: TYPE.label.lineHeight,
    fontWeight: "500",
    flexShrink: 0,
  },
  targetText: {
    includeFontPadding: false,
    textAlignVertical: "center",
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
    includeFontPadding: false,
    textAlignVertical: "center",
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
