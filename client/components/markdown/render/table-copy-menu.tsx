import React, { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../../theme-tokens";
import { unselectable } from "../../selection";
import { useCopy } from "../../../ui/use-copy";
import { useHover } from "../../../ui/use-hover";
import { useInputCapabilities } from "../../../ui/use-input-capabilities";
import { useReducedMotion } from "../../../ui/use-reduced-motion";
import { easing, motionDuration } from "../../../ui/tokens/motion";
import { FLOAT, FLOAT_EASE, floatHover, floatPressed, floatShadow } from "../../../ui/tokens/float";
import { canCopyImage, copyElementImage } from "../../../ui/element-image";
import { ToolbarCopyButton } from "../../../ui/toolbar-button";
import { UI_SCALE } from "../../../ui/tokens/typography";
import { useEnhancerPreferences } from "../../../preferences";
import { toolbarLabel } from "../../../i18n/toolbar-strings";
import { bindTouchDismiss, suppressTouchCallout } from "../../../web";
import { ChatComposerContext, quoteCell } from "../../../ui/chat-composer";
import { insertIntoComposer } from "../../selection-actions";

export const COPY_MARKDOWN_LABEL = "Copy as Markdown";
export const COPY_IMAGE_LABEL = "Copy as image";

/**
 * The copy control at a table's corner, a rounded square like the selection
 * bar's frame. On web it opens to the right into two entries, the Markdown
 * source and a picture of the table as drawn: under a pointer while hovered,
 * on a touch screen after a long press. The first entry sits where the icon
 * was, so a click or a tap without a pause still copies the Markdown. Native
 * keeps the single button. Every platform expands to Copy selected for a selected cell.
 */
export function TableCopyMenu({ source, frame, tokens, selected }: {
  /** The table's Markdown, read when pressed so a streaming table copies its latest rows. */
  source: () => string;
  /** The table's frame; on web its DOM element. */
  frame: RefObject<View | null>;
  tokens: ExtendedThemeTokens;
  selected?: { text: string; dismiss(): void };
}) {
  const { hover } = useInputCapabilities();
  const control = Platform.OS === "web" && canCopyImage()
    ? <ExpandingMenu source={source} frame={frame} tokens={tokens} trigger={hover ? "hover" : "longPress"} />
    : <ToolbarCopyButton text={source} tokens={tokens} label="Copy Markdown table" align="start" outlined />;
  return <SelectionCopyMenu selected={selected} tokens={tokens}>{control}</SelectionCopyMenu>;
}

/** The fixed corner slot keeps its menu mounted through an interruptible exit. */
function SelectionCopyMenu({ children, selected, tokens }: {
  children: ReactNode;
  selected?: { text: string; dismiss(): void };
  tokens: ExtendedThemeTokens;
}) {
  const { copy } = useCopy();
  const composer = useContext(ChatComposerContext);
  const { language } = useEnhancerPreferences();
  const reducedMotion = useReducedMotion();
  const windowWidth = useWindowDimensions().width;
  const open = selected !== undefined;
  const anchorRef = useRef<View>(null);
  const dismiss = selected?.dismiss;
  const selectedText = selected?.text;
  useEffect(() => {
    if (!dismiss || Platform.OS !== "web") return;
    const release = bindTouchDismiss(anchorRef.current, dismiss);
    const doc = (anchorRef.current as unknown as HTMLElement | null)?.ownerDocument;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") dismiss();
      // Cell selection no longer uses a browser range; keep the copy shortcut.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "c"
        && !(event.target as Element | null)?.closest?.("input, textarea, [contenteditable=true]")) {
        event.preventDefault();
        if (selectedText) void copy(selectedText, { feedback: "toast", label: "Copy selected" });
      }
    };
    doc?.addEventListener("keydown", onKeyDown);
    return () => { release(); doc?.removeEventListener("keydown", onKeyDown); };
  }, [dismiss, selectedText, copy]);
  const [shown, setShown] = useState(open);
  // Keep the underlying border hidden until the shrinking frame is removed.
  const buttonHidden = open || shown;
  const [measured, setMeasured] = useState<number | null>(null);
  const width = useRef(new Animated.Value(FLOAT.control)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const latestOpen = useRef(open);
  latestOpen.current = open;
  useLayoutEffect(() => {
    if (!open && !shown) return;
    if (open) setShown(true);
    const target = open && measured !== null ? measured : FLOAT.control;
    const visible = open && measured !== null ? 1 : 0;
    if (reducedMotion) {
      width.setValue(target);
      reveal.setValue(visible);
      if (!open) setShown(false);
      return;
    }
    // Only the absolute clipping frame changes width; the row inside keeps
    // its measured size, and the table never participates in this layout.
    const frameAnimation = Animated.timing(width, {
      toValue: target, duration: open ? 180 : 160, easing: easing.out, useNativeDriver: false,
    });
    const labelAnimation = Animated.timing(reveal, {
      toValue: visible, duration: open ? 140 : 80, easing: easing.out, useNativeDriver: Platform.OS !== "web",
    });
    frameAnimation.start(({ finished }) => {
      if (finished && !latestOpen.current) setShown(false);
    });
    labelAnimation.start();
    return () => { frameAnimation.stop(); labelAnimation.stop(); };
  }, [open, shown, measured, reducedMotion, width, reveal]);
  return (
    <View ref={anchorRef} testID="table-native-copy-slot" style={[styles.nativeSlot, { width: shown ? measured ?? FLOAT.control : FLOAT.control }]}>
      <View pointerEvents={buttonHidden ? "none" : "auto"} accessibilityElementsHidden={buttonHidden}
        aria-hidden={buttonHidden}
        style={{ opacity: buttonHidden ? 0 : 1, ...(Platform.OS === "web" && buttonHidden ? { display: "none" } : {}) }}>
        {children}
      </View>
      {shown ? (
        <Animated.View testID="table-selection-menu-animation" pointerEvents={open ? "auto" : "none"}
          accessibilityElementsHidden={!open}
          aria-hidden={!open}
          style={[styles.frame, styles.nativeFrame, { width, backgroundColor: tokens.surface0, borderColor: tokens.v2.border }]}>
          <View style={{ width: windowWidth }}>
            <View testID="table-selection-menu-row" style={styles.selectedRow}
              onLayout={(event) => setMeasured(Math.ceil(event.nativeEvent.layout.width) + BORDER * 2)}>
              <Pressable accessibilityRole="button" accessible={open} focusable={open} accessibilityLabel={open ? "Copy selected cell" : undefined}
                onPress={() => {
                  if (selected) void copy(selected.text, { feedback: "toast", label: "Copy selected" })
                    .then((ok) => { if (ok) selected.dismiss(); });
                }}
                style={({ pressed }) => [styles.selected, { backgroundColor: pressed ? floatPressed(tokens) : tokens.surface0 }]}>
                <Icon name="Copy" size={FLOAT.iconSize} color={tokens.foregroundMuted} />
                <Animated.View style={{ opacity: reveal,
                  transform: [{ translateX: reveal.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }] }}>
                  <Text selectable={false} numberOfLines={1}
                    style={[styles.label, unselectable, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
                    {toolbarLabel("Copy selected", language)}
                  </Text>
                </Animated.View>
              </Pressable>
              {Platform.OS === "web" || composer ? (
                <Animated.View style={{ opacity: reveal,
                  transform: [{ translateX: reveal.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }] }}>
                  <Pressable accessibilityRole="button" accessible={open} focusable={open}
                    accessibilityLabel={open ? "Add to chat" : undefined}
                    onPress={() => {
                      if (!selected) return;
                      const snippet = quoteCell(selected.text);
                      const added = Platform.OS === "web"
                        ? insertIntoComposer(snippet, anchorRef.current as unknown as Element | null)
                        : composer!.appendText(snippet);
                      if (added) selected.dismiss();
                    }}
                    style={({ pressed }) => [styles.selected, { backgroundColor: pressed ? floatPressed(tokens) : tokens.surface0 }]}>
                    <Icon name="MessageSquarePlus" size={FLOAT.iconSize} color={tokens.foregroundMuted} />
                    <Text selectable={false} numberOfLines={1}
                      style={[styles.label, unselectable, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
                      {toolbarLabel("Add to chat", language)}
                    </Text>
                  </Pressable>
                </Animated.View>
              ) : null}
            </View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

function ExpandingMenu({ source, frame, tokens, trigger }: {
  source: () => string;
  frame: RefObject<View | null>;
  tokens: ExtendedThemeTokens;
  /** A pointer opens it by resting on it; touch by a long press, and a scroll or a touch elsewhere closes it. */
  trigger: "hover" | "longPress";
}) {
  const anchorRef = useRef<View>(null);
  // Bound to the whole control, so the pointer moving between entries keeps it open.
  const { hovered, hoverProps } = useHover(anchorRef);
  // Keyboard focus opens it too, so Tab reaches the second entry. A tap also
  // focuses a button on some phones, so touch leaves focus out.
  const [focused, setFocused] = useState(0);
  const [pressedOpen, setPressedOpen] = useState(false);
  const open = trigger === "hover" ? hovered || focused > 0 : pressedOpen;
  useLayoutEffect(() => {
    if (trigger === "longPress") suppressTouchCallout(anchorRef.current);
  }, [trigger]);
  useEffect(() => {
    if (!pressedOpen) return;
    return bindTouchDismiss(anchorRef.current, () => setPressedOpen(false));
  }, [pressedOpen]);
  const reducedMotion = useReducedMotion();
  // The open width, measured from the row of entries, which is laid out at
  // its full size whether or not the frame shows it.
  const [openWidth, setOpenWidth] = useState<number | null>(null);
  const markdown = useCopy();
  const image = useCopy();
  const copyMarkdown = useCallback(() => {
    const value = source();
    if (value) void markdown.copy(value, { label: COPY_MARKDOWN_LABEL });
  }, [markdown.copy, source]);
  const copyImage = useCallback(() => {
    void image.copyWith(async () => {
      const element = frame.current as unknown as HTMLElement | null;
      if (!element) throw new Error("The table is not on screen");
      await copyElementImage(element, { background: tokens.surface0 });
    }, { label: COPY_IMAGE_LABEL });
  }, [frame, image.copyWith, tokens.surface0]);
  const motion = menuMotion(open, reducedMotion);
  const focus = {
    onFocus: () => setFocused((count) => count + 1),
    onBlur: () => setFocused((count) => Math.max(0, count - 1)),
  };
  return (
    <View
      ref={anchorRef}
      style={[
        styles.frame,
        motion.frame,
        {
          width: open ? openWidth ?? FLOAT.control : FLOAT.control,
          backgroundColor: tokens.surface0,
          borderColor: tokens.v2.border,
          boxShadow: floatShadow(tokens, open),
        },
      ]}
    >
      <View
        style={styles.row}
        onLayout={(event) => setOpenWidth(Math.ceil(event.nativeEvent.layout.width) + BORDER * 2)}
      >
        <Entry
          icon="Copy"
          label={COPY_MARKDOWN_LABEL}
          copied={markdown.copied}
          open={open}
          first
          motion={motion}
          onPress={copyMarkdown}
          onLongPress={trigger === "longPress" ? () => setPressedOpen(true) : undefined}
          onHoverIn={hoverProps.onHoverIn}
          focus={focus}
          tokens={tokens}
        />
        <Entry
          icon="Image"
          label={COPY_IMAGE_LABEL}
          copied={image.copied}
          open={open}
          motion={motion}
          onPress={copyImage}
          onHoverIn={hoverProps.onHoverIn}
          focus={focus}
          tokens={tokens}
        />
      </View>
    </View>
  );
}

/**
 * One entry. Both stay mounted so the frame can widen over them; while it is
 * closed the names and the second entry are faded out and shifted 4 to the
 * left, and the second entry, clipped away, is out of the tab order and
 * hidden from assistive tech.
 */
function Entry({ icon, label, copied, open, first = false, motion, onPress, onLongPress, onHoverIn, focus, tokens }: {
  icon: string;
  label: string;
  copied: boolean;
  open: boolean;
  /** The entry under the closed square: the only one reachable while closed. */
  first?: boolean;
  motion: MenuMotion;
  onPress(): void;
  onLongPress?: () => void;
  onHoverIn(): void;
  focus: { onFocus(): void; onBlur(): void };
  tokens: ExtendedThemeTokens;
}) {
  const { hovered, hoverProps } = useHover();
  const preferences = useEnhancerPreferences();
  const reachable = open || first;
  const name = (
    <Text
      selectable={false}
      numberOfLines={1}
      style={[styles.label, unselectable, { color: tokens.foreground, fontFamily: tokens.fontUi }]}
    >
      {toolbarLabel(label, preferences.language)}
    </Text>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? "Copied" : label}
      aria-hidden={!reachable}
      focusable={reachable}
      onPress={onPress}
      onLongPress={onLongPress}
      onHoverIn={() => {
        hoverProps.onHoverIn();
        onHoverIn();
      }}
      onHoverOut={hoverProps.onHoverOut}
      {...focus}
      style={({ pressed }) => [
        styles.entry,
        first ? styles.entryFirst : [styles.entryLast, motion.reveal, revealed(open)],
        motion.fill,
        {
          backgroundColor: !open ? "transparent"
            : pressed ? floatPressed(tokens)
            : hovered ? floatHover(tokens)
            : "transparent",
        },
      ]}
    >
      {/* The check is the result, so it alone takes a colour; the icons stay muted like the preview toolbar's. */}
      <Icon name={copied ? "Check" : icon} size={FLOAT.iconSize} color={copied ? tokens.success : tokens.foregroundMuted} />
      {first ? <View style={[motion.reveal, revealed(open)]}>{name}</View> : name}
    </Pressable>
  );
}

interface MenuMotion {
  frame: object;
  /** The names and the second entry. */
  reveal: object;
  /** An entry's hover and press fill. */
  fill: object;
}

/**
 * CSS transitions, as the menu exists on web only (docs/prototypes/table-copy-menu.md).
 * Opening widens the frame and lifts its shadow over 180 ms, and the names
 * follow 40 ms later; closing fades the names first and narrows the frame
 * over 160 ms. The declarations follow the state being entered, so a pointer
 * that leaves halfway reverses from where the frame is.
 */
function menuMotion(open: boolean, reducedMotion: boolean): MenuMotion {
  const ms = (value: number) => `${motionDuration(value, reducedMotion)}ms`;
  return {
    frame: {
      transitionProperty: "width, box-shadow",
      transitionDuration: open ? `${ms(180)}, ${ms(180)}` : `${ms(160)}, ${ms(120)}`,
      transitionTimingFunction: FLOAT_EASE.out,
    },
    reveal: {
      transitionProperty: "opacity, transform",
      transitionDuration: open ? ms(140) : ms(80),
      transitionDelay: open ? ms(40) : "0ms",
      transitionTimingFunction: open ? FLOAT_EASE.out : FLOAT_EASE.in,
    },
    fill: {
      transitionProperty: "background-color",
      transitionDuration: ms(100),
      transitionTimingFunction: FLOAT_EASE.out,
    },
  };
}

function revealed(open: boolean): object {
  return open ? { opacity: 1, transform: [{ translateX: 0 }] } : { opacity: 0, transform: [{ translateX: -4 }] };
}

const BORDER = 1;

const styles = StyleSheet.create({
  nativeSlot: { width: FLOAT.control, height: FLOAT.control },
  nativeFrame: { position: "absolute", top: 0, left: 0 },
  selectedRow: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center" },
  selected: { alignSelf: "flex-start", height: FLOAT.control - BORDER * 2, flexDirection: "row", alignItems: "center", gap: FLOAT.iconText, paddingLeft: 7, paddingRight: 10 },
  // A rounded square while closed; open, the same frame is a wider rounded rectangle.
  frame: {
    height: FLOAT.control,
    borderWidth: BORDER,
    borderRadius: FLOAT.radius,
    overflow: "hidden",
  },
  // Out of the frame's flow, so it keeps its full width while the frame clips it.
  // The same inset and gap as the selection bar, so the two entries sit like its buttons.
  row: {
    position: "absolute",
    top: 0,
    left: 0,
    height: FLOAT.control - BORDER * 2,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: FLOAT.inset,
    gap: FLOAT.inset,
  },
  entry: {
    height: FLOAT.item,
    borderRadius: FLOAT.itemRadius,
    flexDirection: "row",
    alignItems: "center",
    gap: FLOAT.iconText,
  },
  // Border 1 + row padding 2 + paddingLeft 5 puts the icon's centre at 15, the closed square's centre.
  entryFirst: { paddingLeft: 5, paddingRight: 10 },
  entryLast: { paddingLeft: 8, paddingRight: 10 },
  label: { fontSize: UI_SCALE.base, lineHeight: 16, fontWeight: "500", whiteSpace: "nowrap" } as object,
});
