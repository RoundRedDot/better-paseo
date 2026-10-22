import React from "react";
import { View } from "react-native";
import { normalizeProvider, ProviderLogo, providerBrand } from "../../components/provider-logo";
import { mix } from "../../components/theme-tokens";
import { contrastRatio, type TaskTokens } from "./tokens";

export { contrastRatio };

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
 * configured near-white or indigo would vanish or mislead. With `mono`,
 * every mark is a silhouette in that one colour.
 */
export function BrandMark(props: { provider: string; size: number; tokens: TaskTokens; mono?: string }) {
  if (props.mono) return <ProviderLogo provider={props.provider} size={props.size} color={props.mono} />;
  if (multicolour(props.provider)) return <PiMark size={props.size} />;
  const brand = providerBrand(props.provider);
  return <ProviderLogo provider={props.provider} size={props.size} color={brand.monochrome ? props.tokens.foreground : undefined} />;
}

export interface AgentPillColors {
  background: string;
  text: string;
  /** The mark and the Brain icon. */
  icon: string;
}

/**
 * A borderless pill in one hue, after Linear's status pill: the hue at 12%
 * over the card (20% on a dark theme), the icon in the hue itself and the
 * label the hue pulled 30% towards the theme's foreground (darker on light,
 * lighter on dark), further if it would fall under 4.5:1 on the fill.
 */
export function tintedPillColors(tokens: TaskTokens, hue: string): AgentPillColors {
  const fg = tokens.foreground;
  const background = mix(tokens.card.background, hue, tokens.isDark ? 0.2 : 0.12);
  let toward = 0.3;
  let text = mix(hue, fg, toward);
  while (contrastRatio(text, background) < 4.5 && toward < 1) {
    toward = Math.min(1, toward + 0.05);
    text = mix(hue, fg, toward);
  }
  return { background, text, icon: hue };
}

/** The neutral borderless pill: the foreground at 6%, a foreground label and a muted icon. */
export function neutralPillColors(tokens: TaskTokens, icon: string = tokens.foreground): AgentPillColors {
  return { background: mix(tokens.card.background, tokens.foreground, 0.06), text: tokens.foreground, icon };
}

/**
 * The model pill: a coloured brand's tinted pill; monochrome and
 * multicolour marks get the neutral one.
 */
export function agentPillColors(tokens: TaskTokens, provider: string): AgentPillColors {
  const brand = brandTint(provider);
  return brand ? tintedPillColors(tokens, brand) : neutralPillColors(tokens);
}
