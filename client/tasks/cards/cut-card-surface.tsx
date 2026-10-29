import React from "react";
import { Platform, View, type ViewStyle } from "react-native";
import { webTransition } from "./action-style";

/** Room for the card's hover shadow outside each clipped section. */
const GUTTER = 12;

/**
 * Three adjoining sections draw one cut silhouette without clipping the card's
 * controls or hints. Each section keeps only its outside shadow; the diagonal
 * is the edge of a rotated square, so it casts the same shadow as the card.
 * Inside the cut lies the corner folded over it: a flat flap in `fold`, the
 * cut-off square's lower-left half, its tip keeping the card's own radius.
 */
export function CutCardSurface(props: {
  size: number;
  radius: number;
  background: string;
  borderColor: string;
  borderWidth: number;
  dashed: boolean;
  shadow: string;
  /** The folded flap's fill. */
  fold: string;
}) {
  const { size, radius, borderWidth } = props;
  // Extend the diagonal past both joins so its rounded ends cannot leave a gap.
  const side = (size + 2) * Math.SQRT2;
  const clip = (size - borderWidth * Math.SQRT2) * Math.SQRT2;
  const surface: ViewStyle = {
    position: "absolute",
    backgroundColor: props.background,
    borderColor: props.borderColor,
    borderWidth,
    borderStyle: props.dashed ? "dashed" : "solid",
    borderRadius: radius,
    boxShadow: props.shadow,
    ...webTransition,
  };
  return (
    <View pointerEvents="none" testID="task-card-cut-surface"
      {...(Platform.OS === "web" ? { "aria-hidden": true } : { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const })}
      style={{ position: "absolute", top: -borderWidth, right: -borderWidth, bottom: -borderWidth, left: -borderWidth }}>
      <View style={{ position: "absolute", top: size, left: -GUTTER, right: -GUTTER, bottom: -GUTTER, overflow: "hidden" }}>
        <View testID="task-card-cut-body" style={[surface, { top: -size, left: GUTTER, right: GUTTER, bottom: GUTTER }]} />
      </View>
      <View style={{ position: "absolute", top: -GUTTER, left: -GUTTER, right: size, height: size + GUTTER, overflow: "hidden" }}>
        <View testID="task-card-cut-top" style={[surface, { top: GUTTER, left: GUTTER, right: -size, bottom: -radius, borderTopRightRadius: 0 }]} />
      </View>
      <View testID="task-availability-corner" style={{ position: "absolute", top: -GUTTER, right: -GUTTER, width: size + GUTTER, height: size + GUTTER, overflow: "hidden" }}>
        <View testID="task-card-cut-edge" style={[surface, {
          top: GUTTER + size + 1 - side / 2,
          left: -1 - side / 2,
          width: side,
          height: side,
          borderRadius: 1,
          transform: [{ rotate: "45deg" }],
        }]} />
      </View>
      <View style={{ position: "absolute", top: 0, right: 0, width: size, height: size }}>
        {/* A diamond centred on the corner square's lower-left vertex keeps the square's lower-left half, inside the cut's border. */}
        <View style={{ position: "absolute", left: -clip / 2, top: size - clip / 2, width: clip, height: clip, overflow: "hidden", transform: [{ rotate: "45deg" }] }}>
          <View testID="task-card-fold" style={{
            position: "absolute",
            left: clip / 2 - size / 2,
            top: clip / 2 - (size / 2) * Math.SQRT2 - size / 2,
            width: size,
            height: size,
            transform: [{ rotate: "-45deg" }],
            backgroundColor: props.fold,
            borderColor: props.borderColor,
            borderLeftWidth: borderWidth,
            borderBottomWidth: borderWidth,
            borderBottomLeftRadius: radius,
            ...webTransition,
          }} />
        </View>
      </View>
    </View>
  );
}
