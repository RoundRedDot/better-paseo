/**
 * Where the first line of text of a rendered reply sits, so a control beside
 * the reply (the inline translate button) can center on it. Pure module: it
 * mirrors the vertical layout `blocks.tsx` gives each block kind.
 */
import type { Token, Tokens } from "../../../vendor/marked";
import { space } from "../../theme-tokens";
import { lexBlockTokens } from "../lex";
import type { VariantMetrics } from "./styles";
import { codeBlockFirstLineCenter } from "../../syntax-highlight";
import { COPY_BUTTON_BOX } from "../../../ui/copy-button";
import { tableFirstLineCenter } from "./table";
import { codeLanguage } from "./text";

export interface FirstLineLayout {
  metrics: VariantMetrics;
  /** A `---` rule's laid-out height on the platform. */
  ruleHeight: number;
  /** The code face's line height, for a code block without a header. */
  monoLineHeight: number;
  /** Whether the Markdown is the start of its reply, where a heading drops its top margin. */
  first?: boolean;
}

/**
 * Only the opening blocks matter, so only this much of a reply is read: a cut
 * paragraph or fence keeps its block kind, and a streaming reply past it gives
 * a memo the same source and is not lexed again per chunk.
 */
export function firstLineSource(text: string): string {
  return text.length > 1024 ? text.slice(0, 1024) : text;
}

/**
 * The distance from the top of the Markdown root (below any block gap the
 * root pads above itself) to the vertical center of its first line of text.
 *
 * Rules (`---`) carry no text, so a reply that opens with one starts its first
 * line a rule and a block gap lower. Headings use their own line height and,
 * unless one opens the whole reply (`first`), their top margin; a quote starts
 * below its margin. A framed block's first line is its header row: the code
 * block's language bar, a table's header cells, an insight's title. Anything
 * else (a rendered Mermaid diagram) falls back to a body line at the top.
 */
export function firstLineCenter(text: string, layout: FirstLineLayout): number {
  const tokens = lexBlockTokens(firstLineSource(text));
  return centerIn(tokens, layout, layout.metrics.blockGap, layout.first ?? true) ?? layout.metrics.bodyLineHeight / 2;
}

function centerIn(tokens: readonly Token[], layout: FirstLineLayout, gap: number, first: boolean): number | null {
  const { metrics, ruleHeight } = layout;
  let offset = 0;
  for (const token of tokens) {
    switch (token.type) {
      case "space":
      case "def":
        continue;
      case "html":
        if (token.raw.trim() === "") continue;
        return offset + metrics.bodyLineHeight / 2;
      case "hr":
        offset += ruleHeight + gap;
        first = false;
        continue;
      case "heading": {
        const level = Math.min(4, Math.max(1, (token as Tokens.Heading).depth));
        // Only a heading that opens the whole reply drops its top margin.
        const margin = first ? 0 : metrics.headingGap[level <= 2 ? 0 : 1];
        return offset + margin + metrics.headingLineHeights[level - 1]! / 2;
      }
      case "blockquote": {
        // A quote's blocks are never the reply's first.
        const inner = centerIn((token as Tokens.Blockquote).tokens, layout, space.xs, false);
        return offset + space.xs + (inner ?? metrics.bodyLineHeight / 2);
      }
      case "code": {
        const code = token as Tokens.Code;
        const lang = codeLanguage(code.lang);
        // A closed Mermaid fence is the host's diagram, which has no text line.
        if (lang.toLowerCase() === "mermaid") return offset + metrics.bodyLineHeight / 2;
        return offset + codeBlockFirstLineCenter(code.text, lang === "" ? "plaintext" : lang, metrics.codeCompact, layout.monoLineHeight);
      }
      case "table":
        return offset + tableFirstLineCenter(metrics.cellLineHeight);
      case "insight":
        // `styles.insight`: a 1 px border and `space.md` padding around a
        // header row of the title and its Copy button.
        return offset + 1 + space.md + Math.max(metrics.bodyLineHeight, COPY_BUTTON_BOX) / 2;
      default:
        return offset + metrics.bodyLineHeight / 2;
    }
  }
  return null;
}
