import React, { useLayoutEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeInsets, type Insets } from "./details/shell/safe-area";
import { type PageLook } from "./settings-controls";
import { SelectOption, SelectTrigger, selectMenuSurface, selectOptionHeight } from "./settings-select";

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

/** The menu's gap from the control and its margin inside the safe area. */
const GAP = 4;
const EDGE = 8;

/**
 * Where the menu sits, in window coordinates. It stays inside the safe area
 * (a native menu is a Modal drawn under the status bar and the home
 * indicator), below the control when the whole list fits there, else above
 * it, else on the roomier side with the list scrolling. When neither side
 * holds a few rows (a short window), it may cover the control instead.
 */
function placeChoiceMenu(
  anchor: Anchor,
  windowHeight: number,
  insets: Insets,
  content: number,
  row: number,
): { top: number; height: number } {
  const first = insets.top + EDGE;
  const last = windowHeight - insets.bottom - EDGE;
  const height = Math.max(0, Math.min(content, last - first));
  const below = anchor.y + anchor.height + GAP;
  const above = anchor.y - GAP;
  if (below + height <= last) return { top: below, height };
  if (above - height >= first) return { top: above - height, height };
  const roomBelow = last - below;
  const roomAbove = above - first;
  if (Math.max(roomBelow, roomAbove) >= Math.min(height, row * 3 + 12)) {
    return roomBelow >= roomAbove
      ? { top: below, height: roomBelow }
      : { top: first, height: roomAbove };
  }
  return { top: Math.max(first, Math.min(below, last - height)), height };
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
      <SelectTrigger
        triggerRef={trigger}
        look={look}
        label={label}
        text={selected?.name ?? label}
        logo={selected?.logo}
        open={open}
        disabled={disabled}
        onPress={() => open ? setOpen(false) : openMenu()}
      />
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
  // Null on native until its probe has laid out once (web reads zero); the
  // menu stays invisible and untouchable until then.
  const [insets, insetProbe] = useSafeInsets();
  const rowHeight = selectOptionHeight(compact);
  const width = Math.min(Math.max(anchor.width, 220), Math.max(160, window.width - 16));
  const left = Math.max(8, Math.min(anchor.x, window.width - width - 8));
  const place = placeChoiceMenu(anchor, window.height, insets ?? { top: 0, bottom: 0 }, choices.length * rowHeight + 12, rowHeight);
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
      {insetProbe}
      <View
        pointerEvents={insets ? "auto" : "none"}
        accessibilityElementsHidden={!insets}
        importantForAccessibility={insets ? "auto" : "no-hide-descendants"}
        style={{
          position: "absolute",
          opacity: insets ? 1 : 0,
          left,
          top: place.top,
          width,
          maxHeight: place.height,
          ...selectMenuSurface(tokens),
        }}
      >
        <ScrollView contentContainerStyle={styles.menuPad} showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}>
          <View accessibilityRole="radiogroup" accessibilityLabel={label}>
            {choices.map((choice) => (
              <SelectOption
                key={choice.value}
                look={look}
                name={choice.name}
                logo={choice.logo}
                selected={choice.value === value}
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

const styles = StyleSheet.create({
  menuPad: { paddingVertical: 6 },
});
