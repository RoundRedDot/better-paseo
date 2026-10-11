import { beforeEach, describe, expect, it } from "vitest";
import {
  firstSentence,
  formatDuration,
  lastCompleteSentence,
  plainInline,
  reasoningHeaderText,
} from "../../client/reasoning/preview";
import { segmentReasoning } from "../../client/reasoning/segment";
import {
  OBSERVED_LIMIT,
  carryObservation,
  observeReasoning,
  observedDurationMs,
  resetObservations,
} from "../../client/reasoning/observed";
import { carryReasoningState, reasoningKey } from "../../client/reasoning/key";
import { getDisclosure, resetDisclosureStore, setDisclosure } from "../../client/state/disclosure-store";
import {
  LONG_PARAGRAPH_CHARS,
  isLongParagraph,
  splitBodyRuns,
} from "../../client/reasoning/paragraphs";

describe("header text", () => {
  const sections = segmentReasoning("**Reading**\n\nA.\n\n**Fixing**\n\nThe memo is wrong. Then");
  const prose = segmentReasoning("The list re-renders. Memo would stop it. But the the");

  it.each([
    {
      state: "streaming sections: current title",
      result: reasoningHeaderText(sections, true, null),
      expected: { verb: "Thinking", preview: "Fixing", meta: [] },
    },
    {
      state: "streaming prose: last complete sentence",
      result: reasoningHeaderText(prose, true, null),
      expected: { verb: "Thinking", preview: "Memo would stop it.", meta: [] },
    },
    {
      state: "done sections: steps and duration",
      result: reasoningHeaderText(sections, false, 12_300),
      expected: { verb: "Thought", preview: "", meta: ["2 steps", "12s"] },
    },
    {
      state: "done prose: first sentence and duration",
      result: reasoningHeaderText(prose, false, 4_000),
      expected: { verb: "Thought", preview: "The list re-renders.", meta: ["4s"] },
    },
    {
      state: "done without an observed stream: no duration",
      result: reasoningHeaderText(sections, false, null),
      expected: { verb: "Thought", preview: "", meta: ["2 steps"] },
    },
    {
      state: "one step is singular",
      result: reasoningHeaderText(segmentReasoning("**Only**\n\nx"), false, null),
      expected: { verb: "Thought", preview: "", meta: ["1 step"] },
    },
    {
      state: "streaming intro before any title previews the intro",
      result: reasoningHeaderText(segmentReasoning("Let me look. Hmm\n\n**Fi", { streaming: true }), true, null),
      expected: { verb: "Thinking", preview: "Let me look.", meta: [] },
    },
  ])("$state", ({ result, expected }) => {
    expect(result).toEqual(expected);
  });
});

describe("sentences", () => {
  it.each([
    ["The cache is stale. Next", "The cache is stale."],
    ["First. Second one! Third", "Second one!"],
    ["Version 1.2 ships soon. Now", "Version 1.2 ships soon."],
    ["No sentence ended yet", ""],
    ["Line one.\nLine two continues. And", "Line two continues."],
    ["中文句子。下一个", "中文句子。"],
    ["It said **stop.** Then", "It said stop."],
    ["It said **stop.** Then more. And", "Then more."],
  ])("lastCompleteSentence(%j) = %j", (text, expected) => {
    expect(lastCompleteSentence(text)).toBe(expected);
  });

  it.each([
    ["Read `a.ts` first. Then edit.", "Read a.ts first."],
    ["No terminator here", "No terminator here"],
    ["\n\nLeading blank. Rest", "Leading blank."],
    ["One paragraph\n\nSecond. paragraph", "One paragraph"],
  ])("firstSentence(%j) = %j", (text, expected) => {
    expect(firstSentence(text)).toBe(expected);
  });

  it("strips inline Markdown", () => {
    expect(plainInline("## **Bold** [link](http://x) `code` _em_")).toBe("Bold link code em");
  });

  it("caps a long preview", () => {
    const sentence = `${"word ".repeat(80).trim()}.`;
    expect(lastCompleteSentence(sentence).length).toBeLessThanOrEqual(200);
  });
});

