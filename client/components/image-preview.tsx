import React, { useContext, useMemo, useState } from "react";
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
import { UI_SCALE } from "../ui/tokens/typography";
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
}

/**
 * The tallest a thumbnail grows. Past this the image scales down to fit; a
 * press opens it at the size of the window.
 */
const MAX_HEIGHT = 480;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
export function ImagePreview({ path, file, tokens, onReveal, bleed = false }: ImagePreviewProps) {
  const [shown, setShown] = useState(true);
  const [viewing, setViewing] = useState(false);
  const capabilities = useInputCapabilities();
  const touchFirst = capabilities.touch && !capabilities.hover;
  const anchor = useScrollAnchor();
  const { copy } = useCopy();
  const pathContext = useContext(PathContext);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        // The code block's frame (plan §3.6): the code surface on the block
        // radius, a 28px header on the same surface, no border or band.
        container: {
          borderRadius: radiusV2.block,
          backgroundColor: tokens.v2.surfaceCode,
          overflow: "hidden",
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
        },
        slot: {
          width: DISCLOSURE_HEADER.iconSlot,
          paddingRight: DISCLOSURE_HEADER.iconSlotPad,
          alignItems: "center",
          justifyContent: "center",
        },
        chips: { flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 0 },
        chip: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.base,
          fontVariant: ["tabular-nums"],
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        eye: {
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          height: 24,
          paddingHorizontal: 6,
        },
        eyeLabel: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.base,
          fontWeight: "500",
          color: tokens.foregroundMuted,
          ...unselectable,
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
        },
        // The press target carries the frame and hugs the picture, so the
        // letterboxed sides of a narrow image stay plain background.
        fill: { width: "100%", height: "100%" },
        image: { width: "100%", height: MAX_HEIGHT },
        message: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.base,
          color: tokens.foregroundMuted,
          padding: space.sm,
        },
      }),
    [tokens],
  );

  const chips: string[] = [];
  if (file?.width && file.height) chips.push(`${file.width} × ${file.height}`);
  if (file?.bytes) chips.push(formatBytes(file.bytes));

  // Size from the image's own pixels: a box sized by width alone letterboxes a
  // tall image inside empty sides, and a fixed height blows a 32 px icon up to
  // eight times its size. Height leads, width follows the ratio, and the
  // container clamps anything too wide.
  const ratio = file?.width && file.height ? file.width / file.height : null;
  const frame =
    ratio !== null && file?.height
      ? {
          height: Math.min(MAX_HEIGHT, file.height),
          aspectRatio: ratio,
          maxWidth: "100%" as const,
        }
      : styles.image;

  const toggle = file?.dataUri
    ? () => {
        anchor.arm();
        setShown((previous) => !previous);
      }
    : undefined;
  // The absolute path, as a long press on any path gives.
  const copyPath = () => void copy(formatPath(path, pathContext).absolutePath, { feedback: "toast" });

  return (
    <View style={[styles.container, bleed && styles.bleed]} onLayout={anchor.settle}>
      <Pressable
        ref={anchor.ref}
        accessibilityRole={toggle ? "button" : undefined}
        accessibilityLabel={toggle ? `${shown ? "Hide" : "Show"} the image ${path}` : undefined}
        accessibilityState={toggle ? { expanded: shown } : undefined}
        disabled={!toggle}
        onPressIn={toggle ? anchor.hold : undefined}
        onPress={toggle}
        onLongPress={capabilities.touch ? copyPath : undefined}
        style={({ pressed }) => [styles.header, pressed && toggle && { backgroundColor: tokens.v2.surface2 }]}
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
            style={{ fontSize: UI_SCALE.base }}
          />
        </View>
        <View style={styles.spacer} />
        <View style={styles.chips}>
          {chips.map((chip) => (
            <Text key={chip} style={styles.chip}>
              {chip}
            </Text>
          ))}
        </View>
        {toggle ? (
          <View style={styles.eye}>
            <Glyph name={shown ? "Eye" : "EyeOff"} size={14} color={tokens.foregroundMuted} />
            <Text style={styles.eyeLabel}>{shown ? "Hide" : "Show"}</Text>
          </View>
        ) : null}
      </Pressable>

      {file === null ? (
        <Text style={styles.message}>Reading the file…</Text>
      ) : file.dataUri === null ? (
        <Text style={styles.message}>{file.error ?? "The image could not be read."}</Text>
      ) : shown ? (
        <View style={styles.canvas}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open the image full screen"
            onPress={() => setViewing(true)}
            style={[frame, Platform.OS === "web" && ({ cursor: "zoom-in" } as never)]}
          >
            <Image
              source={{ uri: file.dataUri }}
              style={styles.fill}
              resizeMode="contain"
              accessibilityLabel={path}
            />
          </Pressable>
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
        </View>
      ) : null}
    </View>
  );
}
