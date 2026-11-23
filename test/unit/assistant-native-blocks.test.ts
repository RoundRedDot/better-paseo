import { describe, expect, it } from "vitest";
import { assistantNeedsNativeBlocks } from "../../client/assistant-native-blocks";

describe("native fenced block routing", () => {
  it.each([
    "```mermaid\ngraph TD; A-->B\n```",
    "~~~DRAWIO extra-info\n<mxfile/>\n~~~",
    "> ```Mermaid\n> graph TD\n> ```",
    "- item\n\n  ~~~drawio\n  <mxfile/>\n  ~~~",
    "[Reference][x]\n\n```mermaid\ngraph TD",
    "```DRAWIO",
  ])("recognizes actual nested, complete and streaming fences: %s", (text) => {
    expect(assistantNeedsNativeBlocks(text, ["^mermaid$", "^drawio$"])).toBe(true);
  });
  it.each([
    "`mermaid` and text saying ```drawio",
    "```mermaid-js\ngraph TD\n```",
    "```typescript\nconst x = 1\n```",
    "````markdown\n```mermaid\ngraph TD\n```\n````",
    "    ```mermaid\n    graph TD\n    ```",
    "<pre>\n```mermaid\n</pre>",
  ])("ignores nonmatching blocks and fence markers inside samples: %s", (text) => {
    expect(assistantNeedsNativeBlocks(text, ["^mermaid$", "^drawio$"])).toBe(false);
  });
  it("matches case-insensitive regexes only against the first info word", () => {
    const patterns = ["^drawio(?:-xml)?$"];
    expect(assistantNeedsNativeBlocks("~~~DRAWIO-XML title\n<mxfile/>", patterns)).toBe(true);
    expect(assistantNeedsNativeBlocks("~~~text drawio\n<mxfile/>", patterns)).toBe(false);
    expect(assistantNeedsNativeBlocks("~~~text\ndrawio", patterns)).toBe(false);
    expect(assistantNeedsNativeBlocks("```mermaid\ngraph TD", [])).toBe(false);
    expect(assistantNeedsNativeBlocks("```mermaid\ngraph TD", ["["])).toBe(false);
    expect(assistantNeedsNativeBlocks("```mermaid\ngraph TD", ["[", "^mermaid$"])).toBe(true);
    expect(assistantNeedsNativeBlocks("```foo,bar\ndata", ["^foo,bar$"])).toBe(true);
    expect(assistantNeedsNativeBlocks("```prefixdrawio\ndata", ["drawio"])).toBe(true);
    expect(assistantNeedsNativeBlocks("```mermaid\ngraph TD", ["^MERMAID$"])).toBe(true);
    expect(assistantNeedsNativeBlocks("```\nplain", ["^$"])).toBe(true);
    expect(assistantNeedsNativeBlocks("    indented code", ["^$"])).toBe(false);
  });
});
