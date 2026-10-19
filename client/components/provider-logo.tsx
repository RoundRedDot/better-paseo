import React, { useMemo } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { fontUi, radiusV2 } from "./theme-tokens";
import { MARK_IDS, MONO_MARKS, useMarkBitmap } from "./marks";
import { unselectable } from "./selection";
import { UI_SCALE } from "../ui/tokens/typography";

export type KnownProvider =
  | "paseo"
  | "claude"
  | "codex"
  | "omp"
  | "pi"
  | "gemini"
  | "antigravity"
  | "copilot"
  | "opencode"
  | "minimax"
  | "deepseek"
  | "grok"
  | "cursor"
  | "ollama"
  | "generic";

interface ProviderLogoProps {
  provider: string;
  size?: number;
  showLabel?: boolean;
  color?: string;
}

export function normalizeProvider(provider: string): KnownProvider {
  const p = (provider || "").toLowerCase();
  if (p.includes("paseo")) return "paseo";
  if (p.includes("cursor")) return "cursor";
  if (p.includes("claude") || p.includes("anthropic")) return "claude";
  if (p.includes("codex") || p.includes("openai") || p.includes("gpt")) return "codex";
  // "pi" must stand alone as a word: a bare substring test also claims
  // "co-pi-lot" and routes GitHub Copilot to the Pi glyph.
  if (p.includes("omp") || /oh[ -]my[ -]pi/.test(p)) return "omp";
  if (/(?:^|[^a-z])pi(?:[^a-z]|$)/.test(p)) return "pi";
  // Antigravity is checked before Gemini: it ships Gemini models under its
  // own brand, so the more specific name has to win.
  if (p.includes("antigravity") || p.includes("agy")) return "antigravity";
  if (p.includes("gemini") || p.includes("google")) return "gemini";
  if (p.includes("copilot") || p.includes("github")) return "copilot";
  if (p.includes("opencode")) return "opencode";
  if (p.includes("minimax")) return "minimax";
  if (p.includes("deepseek")) return "deepseek";
  if (p.includes("grok") || p.includes("xai")) return "grok";
  if (p.includes("ollama")) return "ollama";
  return "generic";
}

/**
 * Local marks include the host's Cursor and Pi glyphs so the provider picker and
 * timeline use the same mark. Other providers use the vendor table.
 */
export const LOCAL_MARKS: Partial<Record<KnownProvider, string>> = {
  cursor: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 466.73 532.09\">\n  <path fill=\"currentColor\" d=\"M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z\"/>\n</svg>",
  paseo:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 700"><path fill="currentColor" d="M291.495 91.399C333.897 104.892 379.155 135.075 416.229 173.191C453.389 211.394 484.429 259.725 495.708 311.251C497.555 319.693 498.865 328.216 499.586 336.776C509.755 326.554 519.867 317.815 529.89 311.547C540.647 304.821 553.808 299.297 568.641 299.785C584.29 300.299 597.395 307.326 607.747 317.632C632.173 341.947 629.612 372.898 619.872 397.936C610.185 422.833 591.557 447.826 572.732 469.124C553.591 490.78 532.713 510.308 516.779 524.318C508.775 531.355 501.936 537.073 497.07 541.052C494.635 543.043 492.689 544.603 491.334 545.679C490.657 546.217 490.126 546.635 489.756 546.926C489.571 547.071 489.425 547.184 489.321 547.265C489.269 547.305 489.227 547.338 489.196 547.362C489.181 547.374 489.168 547.385 489.157 547.393L489.135 547.411C478.157 555.911 462.033 554.334 453.122 543.89C444.213 533.448 445.887 518.094 456.861 509.592C468.216 500.414 474.589 495.088 482.073 488.508C497.114 475.284 516.315 457.282 533.578 437.75C551.157 417.862 565.26 398.01 571.859 381.048C578.403 364.227 575.681 356.302 570.724 351.367C568.928 349.579 567.744 348.902 567.267 348.676C566.888 348.496 566.811 348.52 566.804 348.52C566.605 348.513 563.971 348.537 557.953 352.3C545.161 360.299 528.815 377.492 506.807 403.867C494.927 418.106 481.871 434.435 467.547 451.957C463.709 457.28 459.503 462.538 454.91 467.717L454.702 467.549C420.808 508.347 380.37 553.856 332.335 593.848C301.853 619.226 262.656 622.597 228.642 614.743C194.834 606.936 162.658 587.448 142.217 561.686C108.054 518.631 100.57 469.801 108.223 427.836C115.56 387.606 137.391 351.005 166.502 331.557C161.248 315.813 156.813 299.49 153.519 283.013C142.593 228.368 143.239 167.031 174.28 119.619C186.922 100.31 205.846 89.1535 227.387 85.2773C248.1 81.5504 270.278 84.648 291.495 91.399ZM378.642 206.356C345.773 172.563 307.463 147.917 275.208 137.654C259.096 132.527 246.171 131.514 236.828 133.195C228.314 134.727 222.227 138.497 217.721 145.38C196.712 177.468 193.858 224.004 203.82 273.827C206.532 287.394 210.127 300.834 214.345 313.817C236.45 310.276 260.156 311.463 281.22 317.11C319.621 327.403 357.501 355.419 357.501 405.654C357.501 435.255 339.111 465.136 307.278 473.815C273.211 483.103 238.854 464.822 213.105 427.541C203.716 413.947 194.443 397.766 185.947 379.89C174.028 392.223 163.08 411.953 158.673 436.118C153.128 466.518 158.514 501.286 183.085 532.253C195.993 548.522 217.742 562.031 240.771 567.349C263.594 572.619 284.147 569.24 298.664 557.154C349.383 514.927 390.709 466.547 426.366 422.952C448.879 390.86 453.195 356.06 445.578 321.265C436.703 280.718 411.425 240.06 378.642 206.356Z"/></svg>',
  omp: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 4 56 56"><path fill="currentColor" d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z"/></svg>',
  pi: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 100 600 600"><path fill="currentColor" fill-rule="evenodd" d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"/><path fill="currentColor" d="M517.36 400 H634.72 V634.72 H517.36 Z"/></svg>',
};

