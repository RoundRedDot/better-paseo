import { Lexer, type Token, type Tokens } from "../../../vendor/marked";
import { openLink } from "../../open-link";
import { decodeEntities } from "./text";

/** The translation bar lives outside React in a shadow root. Build only Markdown nodes there. */
export function renderMarkdownDom(body: HTMLElement, source: string): void {
  const document = body.ownerDocument;
  const appendText = (parent: HTMLElement, value: string) => parent.appendChild(document.createTextNode(value));
  const element = (parent: HTMLElement, tag: string) =>
    parent.appendChild(document.createElement(tag));

  function link(parent: HTMLElement, href: string): HTMLButtonElement {
    const button = parent.appendChild(document.createElement("button"));
    button.type = "button";
    button.setAttribute("role", "link");
    button.addEventListener("click", () => openLink(href));
    return button;
  }

  function table(parent: HTMLElement, token: Tokens.Table): void {
    const scroll = element(parent, "div");
    scroll.className = "markdown-table";
    const grid = element(scroll, "table");
    const header = element(element(grid, "thead"), "tr");
    const content = element(grid, "tbody");
    const row = (target: HTMLElement, cells: Tokens.TableCell[], tag: "th" | "td") => {
      for (const cell of cells) {
        const node = element(target, tag);
        if (cell.align) node.style.textAlign = cell.align;
        render(node, cell.tokens);
      }
    };
    row(header, token.header, "th");
    for (const cells of token.rows) row(element(content, "tr"), cells, "td");
  }

  function render(parent: HTMLElement, tokens: readonly Token[]): void {
    for (const token of tokens) {
      switch (token.type) {
        case "paragraph":
          render(element(parent, "p"), (token as Tokens.Paragraph).tokens);
          break;
        case "heading": {
          const heading = token as Tokens.Heading;
          render(element(parent, `h${heading.depth}`), heading.tokens);
          break;
        }
        case "blockquote":
        case "strong":
        case "em":
        case "del":
          render(element(parent, token.type), (token as Tokens.Blockquote | Tokens.Strong | Tokens.Em | Tokens.Del).tokens);
          break;
        case "list": {
          const list = token as Tokens.List;
          const node = element(parent, list.ordered ? "ol" : "ul");
          if (typeof list.start === "number" && list.start !== 1) node.setAttribute("start", String(list.start));
          for (const item of list.items) render(element(node, "li"), item.tokens);
          break;
        }
        case "checkbox":
          appendText(parent, token.checked ? "\u2611 " : "\u2610 ");
          break;
        case "table":
          table(parent, token as Tokens.Table);
          break;
        case "code":
          appendText(element(element(parent, "pre"), "code"), token.text);
          break;
        case "codespan":
          appendText(element(parent, "code"), token.text);
          break;
        case "link": {
          const destination = token as Tokens.Link;
          render(link(parent, destination.autolink ? destination.href : decodeEntities(destination.href)), destination.tokens);
          break;
        }
        case "image":
          appendText(link(parent, decodeEntities(token.href)), decodeEntities(token.text || token.href));
          break;
        case "hr":
        case "br":
          element(parent, token.type);
          break;
        case "text":
          if (token.tokens) render(parent, token.tokens);
          else appendText(parent, decodeEntities(token.text));
          break;
        case "escape":
          appendText(parent, token.text);
          break;
        case "html":
        case "space":
          appendText(parent, token.raw);
          break;
        case "def":
          break;
      }
    }
  }

  render(body, Lexer.lex(source, { gfm: true }));
}
