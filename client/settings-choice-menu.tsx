import React, { useLayoutEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { radiusV2, space } from "./components/theme-tokens";
import { settingsTextStyle, type PageLook } from "./settings-controls";

/**
 * A settings select: a bordered button showing the saved choice, and a menu
 * anchored under it listing every choice with its logo. The file-open editor
 * and the title provider share it so both menus look and behave the same.
 */
export interface MenuChoice {
  value: string;
  name: string;
  logo: React.ReactNode;
}

/** A stroked chevron drawn here, so the control does not need the host icon set. */
function Chevron({ color, up }: { color: string; up: boolean }) {
  const size = 16;
  const side = size * 0.46;
  const stroke = Math.max(1.2, size / 8.5);
  const nudge = size * 0.11;
  return (
    <View style={styles.chevron}>
      <View
        style={{
          width: side,
          height: side,
          borderRightWidth: stroke,
          borderBottomWidth: stroke,
          borderColor: color,
          transform: [{ rotate: up ? "-135deg" : "45deg" }],
          marginTop: up ? 0 : -nudge,
          marginBottom: up ? -nudge : 0,
        }}
      />
    </View>
  );
}

interface Anchor { x: number; y: number; width: number; height: number }

function readAnchor(node: unknown, done: (anchor: Anchor) => void) {
  const fallback = { x: 8, y: 8, width: 200, height: 36 };
  const measure = node && typeof node === "object" && "measureInWindow" in node
    ? (node as { measureInWindow?: (report: (x: number, y: number, width: number, height: number) => void) => void }).measureInWindow
    : undefined;
  if (typeof measure !== "function") {
    done(fallback);
    return;
  }
  measure.call(node, (x, y, width, height) => done({ x, y, width, height }));
}

export function ChoiceMenuSelect({
  value,
  selected,
  choices,
  onChange,
  look,
  label,
  disabled = false,
}: {
  value: string;
  /** The closed control's face; null shows `label`'s placeholder without a logo. */
  selected: MenuChoice | null;
  choices: readonly MenuChoice[];
  onChange(next: string): void;
  look: PageLook;
  /** The control's name, the setting title. */
  label: string;
  disabled?: boolean;
}) {
  const { tokens, compact } = look;
  const trigger = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const openMenu = () => {
    readAnchor(trigger.current, (next) => {
      setAnchor(next);
      setOpen(true);
    });
  };
  return (
    <>
      <Pressable
        ref={trigger}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open, disabled }}
        accessibilityValue={selected ? { text: selected.name } : undefined}
        disabled={disabled}
        onPress={() => open ? setOpen(false) : openMenu()}
        style={({ pressed }) => [
          styles.trigger,
          compact ? styles.triggerCompact : null,
          {
            borderColor: tokens.v2.border,
            backgroundColor: pressed ? tokens.v2.surface2 : tokens.v2.surface0,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        {selected?.logo ?? null}
        <Text
          numberOfLines={1}
          style={[
            styles.name,
            settingsTextStyle(tokens, -1),
            { color: tokens.foreground, fontWeight: "500", fontFamily: tokens.fontUi },
          ]}
        >
          {selected?.name ?? label}
        </Text>
        <Chevron color={tokens.foregroundMuted} up={open} />
      </Pressable>
      {open && anchor ? (
        <ChoiceMenu
          anchor={anchor}
          choices={choices}
          value={value}
          label={label}
          look={look}
          onSelect={(next) => {
            onChange(next);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ChoiceMenu({
  anchor,
  choices,
  value,
  label,
  look,
  onSelect,
  onClose,
}: {
  anchor: Anchor;
  choices: readonly MenuChoice[];
  value: string;
  label: string;
  look: PageLook;
  onSelect(next: string): void;
  onClose(): void;
}) {
  const { tokens, compact } = look;
  const window = useWindowDimensions();
  const layer = useRef<View>(null);
  const rowHeight = compact ? 44 : 32;
  const width = Math.min(Math.max(anchor.width, 220), Math.max(160, window.width - 16));
  const estimated = Math.min(window.height - 16, choices.length * rowHeight + 12);
  const left = Math.max(8, Math.min(anchor.x, window.width - width - 8));
  const below = anchor.y + anchor.height + 4;
  const top = below + estimated > window.height - 8 ? Math.max(8, anchor.y - estimated - 4) : below;
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = layer.current as unknown as HTMLElement | null;
    // The test renderer and native hosts expose a view, not a DOM node.
    if (!node || typeof node.setAttribute !== "function" || !node.ownerDocument) return;
    node.setAttribute("popover", "manual");
    try { node.showPopover(); } catch { /* the host already shows the layer */ }
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    node.ownerDocument.addEventListener("keydown", key, true);
    return () => {
      node.ownerDocument.removeEventListener("keydown", key, true);
      try { node.hidePopover(); } catch { /* already closed */ }
    };
  }, [onClose]);
  const content = (
    <View
      ref={layer}
      style={[
        StyleSheet.absoluteFill,
        Platform.OS === "web" && { position: "fixed", margin: 0, padding: 0, borderWidth: 0, width: "100%", height: "100%", backgroundColor: "transparent" } as never,
      ]}
    >
      <Pressable accessible={false} importantForAccessibility="no" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View
        style={{
          position: "absolute",
          left,
          top,
          width,
          maxHeight: estimated,
          borderRadius: 12,
          backgroundColor: tokens.v2.surface0,
          borderColor: tokens.v2.border,
          borderWidth: StyleSheet.hairlineWidth,
          boxShadow: tokens.isDark ? "0px 8px 32px rgba(0,0,0,0.5)" : "0px 8px 32px rgba(0,0,0,0.12)",
        }}
      >
        <ScrollView contentContainerStyle={styles.menuPad} showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}>
          <View accessibilityRole="radiogroup" accessibilityLabel={label}>
            {choices.map((choice) => (
              <ChoiceRow
                key={choice.value}
                choice={choice}
                selected={choice.value === value}
                height={rowHeight}
                look={look}
                onPress={() => onSelect(choice.value)}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
  return Platform.OS === "web" ? content : (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>{content}</Modal>
  );
}

function ChoiceRow({
  choice,
  selected,
  height,
  look,
  onPress,
}: {
  choice: MenuChoice;
  selected: boolean;
  height: number;
  look: PageLook;
  onPress(): void;
}) {
  const { tokens } = look;
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      aria-checked={selected}
      accessibilityLabel={choice.name}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => ({
        height,
        marginHorizontal: 6,
        paddingHorizontal: 8,
        borderRadius: radiusV2.block,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        backgroundColor: pressed || hovered || selected ? tokens.v2.surface2 : "transparent",
      })}
    >
      {choice.logo}
      <Text
        numberOfLines={1}
        style={[
          styles.name,
          settingsTextStyle(tokens, -1),
          {
            color: selected ? tokens.foreground : tokens.foregroundMuted,
            fontWeight: selected ? "500" : "400",
            fontFamily: tokens.fontUi,
          },
        ]}
      >
        {choice.name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radiusV2.block,
    borderWidth: 1,
  },
  triggerCompact: { minHeight: 44 },
  name: { flexShrink: 1, minWidth: 0 },
  chevron: { width: 16, height: 16, alignItems: "center", justifyContent: "center" },
  menuPad: { paddingVertical: 6 },
});
