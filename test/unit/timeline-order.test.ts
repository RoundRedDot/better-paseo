/**
 * What follows a reply decides whether it keeps Paseo's 16pt gap: a tool or
 * thought row below takes it down to the host's own 4pt.
 */
import { describe, expect, it } from "vitest";
import { nextEntryIsRow, registerTimelineEntry } from "../../client/timeline-order";

// Module state: every test works above the previous test's times.
let clock = 1_800_000_000_000;
const nextAt = () => (clock += 1000);

describe("the item after a reply", () => {
  it("is a row when a tool or thought arrived next", () => {
    const reply = nextAt();
    const tool = nextAt();
    const forget = [registerTimelineEntry(reply, "text"), registerTimelineEntry(tool, "row")];
    expect(nextEntryIsRow(reply)).toBe(true);
    for (const done of forget) done();
  });

  it("is not a row when a prompt or another reply arrived next", () => {
    const reply = nextAt();
    const prompt = nextAt();
    const tool = nextAt();
    const forget = [
      registerTimelineEntry(reply, "text"),
      registerTimelineEntry(prompt, "text"),
      registerTimelineEntry(tool, "row"),
    ];
    expect(nextEntryIsRow(reply)).toBe(false);
    for (const done of forget) done();
  });

  it("keeps the gap when nothing arrived after it", () => {
    const earlier = nextAt();
    const reply = nextAt();
    const forget = [registerTimelineEntry(earlier, "row"), registerTimelineEntry(reply, "text")];
    expect(nextEntryIsRow(reply)).toBe(false);
    for (const done of forget) done();
  });

  it("forgets a row once it unmounts", () => {
    const reply = nextAt();
    const tool = nextAt();
    const forgetReply = registerTimelineEntry(reply, "text");
    const forgetTool = registerTimelineEntry(tool, "row");
    forgetTool();
    expect(nextEntryIsRow(reply)).toBe(false);
    forgetReply();
  });

  it("does not count a row arriving at the reply's own moment", () => {
    const reply = nextAt();
    const forget = [registerTimelineEntry(reply, "text"), registerTimelineEntry(reply, "row")];
    expect(nextEntryIsRow(reply)).toBe(false);
    for (const done of forget) done();
  });

  it("needs every item at the next moment to be a row", () => {
    const reply = nextAt();
    const next = nextAt();
    const forget = [
      registerTimelineEntry(reply, "text"),
      registerTimelineEntry(next, "row"),
      registerTimelineEntry(next, "text"),
    ];
    expect(nextEntryIsRow(reply)).toBe(false);
    for (const done of forget) done();
  });
});
