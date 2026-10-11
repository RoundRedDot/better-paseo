import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createReasoningSegmenter,
  reasoningText,
  segmentReasoning,
  type ReasoningSegmentation,
} from "../../client/reasoning/segment";

const titles = (result: ReasoningSegmentation) =>
  result.kind === "sections" ? result.sections.map((section) => section.title) : [];

describe("segmentReasoning", () => {
  const cases: Array<{
    name: string;
    text: string;
    kind: "sections" | "prose";
    titles?: Array<string | null>;
    bodies?: string[];
    steps?: number;
  }> = [
    {
      name: "Codex bold titles",
      text: "**Reading the code**\n\nThe reducer merges deltas.\n\n**Checking memo**\n\nThe card re-renders.",
      kind: "sections",
      titles: ["Reading the code", "Checking memo"],
      bodies: ["The reducer merges deltas.", "The card re-renders."],
      steps: 2,
    },
    {
      name: "a single bold title is enough",
      text: "**Plan**\n\nRead first, then edit.",
      kind: "sections",
      titles: ["Plan"],
      steps: 1,
    },
    {
      name: "intro paragraph before the first title",
      text: "Let me look at this.\n\n**Locating the bug**\n\nIt is in the reducer.",
      kind: "sections",
      titles: [null, "Locating the bug"],
      bodies: ["Let me look at this.", "It is in the reducer."],
      steps: 1,
    },
    {
      name: "two headings of one level",
      text: "## Context\n\nThe host remounts rows.\n\n## Fix\n\nKeep state in a store.",
      kind: "sections",
      titles: ["Context", "Fix"],
      bodies: ["The host remounts rows.", "Keep state in a store."],
      steps: 2,
    },
    {
      name: "the shallowest level with two headings splits; deeper ones stay in the body",
      text: "# Title\n\n## One\n\n### Detail\n\nText.\n\n## Two\n\nMore.",
      kind: "sections",
      titles: [null, "One", "Two"],
      bodies: ["# Title", "### Detail\n\nText.", "More."],
    },
    {
      name: "one heading alone is prose",
      text: "## Notes\n\nJust one heading here.",
      kind: "prose",
    },
    {
      name: "plain prose",
      text: "The list re-renders on each chunk. Memo would stop it.\n\nBut the theme changes.",
      kind: "prose",
    },
    {
      name: "prose with an ordered list is not steps",
      text: "I need to:\n\n1. Read the reducer.\n2. Check the memo.\n3. Write a test.\n\nThen run it.",
      kind: "prose",
    },
    {
      name: "bold inside a sentence is not a title",
      text: "This is **important** for the reducer.\n\n**Note:** the cache is shared.",
      kind: "prose",
    },
    {
      name: "bold in a list item is not a title",
      text: "- **First** item\n- **Second** item",
      kind: "prose",
    },
    {
      name: "titles inside fenced code are ignored",
      text: "Look:\n\n```md\n**Not a title**\n## Nor this\n## Nor that\n```\n\nDone.",
      kind: "prose",
    },
    {
      name: "bold titles win over headings",
      text: "**Step**\n\n## A\n\ntext\n\n## B\n\ntext",
      kind: "sections",
      titles: ["Step"],
    },
  ];

  it.each(cases)("$name", ({ text, kind, titles: expectedTitles, bodies, steps }) => {
    const result = segmentReasoning(text);
    expect(result.kind).toBe(kind);
    if (expectedTitles) expect(titles(result)).toEqual(expectedTitles);
    if (bodies && result.kind === "sections") {
      expect(result.sections.map((section) => section.body)).toEqual(bodies);
    }
    if (steps !== undefined && result.kind === "sections") expect(result.steps).toBe(steps);
    if (kind === "prose" && result.kind === "prose") expect(result.body).toBe(text.trim());
  });

  it("keeps the ordered list intact in the prose body", () => {
    const result = segmentReasoning("Steps:\n\n1. one\n2. two");
    expect(result).toEqual({ kind: "prose", body: "Steps:\n\n1. one\n2. two" });
  });

  it("round-trips sections to Markdown for copying", () => {
    const text = "Intro.\n\n**A**\n\nBody A.\n\n**B**\n\nBody B.";
    expect(reasoningText(segmentReasoning(text))).toBe(text);
  });
});

