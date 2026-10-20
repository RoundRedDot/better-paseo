import React from "react";
import { View } from "react-native";
import { normalizeProvider, ProviderLogo, providerBrand } from "../../components/provider-logo";
import type { TaskTokens } from "./tokens";

/**
 * Pi's mark in its own colours: the pixel "Pi" of provider:pi on a 4 x 4 grid
 * (row 1 col 1 left open), coral across the top and down the right of the P,
 * blue down its stem, yellow for the i. Data colours, the same on every
 * theme. Drawn from five Views rather than a new bitmap; the grid keeps the
 * shipped glyph's 10% margin.
 */
const PI_CELLS: ReadonlyArray<{ x: number; y: number; w: number; h: number; color: string }> = [
  { x: 0, y: 0, w: 3, h: 1, color: "#e39586" },
  { x: 2, y: 1, w: 1, h: 1, color: "#e39586" },
  { x: 0, y: 1, w: 1, h: 3, color: "#6198bb" },
  { x: 1, y: 2, w: 1, h: 1, color: "#6198bb" },
  { x: 3, y: 2, w: 1, h: 2, color: "#e9c069" },
];

export function PiMark(props: { size: number }) {
  const { size } = props;
  const margin = size * 0.1;
  const cell = (size - margin * 2) / 4;
  return (
    <View style={{ width: size, height: size }} accessibilityLabel="Pi" testID="pi-mark">
      {PI_CELLS.map((part, index) => (
        <View
          key={index}
          style={{
            position: "absolute",
            left: margin + part.x * cell,
            top: margin + part.y * cell,
            width: part.w * cell,
            height: part.h * cell,
            backgroundColor: part.color,
          }}
        />
      ))}
    </View>
  );
}

/** Pi's mark has three colours; its pill stays neutral rather than taking one of them. */
function multicolour(provider: string): boolean {
  return normalizeProvider(provider) === "pi";
}

/** A coloured brand tints its pill with its hue; a monochrome or multicolour mark's pill is neutral. */
export function brandTint(provider: string): string | null {
  if (multicolour(provider)) return null;
  const brand = providerBrand(provider);
  return brand.monochrome ? null : brand.color;
}

/**
 * A provider's mark on a theme-following surface: Pi in its own three
 * colours; coloured brands keep their hue; monochrome marks (Oh My Pi,
 * Cursor, Grok, Ollama, Paseo) take the theme's foreground, where their
 * configured near-white or indigo would vanish or mislead.
 */
export function BrandMark(props: { provider: string; size: number; tokens: TaskTokens }) {
  if (multicolour(props.provider)) return <PiMark size={props.size} />;
  const brand = providerBrand(props.provider);
  return <ProviderLogo provider={props.provider} size={props.size} color={brand.monochrome ? props.tokens.foreground : undefined} />;
}
