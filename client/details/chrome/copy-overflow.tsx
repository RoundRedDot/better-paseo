/**
 * The details toolbar's copy buttons: as many as fit side by side, the rest
 * in a "⋯" menu (docs/prototypes/block-details-sheet.md, "复制按钮"). The
 * order is the content's, its first copy the main one, so the fold starts at
 * the last and the first always stays. An empty copy, or one with the label or
 * text of an earlier one, is not offered at all.
 *
 * The buttons are the content's own `ToolbarCopyButton`s; under
 * `CopyOverflowContext` each registers here and draws only while it fits.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../../components/theme-tokens";
import { radiusV2, space } from "../../components/theme-tokens";
import { unselectable } from "../../components/selection";
import { floatShadow } from "../../ui/tokens/float";
import { AnchoredToolbarDetails, ToolbarButton, type CopyOverflow, type CopyOverflowItem } from "../../ui/toolbar-button";
import { bindDetailsEscape, bindTouchDismiss } from "../../web";
import { useEnhancerPreferences } from "../../preferences";
import { toolbarLabel } from "../../i18n/toolbar-strings";

interface Registered {
  seq: number;
  read(): CopyOverflowItem;
  /** What `update` last saw, so an unchanged button does not lay the row out again. */
  seen: string;
}

/**
 * Which of `items` a row of `slots` buttons draws, in order: all of them when
 * they fit, else the first `slots − 1` and a "⋯" for the rest. The first is
 * always drawn. Empty items and repeats (same label or text) are dropped first.
 */
export function foldCopies<T extends { label: string; text: string | undefined }>(items: readonly T[], slots: number): { shown: T[]; folded: T[] } {
  const seen = new Set<string>();
  const kept = items.filter((item) => {
    if (item.text !== undefined && item.text.trim() === "") return false;
    if (seen.has(`label:${item.label}`) || (item.text !== undefined && seen.has(`text:${item.text}`))) return false;
    seen.add(`label:${item.label}`);
    if (item.text !== undefined) seen.add(`text:${item.text}`);
    return true;
  });
  if (kept.length <= slots) return { shown: kept, folded: [] };
  const visible = Math.max(1, slots - 1);
  return { shown: kept.slice(0, visible), folded: kept.slice(visible) };
}

/** How many buttons of `button` with `gap` between them fit in `width`; every one when it is not measured yet. */
export function copySlots(width: number | null, button: number, gap: number): number {
  if (width === null) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.floor((width + gap) / (button + gap)));
}

/** The context the toolbar provides around its copies, and the copies it folded. */
export function useCopyOverflow(slots: number, copiedColor: string): { overflow: CopyOverflow; folded: CopyOverflowItem[] } {
  const items = useRef(new Map<string, Registered>());
  const next = useRef(0);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((value) => value + 1), []);
  const register = useCallback((key: string, read: () => CopyOverflowItem) => {
    items.current.set(key, { seq: next.current++, read, seen: signature(read()) });
    bump();
    return () => {
      items.current.delete(key);
      bump();
    };
  }, [bump]);
  const update = useCallback((key: string) => {
    const entry = items.current.get(key);
    if (!entry) return;
    const now = signature(entry.read());
    if (now === entry.seen) return;
    entry.seen = now;
    bump();
  }, [bump]);
  return useMemo(() => {
    const ordered = [...items.current.entries()].sort((a, b) => a[1].seq - b[1].seq)
      .map(([key, entry]) => ({ key, ...entry.read() }));
    const { shown, folded } = foldCopies(ordered, slots);
    const drawn = new Set(shown.map((item) => item.key));
    return {
      overflow: {
        register,
        update,
        // A button not registered yet draws, as it would anywhere else.
        shows: (key: string) => !items.current.has(key) || drawn.has(key),
        copiedColor,
      },
      folded,
    };
    // `version` stands for the registered buttons, which live in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, slots, copiedColor, register, update]);
}

function signature(item: CopyOverflowItem): string {
  return `${item.label}\u0000${item.icon}\u0000${item.text === undefined ? "\u0001" : item.text}`;
}

/** "⋯" and its menu of the copies that did not fit. */
export function CopyOverflowMenu({ items, tokens }: { items: readonly CopyOverflowItem[]; tokens: ExtendedThemeTokens }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);
  // Web draws the menu on the panel's own layer; a press outside or Esc closes it.
  useLayoutEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const releaseOutside = bindTouchDismiss(anchorRef.current, close, { allowInsideScroll: true });
    const releaseEscape = bindDetailsEscape(anchorRef.current, close);
    return () => { releaseOutside(); releaseEscape(); };
  }, [open, close]);
  if (items.length === 0) return null;
  const menu = <CopyMenu items={items} tokens={tokens} close={close} />;
  return (
    <View ref={anchorRef} collapsable={false} testID="details-copy-overflow" style={styles.anchor}>
      <ToolbarButton icon="MoreVertical" label="More" checked={open} onPress={() => setOpen((value) => !value)} tokens={tokens} align="end" />
      {open ? Platform.OS === "web" ? (
        <View style={[styles.dropdown, menuLook(tokens)]}>{menu}</View>
      ) : (
        // A native panel is a Modal already; only another one can rise over it and take the press outside.
        <AnchoredToolbarDetails anchor={anchorRef} close={close} width={220} tokens={tokens}>{menu}</AnchoredToolbarDetails>
      ) : null}
    </View>
  );
}

function CopyMenu({ items, tokens, close }: { items: readonly CopyOverflowItem[]; tokens: ExtendedThemeTokens; close(): void }) {
  const { language } = useEnhancerPreferences();
  return (
    <View testID="details-copy-menu" accessibilityRole="menu" style={styles.menu}>
      {items.map((item) => (
        <Pressable
          key={item.label}
          accessibilityRole="menuitem"
          accessibilityLabel={toolbarLabel(item.label, language)}
          onPress={() => {
            item.copy();
            close();
          }}
          style={({ pressed }) => [styles.item, Platform.OS === "web" && styles.pointer, pressed && { backgroundColor: tokens.v2.surface2 }]}
        >
          <Icon name={item.icon} size={16} color={tokens.foregroundMuted} />
          <Text selectable={false} numberOfLines={1}
            style={[styles.label, unselectable, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
            {toolbarLabel(item.label, language)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function menuLook(tokens: ExtendedThemeTokens) {
  return { backgroundColor: tokens.surface0, borderColor: tokens.v2.border, boxShadow: floatShadow(tokens) };
}

const styles = StyleSheet.create({
  anchor: { position: "relative", flexShrink: 0, zIndex: 2 },
  dropdown: {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: space.xs,
    minWidth: 200,
    borderWidth: 1,
    borderRadius: radiusV2.card,
    overflow: "hidden",
    zIndex: 10,
  },
  menu: { paddingVertical: space.xs },
  item: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 36, paddingHorizontal: space.md },
  pointer: { cursor: "pointer" } as object,
  label: { flexShrink: 1, fontSize: 14 },
});
