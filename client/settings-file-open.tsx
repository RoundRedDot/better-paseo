import React, { useLayoutEffect, useRef, useState } from "react";
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { FILE_OPEN_APPS, FILE_OPEN_LABELS, type FileOpenApp } from "../shared/file-open-apps";
import { useMarkBitmap } from "./components/marks";
import { radiusV2, space } from "./components/theme-tokens";
import { settingsTextStyle, type PageLook } from "./settings-controls";

/**
 * One editor choice. The closed control shows the saved editor. The menu lists
 * System app and the editors this host can launch, so a name the host cannot
 * open does not take a row. Colour rasters stay out of the monochrome marks.
 */
const LOGO = 20;

const OPTIONS: ReadonlyArray<{ value: FileOpenApp; label: string | null }> = FILE_OPEN_APPS.map((value) => ({
  value,
  label: value === "system" ? null : FILE_OPEN_LABELS[value],
}));

function optionName(option: (typeof OPTIONS)[number], systemLabel: string): string {
  return option.label ?? systemLabel;
}

function visibleOptions(available: readonly FileOpenApp[] | null, value: FileOpenApp) {
  if (available === null) return OPTIONS.filter((option) => option.value === "system" || option.value === value);
  const allowed = new Set<FileOpenApp>(available);
  allowed.add("system");
  return OPTIONS.filter((option) => allowed.has(option.value));
}

function EditorLogo({ app }: { app: FileOpenApp }) {
  const uri = useMarkBitmap(`editor:${app}`);
  if (!uri) return <View style={styles.logo} />;
  return <Image accessible={false} source={{ uri }} resizeMode="contain" style={styles.logo} />;
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

export function FileOpenChoices({
  value,
  onChange,
  look,
  label,
  systemLabel,
  available = null,
}: {
  value: FileOpenApp;
  onChange(next: FileOpenApp): void;
  look: PageLook;
  /** The control's name, the setting title. */
  label: string;
  systemLabel: string;
  /**
   * Editors this host can launch, including `system` once known.
   * Null while the scan has not returned: the menu keeps the saved choice.
   */
  available?: readonly FileOpenApp[] | null;
}) {
  const { tokens, compact } = look;
  const trigger = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const selected = OPTIONS.find((option) => option.value === value) ?? OPTIONS[0]!;
  const selectedName = optionName(selected, systemLabel);
  const choices = visibleOptions(available, value);
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
        accessibilityState={{ expanded: open }}
        accessibilityValue={{ text: selectedName }}
        onPress={() => open ? setOpen(false) : openMenu()}
        style={({ pressed }) => [
          styles.trigger,
          compact ? styles.triggerCompact : null,
          {
            borderColor: tokens.v2.border,
            backgroundColor: pressed ? tokens.v2.surface2 : tokens.v2.surface0,
          },
        ]}
      >
        <EditorLogo app={value} />
        <Text
          numberOfLines={1}
          style={[
            styles.name,
            settingsTextStyle(tokens, -1),
            { color: tokens.foreground, fontWeight: "500", fontFamily: tokens.fontUi },
          ]}
        >
          {selectedName}
        </Text>
        <Chevron color={tokens.foregroundMuted} up={open} />
      </Pressable>
      {open && anchor ? (
        <FileOpenMenu
          anchor={anchor}
          choices={choices}
          value={value}
          label={label}
          systemLabel={systemLabel}
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

function FileOpenMenu({
  anchor,
  choices,
  value,
  label,
  systemLabel,
  look,
  onSelect,
  onClose,
}: {
  anchor: Anchor;
  choices: readonly (typeof OPTIONS)[number][];
  value: FileOpenApp;
  label: string;
  systemLabel: string;
  look: PageLook;
  onSelect(next: FileOpenApp): void;
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
            {choices.map((option) => (
              <FileOpenRow
                key={option.value}
                option={option}
                selected={option.value === value}
                name={optionName(option, systemLabel)}
                height={rowHeight}
                look={look}
                onPress={() => onSelect(option.value)}
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

function FileOpenRow({
  option,
  selected,
  name,
  height,
  look,
  onPress,
}: {
  option: (typeof OPTIONS)[number];
  selected: boolean;
  name: string;
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
      accessibilityLabel={name}
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
      <EditorLogo app={option.value} />
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
        {name}
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
  logo: { width: LOGO, height: LOGO },
  name: { flexShrink: 1, minWidth: 0 },
  chevron: { width: 16, height: 16, alignItems: "center", justifyContent: "center" },
  menuPad: { paddingVertical: 6 },
});
