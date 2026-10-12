/**
 * What follows a reply decides whether it keeps Paseo's 16pt gap: a tool or
 * thought row below takes it down to the host's own 4pt. A row keeps its own
 * gap only while nothing of its agent's sits below it.
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
    const forget = [registerTimelineEntry(AGENT, reply, "reply"), registerTimelineEntry(AGENT, tool, "tool")];
    expect(nextEntryIsRow(AGENT, reply, "reply")).toBe(true);
    for (const done of forget) done();
  });

  it("is not a row when a prompt or another reply arrived next", () => {
    const reply = nextAt();
    const prompt = nextAt();
    const tool = nextAt();
    const forget = [
      registerTimelineEntry(AGENT, reply, "reply"),
      registerTimelineEntry(AGENT, prompt, "prompt"),
      registerTimelineEntry(AGENT, tool, "tool"),
    ];
    expect(nextEntryIsRow(AGENT, reply, "reply")).toBe(false);
    for (const done of forget) done();
  });

  it("keeps the gap when nothing arrived after it", () => {
    const earlier = nextAt();
    const reply = nextAt();
    const forget = [registerTimelineEntry(AGENT, earlier, "tool"), registerTimelineEntry(AGENT, reply, "reply")];
    expect(nextEntryIsRow(AGENT, reply, "reply")).toBe(false);
    for (const done of forget) done();
  });

  it("forgets a row once it unmounts", () => {
    const reply = nextAt();
    const tool = nextAt();
    const forgetReply = registerTimelineEntry(AGENT, reply, "reply");
    const forgetTool = registerTimelineEntry(AGENT, tool, "tool");
    forgetTool();
    expect(nextEntryIsRow(AGENT, reply, "reply")).toBe(false);
    forgetReply();
  });

  it("counts a tool call stamped in the reply's own millisecond: a message reads reply, then calls", () => {
    const at = nextAt();
    const forget = [registerTimelineEntry(AGENT, at, "reply"), registerTimelineEntry(AGENT, at, "tool")];
    expect(nextEntryIsRow(AGENT, at, "reply")).toBe(true);
    for (const done of forget) done();
  });

  it("does not count a thought stamped in the reply's own millisecond: it sits above", () => {
    const at = nextAt();
    const forget = [registerTimelineEntry(AGENT, at, "reply"), registerTimelineEntry(AGENT, at, "thought")];
    expect(nextEntryIsRow(AGENT, at, "reply")).toBe(false);
    for (const done of forget) done();
  });

  it("does not count a notice in the reply's own millisecond: their order is unknown", () => {
    const at = nextAt();
    const forget = [registerTimelineEntry(AGENT, at, "reply"), registerTimelineEntry(AGENT, at, "notice")];
    expect(nextEntryIsRow(AGENT, at, "reply")).toBe(false);
    for (const done of forget) done();
  });

  it("needs every item at the next moment to be a row", () => {
    const reply = nextAt();
    const next = nextAt();
    const forget = [
      registerTimelineEntry(AGENT, reply, "reply"),
      registerTimelineEntry(AGENT, next, "tool"),
      registerTimelineEntry(AGENT, next, "notice"),
    ];
    expect(nextEntryIsRow(AGENT, reply, "reply")).toBe(false);
    for (const done of forget) done();
  });

  it("ignores another agent's rows: each chat is its own timeline", () => {
    // Agent B is still working in another pane while A's last reply sits at
    // the bottom of A's chat. B's row is later, but it is not below A's reply.
    const reply = nextAt();
    const otherRow = nextAt();
    const forget = [registerTimelineEntry(AGENT, reply, "reply"), registerTimelineEntry(OTHER, otherRow, "tool")];
    expect(nextEntryIsRow(AGENT, reply, "reply")).toBe(false);
    for (const done of forget) done();
  });
});

describe("whether anything follows an item", () => {
  it("is false for the newest item and true once another arrives", () => {
    const thought = nextAt();
    const forgetThought = registerTimelineEntry(AGENT, thought, "thought");
    expect(hasEntryAfter(AGENT, thought, "thought")).toBe(false);
    const forgetReply = registerTimelineEntry(AGENT, nextAt(), "reply");
    expect(hasEntryAfter(AGENT, thought, "thought")).toBe(true);
    forgetReply();
    forgetThought();
  });

  it("counts only the item's own agent", () => {
    const thought = nextAt();
    const forget = [
      registerTimelineEntry(AGENT, thought, "thought"),
      registerTimelineEntry(OTHER, nextAt(), "reply"),
    ];
    expect(hasEntryAfter(AGENT, thought, "thought")).toBe(false);
    for (const done of forget) done();
  });

  it("puts a running call below the thought stamped in the same millisecond", () => {
    // One model message: the thought and the call it led to leave the daemon
    // together. The call is below until it finishes and takes a later stamp.
    const at = nextAt();
    const forget = [registerTimelineEntry(AGENT, at, "thought"), registerTimelineEntry(AGENT, at, "tool")];
    expect(hasEntryAfter(AGENT, at, "thought")).toBe(true);
    expect(hasEntryAfter(AGENT, at, "tool")).toBe(false);
    for (const done of forget) done();
  });

  it("puts a later thought below a finished call", () => {
    const tool = nextAt();
    const forget = [registerTimelineEntry(AGENT, tool, "tool"), registerTimelineEntry(AGENT, nextAt(), "thought")];
    expect(hasEntryAfter(AGENT, tool, "tool")).toBe(true);
    for (const done of forget) done();
  });

  it("leaves two calls in one millisecond unordered, so the lower keeps its gap", () => {
    const at = nextAt();
    const forget = [registerTimelineEntry(AGENT, at, "tool"), registerTimelineEntry(AGENT, at, "tool")];
    expect(hasEntryAfter(AGENT, at, "tool")).toBe(false);
    for (const done of forget) done();
  });
});
