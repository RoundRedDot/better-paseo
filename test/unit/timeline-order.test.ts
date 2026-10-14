/**
 * What follows a reply decides whether it keeps Paseo's 16pt gap: a tool or
 * thought row below takes it down to the host's own 4pt. A row keeps its own
 * gap only while nothing of its agent's sits below it.
 */
import { describe, expect, it } from "vitest";
import { hasEntryAfter, nextEntryIsRow, registerTimelineEntry, viewCentre } from "../../client/timeline-order";

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

describe("replayed history, every item stamped in one millisecond", () => {
  // A provider that keeps no times (Grok over ACP) has its history stamped as
  // the daemon replays it, in one loop: a call and the thought after it share
  // a millisecond, and the kind says nothing about which sits lower.
  it("puts a settled thought below a settled call it ties with", () => {
    const at = nextAt();
    const forget = [
      registerTimelineEntry(AGENT, at, "tool", "call-1"),
      registerTimelineEntry(AGENT, at, "thought", "next step"),
    ];
    expect(hasEntryAfter(AGENT, at, "tool", "call-1")).toBe(true);
    expect(hasEntryAfter(AGENT, at, "thought", "next step")).toBe(true);
    for (const done of forget) done();
  });

  it("does not count the item itself, or its copy in another pane", () => {
    const at = nextAt();
    const forget = [
      registerTimelineEntry(AGENT, at, "thought", "same"),
      registerTimelineEntry(AGENT, at, "thought", "same"),
    ];
    expect(hasEntryAfter(AGENT, at, "thought", "same")).toBe(false);
    for (const done of forget) done();
  });

  it("keeps a running call below a thought in its millisecond: it is live, not replayed", () => {
    const at = nextAt();
    const forget = [registerTimelineEntry(AGENT, at, "thought", "plan"), registerTimelineEntry(AGENT, at, "tool")];
    expect(hasEntryAfter(AGENT, at, "tool")).toBe(false);
    expect(hasEntryAfter(AGENT, at, "thought", "plan")).toBe(true);
    for (const done of forget) done();
  });
});

describe("the newest moment of replayed history, ordered by where items sit", () => {
  // Only the newest moment needs it: an older moment has a later one below.
  // Its lowest settled item keeps its gap, so the last row of a history that
  // ends on a call does not sink into the list's bottom padding.
  const at = (y: number) => () => ({ left: 0, top: y, width: 300, height: 0 });

  it("keeps the gap under the lowest item, whatever its kind", () => {
    const time = nextAt();
    const forget = [
      registerTimelineEntry(AGENT, time, "thought", "plan", at(100)),
      registerTimelineEntry(AGENT, time, "tool", "call-last", at(200)),
    ];
    expect(hasEntryAfter(AGENT, time, "tool", "call-last")).toBe(false);
    expect(hasEntryAfter(AGENT, time, "thought", "plan")).toBe(true);
    for (const done of forget) done();
  });

  it("puts a thought that sits lowest below the call it ties with", () => {
    const time = nextAt();
    const forget = [
      registerTimelineEntry(AGENT, time, "tool", "call", at(100)),
      registerTimelineEntry(AGENT, time, "thought", "after", at(200)),
    ];
    expect(hasEntryAfter(AGENT, time, "tool", "call")).toBe(true);
    expect(hasEntryAfter(AGENT, time, "thought", "after")).toBe(false);
    for (const done of forget) done();
  });

  it("counts every tied item as below when one cannot be placed", () => {
    const time = nextAt();
    const forget = [
      registerTimelineEntry(AGENT, time, "thought", "plan", at(100)),
      registerTimelineEntry(AGENT, time, "tool", "call", () => null),
    ];
    expect(hasEntryAfter(AGENT, time, "tool", "call")).toBe(true);
    expect(hasEntryAfter(AGENT, time, "thought", "plan")).toBe(true);
    for (const done of forget) done();
  });

  it("follows a newer moment: the old one is no longer the newest", () => {
    const time = nextAt();
    const forget = [
      registerTimelineEntry(AGENT, time, "thought", "plan", at(100)),
      registerTimelineEntry(AGENT, time, "tool", "call", at(200)),
    ];
    expect(hasEntryAfter(AGENT, time, "tool", "call")).toBe(false);
    forget.push(registerTimelineEntry(AGENT, nextAt(), "reply", "done", at(300)));
    expect(hasEntryAfter(AGENT, time, "tool", "call")).toBe(true);
    for (const done of forget) done();
  });

  it("places an item by its copy on screen when a hidden pane holds another", () => {
    const time = nextAt();
    const forget = [
      registerTimelineEntry(AGENT, time, "thought", "plan", at(100)),
      registerTimelineEntry(AGENT, time, "tool", "call", at(200)),
      registerTimelineEntry(AGENT, time, "thought", "plan", () => null),
      registerTimelineEntry(AGENT, time, "tool", "call", () => null),
    ];
    expect(hasEntryAfter(AGENT, time, "tool", "call")).toBe(false);
    expect(hasEntryAfter(AGENT, time, "thought", "plan")).toBe(true);
    for (const done of forget) done();
  });

  it("orders two calls of one message by where they sit, running or not", () => {
    const time = nextAt();
    // Running calls carry their id but no settled key.
    const forget = [
      registerTimelineEntry(AGENT, time, "tool", undefined, at(100), "first"),
      registerTimelineEntry(AGENT, time, "tool", undefined, at(200), "second"),
    ];
    expect(hasEntryAfter(AGENT, time, "tool", undefined, "first")).toBe(true);
    expect(hasEntryAfter(AGENT, time, "tool", undefined, "second")).toBe(false);
    for (const done of forget) done();
  });

  it("takes the lowest item from whichever pane draws it lowest", () => {
    // The same chat in two panes: the lowest copy overall is the lowest item
    // of its own pane, and so the same item in the other.
    const time = nextAt();
    const forget = [
      registerTimelineEntry(AGENT, time, "thought", "plan", at(100)),
      registerTimelineEntry(AGENT, time, "tool", "call", at(150)),
      registerTimelineEntry(AGENT, time, "thought", "plan", at(400)),
      registerTimelineEntry(AGENT, time, "tool", "call", at(450)),
    ];
    expect(hasEntryAfter(AGENT, time, "tool", "call")).toBe(false);
    expect(hasEntryAfter(AGENT, time, "thought", "plan")).toBe(true);
    for (const done of forget) done();
  });
});

describe("where a view is drawn", () => {
  it("reads a web view's box and a Fabric view's synchronous measurement", () => {
    expect(viewCentre({ getBoundingClientRect: () => ({ top: 10, width: 300, height: 20 }) })).toBe(20);
    expect(viewCentre({ measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) => callback(0, 40, 300, 20) })).toBe(50);
  });

  it("leaves a view unplaced when it has no size or answers later", () => {
    expect(viewCentre({ getBoundingClientRect: () => ({ top: 0, width: 0, height: 0 }) })).toBeNull();
    expect(viewCentre({ measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) => callback(0, 0, 0, 0) })).toBeNull();
    expect(viewCentre({ measureInWindow: () => {} })).toBeNull();
    expect(viewCentre(null)).toBeNull();
  });
});
