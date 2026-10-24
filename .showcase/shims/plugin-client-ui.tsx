import React, { type ReactNode } from "react";
import { View } from "react-native";

/** Host-injected sidebar row, stubbed for the offline screenshot harness. */
export function SidebarRow({ label, trailing }: { label?: ReactNode; trailing?: ReactNode }) {
  return (
    <View>
      {label}
      {trailing}
    </View>
  );
}
