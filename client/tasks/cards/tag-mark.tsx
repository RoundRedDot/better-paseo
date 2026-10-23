import React from "react";
import { View } from "react-native";

/**
 * A solid tag in a label's colour: Lucide's Tag outline, filled. Lucide has
 * no filled icons and the host's Icon draws strokes only, so it is built from
 * Views: a strip along the diagonal, flat and rounded at the bottom-right
 * end, pointed at the top-left by a square turned 45 degrees, with the hole
 * in the colour of the surface under it (`hole`).
 *
 * In Lucide's 24 grid the strip runs 22.6 along the diagonal and 14.1 across,
 * its middle at (10, 10); the shape's box spans 2 to 23, so it is centred on
 * (12.5, 12.5) and fills 22 of the 24.
 */
export function TagMark(props: { size: number; color: string; hole: string; testID?: string }) {
  const { size, color } = props;
  const k = size / 22;
  const length = 22.63 * k;
  const width = 14.14 * k;
  const depth = width / 2;
  const side = width / Math.SQRT2;
  const center = size / 2 - 2.5 * k;
  const hole = Math.max(2, 3.2 * k);
  return (
    <View testID={props.testID} style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          left: center - length / 2,
          top: center - width / 2,
          width: length,
          height: width,
          transform: [{ rotate: "45deg" }],
        }}
      >
        <View
          style={{
            position: "absolute",
            left: depth,
            top: 0,
            width: length - depth,
            height: width,
            backgroundColor: color,
            borderTopRightRadius: 2.4 * k,
            borderBottomRightRadius: 2.4 * k,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: depth - side / 2,
            top: width / 2 - side / 2,
            width: side,
            height: side,
            backgroundColor: color,
            borderRadius: 1.5 * k,
            transform: [{ rotate: "45deg" }],
          }}
        />
        <View
          style={{
            position: "absolute",
            left: 7.78 * k - hole / 2,
            top: width / 2 - hole / 2,
            width: hole,
            height: hole,
            borderRadius: hole / 2,
            backgroundColor: props.hole,
          }}
        />
      </View>
    </View>
  );
}
