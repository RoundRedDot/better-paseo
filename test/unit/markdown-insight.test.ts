import { describe, expect, it } from "vitest";
import { createBlockCache, splitBlocks } from "../../client/components/markdown/blocks";
import { lexBlock } from "../../client/components/markdown/lex";
import { repairTail } from "../../client/components/markdown/repair";

const header = "`★ Insight ─────────────────────────────────────`\n";
const footer = "`─────────────────────────────────────────────────`";
const body = "- **幂等**保留最终集合，`id` 仍可能变化。\n- [请求](https://example.com)需要服务端凭证。\n";
const insight = header + body + footer;

describe("Claude Code Insight", () => {
  it("keeps the title, Markdown body and closing rule in one block", () => {
    expect(splitBlocks(`Before\n\n${insight}\n\nAfter`)).toEqual([
      "Before\n\n", `${insight}\n\n`, "After",
    ]);
    expect(lexBlock(insight)[0]).toMatchObject({ type: "insight", text: body, closed: true });
    const token = lexBlock(insight)[0] as { tokens: unknown[] };
    expect(token.tokens).toMatchObject([{ type: "list", items: [
      { tokens: [{ tokens: [{ type: "strong" }, { type: "text" }, { type: "codespan", text: "id" }, { type: "text" }] }] },
      { tokens: [{ tokens: [{ type: "link", href: "https://example.com" }, { type: "text" }] }] },
    ] }]);
  });

  it("stays one block across blank lines while streaming and closes before following prose", () => {
    const text = `Before\n\n${header}- First\n\n- Second\n${footer}\n\nAfter\n\nDone`;
    const cache = createBlockCache();
    for (let end = 1; end <= text.length; end++) {
      const prefix = text.slice(0, end);
      expect(splitBlocks(prefix, cache)).toEqual(splitBlocks(prefix));
      expect(splitBlocks(prefix, cache).join("")).toBe(prefix);
    }
    const open = header + "- First\n\n- **Second";
    expect(splitBlocks(open)).toEqual([open]);
    expect(lexBlock(repairTail(open), true)[0]).toMatchObject({ type: "insight", closed: false });
    expect(lexBlock(text).map((token) => token.type).filter((type) => type !== "space"))
      .toEqual(["paragraph", "insight", "paragraph", "paragraph"]);
  });

  it("does not interpret ordinary code spans or examples in code fences", () => {
    for (const text of ["`Insight`", "`★ Insight`", `Example: ${header}`, `\`\`\`md\n${insight}\n\`\`\``]) {
      expect(lexBlock(text).some((token) => token.type === "insight")).toBe(false);
    }
  });

  it("does not close on a rule inside a fenced code example", () => {
    const text = `${header}\`\`\`md\n${footer}\n\`\`\`\n\nStill inside\n${footer}\nAfter`;
    expect(lexBlock(text)[0]).toMatchObject({
      type: "insight", closed: true,
      text: `\`\`\`md\n${footer}\n\`\`\`\n\nStill inside\n`,
    });
    expect(lexBlock(text).slice(-1)[0]).toMatchObject({ type: "paragraph", text: "After" });
  });

  it("recognizes adjacent cards and a header immediately after prose", () => {
    const text = `Before\n${insight}\n${insight}`;
    expect(lexBlock(text).filter((token) => token.type !== "space").map((token) => token.type))
      .toEqual(["paragraph", "insight", "insight"]);
  });

  it("shares reference definitions with its body and normalizes CRLF when splitting", () => {
    const text = `${header}[Request][doc]\n${footer}\n\n[doc]: https://example.com`;
    const token = lexBlock(text)[0] as { tokens: unknown[] };
    expect(token.tokens).toMatchObject([{ type: "paragraph", tokens: [{ type: "link", href: "https://example.com" }] }]);
    expect(splitBlocks(insight.replace(/\n/g, "\r\n"))).toEqual([insight]);
  });
});
