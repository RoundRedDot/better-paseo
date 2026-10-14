import React, { useCallback, useContext, useMemo, useState } from "react";
import { View, Text, Pressable, Image, StyleSheet, Platform } from "react-native";
import { Glyph } from "./glyph";
import { ImageViewer } from "./image-viewer";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { unselectable } from "./selection";
import { PathContext, PathText } from "../ui/path-text";
import { formatPath } from "../paths/format-path";
import { DISCLOSURE_HEADER } from "../ui/disclosure-header";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { useScrollAnchor } from "../ui/scroll-anchor";
import { useCopy } from "../ui/use-copy";
import { ToolbarCopyButton } from "../ui/toolbar-button";
import { PreviewPath } from "../ui/command-band";
import {
  HoverPreview,
  HoverPreviewBody,
  HoverPreviewContext,
  HoverPreviewHeader,
  useHoverPreview,
  usePreviewPanel,
} from "../ui/hover-preview";
import type { ImageFile } from "../image-file";

interface ImagePreviewProps {
  /** The path as the tool reported it, selector and all. */
  path: string;
  /** Null while the daemon is still reading the file. */
  file: ImageFile | null;
  tokens: ExtendedThemeTokens;
  /** Shows the file in the machine's own file manager. */
  onReveal?: () => void;
  /**
   * In prose, outdent the card the way a tool row is outdented, so its icon
   * and path share the rows' icon edge and text column and the picture starts
   * on the prose edge. Inside an opened tool body the body's own padding
   * already places it.
   */
  bleed?: boolean;
  /**
   * Drawn inside a row's hover or long-press preview: a smaller picture that
   * fits the resting panel, no path (the panel shows it whole), and no
   * show/hide toggle. A maximized panel gives the picture the room left over.
   * A press calls `onView` and closes the panel: the viewer has to be owned
   * outside the popover, which would otherwise cover it.
   */
  preview?: boolean;
  /**
   * Opens the full-screen viewer from a maximized preview. The owner stays
   * mounted after the panel closes.
   */
  onView?: () => void;
}

/**
 * The tallest a thumbnail grows. Past this the image scales down to fit; a
 * press opens it at the size of the window.
 */
const MAX_HEIGHT = 480;
/**
 * The tallest a thumbnail grows inside a preview panel. On web the hover panel
 * is 360 tall (`PREVIEW_LIMIT`) and this leaves room for its toolbar, the path
 * and the card's header; a phone's long-press panel has about 500.
 */
export const PREVIEW_MAX_HEIGHT = Platform.OS === "web" ? 220 : 320;

/**
 * The thumbnail's box, from the image's own pixels: a box sized by width alone
 * letterboxes a tall image inside empty sides, and a fixed height blows a
 * 32 px icon up to eight times its size. Width leads and height follows the
 * ratio: the box fills the column but grows no wider than the file itself or
 * than `maxHeight` allows.
 *
 * `maxHeight` repeats what `maxWidth` already implies, for Yoga: it derives
 * the height from the 100% width before `maxWidth` narrows it, so a tall
 * screenshot on a phone got a 218-wide box 750 tall and its picture sat
 * between two bands of empty canvas. CSS sizes it right either way.
 */
