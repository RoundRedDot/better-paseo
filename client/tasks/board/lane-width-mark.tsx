import React from "react";
import { View } from "react-native";
import type { LaneWidth } from "../../../shared/tasks-settings";

const WIDTH = { narrow: 6, default: 10, wide: 14 } as const;

/** One lane at three widths, matching the approved 20-unit outline drawing. */
export function LaneWidthMark({ laneWidth, size, color }: { laneWidth: LaneWidth; size: number; color: string }) {
  const unit = size / 20;
  return (
    <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: (WIDTH[laneWidth] + 1.5) * unit,
          height: 15.5 * unit,
          borderWidth: 1.5 * unit,
          borderRadius: 2.25 * unit,
          borderColor: color,
        }}
      />
    </View>
  );
}
