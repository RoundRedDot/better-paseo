import React from "react";
import { View } from "react-native";
import { statusMarkSize } from "./status-icon";

/**
 * Mark as unread. The review lane's unread mark: StatusIcon's filled dot,
 * 6px at the 12px mark, scaled by `statusMarkSize`. Drawn from Views, like
 * that dot: the card sandbox has no SVG. The button paints it in the lane's
 * success green; a menu row paints it in the row's muted colour.
 */
export function UnreadIcon(props: { size: number; color: string }) {
  const { size, color } = props;
  const dot = (6 * statusMarkSize(size)) / 12;
  const inset = (size - dot) / 2;
  return (
    <View testID="unread-icon" accessible={false} style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          left: inset,
          top: inset,
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