export function thumbnailFrame(width: number, height: number, maxHeight: number) {
  const ratio = width / height;
  const maxWidth = Math.min(width, maxHeight * ratio);
  return {
    width: "100%" as const,
    maxWidth,
    maxHeight: maxWidth / ratio,
    aspectRatio: ratio,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function imageChips(file: ImageFile | null): string[] {
  const chips: string[] = [];
  if (file?.width && file.height) chips.push(`${file.width} × ${file.height}`);
  if (file?.bytes) chips.push(formatBytes(file.bytes));
  return chips;
}

/** A picture's size and weight, as the card's header and a preview's toolbar show them. */
export function ImageMeta({ file, tokens }: { file: ImageFile | null; tokens: ExtendedThemeTokens }) {
  const chips = imageChips(file);
  if (chips.length === 0) return null;
  const chip = {
    fontFamily: tokens.fontUi,
    fontSize: tokens.typography.block.meta.size,
    fontVariant: ["tabular-nums" as const],
    color: tokens.foregroundMuted,
    ...unselectable,
  };
  return (
    <View style={metaStyles.chips}>
      {chips.map((text) => (
        <Text key={text} selectable={false} style={chip}>
          {text}
        </Text>
      ))}
    </View>
  );
}

const metaStyles = StyleSheet.create({
  chips: { flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 0 },
});

/**
 * A read of an image, drawn as the image.
 *
 * The reader hands the timeline a placeholder line rather than bytes, so
 * without this an image file renders as an empty code block with a language
 * badge — text chrome around nothing. The bytes come from the plugin's own
 * daemon-side RPC, which is the only side that can reach the file.
 *
 * The thumbnail keeps the file's aspect ratio when the header gave one, and
 * falls back to a fixed box when the header could not be read: an image that
 * loads but reports no size still has to occupy an honest amount of room.
 *
 * The whole header is the show/hide control, as a tool row is the control for
 * its body; the eye at its end says which way it goes. On a pointer device the
 * path still reveals the file; on touch a press anywhere on the header
 * toggles and a long press copies the path. The toggle keeps the header under
 * the finger (`useScrollAnchor`): in the native timeline the picture
 * collapsing would otherwise throw the header off screen.
 */
export function ImagePreview({ path, file, tokens, onReveal, bleed = false, preview = false, onView }: ImagePreviewProps) {
  const [shown, setShown] = useState(true);
  const [viewing, setViewing] = useState(false);
  const capabilities = useInputCapabilities();
  const touchFirst = capabilities.touch && !capabilities.hover;
  const anchor = useScrollAnchor(shown);
  const { copy } = useCopy();
  const pathContext = useContext(PathContext);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        // The code block's frame (plan 3.6): the code surface on the block
        // radius, a 28px header on the same surface, no border or band. The
        // frame does not clip, so the path's hover tooltip can rise above the
        // card; the parts with their own fill round their own corners.
        container: {
          borderRadius: radiusV2.block,
          backgroundColor: tokens.v2.surfaceCode,
        },
        bleed: { marginHorizontal: -DISCLOSURE_HEADER.bleed },
        // The row's geometry: the icon in the row's status slot, the path on
        // the row's text column.
        header: {
          minHeight: 28,
          flexDirection: "row",
          alignItems: "center",
          gap: DISCLOSURE_HEADER.gap,
          paddingLeft: DISCLOSURE_HEADER.paddingX,
          paddingRight: space.xs,
          borderTopLeftRadius: radiusV2.block,
          borderTopRightRadius: radiusV2.block,
        },
        // The header with nothing under it: its pressed fill is the whole card.
        headerAlone: {
          borderBottomLeftRadius: radiusV2.block,
          borderBottomRightRadius: radiusV2.block,
        },
        slot: {
          width: DISCLOSURE_HEADER.iconSlot,
          paddingRight: DISCLOSURE_HEADER.iconSlotPad,
          alignItems: "center",
          justifyContent: "center",
        },
        eye: {
          alignItems: "center",
          justifyContent: "center",
          height: 24,
          paddingHorizontal: 6,
        },
        path: { flexShrink: 1, minWidth: 0 },
        spacer: { flex: 1, minWidth: 8 },
        // The checker tint is a flat wash rather than a pattern: a transparent
        // PNG needs something behind it, and a repeating background is not a
        // React Native style.
        canvas: {
          padding: space.sm,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tokens.surface0,
          borderBottomLeftRadius: radiusV2.block,
          borderBottomRightRadius: radiusV2.block,
        },
        // In a preview the card has no header: the canvas is the whole card.
        canvasAlone: {
          borderTopLeftRadius: radiusV2.block,
          borderTopRightRadius: radiusV2.block,
        },
        // The press target carries the frame and hugs the picture, so the
        // letterboxed sides of a narrow image stay plain background.
        fill: { width: "100%", height: "100%" },
        image: { width: "100%" },
        // A maximized preview has a fixed height. These pass it down to the
        // picture, which then fills the box (`fillFrame` / `fillImage`).
        containerFill: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, alignSelf: "stretch" },
        canvasFill: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 },
        fillFrame: {
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          alignSelf: "stretch",
          minHeight: 0,
          width: "100%",
          position: "relative",
        },
        fillImage: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
        message: {
          fontFamily: tokens.fontUi,
          fontSize: tokens.typography.block.meta.size,
          color: tokens.foregroundMuted,
          padding: space.sm,
        },
      }),
    [tokens],
  );

  // A fixed height clamped by the column instead keeps its full height on a
  // phone and letterboxes a wide image above and below.
  const panel = usePreviewPanel();
  // The resting panel stays a thumbnail. Maximized, the picture takes the
  // height the window just gained instead of leaving it empty.
  const fillsPreview = preview && (panel?.maximized ?? false);
  const maxHeight = preview ? PREVIEW_MAX_HEIGHT : MAX_HEIGHT;
  const frame =
    file?.width && file.height
      ? thumbnailFrame(file.width, file.height, maxHeight)
      : [styles.image, { height: maxHeight }];

  const toggle = file?.dataUri && !preview
    ? () => {
        anchor.arm();
        setShown((previous) => !previous);
      }
    : undefined;
  const absolutePath = formatPath(path, pathContext).absolutePath;
  // The absolute path, as a long press on any path gives.
  const copyPath = () => void copy(absolutePath, { feedback: "toast", label: "Copy path" });
  // On web a resting pointer on the header previews the picture, as it
  // previews a tool row's body. On a phone a long press opens the picture in
  // the viewer, as a press on the thumbnail does, hidden or not.
  const viewable = Boolean(file?.dataUri) && !preview;
  const previews = viewable && !capabilities.native;
  const previewOwner = useContext(HoverPreviewContext);
  const hover = useHoverPreview(previews);
  const longPress = viewable && capabilities.native
    ? () => setViewing(true)
    : capabilities.touch ? copyPath : undefined;
  const { anchorRef } = hover;
  const headerRef = useCallback(
    (node: View | null) => {
      anchorRef.current = node;
      anchor.ref.current = node;
    },
    [anchorRef, anchor.ref],
  );

  const zoomCursor = Platform.OS === "web" ? ({ cursor: "zoom-in" } as never) : null;
  const picture = file?.dataUri ? (
    <Image
      source={{ uri: file.dataUri }}
      style={fillsPreview ? styles.fillImage : styles.fill}
      resizeMode="contain"
      accessibilityLabel={path}
    />
  ) : null;

  return (
    <View style={[styles.container, bleed && styles.bleed, fillsPreview && styles.containerFill]}>
      {/* In a preview panel the path sits above the card and the size in the
          panel's toolbar, so the card is the picture alone. The path inside
          the header must not open a second layer. */}
      {preview ? null : (
        <HoverPreviewContext.Provider value={previewOwner || previews}>
          <Pressable
            ref={headerRef}
            accessibilityRole={toggle ? "button" : undefined}
            accessibilityLabel={toggle ? `${shown ? "Hide" : "Show"} the image ${path}` : undefined}
            accessibilityState={toggle ? { expanded: shown } : undefined}
            disabled={!toggle}
            onPressIn={toggle ? anchor.hold : undefined}
            onPress={toggle}
            onLongPress={longPress}
            style={({ pressed }) => [
              styles.header,
              file?.dataUri && !shown && styles.headerAlone,
              pressed && toggle && { backgroundColor: tokens.v2.surface2 },
            ]}
          >
            <View style={styles.slot}>
              <Glyph name="Image" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
            </View>
            {/* Relative to the workspace, middle-truncated. On touch the path is
                part of the header's press, as a row's target is (plan §3.9). */}
            <View pointerEvents={touchFirst ? "none" : "auto"} style={styles.path}>
              <PathText
                path={path}
                tokens={tokens}
                onReveal={onReveal ? () => onReveal() : undefined}
                style={{ fontSize: tokens.typography.block.meta.size }}
              />
            </View>
            <View style={styles.spacer} />
            <ImageMeta file={file} tokens={tokens} />
            {toggle ? (
              <View style={styles.eye}>
                <Glyph name={shown ? "Eye" : "EyeOff"} size={14} color={tokens.foregroundMuted} />
              </View>
            ) : null}
          </Pressable>
        </HoverPreviewContext.Provider>
      )}
      {hover.open && file?.dataUri ? (
        <HoverPreview preview={hover} tokens={tokens} wraps={false}>
          <HoverPreviewHeader tokens={tokens} icon="Image" center={<ImageMeta file={file} tokens={tokens} />}>
            <ToolbarCopyButton text={absolutePath} icon="Link" tokens={tokens} label="Copy path" />
          </HoverPreviewHeader>
          <HoverPreviewBody>
            <PreviewPath path={absolutePath} tokens={tokens} />
            <ImagePreview path={path} file={file} tokens={tokens} preview onView={() => setViewing(true)} />
          </HoverPreviewBody>
        </HoverPreview>
      ) : null}

      {file === null ? (
        <Text style={styles.message}>Reading the file…</Text>
      ) : file.dataUri === null ? (
        <Text style={styles.message}>{file.error ?? "The image could not be read."}</Text>
      ) : shown && picture ? (
        <View style={[styles.canvas, preview && styles.canvasAlone, fillsPreview && styles.canvasFill]}>
          {fillsPreview ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open the image full screen"
              onPress={() => {
                if (!onView) return;
                onView();
                panel?.close();
              }}
              style={[styles.fillFrame, zoomCursor]}
            >
              {picture}
            </Pressable>
          ) : preview ? (
            onView ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open the image full screen"
                onPress={() => {
                  onView();
                  panel?.close();
                }}
                style={[frame, zoomCursor]}
              >
                {picture}
              </Pressable>
            ) : (
              <View style={frame}>{picture}</View>
            )
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open the image full screen"
              onPress={() => setViewing(true)}
              style={[frame, zoomCursor]}
            >
              {picture}
            </Pressable>
          )}
        </View>
      ) : null}
      {viewable && file?.dataUri ? (
        <ImageViewer
          open={viewing}
          onClose={() => setViewing(false)}
          uri={file.dataUri}
          width={file.width ?? null}
          height={file.height ?? null}
          label={path}
          tokens={tokens}
          onReveal={onReveal}
        />
      ) : null}
    </View>
  );
}
