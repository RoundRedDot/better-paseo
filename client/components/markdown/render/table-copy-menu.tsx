import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../../theme-tokens";
import { unselectable } from "../../selection";
import { useCopy } from "../../../ui/use-copy";
import { useHover } from "../../../ui/use-hover";
import { useInputCapabilities } from "../../../ui/use-input-capabilities";
import { useReducedMotion } from "../../../ui/use-reduced-motion";
import { motionDuration } from "../../../ui/tokens/motion";
import { FLOAT, FLOAT_EASE, floatHover, floatPressed, floatShadow } from "../../../ui/tokens/float";
import { canCopyImage, copyElementImage } from "../../../ui/element-image";
import { ToolbarCopyButton } from "../../../ui/toolbar-button";
import { UI_SCALE } from "../../../ui/tokens/typography";
import { useEnhancerPreferences } from "../../../preferences";
import { toolbarLabel } from "../../../i18n/toolbar-strings";
import { bindTouchDismiss, suppressTouchCallout } from "../../../web";

export const COPY_MARKDOWN_LABEL = "Copy as Markdown";
export const COPY_IMAGE_LABEL = "Copy as image";

/**
 * The copy control at a table's corner, a rounded square like the selection
 * bar's frame. On web it opens to the right into two entries, the Markdown
 * source and a picture of the table as drawn: under a pointer while hovered,
 * on a touch screen after a long press. The first entry sits where the icon
 * was, so a click or a tap without a pause still copies the Markdown. Native
 * keeps the single button: it has no DOM to draw the picture from.
 */
export function TableCopyMenu({ source, frame, tokens }: {
  /** The table's Markdown, read when pressed so a streaming table copies its latest rows. */
  source: () => string;
  /** The table's frame; on web its DOM element. */
  frame: RefObject<View | null>;
  tokens: ExtendedThemeTokens;
}) {
  const { hover } = useInputCapabilities();
  if (Platform.OS !== "web" || !canCopyImage()) {
    return <ToolbarCopyButton text={source} tokens={tokens} label="Copy Markdown table" align="start" outlined />;
  }
  return <ExpandingMenu source={source} frame={frame} tokens={tokens} trigger={hover ? "hover" : "longPress"} />;
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
        <View style={[styles.divider, motion.reveal, revealed(open), { backgroundColor: tokens.v2.border }]} />
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
  /** The names, the divider and the second entry. */
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
  // A rounded square while closed; open, the same frame is a wider rounded rectangle.
  frame: {
    height: FLOAT.control,
    borderWidth: BORDER,
    borderRadius: FLOAT.radius,
    overflow: "hidden",
  },
  // Out of the frame's flow, so it keeps its full width while the frame clips it.
  row: {
    position: "absolute",
    top: 0,
    left: 0,
    height: FLOAT.control - BORDER * 2,
    flexDirection: "row",
    alignItems: "center",
  },
  entry: {
    height: FLOAT.item,
    marginHorizontal: FLOAT.inset,
    borderRadius: FLOAT.itemRadius,
    flexDirection: "row",
    alignItems: "center",
    gap: FLOAT.iconText,
  },
  // 1 + 2 + 5 puts the icon's centre at 15, the closed square's centre, so it does not move as the menu opens.
  entryFirst: { paddingLeft: 5, paddingRight: 10 },
  entryLast: { paddingLeft: 8, paddingRight: 12 },
  divider: { width: 1, height: 12, marginHorizontal: 4 },
  label: { fontSize: UI_SCALE.base, lineHeight: 16, fontWeight: "500", whiteSpace: "nowrap" } as object,
});
