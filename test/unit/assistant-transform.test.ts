import { describe, expect, it } from "vitest";
import { assistantRows, hasBrowserPromptFence, hasUiFence } from "../../client/assistant-transform";

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
    // No other row carries the whole reply again.
    expect(rows.filter((row) => Object.values(row.data).includes(longReply))).toHaveLength(1);
  });

  it("keeps the streaming reply in one stable slot and keeps short replies unchanged", () => {
    expect(assistantRows(longReply, "streaming")).toHaveLength(1);
    expect(assistantRows("A short reply", "complete")[0]!.data)
      .toEqual({ text: "A short reply", phase: "complete" });
  });

  it("drops the single-dot filler omp writes for tool-only assistant messages", () => {
    expect(assistantRows(".", "complete")).toEqual([]);
    expect(assistantRows(" . \n", "streaming")).toEqual([]);
    expect(assistantRows("...", "complete")).toHaveLength(1);
    expect(assistantRows("Done.", "complete")).toHaveLength(1);
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
    // A footnote keeps the reply whole, so a long list's directive is not cut away either.
    const footnotedList = Array.from({ length: 64 }, (_, index) => `- Item ${index}${index === 0 ? "[^one]" : ""}: ${"detail ".repeat(60)}\n${index === 30 ? "    ::browser-complete{title=\"Done\"}\n" : ""}`).join("");
    expect(assistantRows(footnotedList, "complete")).toHaveLength(1);
  });
  it("keeps directive-bearing long replies intact for provider-specific rendering", () => {
    const text = `Example:\n::browser-complete{title="Done"}\n\n${longReply}`;
    expect(assistantRows(text, "complete")).toHaveLength(1);
    expect(assistantRows(text, "complete")[0]!.data.text).toBe(text);
  });
  it("virtualizes long replies that only quote directives inside code fences", () => {
    const examples = [
      "```markdown\n::browser-complete{title=\"Done\"}\n```\n\n",
      "~~~\n::code-comment{file=\"a.ts\" title=\"Fix\"}\n~~~\n\n",
      "> ```\n> ::browser-complete{title=\"Done\"}\n> ```\n\n",
      "    - ::browser-complete{title=\"Done\"} is indented code\n\n",
      "| Directive | Use |\n| --- | --- |\n::browser-complete{title=\"Done\"} | documentation example\n\n",
      "| Directive | Use |\n| --- | --- |\n::browser-complete{title=\"A | B\"}\n\n",
      "- > - $$\n::browser-complete{title=\"Done\"}\n\n", "::browser-complete{}\n\n",
      "Header\n:---\n::browser-complete{title=\"Done\"}\n\n",
      // A list marker or quote inside a fence is code, not the fence's end.
      "```\n- ```\n> ::browser-complete{title=\"Example\"}\n```\n\n",
      "- Item\n\n  ```text\n  ::artifact-template{display_name=\"A\" artifact_kind=\"doc\" skill_name=\"s\"}\n  :codex-file-citation{path=\"/repo/out.pdf\" purpose=\"output\"}\n  ```\n\n",
    ];
    for (const example of examples) {
      const text = `${example}${longReply}`;
      const rows = assistantRows(text, "complete");
      expect(rows.length).toBeGreaterThan(80);
      expect(rows.map((row) => row.data.text).join("")).toBe(text);
    }
  });
  it("keeps a real directive intact when a fence elsewhere quotes one", () => {
    const text = `\`\`\`\n::browser-complete{title="Example"}\n\`\`\`\n\n${longReply}::browser-complete{title="Done"}\n`;
    expect(assistantRows(text, "complete")).toHaveLength(1);
    const output = `${longReply}:codex-file-citation{path="/repo/out.pdf" purpose="output"}\n`;
    expect(assistantRows(output, "complete")).toHaveLength(1);
    for (const nested of [
      "- ::browser-complete{title=\"Done\"}\n", "> ::browser-complete{title=\"Done\"}\n", "1. Step\n\n   ::browser-complete{title=\"Done\"}\n",
      "- > ::browser-complete{title=\"Done\"}\n", ":codex-file-citation{path=\"/repo/out.pdf\"\npurpose=\"output\"}\n",
      // A fence opened on the list item's own line closes before the real directive.
      "- ```text\n  example\n  ```\n\n::browser-complete{title=\"Done\"}\n",
    ]) {
      expect(assistantRows(`${longReply}${nested}`, "complete")).toHaveLength(1);
    }
  });
  it("scans a long run of nested list markers in linear time", () => {
    const text = `${"-  ".repeat(28)}nested list\n\n::browser-complete{title="Done"}\n\n${longReply}`;
    const started = performance.now();
    expect(assistantRows(text, "complete")).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
  it("virtualizes long replies with only inline file citations", () => {
    const text = `See :codex-file-citation{path="/repo/a.pdf" purpose="source"}.\n\n${longReply}`;
    const rows = assistantRows(text, "complete");
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((row) => row.data.text).join("")).toBe(text);
  });
});

describe("browser-prompt fence yield", () => {
  it("matches closed fences accepted by the receiving plugin", () => {
    for (const text of ["```browser-prompt\nopen\n```", "~~~browser-prompt title\nopen\n~~~", "  ```browser-prompt\r\nopen\r\n  ```", "browser-prompt\n```Browser-Prompt\nopen\n```", "```ts\nx\n```\n```browser-prompt\ny\n```"]) {
      expect(hasBrowserPromptFence(text)).toBe(true);
    }
  });
  it("leaves unfinished, quoted and unrelated fences alone", () => {
    for (const text of ["```browser-prompt\nopen", "````markdown\n```browser-prompt\nopen\n```\n````", "```browser-prompts\nx\n```", "```Browser-Prompt\nx\n```", "browser-prompt text"]) {
      expect(hasBrowserPromptFence(text)).toBe(false);
    }
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
    expect(hasUiFence("```ui.json\n{}\n```")).toBe(false);
    expect(hasUiFence("```ui+json\n{}\n```")).toBe(false);
    expect(hasUiFence("```app.html\n<b>hi</b>\n```")).toBe(false);
    expect(hasUiFence("Text with ```ui mid-line is not a fence")).toBe(false);
    expect(hasUiFence("~~~~\n```\nui\n```\n~~~~")).toBe(false);
  });

  it("ignores a ui fence nested inside another fenced block", () => {
    expect(hasUiFence("```markdown\n```ui\nCard()\n```\n```")).toBe(false);
  });

  it("yields a streaming fence that has not closed yet", () => {
    expect(hasUiFence("Reply so far\n\n```ui\nCard(\"Ping", "streaming")).toBe(true);
  });

  it("waits for a streaming language label to finish before handing off", () => {
    expect(hasUiFence("```app", "streaming")).toBe(false);
    expect(hasUiFence("```applescript\n", "streaming")).toBe(false);
    expect(hasUiFence("```ui", "streaming")).toBe(false);
    expect(hasUiFence("```ui.json\n", "streaming")).toBe(false);
    expect(hasUiFence("```ui\n", "streaming")).toBe(true);
    expect(hasUiFence("```ui", "complete")).toBe(true);
  });
});