describe("streaming", () => {
  it("withholds a title line split across chunks until it settles", () => {
    const segmenter = createReasoningSegmenter();
    const step1 = segmenter.update("**Understanding ", { streaming: true });
    // Nothing visible yet: no literal asterisks flash in.
    expect(step1).toEqual({ kind: "prose", body: "" });

    const step2 = segmenter.update("**Understanding the symptom**", { streaming: true });
    // The closing ** has arrived but the line has not ended: still provisional.
    expect(step2).toEqual({ kind: "prose", body: "" });

    const step3 = segmenter.update("**Understanding the symptom**\n\nThe syntax ", {
      streaming: true,
    });
    expect(titles(step3)).toEqual(["Understanding the symptom"]);
  });

  it("withholds a second title mid-line but keeps the section before it", () => {
    const segmenter = createReasoningSegmenter();
    const result = segmenter.update("**One**\n\nFirst body.\n\n**Tw", { streaming: true });
    expect(result.kind).toBe("sections");
    if (result.kind !== "sections") return;
    expect(result.sections).toEqual([{ title: "One", body: "First body." }]);
  });

  it("shows bold prose as soon as text follows the bold", () => {
    const result = segmentReasoning("**Note:** the cache", { streaming: true });
    expect(result).toEqual({ kind: "prose", body: "**Note:** the cache" });
  });

  it("treats a final unterminated title line as a title once complete", () => {
    expect(titles(segmentReasoning("Intro.\n\n**Done**"))).toEqual([null, "Done"]);
  });

  it("reuses finished section objects across updates", () => {
    const segmenter = createReasoningSegmenter();
    const first = segmenter.update("**A**\n\nBody A.\n\n**B**\n\nBody", { streaming: true });
    const second = segmenter.update("**A**\n\nBody A.\n\n**B**\n\nBody B grows", {
      streaming: true,
    });
    if (first.kind !== "sections" || second.kind !== "sections") throw new Error("sections");
    expect(second.sections[0]).toBe(first.sections[0]);
    expect(second.sections[1]).not.toBe(first.sections[1]);
  });

  it("returns the same result for an unchanged text", () => {
    const segmenter = createReasoningSegmenter();
    const a = segmenter.update("**A**\n\nBody.", { streaming: true });
    expect(segmenter.update("**A**\n\nBody.", { streaming: true })).toBe(a);
  });

  it("starts over when the text is replaced rather than extended", () => {
    const segmenter = createReasoningSegmenter();
    segmenter.update("**A**\n\nBody.\n\n**B**\n\nMore.");
    expect(segmenter.update("Plain prose now.")).toEqual({
      kind: "prose",
      body: "Plain prose now.",
    });
  });

  it("tracks a fence opened in an earlier chunk", () => {
    const segmenter = createReasoningSegmenter();
    segmenter.update("Code:\n\n```ts\n", { streaming: true });
    segmenter.update("Code:\n\n```ts\n**inside**\n", { streaming: true });
    const result = segmenter.update("Code:\n\n```ts\n**inside**\n```\n\n**Real**\n\nText", {
      streaming: true,
    });
    expect(titles(result)).toEqual([null, "Real"]);
  });
});

// --- Real fixtures ---------------------------------------------------------

interface FixtureEvent {
  item: { type: string; text?: string };
}

/** Each reasoning item of a fixture, as the sequence of texts the card receives. */
function reasoningStreams(name: string): string[][] {
  const file = path.join(__dirname, "../fixtures/streams", `${name}.jsonl`);
  const events = readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => JSON.parse(line) as FixtureEvent);
  const streams: string[][] = [];
  let current: string[] | null = null;
  for (const { item } of events) {
    if (item.type !== "reasoning") {
      current = null;
      continue;
    }
    if (!current) {
      current = [];
      streams.push(current);
    }
    const previous = current[current.length - 1] ?? "";
    current.push(previous + (item.text ?? ""));
  }
  return streams;
}

describe("fixtures", () => {
  it.each(["reasoning-long-sections", "reasoning-long-prose", "mixed-turn"])(
    "%s: incremental segmentation matches a full scan at every chunk",
    (name) => {
      for (const stream of reasoningStreams(name)) {
        const segmenter = createReasoningSegmenter();
        for (const text of stream) {
          expect(segmenter.update(text, { streaming: true })).toEqual(
            segmentReasoning(text, { streaming: true }),
          );
        }
        const final = stream[stream.length - 1] ?? "";
        expect(segmenter.update(final)).toEqual(segmentReasoning(final));
      }
    },
  );

  it("reasoning-long-sections: 19 titled steps, never a literal ** in a body", () => {
    const [stream] = reasoningStreams("reasoning-long-sections");
    if (!stream) throw new Error("no reasoning");
    const segmenter = createReasoningSegmenter();
    for (const text of stream) {
      const result = segmenter.update(text, { streaming: true });
      const bodies = result.kind === "sections" ? result.sections.map((s) => s.body) : [result.body];
      for (const body of bodies) expect(body.startsWith("**")).toBe(false);
    }
    const final = segmenter.update(stream[stream.length - 1] ?? "");
    expect(final.kind).toBe("sections");
    if (final.kind !== "sections") return;
    expect(final.steps).toBe(19);
    expect(final.sections[0]?.title).toBe("Understanding the symptom");
    expect(final.sections.every((section) => section.title && section.body)).toBe(true);
  });

  it("reasoning-long-prose: stays one prose body throughout", () => {
    const [stream] = reasoningStreams("reasoning-long-prose");
    if (!stream) throw new Error("no reasoning");
    const segmenter = createReasoningSegmenter();
    for (const text of stream) expect(segmenter.update(text, { streaming: true }).kind).toBe("prose");
    const final = stream[stream.length - 1] ?? "";
    expect(segmenter.update(final)).toEqual({ kind: "prose", body: final.trim() });
  });

  it("mixed-turn: the first thought has two titled steps", () => {
    const [first] = reasoningStreams("mixed-turn");
    const final = segmentReasoning(first?.[first.length - 1] ?? "");
    expect(titles(final)).toEqual(["Locating the collapse logic", "Checking turn completion"]);
  });
});