/**
 * A monochrome mark paints with `currentColor`, and an <Image> has no inherited
 * colour, so the brand hue is substituted in. Encoding is memoised because the
 * same handful of marks render on every turn in the stream.
 */
/** A local mark first, then the vendor table. Both ship as PNG rasters. */
function markId(provider: KnownProvider): string | undefined {
  for (const candidate of [`provider:${provider}`, `lobe:${provider}`]) {
    if (MARK_IDS.has(candidate)) return candidate;
  }
  return undefined;
}

export function ProviderLogo({ provider, size = 14, showLabel = false, color }: ProviderLogoProps) {
  const normalized = normalizeProvider(provider);
  const config = PROVIDER_CONFIGS[normalized];
  const id = useMemo(() => markId(normalized), [normalized]);
  const uri = useMarkBitmap(id);
  const foreground = color ?? config.brandColor;
  // A monochrome mark is rasterised white, so the brand hue arrives as a tint.
  const tint = color ?? (id && MONO_MARKS.has(id) ? config.brandColor : undefined);

  return (
    <View style={styles.row}>
      {uri ? (
        <Image
          source={{ uri }}
          style={
            tint ? { width: size, height: size, tintColor: tint } : { width: size, height: size }
          }
          resizeMode="contain"
          accessibilityLabel={config.displayName}
        />
      ) : uri === undefined ? (
        // On its way from the daemon: hold the space rather than flash the letter.
        <View style={{ width: size, height: size }} />
      ) : (
        <View
          style={[styles.fallback, { width: size, height: size, borderColor: foreground }]}
        >
          <Text
            style={[
              styles.fallbackLabel,
              { fontSize: size * 0.6, color: foreground },
              unselectable,
            ]}
          >
            {config.displayName.slice(0, 1)}
          </Text>
        </View>
      )}
      {showLabel ? (
        <Text style={[styles.label, { color: foreground }, unselectable]}>
          {config.displayName}
        </Text>
      ) : null}
    </View>
  );
}

interface ProviderMeta {
  displayName: string;
  /** Also the fill for a monochrome mark, so it stays legible on either theme. */
  brandColor: string;
}

const PROVIDER_CONFIGS: Record<KnownProvider, ProviderMeta> = {
  paseo: { displayName: "Paseo", brandColor: "#6366F1" },
  claude: { displayName: "Claude", brandColor: "#D97757" },
  codex: { displayName: "Codex", brandColor: "#10A37F" },
  omp: { displayName: "Oh My Pi", brandColor: "#818CF8" },
  pi: { displayName: "Pi", brandColor: "#818CF8" },
  gemini: { displayName: "Gemini", brandColor: "#4285F4" },
  antigravity: { displayName: "Antigravity", brandColor: "#00B95C" },
  copilot: { displayName: "Copilot", brandColor: "#58A6FF" },
  opencode: { displayName: "OpenCode", brandColor: "#38BDF8" },
  minimax: { displayName: "MiniMax", brandColor: "#E2167E" },
  deepseek: { displayName: "DeepSeek", brandColor: "#4D6BFE" },
  grok: { displayName: "Grok", brandColor: "#E5E7EB" },
  cursor: { displayName: "Cursor", brandColor: "#E5E7EB" },
  ollama: { displayName: "Ollama", brandColor: "#CBD5E1" },
  generic: { displayName: "Agent", brandColor: "#94A3B8" },
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radiusV2.chip,
  },
  fallbackLabel: { fontFamily: fontUi, fontWeight: "700" },
  label: { fontFamily: fontUi, fontSize: UI_SCALE.base, fontWeight: "600" },
});
