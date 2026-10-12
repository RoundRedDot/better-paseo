import { Platform, type TextProps, type TextStyle } from "react-native";

const NO_STYLE: TextStyle = {};

/**
 * Android's selectable `Text` keeps the font's extra top padding. The line
 * height already includes that leading, so when the selection handles appear
 * the padding is applied again and the glyphs drop. Turning it off, and
 * pinning the line to the top, leaves the words where they were. The chat
 * list does not scroll for this: an inverted list ignores that visibility
 * request. UI chrome is unchanged.
 */
const ANDROID_STYLE: TextStyle = {
  includeFontPadding: false,
  textAlignVertical: "top",
};

/**
 * Props for reading text (a reply, a prompt, a table cell).
 *
 * On Android, React Native multiplies `fontSize` and `lineHeight` by the
 * system font scale. Paseo's content size is already that reading size, so a
 * scale above 1 draws the reply larger than the setting. UI chrome keeps the
 * default and still follows the system font. iOS and web are unchanged.
 */
export function contentTextProps(): Pick<TextProps, "allowFontScaling"> {
  return Platform.OS === "android" ? { allowFontScaling: false } : {};
}

/** The Android line-box fix, or an empty style everywhere else. */
export function contentTextStyle(): TextStyle {
  return Platform.OS === "android" ? ANDROID_STYLE : NO_STYLE;
}
