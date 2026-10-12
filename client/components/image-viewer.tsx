import React, { useMemo } from "react";
import { Modal, View, Pressable, Image, StyleSheet, Platform, useWindowDimensions } from "react-native";
import { Glyph } from "./glyph";
import { radiusV2, space } from "./theme-tokens";

interface ImageViewerProps {
  open: boolean;
  onClose: () => void;
  uri: string;
  /** The file's own pixel size; null when the header could not be read. */
  width: number | null;
  height: number | null;
  label: string;
}

/** Room left around the picture so the backdrop stays a target to press. */
const GUTTER = 32;

/**
 * The image at the size of the window.
 *
 * A bare React Native modal rather than the host's: the host modal is a titled
 * sheet with padding, and a picture wants the whole screen. The image fits the
 * window and never grows past its own pixels, so a small icon stays crisp. The
 * backdrop, the close mark, Escape on web and the Android back button all close
 * it; the picture itself swallows its press so a stray click on it does not.
 */
export function ImageViewer({ open, onClose, uri, width, height, label }: ImageViewerProps) {
  const window = useWindowDimensions();

  const frame = useMemo(() => {
    const room = { width: Math.max(1, window.width - GUTTER * 2), height: Math.max(1, window.height - GUTTER * 2) };
    if (!width || !height) return room;
    const scale = Math.min(1, room.width / width, room.height / height);
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
  }, [window.width, window.height, width, height]);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the image"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.backdrop, webCursor("zoom-out")]}
        />
        <Pressable onPress={() => {}} style={webCursor("default")}>
          <Image source={{ uri }} style={frame} resizeMode="contain" accessibilityLabel={label} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={8}
          style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
        >
          <Glyph name="X" size={16} color="#ffffff" />
        </Pressable>
      </View>
    </Modal>
  );
}

function webCursor(cursor: string) {
  return (Platform.OS === "web" ? { cursor } : null) as never;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
  backdrop: { backgroundColor: "rgba(0, 0, 0, 0.88)" },
  close: {
    position: "absolute",
    top: space.md,
    right: space.md,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusV2.chip,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  closePressed: { backgroundColor: "rgba(255, 255, 255, 0.24)" },
});
