/**
 * Old engine vs new, on the showcase and the fixture corpus captured when
 * the old engine was removed (plan §3.1 test 3). The old engine's
 * output was recorded before `parse.ts` was deleted
 * (`.showcase/md-compare/old-engine.json`); both sides are compared in the
 * old block-tree shape. Every difference is listed below with its reason;
 * anything else fails.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as corpus from "../../.showcase/markdown-corpus";
import { fixtureNames, streamTexts } from "./helpers/stream-texts";
import { normalizeMarkdown, normalizeOld, type NBlock } from "./helpers/md-normal";

const OLD = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../.showcase/md-compare/old-engine.json"), "utf8"),
) as Record<string, NBlock[]>;

const documents: Array<[string, string]> = [];
for (const [name, text] of Object.entries(corpus)) documents.push([`showcase:${name}`, text]);
// New fixtures have no historical output from the deleted engine. Their
// incremental/full parsing is covered by markdown-blocks and stream-reuse.
const recordedFixtures = new Set(Object.keys(OLD).filter((id) => !id.startsWith("showcase:"))
  .map((id) => id.split(":")[0]!));
for (const fixture of fixtureNames().filter((name) => recordedFixtures.has(name))) {
  for (const item of streamTexts(fixture)) {
    if (item.text.trim() !== "") documents.push([`${fixture}:${item.kind}:${item.index}`, item.text]);
  }
}

/**
 * The justified differences, as edits that turn the old tree into the new one.
 * Only the sampler exercises them; nothing in the fixtures or the shipped
 * showcase replies differs.
 */
const KNOWN: Record<string, (old: NBlock[]) => NBlock[]> = {
  "showcase:MD_SAMPLER": (old) => {
    const out = structuredClone(old);
    // 1. CommonMark: task items right after bullets are the same list. The old
    //    engine started a new list block on the switch; rows and markers are
    //    unchanged, only the gap between the two runs becomes an item gap.
    const bullets = out[3];
    const tasks = out[4];
    if (bullets?.kind !== "list" || tasks?.kind !== "list") throw new Error("sampler moved");
    for (const item of tasks.items) bullets.items.push({ ...item, index: bullets.items.length + 1 });
    out.splice(4, 1);
    for (const block of out) {
      // 2. `$$ … $$` is a math block (plan D6), drawn as TeX source on the code
      //    face, instead of a paragraph that shows the delimiters.
      if (block.kind === "paragraph" && block.spans[0]?.kind === "text" && block.spans[0].text === "$$ E = mc^2 $$") {
        Object.assign(block, { kind: "plain", text: "E = mc^2" });
        delete (block as { spans?: unknown }).spans;
      }
      // 3. Character references decode: `&amp;` reads as `&`, as it would in
      //    any Markdown viewer.
      if (block.kind === "paragraph" && block.spans[0]?.kind === "text") {
        block.spans[0] = { kind: "text", text: block.spans[0].text.replace("&amp;", "&") };
      }
    }
    return out;
  },
};

describe("old engine vs marked", () => {
  it("covers every document in the historical snapshot", () => {
    expect(documents.map(([id]) => id).sort()).toEqual(Object.keys(OLD).sort());
  });

  it("draws the same tree for every document, except the listed differences", () => {
    const unexpected: string[] = [];
    for (const [id, text] of documents) {
      const old = OLD[id];
      expect(old, id).toBeDefined();
      const expected = (KNOWN[id] ?? ((tree: NBlock[]) => tree))(normalizeOld(old ?? []));
      const actual = normalizeMarkdown(text);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) unexpected.push(id);
    }
    expect(unexpected).toEqual([]);
  });

  it("differs from the old engine on the sampler only", () => {
    const differing = documents
      .filter(([id, text]) => JSON.stringify(normalizeMarkdown(text)) !== JSON.stringify(normalizeOld(OLD[id] ?? [])))
      .map(([id]) => id);
    expect(differing).toEqual(Object.keys(KNOWN));
  });
});
