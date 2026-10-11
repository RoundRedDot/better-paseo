import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { unselectable } from "../components/selection";
import { useHover } from "./use-hover";

export interface ActionMenuItem {
  id: string;
  label: string;
  /** A Lucide icon name from the host set. */
  icon?: string;
  tone?: "default" | "danger";
  onSelect(): void;
}

/** Open state for one menu: the trigger and the list share it. */
export function useActionMenu(): { open: boolean; toggle(): void; close(): void } {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, toggle, close };
}

const BOX = 24;
const HIT_SLOP = (32 - BOX) / 2;

interface ActionMenuTriggerProps {
  open: boolean;
  onPress(): void;
  tokens: ExtendedThemeTokens;
  label?: string;
}

/** The `⋯` button. Same box and touch target as `CopyButton`. */
export function ActionMenuTrigger({ open, onPress, tokens, label = "More actions" }: ActionMenuTriggerProps) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      hitSlop={HIT_SLOP}
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => [
        styles.trigger,
        (hovered || open) && { backgroundColor: tokens.v2.surface1 },
        pressed && { backgroundColor: tokens.v2.surface2 },
      ]}
    >
      <Icon name="Ellipsis" size={14} color={tokens.foregroundMuted} />
    </Pressable>
  );
}

interface ActionMenuListProps {
  items: readonly ActionMenuItem[];
  open: boolean;
  onClose(): void;
  tokens: ExtendedThemeTokens;
  compact?: boolean;
}

/**
 * The menu body: an inline list that opens downward inside the card (plan
 * §3.8). No overlay and no portal — the plugin has no layer above the
 * timeline, and an inline list cannot be clipped by the row it lives in. It
 * pushes the content below it down by its own height, which is the expected
 * effect of opening something.
 */
export function ActionMenuList({ items, open, onClose, tokens, compact = false }: ActionMenuListProps) {
  if (!open || items.length === 0) return null;
  return (
    <View
      accessibilityRole="menu"
      style={[styles.list, { borderColor: tokens.v2.borderSubtle }]}
    >
      {items.map((item) => (
        <ActionMenuRow
          key={item.id}
          item={item}
          tokens={tokens}
          compact={compact}
          onDone={onClose}
        />
      ))}
    </View>
  );
}

function ActionMenuRow({
  item,
  tokens,
  compact,
  onDone,
}: {
  item: ActionMenuItem;
  tokens: ExtendedThemeTokens;
  compact: boolean;
  onDone(): void;
}) {
  const { hovered, hoverProps } = useHover();
  const color = item.tone === "danger" ? tokens.danger : tokens.foreground;
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={item.label}
      onPress={() => {
        item.onSelect();
        onDone();
      }}
      {...hoverProps}
      style={({ pressed }) => [
        styles.row,
        // 32 on touch-first compact layouts, 28 on desktop.
        { minHeight: compact ? 32 : 28 },
        hovered && { backgroundColor: tokens.v2.surface1 },
        pressed && { backgroundColor: tokens.v2.surface2 },
      ]}
    >
      <View style={styles.rowIcon}>
        {item.icon ? <Icon name={item.icon} size={14} color={tokens.foregroundMuted} /> : null}
      </View>
      <Text
        selectable={false}
        numberOfLines={1}
        style={[styles.rowLabel, unselectable, { color, fontFamily: tokens.fontUi }]}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: BOX,
    height: BOX,
    borderRadius: radiusV2.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: space.sm,
    borderRadius: radiusV2.chip,
  },
  rowIcon: {
    width: 16,
    alignItems: "center",
  },
  rowLabel: {
    fontSize: 13,
    flexShrink: 1,
  },
});
