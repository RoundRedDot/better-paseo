import React from "react";
import { View } from "react-native";

/**
 * Mark as unread. An open circle is the task; the filled dot on its top-right
 * rim is the same "not yet seen" mark the review lane uses. Drawn from Views,
 * like the status ring: the card sandbox has no SVG. The button paints it in
 * the mark-read green; a menu row paints it in the row's muted colour.
 *
 * Measured on a 24-unit box with a 2-unit stroke, the same weight as Archive.
 * The 8-unit dot is drawn after the ring and overlaps it, so at 13px the two
 * still read as one mark. The dot is opaque; the overlap needs no knockout.
 */
export function UnreadIcon(props: { size: number; color: string }) {
  const { size, color } = props;
  const unit = size / 24;
  const ring = 15 * unit;
  const dot = 8 * unit;
  return (
    <View testID="unread-icon" accessible={false} style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          left: 4 * unit,
          top: 6.5 * unit,
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: 2 * unit,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 12 * unit,
          top: 3 * unit,
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
