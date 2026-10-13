import React, { useCallback, useRef, useState, type RefObject } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../../theme-tokens";
import { radiusV2 } from "../../theme-tokens";
import { unselectable } from "../../selection";
import { useCopy } from "../../../ui/use-copy";
import { useHover } from "../../../ui/use-hover";
import { useInputCapabilities } from "../../../ui/use-input-capabilities";
import { useReducedMotion } from "../../../ui/use-reduced-motion";
import { duration, motionDuration } from "../../../ui/tokens/motion";
import { canCopyImage, copyElementImage } from "../../../ui/element-image";
import { ToolbarCopyButton } from "../../../ui/toolbar-button";
import { UI_SCALE } from "../../../ui/tokens/typography";
import { useEnhancerPreferences } from "../../../preferences";
import { toolbarLabel } from "../../../i18n/toolbar-strings";

export const COPY_MARKDOWN_LABEL = "Copy as Markdown";
export const COPY_IMAGE_LABEL = "Copy as image";

/**
 * The copy control at a table's corner. A pointer on web opens it to the
 * right into two entries, the Markdown source and a picture of the table as
 * drawn; the first sits where the icon was, so a click without a pause still
 * copies the Markdown. Touch and native keep the single button: they have no
 * hover to open it, and no DOM to draw the picture from.
 */
export function TableCopyMenu({ source, frame, tokens }: {
  /** The table's Markdown, read when pressed so a streaming table copies its latest rows. */
  source: () => string;
  /** The table's frame; on web its DOM element. */
  frame: RefObject<View | null>;
  tokens: ExtendedThemeTokens;
}) {
  const { hover } = useInputCapabilities();
  if (Platform.OS !== "web" || !hover || !canCopyImage()) {
    return <ToolbarCopyButton text={source} tokens={tokens} label="Copy Markdown table" align="start" outlined />;
  }
  return <HoverMenu source={source} frame={frame} tokens={tokens} />;
}

function HoverMenu({ source, frame, tokens }: {
  source: () => string;
  frame: RefObject<View | null>;
  tokens: ExtendedThemeTokens;
}) {
  const anchorRef = useRef<View>(null);
  // Bound to the whole control, so the pointer moving between entries keeps it open.
  const { hovered: open, hoverProps } = useHover(anchorRef);
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
  const motion = transition(motionDuration(duration.menu, reducedMotion));
  return (
    <View
      ref={anchorRef}
      style={[
        styles.frame,
        motion,
        {
          width: open ? openWidth ?? CLOSED : CLOSED,
          backgroundColor: tokens.surface0,
          borderColor: open ? tokens.foregroundMuted : tokens.v2.border,
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
          onHoverIn={hoverProps.onHoverIn}
          tokens={tokens}
        />
        <View style={[styles.divider, motion, { backgroundColor: tokens.v2.border, opacity: open ? 1 : 0 }]} />
        <Entry
          icon="Image"
          label={COPY_IMAGE_LABEL}
          copied={image.copied}
          open={open}
          motion={motion}
          onPress={copyImage}
          onHoverIn={hoverProps.onHoverIn}
          tokens={tokens}
        />
      </View>
    </View>
  );
}

/**
 * One entry. Both stay mounted so the frame can widen over them; while it is
 * closed the names are faded out and the second entry, clipped away, is also
 * out of the tab order and hidden from assistive tech.
 */
function Entry({ icon, label, copied, open, first = false, motion, onPress, onHoverIn, tokens }: {
  icon: string;
  label: string;
  copied: boolean;
  open: boolean;
  /** The entry under the closed circle: the only one reachable while closed. */
  first?: boolean;
  motion: object;
  onPress(): void;
  onHoverIn(): void;
  tokens: ExtendedThemeTokens;
}) {
  const { hovered, hoverProps } = useHover();
  const preferences = useEnhancerPreferences();
  const color = copied ? tokens.foreground : tokens.foregroundMuted;
  const reachable = open || first;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? "Copied" : label}
      aria-hidden={!reachable}
      focusable={reachable}
      onPress={onPress}
      onHoverIn={() => {
        hoverProps.onHoverIn();
        onHoverIn();
      }}
      onHoverOut={hoverProps.onHoverOut}
      style={({ pressed }) => [
        styles.entry,
        first ? styles.entryFirst : styles.entryLast,
        motion,
        { backgroundColor: (hovered || pressed) && open ? tokens.v2.surface2 : "transparent" },
      ]}
    >
      <Icon name={copied ? "Check" : icon} size={ICON} color={color} />
      <Text
        selectable={false}
        numberOfLines={1}
        style={[styles.label, unselectable, motion, { color: tokens.foreground, fontFamily: tokens.fontUi, opacity: open ? 1 : 0 }]}
      >
        {toolbarLabel(label, preferences.language)}
      </Text>
    </Pressable>
  );
}

/** A CSS transition for the frame's width and the fades: the menu exists on web only. */
function transition(ms: number): object {
  return {
    transitionProperty: "width, opacity, border-color, background-color",
    transitionDuration: `${ms}ms`,
    transitionTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
  };
}

/** The closed circle's diameter, its border included: the closed toolbar button's size. */
const CLOSED = 24;
const BORDER = 1;
const ICON = 14;
// The first icon sits in the middle of the closed circle.
const ICON_INSET = (CLOSED - BORDER * 2 - ICON) / 2;

const styles = StyleSheet.create({
  // A circle while closed; open, the round ends make it a capsule.
  frame: {
    height: CLOSED,
    borderWidth: BORDER,
    borderRadius: CLOSED / 2,
    overflow: "hidden",
  },
  // Out of the frame's flow, so it keeps its full width while the frame clips it.
  row: {
    position: "absolute",
    top: 0,
    left: 0,
    height: CLOSED - BORDER * 2,
    flexDirection: "row",
    alignItems: "center",
  },
  entry: {
    height: CLOSED - BORDER * 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  entryFirst: { paddingLeft: ICON_INSET, paddingRight: 8 },
  // A little more room before the capsule's round end.
  entryLast: { paddingLeft: 8, paddingRight: 10 },
  divider: { width: 1, height: 12 },
  label: { fontSize: UI_SCALE.base, lineHeight: 16, whiteSpace: "nowrap" } as object,
});
