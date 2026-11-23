import { describe, expect, it } from "vitest";
import { assistantNeedsNativeFiles } from "../../client/assistant-native-files";

describe("assistant native file routing", () => {
  it.each([
    "[Design](docs/WORKFLOW-draft7.md)",
    "[Source](/work/main.ts:12:3)",
    "[Binary](archive.bin)",
    "[License](LICENSE)",
    "[Plan](notes.md#L12)",
    "[Plan](notes.md:12)",
    "[PDF](file:///Users/me/My%20Document.pdf)",
    "[Windows](<C:\\work\\notes.md>)",
    "[Reference][design]\n\n[design]: docs/design.markdown",
    "> - **[Nested](../notes.txt)**",
    "| File |\n| --- |\n| [Plan](docs/plan.md) |",
    "![Image](file:///tmp/screenshot.png)",
    "Read `src/main.ts`.",
  ])("routes local file prose to Paseo: %s", (text) => {
    expect(assistantNeedsNativeFiles(text)).toBe(true);
  });

  it.each([
    "A normal **formatted** reply.",
    "[Docs](https://example.com/docs.md#L12)",
    "[Mail](mailto:me@example.com)",
    "[Call](tel:123)",
    "[Section](#usage) and [Query](?raw=1)",
    "[Remote](//cdn.example.com/image.png)",
    "![Remote](https://example.com/image.png)",
    "`console.log` and `item.data`",
    "```md\n[Example](docs/example.md)\n`src/main.ts`\n```",
    "    [Example](docs/example.md)\n",
  ])("keeps other prose enhanced: %s", (text) => {
    expect(assistantNeedsNativeFiles(text)).toBe(false);
  });

  it("does not change rendering just because a reply is large", () => {
    expect(assistantNeedsNativeFiles("text ".repeat(30_000))).toBe(false);
  });
});
