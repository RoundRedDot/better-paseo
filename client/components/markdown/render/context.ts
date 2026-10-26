import type { ExtendedThemeTokens } from "../../theme-tokens";
import type { MarkdownStyles, MarkdownVariant, VariantMetrics } from "./styles";

/**
 * Everything a block needs besides its own source. Built once per
 * `[tokens, variant]` (and the two callbacks), so a theme or font change
 * rebuilds this object and the blocks re-render, but nothing is lexed again.
 */
export interface RenderContext {
  styles: MarkdownStyles;
  tokens: ExtendedThemeTokens;
  metrics: VariantMetrics;
  variant: MarkdownVariant;
  /** Compact only: fenced code starts folded to a one-line summary. */
  collapseCode: boolean;
  /**
   * iOS draws prose as plain `Text` while the reply streams: every native
   * Markdown view is a UITextView, and each streamed commit that moves the
   * list notifies all of them (see `prose.tsx`). Settled prose goes native.
   */
  plainProse?: boolean;
  /** Press on a path in the prose; absent: `PathText` falls back to its context. */
  onRevealPath?: (path: string) => void;
}
