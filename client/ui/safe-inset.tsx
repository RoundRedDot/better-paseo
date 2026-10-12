import React from "react";
import { Platform, SafeAreaView, StatusBar, View, type ViewProps } from "react-native";

/**
 * The safe area on iOS. React Native's `SafeAreaView` is the only inset source
 * a plugin can reach (the host's safe-area context is not shared). Named
 * imports from the host's module are read where they are used, so web and
 * Android never touch its deprecated getter. (A namespace import would copy
 * every export at load, and some of them throw on evaluation.)
 */
export function SafeInset(props: ViewProps) {
  if (Platform.OS === "ios" && SafeAreaView) return <SafeAreaView {...props} />;
  // A modal is drawn under Android's translucent status bar.
  const top = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
  return <View {...props} style={[props.style, top > 0 && { paddingTop: top }]} />;
}
