/**
 * What follows a reply decides whether it keeps Paseo's 16pt gap: a tool or
 * thought row below takes it down to the host's own 4pt.
 */
import { describe, expect, it } from "vitest";
import { hasEntryAfter, nextEntryIsRow, registerTimelineEntry } from "../../client/timeline-order";

const AGENT = "agent-a";
const OTHER = "agent-b";

// Module state: every test works above the previous test's times.
let clock = 1_800_000_000_000;
const nextAt = () => (clock += 1000);

describe("the item after a reply", () => {
  it("is a row when a tool or thought arrived next", () => {
    const reply = nextAt();
    const tool = nextAt();
    const forget = [registerTimelineEntry(AGENT, reply, "text"), registerTimelineEntry(AGENT, tool, "row")];
    expect(nextEntryIsRow(AGENT, reply)).toBe(true);
    for (const done of forget) done();
  });

  it("is not a row when a prompt or another reply arrived next", () => {
    const reply = nextAt();
    const prompt = nextAt();
    const tool = nextAt();
    const forget = [
      registerTimelineEntry(AGENT, reply, "text"),
      registerTimelineEntry(AGENT, prompt, "text"),
      registerTimelineEntry(AGENT, tool, "row"),
    ];
    expect(nextEntryIsRow(AGENT, reply)).toBe(false);
    for (const done of forget) done();
  });

  it("keeps the gap when nothing arrived after it", () => {
    const earlier = nextAt();
    const reply = nextAt();
    const forget = [registerTimelineEntry(AGENT, earlier, "row"), registerTimelineEntry(AGENT, reply, "text")];
    expect(nextEntryIsRow(AGENT, reply)).toBe(false);
    for (const done of forget) done();
  });

  it("forgets a row once it unmounts", () => {
    const reply = nextAt();
    const tool = nextAt();
    const forgetReply = registerTimelineEntry(AGENT, reply, "text");
    const forgetTool = registerTimelineEntry(AGENT, tool, "row");
    forgetTool();
    expect(nextEntryIsRow(AGENT, reply)).toBe(false);
    forgetReply();
  });

  it("does not count a row arriving at the reply's own moment", () => {
    const reply = nextAt();
    const forget = [registerTimelineEntry(AGENT, reply, "text"), registerTimelineEntry(AGENT, reply, "row")];
    expect(nextEntryIsRow(AGENT, reply)).toBe(false);
    for (const done of forget) done();
  });

  it("needs every item at the next moment to be a row", () => {
    const reply = nextAt();
    const next = nextAt();
    const forget = [
      registerTimelineEntry(AGENT, reply, "text"),
      registerTimelineEntry(AGENT, next, "row"),
      registerTimelineEntry(AGENT, next, "text"),
    ];
    expect(nextEntryIsRow(AGENT, reply)).toBe(false);
    for (const done of forget) done();
  });

  it("ignores another agent's rows: each chat is its own timeline", () => {
    // Agent B is still working in another pane while A's last reply sits at
    // the bottom of A's chat. B's row is later, but it is not below A's reply.
    const reply = nextAt();
    const otherRow = nextAt();
    const forget = [registerTimelineEntry(AGENT, reply, "text"), registerTimelineEntry(OTHER, otherRow, "row")];
    expect(nextEntryIsRow(AGENT, reply)).toBe(false);
    for (const done of forget) done();
  });
});

describe("whether anything follows an item", () => {
  it("is false for the newest item and true once another arrives", () => {
    const thought = nextAt();
    const forgetThought = registerTimelineEntry(AGENT, thought, "row");
    expect(hasEntryAfter(AGENT, thought)).toBe(false);
    const forgetReply = registerTimelineEntry(AGENT, nextAt(), "text");
    expect(hasEntryAfter(AGENT, thought)).toBe(true);
    forgetReply();
    forgetThought();
  });

  it("counts only the item's own agent", () => {
    const thought = nextAt();
    const forget = [registerTimelineEntry(AGENT, thought, "row"), registerTimelineEntry(OTHER, nextAt(), "text")];
    expect(hasEntryAfter(AGENT, thought)).toBe(false);
    for (const done of forget) done();
  });
});
