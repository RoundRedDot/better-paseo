import { describe, expect, it } from "vitest";
import { assistantRows, hasUiFence } from "../../client/assistant-transform";

const longReply = Array.from({ length: 80 }, (_, index) =>
  `## Section ${index}\n\n${"A complete paragraph with **formatting**. ".repeat(20)}\n\n`).join("");

describe("long reply history rows", () => {
  it("lets the host virtualize complete blocks instead of mounting the entire reply", () => {
    const rows = assistantRows(longReply, "complete");
    expect(rows.length).toBeGreaterThan(80);
    expect(rows.map((row) => row.data.text).join("")).toBe(longReply);
    expect(Math.max(...rows.map((row) => row.data.text.length))).toBeLessThan(2000);
    expect(rows.filter((row) => "messageText" in row.data)).toHaveLength(1);
    expect(rows.at(-1)!.data).toMatchObject({ messageText: longReply });
  });

  it("keeps the streaming reply in one stable slot and keeps short replies unchanged", () => {
    expect(assistantRows(longReply, "streaming")).toHaveLength(1);
    expect(assistantRows("A short reply", "complete")[0]!.data)
      .toEqual({ text: "A short reply", phase: "complete" });
  });

  it("virtualizes a large tight unordered list at whole-item boundaries", () => {
    const items = Array.from({ length: 244 }, (_, index) => `- Item ${index}: ${"detail ".repeat(20)}\n`);
    const text = items.join("");
    const rows = assistantRows(text, "complete");
    expect(rows).toHaveLength(16);
    expect(rows.map((row) => row.data.text).join("")).toBe(text);
    expect(rows[0]!.data.listContinuation).toBeUndefined();
    expect(rows.slice(1).every((row) => row.data.listContinuation)).toBe(true);
    expect(rows[0]!.data.text).toBe(items.slice(0, 16).join(""));
    expect(rows.at(-1)!.data.messageText).toBe(text);
  });

  it("does not cut a fenced block, table, or shared reference document", () => {
    const fence = `\`\`\`text\n${"line\n".repeat(4000)}\`\`\`\n\n`;
    const rows = assistantRows(fence + longReply, "complete");
    expect(rows[0]!.data.text).toBe(fence);
    const table = "| Name | Value |\n| --- | --- |\n| one | two |\n\n";
    expect(assistantRows(table + longReply, "complete")[0]!.data.text).toBe(table);
    const referenced = `${longReply}\n[reference][target]\n\n[target]: https://example.com\n`;
    expect(assistantRows(referenced, "complete")).toHaveLength(1);
    expect(assistantRows(`${longReply}\nfootnote[^1]\n\n[^1]: note\n`, "complete")).toHaveLength(1);
  });
});

describe("ui fence yield", () => {
  it("reports a message whose ui or app fence another plugin renders live", () => {
    expect(hasUiFence(`Intro\n\n\`\`\`ui\nCard("Hi", [])\n\`\`\`\n`)).toBe(true);
    expect(hasUiFence(`\`\`\`app\n<b>hi</b>\n\`\`\``)).toBe(true);
    expect(hasUiFence(`~~~UI\nCard("Hi", [])\n~~~`)).toBe(true);
    expect(hasUiFence("   \`\`\`app x\n<b>hi</b>")).toBe(true);
  });

  it("keeps plain markdown and ordinary code fences", () => {
    expect(hasUiFence("Just **markdown**")).toBe(false);
    expect(hasUiFence("```ts\nconst one = 1;\n```")).toBe(false);
    expect(hasUiFence("```uish\nnot the ui language\n```")).toBe(false);
    expect(hasUiFence("Text with ```ui mid-line is not a fence")).toBe(false);
    expect(hasUiFence("~~~~\n```\nui\n```\n~~~~")).toBe(false);
  });

  it("ignores a ui fence nested inside another fenced block", () => {
    expect(hasUiFence("```markdown\n```ui\nCard()\n```\n```")).toBe(false);
  });

  it("yields a streaming fence that has not closed yet", () => {
    expect(hasUiFence("Reply so far\n\n```ui\nCard(\"Ping")).toBe(true);
  });
});
