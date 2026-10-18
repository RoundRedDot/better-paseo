/**
 * A `react-native` stand-in for counting what a component mounts.
 *
 * Every primitive renders a host element named after itself, so
 * `react-test-renderer` produces the tree a native renderer would: one node
 * per View, Text, Pressable, ScrollView, Image or Animated.View. Behaviour is
 * the minimum the plugin's components touch while rendering; nothing lays
 * out or animates. `Platform.OS` reads `globalThis.__rnMockOS` (default
 * "ios"), so one test file can count both a native and a web tree.
 */
import React from "react";

type Props = Record<string, unknown> & { children?: React.ReactNode };

function host(name: string) {
  return function HostPrimitive(props: Props) {
    return React.createElement(name, props, props.children);
  };
}

function resolve<T>(value: T | ((state: { pressed: boolean; hovered: boolean }) => T)): T {
  return typeof value === "function"
    ? (value as (state: { pressed: boolean; hovered: boolean }) => T)({ pressed: false, hovered: false })
    : value;
}

export const View = host("View");
export const Text = host("Text");
export const Image = host("Image");
export const ScrollView = host("ScrollView");
export const TextInput = host("TextInput");
export const SafeAreaView = host("SafeAreaView");

/** Its children while visible, as a host element in place. */
export function Modal(props: Props) {
  const { visible, children, ...rest } = props;
  return visible === false ? null : React.createElement("Modal", rest, children);
}

export const StatusBar = { currentHeight: 0 };

export function Pressable(props: Props) {
  const { style, children, ...rest } = props;
  return React.createElement(
    "Pressable",
    { ...rest, style: resolve(style as never) },
    resolve(children as never),
  );
}

function flatten(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return typeof style === "object" ? (style as Record<string, unknown>) : {};
}

export const StyleSheet = {
  create<T>(styles: T): T {
    return styles;
  },
  flatten,
  hairlineWidth: 1,
  absoluteFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  absoluteFillObject: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
};

function os(): string {
  return (globalThis as { __rnMockOS?: string }).__rnMockOS ?? "ios";
}

export const Platform = {
  get OS() {
    return os();
  },
  select<T>(choices: Record<string, T>): T | undefined {
    const key = os();
    if (key in choices) return choices[key];
    if (key !== "web" && "native" in choices) return choices.native;
    return choices.default;
  },
};

function makeValue(initial: number) {
  let value = initial;
  return {
    setValue(next: number) {
      value = next;
    },
    interpolate() {
      return value;
    },
    get __value() {
      return value;
    },
  };
}

const idleAnimation = { start() {}, stop() {}, reset() {} };

export const Animated = {
  View: host("Animated.View"),
  Text: host("Animated.Text"),
  ScrollView: host("Animated.ScrollView"),
  Value: function AnimatedValue(this: unknown, initial: number) {
    return makeValue(initial);
  } as unknown as new (initial: number) => ReturnType<typeof makeValue>,
  timing: () => idleAnimation,
  loop: () => idleAnimation,
  sequence: () => idleAnimation,
  parallel: () => idleAnimation,
  event: () => () => {},
  multiply: (a: unknown) => a,
  add: (a: unknown) => a,
};

export const AccessibilityInfo = {
  isReduceMotionEnabled: () => Promise.resolve(false),
  addEventListener: () => ({ remove() {} }),
};

export const Dimensions = {
  get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  addEventListener: () => ({ remove() {} }),
};

export const PixelRatio = {
  get: () => Dimensions.get().scale,
};

export const Linking = { openURL: () => Promise.resolve() };

export const NativeModules: Record<string, unknown> = {};

export const TurboModuleRegistry = {
  get(_name: string) {
    return null;
  },
};

export function useWindowDimensions() {
  return Dimensions.get();
}

export default {
  View,
  Text,
  Image,
  ScrollView,
  TextInput,
  SafeAreaView,
  Modal,
  StatusBar,
  Pressable,
  StyleSheet,
  Platform,
  PixelRatio,
  Animated,
  AccessibilityInfo,
  Dimensions,
  Linking,
  NativeModules,
  TurboModuleRegistry,
  useWindowDimensions,
};
