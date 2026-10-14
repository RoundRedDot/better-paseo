import {
  Children,
  createContext,
  createElement,
  isValidElement,
  useContext,
  useMemo,
  type ElementType,
  type ReactNode,
} from "react";
import { Platform, StyleSheet, Text, UIManager, type TextProps, type TextStyle } from "react-native";
import { contentTextProps, contentTextStyle } from "./content-text";

/**
 * Prose that iOS can select a range of.
 *
 * On iOS a `<Text selectable>` long press offers one "Copy" for the whole run:
 * no cursor, no handles, no partial selection. Paseo's own Markdown avoids
 * this with react-native-uitextview, a UITextView-backed text, and the host
 * app registers its two native components (`RNUITextView`, `RNUITextViewChild`)
 * when its stream view loads. A plugin cannot bundle native code, but it can
 * render a registered native component by name, so on iOS prose goes through
 * the same pair: the root is one UITextView, and every run inside it is a
 * child that adds a styled fragment to the root's attributed string.
 *
 * Web and Android keep `<Text selectable>`, which already selects ranges.
 */

const ROOT = "RNUITextView" as unknown as ElementType;
const CHILD = "RNUITextViewChild" as unknown as ElementType;

let nativeChecked: boolean | undefined;

/**
 * Whether the host has the UITextView pair. Every host on SDK 0.11 does; the
 * check keeps an older or stripped host on plain `Text` instead of an
 * "unimplemented component" box.
 */
function nativeProse(): boolean {
  if (Platform.OS !== "ios") return false;
  if (nativeChecked === undefined) {
    try {
      nativeChecked = UIManager.hasViewManagerConfig(ROOT as unknown as string);
    } catch {
      nativeChecked = false;
    }
  }
  return nativeChecked;
}

interface Run {
  style: TextStyle;
  onPress?: TextProps["onPress"];
}

/** The run a nested span inherits from; `null` outside a native root. */
const RunContext = createContext<Run | null>(null);

/** Text attributes a child fragment carries; the rest of a style is layout. */
const FRAGMENT_KEYS = [
  "color",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "fontFamily",
  "letterSpacing",
  "lineHeight",
  "textDecorationLine",
  "textDecorationStyle",
  "textDecorationColor",
  "textAlign",
  "backgroundColor",
] as const;

type NativeFontWeight = "normal" | "bold" | "ultraLight" | "light" | "medium" | "semibold" | "heavy";

/**
 * The child component's codegen spec takes named weights only, one per
 * UIKit weight it draws: thin and ultra-light both draw ultra-light, black
 * draws heavy.
 */
export function nativeFontWeight(weight: TextStyle["fontWeight"]): NativeFontWeight {
  switch (String(weight ?? "normal")) {
    case "100":
    case "200":
    case "ultralight":
      return "ultraLight";
    case "300":
    case "light":
      return "light";
    case "500":
    case "medium":
      return "medium";
    case "600":
    case "semibold":
      return "semibold";
    case "700":
    case "bold":
      return "bold";
    case "800":
    case "900":
    case "heavy":
    case "black":
      return "heavy";
    default:
      return "normal";
  }
}

/** A run's style merged over its parent's, reduced to fragment attributes. */
export function fragmentStyle(parent: TextStyle | null, own: TextProps["style"]): TextStyle {
  const merged = { ...(parent ?? {}), ...(StyleSheet.flatten(own) ?? {}) } as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of FRAGMENT_KEYS) {
    if (merged[key] !== undefined) out[key] = merged[key];
  }
  out.fontWeight = nativeFontWeight(merged.fontWeight as TextStyle["fontWeight"]);
  // react-native-uitextview passes the same default for a run with no fill.
  out.backgroundColor = merged.backgroundColor ?? "transparent";
  // The child maps its view shadow onto the text, and React Native's default
  // view shadow offset is (0, -3): left alone, every run draws a copy of
  // itself three points higher.
  out.shadowColor = "transparent";
  out.shadowOffset = { width: 0, height: 0 };
  return out as TextStyle;
}

/** Strings become fragments; elements (nested spans) render in place. */
function fragments(children: ReactNode, run: Run): ReactNode[] {
  return Children.toArray(children).map((child, index) => {
    if (typeof child === "string" || typeof child === "number") {
      return createElement(CHILD, {
        key: index,
        text: String(child),
        style: run.style,
        onPress: run.onPress,
      });
    }
    return isValidElement(child) ? child : null;
  });
}

/**
 * A block of selectable prose: a paragraph, a heading, a list item's body.
 * Inline runs inside it must be `ProseSpan`s: on iOS a plain `Text` nested in
 * the native root is not part of its text and does not draw.
 */
export function ProseText({ style, children, ...rest }: TextProps) {
  const native = nativeProse();
  const run = useMemo<Run>(() => ({ style: fragmentStyle(null, style) }), [style]);
  // UITextView starts on the system background, black in dark mode, and the
  // root only repaints when its fill prop changes: give it one, as
  // react-native-uitextview's own `flattenStyles` does.
  const rootStyle = useMemo(
    () => ({ ...(StyleSheet.flatten(style) ?? {}), backgroundColor: run.style.backgroundColor }),
    [style, run],
  );
  if (!native) {
    return (
      <Text selectable style={[style, contentTextStyle()]} {...rest} {...contentTextProps()}>
        {children}
      </Text>
    );
  }
  return (
    <RunContext.Provider value={run}>
      <ROOT
        selectable
        allowFontScaling={rest.allowFontScaling ?? true}
        numberOfLines={rest.numberOfLines}
        accessible={rest.accessible}
        accessibilityLabel={rest.accessibilityLabel}
        // The root reports each laid-out line's text (no geometry).
        onTextLayout={rest.onTextLayout}
        style={rootStyle}
      >
        {fragments(children, run)}
      </ROOT>
    </RunContext.Provider>
  );
}

/**
 * Whether `SelectableText` below goes through `ProseText`. The phone preview
 * sets it, so a long press in a command or its output places a cursor and
 * handles on iOS instead of offering one Copy for the whole run. Elsewhere
 * those bodies stay plain `<Text selectable>`, as they were.
 */
export const ProseSelectionContext = createContext(false);

/** Selectable text: `ProseText` under `ProseSelectionContext`, else `<Text selectable>`. */
export function SelectableText(props: TextProps) {
  return useContext(ProseSelectionContext) ? <ProseText {...props} /> : <Text selectable {...props} />;
}

/**
 * A run inside `SelectableText`: part of the native root's text when there is
 * one, else the nested `Text` it replaces, with exactly the props it is given.
 */
export function SelectableSpan(props: TextProps) {
  return useContext(RunContext) === null ? <Text {...props} /> : <ProseSpan {...props} />;
}

/**
 * An inline run inside `ProseText`: bold, a code span, a link. Outside a native
 * root (web, Android, a table cell drawn with plain `Text`) it is the nested
 * `Text` it replaces, with the props it is given. A run inherits its parent's
 * press handler, so the bold words of a link still open it.
 */
export function ProseSpan({ style, onPress, children, ...rest }: TextProps) {
  const parent = useContext(RunContext);
  const run = useMemo<Run | null>(
    () =>
      parent === null
        ? null
        : {
            style: fragmentStyle(parent.style, style),
            onPress: onPress ?? parent.onPress,
          },
    [parent, style, onPress],
  );
  if (run === null) {
    return (
      <Text style={[style, contentTextStyle()]} onPress={onPress} {...rest} {...contentTextProps()}>
        {children}
      </Text>
    );
  }
  return <RunContext.Provider value={run}>{fragments(children, run)}</RunContext.Provider>;
}
