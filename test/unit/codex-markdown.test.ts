import { describe, expect, it } from "vitest";
import { createBlockCache, splitBlocks } from "../../client/components/markdown/blocks";
import { lexBlock } from "../../client/components/markdown/lex";
import { codexPath } from "../../client/components/markdown/codex";

const browser = '::browser-complete{title="验证候选版翻译成功"}';
const review = '::code-comment{title="[P1] Fix it" body="Use a \\"safe\\" value." file="/repo/a.ts" start=10 end=12 priority=1}';
const citation = ':codex-file-citation{path="/repo/report.pdf" purpose="source" artifact_kind="document" page_number="4"}';
const template = '::artifact-template{skill_name="artifact-template-report" skill_directory="/repo/skill" display_name="Report" artifact_kind="document"}';
const memory = '<oai-mem-citation>\n<citation_entries>\nMEMORY.md:10-12|note=[Relevant context]\n</citation_entries>\n<rollout_ids>\nid\n</rollout_ids>\n</oai-mem-citation>';

describe("Codex directives", () => {
  it("parses known blocks and preserves the original source", () => {
    for (const [source, kind] of [[browser, "browser"], [review, "review"], [template, "template"], [memory, "memory"]]) {
      const token = lexBlock(source!)[0];
      expect(token).toMatchObject({ type: "codex", kind, raw: source });
    }
  });
  it("parses citations inside prose", () => {
    expect(lexBlock(`See ${citation} now`)[0]).toMatchObject({ type: "paragraph", tokens: [
      { type: "text" }, { type: "codex", kind: "citation", attrs: { path: "/repo/report.pdf", page_number: "4" } }, { type: "text" },
    ] });
  });
  it("keeps code and malformed or unknown directives literal", () => {
    for (const source of [`\`\`\`text\n${browser}\n\`\`\``, `\`${citation}\``, '::browser-complete{title="unfinished', ':codex-file-citation{purpose="source"}', ':codex-file-citation{path="https://example.com/report.pdf" purpose="output"}', ':codex-file-citation{path="/repo/report.pdf" purpose="source" mode="live"}', '::other{title="x"}']) {
      expect(JSON.stringify(lexBlock(source))).not.toContain('"type":"codex"');
    }
  });
  it("keeps the older review format in one block", () => {
    const source = '::code-comment{file="src/a.ts" line="42" severity="P1"}\nDetails.\n::';
    expect(lexBlock(source)[0]).toMatchObject({ type: "codex", kind: "review", body: "Details.", attrs: { line: "42", severity: "P1" } });
  });
  it("accepts a review with a title and no body", () => {
    const source = '::code-comment{title="Check this" file="src/a.ts"}';
    expect(lexBlock(source)[0]).toMatchObject({ type: "codex", kind: "review", attrs: { title: "Check this" } });
  });
  it("does not swallow later paragraphs, fenced delimiters, or another review", () => {
    const first = '::code-comment{title="First" file="a.ts"}';
    const second = '::code-comment{file="b.ts"}\nDetails.\n::';
    for (const suffix of ['\n\nParagraph.\n\n```\n::\n```\n\nAfter', `\n\n${second}`]) {
      const tokens = lexBlock(first + suffix);
      expect(tokens[0]).toMatchObject({ type: "codex", raw: first });
    }
  });
  it("retains a fenced delimiter inside a legacy review body", () => {
    const source = '::code-comment{file="a.ts"}\nDetails.\n\n```text\n::\n```\n\nMore.\n::';
    expect(lexBlock(source)[0]).toMatchObject({ type: "codex", body: 'Details.\n\n```text\n::\n```\n\nMore.' });
  });
  it("recognizes a legacy review with a blank line after its header", () => {
    const source = '::code-comment{file="a.ts"}\n\nDetails.\n::';
    expect(lexBlock(source)[0]).toMatchObject({ type: "codex", body: "Details." });
  });
  it("parses escaped quotes without consuming neighboring text", () => {
    const source = '::browser-complete{title="A \\"quoted\\" result"}';
    expect(lexBlock(source)[0]).toMatchObject({ type: "codex", attrs: { title: 'A "quoted" result' } });
    expect(lexBlock(source + ' trailing')[0]?.type).not.toBe("codex");
  });
  it("keeps streamed block boundaries consistent with a fresh parse", () => {
    const source = `Before\n\n${browser}\n\nAfter ${citation}\n\n${memory}`;
    const cache = createBlockCache();
    for (let end = 1; end <= source.length; end++) {
      const part = source.slice(0, end);
      expect(splitBlocks(part, cache), `prefix ${end}`).toEqual(splitBlocks(part));
      expect(splitBlocks(part, cache).join("")).toBe(part);
    }
  });
  it("reparses a streamed multiline legacy review after its closing delimiter", () => {
    for (const title of ['', 'title="Check this" ']) {
      const source = `::code-comment{${title}file="src/a.ts" severity="P1"}\nFirst.\n\nSecond.\n\nThird.\n::\n\nAfter`;
      const cache = createBlockCache();
      for (let end = 1; end <= source.length; end++) {
        const part = source.slice(0, end);
        expect(splitBlocks(part, cache), `prefix ${end}`).toEqual(splitBlocks(part));
      }
    }
  });
  it("reparses a legacy review immediately after prose when its closing delimiter arrives", () => {
    const source = 'Intro text\n::code-comment{file="a.ts"}\n\nBody one.\n\nBody two.\n::\n\nAfter';
    const cache = createBlockCache();
    for (let end = 1; end <= source.length; end++) {
      const part = source.slice(0, end);
      expect(splitBlocks(part, cache), `prefix ${end}`).toEqual(splitBlocks(part));
    }
  });
  it("reparses multiline attributes in every supported directive", () => {
    for (const header of [
      '::browser-complete{title="a\n\nb\n\nc"}',
      '::artifact-template{display_name="a\n\nb\n\nc" artifact_kind=document skill_name=s}',
      ':codex-file-citation{path="/a.pdf" purpose=output title="a\n\nb\n\nc"}',
    ]) {
      const source = `Intro.\n\n${header}\n\nAfter.`;
      const cache = createBlockCache();
      for (let end = 1; end <= source.length; end++) {
        const part = source.slice(0, end);
        expect(splitBlocks(part, cache), `prefix ${end}`).toEqual(splitBlocks(part));
      }
    }
  });
  it("preserves percent characters in raw citation paths", () => {
    for (const path of ['/repo/report%20final.pdf', '/repo/100%real.pdf']) {
      const source = `:codex-file-citation{path="${path}" purpose="output"}`;
      expect(lexBlock(source)[0]).toMatchObject({ type: "codex", attrs: { path } });
      expect(codexPath(path)).toBe(path);
    }
    expect(codexPath('file:///repo/report%20final.pdf')).toBe('/repo/report final.pdf');
  });
  it("reuses stable blocks after a completed review", () => {
    const cache = createBlockCache();
    const source = `${review}\n\nOne.\n\nTwo.\n\nThree.\n\n`;
    splitBlocks(source, cache);
    splitBlocks(source + 'More', cache);
    expect(cache.verifiedCount).toBeGreaterThan(0);
  });
  it("keeps reusing blocks after a fenced review example", () => {
    const cache = createBlockCache();
    const source = '```text\n::code-comment{file="a.ts"}\nDetails.\n```\n\nOne.\n\nTwo.\n\nThree.\n\n';
    splitBlocks(source, cache);
    splitBlocks(source + 'More', cache);
    expect(cache.verifiedCount).toBeGreaterThan(0);
  });
  it("keeps reusing stable blocks while a review remains unclosed", () => {
    for (const head of ['::code-comment{title="T" file="a.ts"}\nDescription.', '::code-comment{file="a.ts"}\nDescription.', '::code-comment{invalid}']) {
      const cache = createBlockCache();
      const source = `${head}\n\nOne.\n\nTwo.\n\nThree.\n\n`;
      splitBlocks(source, cache);
      splitBlocks(source + 'More code: { value: true }', cache);
      expect(cache.verifiedCount).toBeGreaterThan(0);
    }
  });
  it("can leave directive examples literal in non-assistant content", () => {
    expect(lexBlock(browser, false, false)[0]?.type).not.toBe("codex");
    expect(lexBlock(browser, false, true)[0]?.type).toBe("codex");
    const cache = createBlockCache();
    const text = `Before\n${browser}\n\nAfter`;
    expect(splitBlocks(text, cache, true)).toEqual(splitBlocks(text, undefined, true));
    expect(splitBlocks(text, cache, false)).toEqual(splitBlocks(text, undefined, false));
    expect(splitBlocks(text, cache, true)).toEqual(splitBlocks(text, undefined, true));
  });
});
