import React from "react";
import { Image } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { MARK_BITMAPS, MONO_MARKS } from "./mark-bitmaps";

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
}

/**
 * Names this plugin used before the host exposed its Lucide set, plus the
 * Lucide names that changed in the icon set itself. Mapping them here keeps
 * every call site unchanged.
 */
const LUCIDE_ALIASES: Record<string, string> = {
  CheckCircle: "CircleCheck",
  AlertCircle: "CircleAlert",
  AlertTriangle: "TriangleAlert",
  HelpCircle: "CircleHelp",
  Edit: "SquarePen",
  Book: "BookOpen",
  FileDiff: "FileDiff",
  Dot: "Dot",
};

/** The three marks Lucide does not carry. Each is a PNG raster of its own SVG. */
const BRAND_MARKS: Record<string, string> = {
  Git: "brand:git",
  GitHub: "brand:github",
  Paseo: "brand:paseo",
};

/**
 * One icon.
 *
 * Lucide icons come from the host, which renders them as real components on
 * every platform. Only brand marks stay images, because the sandbox has no SVG
 * renderer and a data-URI SVG never decodes on iOS or Android.
 */
export function Glyph({ name, size = 14, color }: IconProps) {
  const brand = BRAND_MARKS[name];
  if (brand) {
    const uri = MARK_BITMAPS[brand];
    if (uri) {
      return (
        <Image
          source={{ uri }}
          style={
            MONO_MARKS.has(brand) && color
              ? { width: size, height: size, tintColor: color }
              : { width: size, height: size }
          }
          resizeMode="contain"
          accessibilityLabel={name}
        />
      );
    }
  }

  return <Icon name={LUCIDE_ALIASES[name] ?? name} size={size} color={color} />;
}