describe("formatDuration", () => {
  it.each([
    [null, null],
    [0, null],
    [400, "1s"],
    [12_300, "12s"],
    [65_000, "1m 05s"],
  ])("%j -> %j", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("observed duration", () => {
  beforeEach(() => resetObservations());

  it("measures from the first streaming render to the last timestamp", () => {
    observeReasoning("k", true, 1_000);
    observeReasoning("k", true, 5_000);
    observeReasoning("k", false, 13_000);
    expect(observedDurationMs("k")).toBe(12_000);
  });

  it("never invents a duration for a thought first seen complete", () => {
    observeReasoning("history", false, 9_000);
    expect(observedDurationMs("history")).toBeNull();
  });

  it("survives a remount: a later render only extends the record", () => {
    observeReasoning("k", true, 1_000);
    observeReasoning("k", false, 3_000);
    // Remounted in history with the same final timestamp.
    observeReasoning("k", false, 3_000);
    expect(observedDurationMs("k")).toBe(2_000);
  });

  it("carries a record to the settled key", () => {
    observeReasoning("short", true, 1_000);
    carryObservation("short", "long");
    observeReasoning("long", false, 4_000);
    expect(observedDurationMs("long")).toBe(3_000);
  });

  it("is bounded", () => {
    for (let index = 0; index <= OBSERVED_LIMIT; index++) observeReasoning(`k${index}`, true, 1);
    observeReasoning("k0", false, 10);
    expect(observedDurationMs("k0")).toBeNull();
  });
});

describe("reasoning key", () => {
  beforeEach(() => {
    resetDisclosureStore();
    resetObservations();
  });

  it("depends only on the agent and the first 80 characters", () => {
    const head = "x".repeat(80);
    expect(reasoningKey("a", `${head} one`)).toBe(reasoningKey("a", `${head} two`));
    expect(reasoningKey("a", head)).not.toBe(reasoningKey("b", head));
    expect(reasoningKey("a", "short")).not.toBe(reasoningKey("a", "shorter"));
  });

  it("carries the reader's choice while a short text grows", () => {
    const early = reasoningKey("a", "Let me");
    const later = reasoningKey("a", "Let me think");
    setDisclosure(early, true);
    expect(carryReasoningState(early, later)).toBe(true);
    expect(getDisclosure(later)).toBe(true);
  });

  it("never overrides a choice already made under the new key", () => {
    setDisclosure("from", true);
    setDisclosure("to", false);
    carryReasoningState("from", "to");
    expect(getDisclosure("to")).toBe(false);
  });
});

describe("long paragraphs", () => {
  const long = "word ".repeat(LONG_PARAGRAPH_CHARS / 4).trim();

  it("leaves a body without long paragraphs as one run", () => {
    expect(splitBodyRuns("Short.\n\n1. one\n2. two")).toEqual([
      { offset: 0, text: "Short.\n\n1. one\n2. two", long: false },
    ]);
  });

  it("isolates a long plain paragraph and keeps the rest together", () => {
    const body = `Intro.\n\n- a\n- b\n\n${long}\n\nAfter.`;
    const runs = splitBodyRuns(body);
    expect(runs.map((run) => run.long)).toEqual([false, true, false]);
    expect(runs[0]?.text).toBe("Intro.\n\n- a\n- b");
    expect(runs[1]?.text).toBe(long);
    expect(runs[2]?.text).toBe("After.");
    // Offsets point into the body, so they stay stable as it grows.
    for (const run of runs) expect(body.slice(run.offset).startsWith(run.text)).toBe(true);
  });

  it("never clamps lists, quotes or code", () => {
    expect(isLongParagraph(`- ${long}`)).toBe(false);
    expect(isLongParagraph(`> ${long}`)).toBe(false);
    expect(isLongParagraph(`1. ${long}`)).toBe(false);
    expect(isLongParagraph(`    ${long}`)).toBe(false);
    expect(isLongParagraph(long)).toBe(true);
  });

  it("does not split a fence on its blank lines", () => {
    const body = `\`\`\`ts\nconst a = 1;\n\nconst b = 2;\n\`\`\`\n\n${long}`;
    const runs = splitBodyRuns(body);
    expect(runs[0]?.text).toBe("```ts\nconst a = 1;\n\nconst b = 2;\n```");
    expect(runs[1]?.long).toBe(true);
  });
});
