import React from "react";
import { View } from "react-native";
import { UPDATE_INDICATOR_COLOR } from "./update-indicator";

/** A decorative update dot centred beside its label without shifting it. */
export function TextUpdateDot({ testID }: { testID: string }) {
  return <View pointerEvents="none" accessible={false} style={{ position: "absolute", top: 0, bottom: 0, right: -8, width: 4, justifyContent: "center" }}>
    <View testID={testID} accessible={false} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: UPDATE_INDICATOR_COLOR }} />
  </View>;
}
