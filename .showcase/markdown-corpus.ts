/**
 * Markdown the showcase draws, kept in one module so the S2 comparison test
 * (old engine vs marked) reads exactly what the screenshots show.
 */
export const REPLY = [
  "## What shipped",
  "",
  "Links in a reply are clickable now, and they route through the host's own opener —",
  "see [pull/125](https://github.com/paseo-cafe/paseo-cafe/pull/125) or the bare form",
  "https://paseo.sh/docs.",
  "",
  "| Area | Result |",
  "| --- | --- |",
  "| Selection | Copy and Add to chat |",
  "| Highlighting | shiki on the daemon |",
  "| System text | drawn as cards |",
  "",
  "1. Parse the envelope, never guess.",
  "2. Draw the card from typed fields.",
  "   - job output on the code surface",
  "   - a relayed message as prose",
  "",
  "> A refused scheme stays inert: `javascript:` never reaches a sink.",
  "",
  "```ts",
  'const ALLOWED = new Set(["http:", "https:", "mailto:"]);',
  "if (!ALLOWED.has(new URL(url).protocol)) return;",
  "```",
].join("\n");

export const HERO_REPLY = [
  "## What shipped",
  "",
  "Links route through the host's own opener — [pull/125](https://github.com/paseo-cafe/paseo-cafe/pull/125)",
  "or the bare form https://paseo.sh/docs.",
  "",
  "| Area | Result |",
  "| --- | --- |",
  "| Selection | Copy and Add to chat |",
  "| Highlighting | shiki on the daemon |",
  "",
  "```ts",
  'const ALLOWED = new Set(["http:", "https:", "mailto:"]);',
  "```",
].join("\n");

export const REASONING_SECTIONS = [
  "Let me trace where the stutter comes from before changing anything.",
  "",
  "**Understanding the symptom**",
  "",
  "The highlighter re-tokenises every fenced block on each delta. The message cache then measures a stale selection range, which forces a second layout.",
  "",
  "**Mapping the render path**",
  "",
  "I need to:",
  "",
  "1. Find where `splitBlocks` runs.",
  "2. Check whether finished blocks are memoised.",
  "3. Confirm the theme object is stable.",
  "",
  "**Checking the memo**",
  "",
  "The card compares `text.length` and `phase` only. " +
    "That should stop most renders, but the host hands every row a fresh theme object on every chunk, so the tokens memo has to key on the colour strings rather than the object identity. ".repeat(4) +
    "Once that holds, a finished section never renders again while later sections stream in.",
].join("\n");

export const REASONING_PROSE =
  "The list re-renders on each chunk because the live head is rebuilt from a new array. Memo on the row would stop it, but the theme object changes too. " +
  "So the comparator has to look at colours, not identity.\n\nThat leaves the reveal loop, which only runs while the text streams.";

/**
 * Every construct the engine draws, once, for the three-variant shots and the
 * old-vs-new comparison.
 */
export const MD_SAMPLER = [
  "# Rendering report",
  "",
  "The reply streams in **blocks**, with *emphasis*, ~~struck~~ text, `inline code` and a",
  "path such as `client/components/markdown/blocks.ts:42` that opens the file.",
  "See [the plan](https://example.com/plan) or https://paseo.sh/docs for details.",
  "",
  "## Lists",
  "",
  "- First item",
  "- Second item with `code`",
  "  - Nested item",
  "    - Deeper item",
  "- [x] Finished task",
  "- [ ] Open task",
  "",
  "3. Starts at three",
  "4. Then four",
  "",
  "### A quote",
  "",
  "> Finished blocks never render again.",
  ">",
  "> > A nested quote keeps its own rule.",
  "",
  "#### Table",
  "",
  "| Metric | Before | After |",
  "| :--- | ---: | :---: |",
  "| Flips | 10 | 0 |",
  "| RPC per block | 6 | 1 |",
  "",
  "---",
  "",
  "```ts",
  "export function splitBlocks(text: string): string[] {",
  "  return lex(text).map((token) => token.raw);",
  "}",
  "```",
  "",
  "$$",
  "E = mc^2",
  "$$",
  "",
  "Done &amp; dusted.",
].join("\n");
