import React from "react";
import { INCOMPLETE_IMAGE_PLACEHOLDER } from "remend";
import type { Token, Tokens } from "../../../vendor/marked";
import { openLink } from "../../open-link";
import { PathText } from "../../../ui/path-text";
import { CHAR_RATIO_DIGIT, CHAR_RATIO_MONO, CODE_CHIP_PADDING } from "./styles";
import type { RenderContext } from "./context";
import { codeSurface } from "../../host-font-escape";
import { decodeEntities, isPathLike, softBreaks } from "./text";
import { localPath } from "./local-path";
import { LocalLink } from "./local-link";
import { ProseSpan } from "../../../ui/prose-text";

/** The visible text of an inline run, for measuring and summaries. */
export function inlineText(tokens: readonly Token[] | undefined): string {
  if (!tokens) return "";
  let out = "";
  for (const token of tokens) {
    switch (token.type) {
      case "text":
        out += token.tokens ? inlineText(token.tokens) : softBreaks(decodeEntities(token.text));
        break;
      case "escape":
      case "codespan":
        out += token.text;
        break;
      case "br":
        out += "\n";
        break;
      case "html":
        out += token.raw;
        break;
      case "image":
        out += token.text;
        break;
      default: {
        const children = (token as Tokens.Generic).tokens;
        out += children ? inlineText(children) : (token.raw ?? "");
      }
    }
  }
  return out;
}

/**
 * Inline runs as `ProseSpan`s (nested `Text` off iOS). Every node is
 * selectable, and the order of runs is the order of the source, so a
 * selection copies the prose.
 */
export function renderInline(
  tokens: readonly Token[] | undefined,
  context: RenderContext,
  keyPrefix: string,
  /** Inside a heading or `strong`: a code span keeps the bold weight. */
  inBold = false,
): React.ReactNode[] {
  if (!tokens) return [];
  const { styles } = context;
  const codeStyle = inBold ? styles.codeSpanBold : styles.codeSpan;
  const out: React.ReactNode[] = [];

  tokens.forEach((token, index) => {
    const key = `${keyPrefix}i${index}`;
    switch (token.type) {
      case "text":
        // A list item's text token wraps its own inline run.
        if (token.tokens && token.tokens.length > 0) {
          out.push(...renderInline(token.tokens, context, key, inBold));
        } else {
          out.push(softBreaks(decodeEntities(token.text)));
        }
        return;
      case "escape":
        out.push(token.text);
        return;
      case "br":
        out.push("\n");
        return;
      case "html":
        // HTML is shown as the source the author wrote, never interpreted.
        out.push(token.raw);
        return;
      case "codespan":
        if (isPathLike(token.text)) {
          out.push(
            <PathText
              key={key}
              path={token.text}
              tokens={context.tokens}
              verbatim
              inline
              onReveal={context.onRevealPath}
              style={codeStyle}
            />,
          );
          return;
        }
        out.push(
          <ProseSpan key={key} selectable {...(codeSurface as object)} style={codeStyle}>
            {token.text}
          </ProseSpan>,
        );
        return;
      case "strong":
        out.push(
          <ProseSpan key={key} selectable style={styles.strong}>
            {renderInline(token.tokens, context, key, true)}
          </ProseSpan>,
        );
        return;
      case "em":
        out.push(
          <ProseSpan key={key} selectable style={styles.emphasis}>
            {renderInline(token.tokens, context, key, inBold)}
          </ProseSpan>,
        );
        return;
      case "del":
        out.push(
          <ProseSpan key={key} selectable style={styles.strike}>
            {renderInline(token.tokens, context, key, inBold)}
          </ProseSpan>,
        );
        return;
      case "link": {
        const children = renderInline(token.tokens, context, key, inBold);
        const local = localPath(token.href);
        out.push(
          local !== null ? (
            <LocalLink key={key} path={local} context={context}>
              {children}
            </LocalLink>
          ) : (
            renderLink(token.href, children, context, key)
          ),
        );
        return;
      }
      case "image": {
        // Images are not drawn in a chat row; the alt text links to the image.
        // An image still streaming has no address yet: its alt text alone.
        const label = token.text !== "" ? token.text : token.href;
        if (token.href === INCOMPLETE_IMAGE_PLACEHOLDER) {
          out.push(label);
          return;
        }
        // A file links as a path does; `openLink` refuses `file:`. (A
        // local image in a paragraph is drawn as the image, in `blocks.tsx`;
        // this is one in a heading, a list item or a table cell.)
        const local = localPath(token.href);
        if (local !== null) {
          out.push(
            <LocalLink key={key} path={local} context={context}>
              {label}
            </LocalLink>,
          );
          return;
        }
        out.push(renderLink(token.href, [label], context, key));
        return;
      }
      default:
        out.push(token.raw ?? "");
    }
  });
  return out;
}

function renderLink(
  href: string,
  children: React.ReactNode[],
  context: RenderContext,
  key: string,
): React.ReactNode {
  // `onPress` on a Text, not a Pressable wrapper: a link sits mid sentence, and
  // a View there would break the line box and drop the text out of the
  // paragraph's selection range. No `href`: React Native Web would render a
  // real anchor and the click would navigate the app window itself.
  return (
    <ProseSpan
      key={key}
      selectable
      accessibilityRole="link"
      onPress={() => openLink(href)}
      style={context.styles.link}
    >
      {children}
    </ProseSpan>
  );
}

/**
 * East Asian wide characters (CJK, kana, hangul, full-width forms): a full em
 * whatever the face, where Latin text averages `ratio` of one.
 */
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/g;

const DIGIT = /[0-9]/g;

/**
 * Estimated width of plain text: wide characters at 1 em, digits at least at
 * a tabular figure's advance, the rest at `ratio`.
 */
export function textWidth(text: string, size: number, ratio: number): number {
  const wide = text.match(WIDE)?.length ?? 0;
  const digits = text.match(DIGIT)?.length ?? 0;
  const rest = text.length - wide - digits;
  return wide * size + digits * size * Math.max(ratio, CHAR_RATIO_DIGIT) + rest * size * ratio;
}

/**
 * Estimated width of an inline run. A chip is wider than the text it holds:
 * the code face is wider than the UI face and the chip carries padding of its
 * own, so code is measured on its own terms.
 */
export function inlineWidth(tokens: readonly Token[] | undefined, size: number, ratio: number): number {
  if (!tokens) return 0;
  let width = 0;
  for (const token of tokens) {
    switch (token.type) {
      case "text":
        width += token.tokens
          ? inlineWidth(token.tokens, size, ratio)
          : textWidth(softBreaks(decodeEntities(token.text)), size, ratio);
        break;
      case "codespan":
        width += textWidth(token.text, size, CHAR_RATIO_MONO) + CODE_CHIP_PADDING * 2;
        break;
      case "escape":
      case "image":
        width += textWidth(token.text, size, ratio);
        break;
      default: {
        const children = (token as Tokens.Generic).tokens;
        width += children
          ? inlineWidth(children, size, ratio)
          : textWidth(token.raw ?? "", size, ratio);
      }
    }
  }
  return width;
}
