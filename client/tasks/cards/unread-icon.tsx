import React from "react";
import { View } from "react-native";

/**
 * Mark as unread. Reeder's unread mark is one filled circle, so this is that
 * disc and nothing else. Drawn from Views, like the status dot: the card
 * sandbox has no SVG. The button paints it in the running blue, the same blue
 * as its frame; a menu row paints it in the row's muted colour.
 *
 * Measured on a 24-unit box. The 14-unit disc is centred, so at 13px it reads
 * as a list bullet beside the label rather than a second outlined icon.
 */
export function UnreadIcon(props: { size: number; color: string }) {
  const { size, color } = props;
  const disc = (size * 14) / 24;
  const inset = (size - disc) / 2;
  return (
    <View testID="unread-icon" accessible={false} style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          left: inset,
          top: inset,
          width: disc,
          height: disc,
          borderRadius: disc / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
