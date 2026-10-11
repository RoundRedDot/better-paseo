/**
 * The assistant row's tail key (F1b). Replies arriving in the same millisecond
 * used to share `assistant:<ms>`, so both drew the reply footer.
 */
import { describe, expect, it } from "vitest";
import {
  getTimelineTail,
  noteTimelineItem,
  renameTimelineItem,
  textItemTailKey,
} from "../../client/timeline-tail";

// Module state: every test works above the previous test's times.
let clock = 1_800_000_000_000;
const nextAt = () => (clock += 1000);

describe("text item tail keys", () => {
  it("tells apart two replies with the same timestamp", () => {
    const at = nextAt();
    const first = textItemTailKey("assistant", at, "I'll start by searching for how the state is set.");
    const second = textItemTailKey("assistant", at, "Found it: `isTurnDone` ignores trailing tool calls.");
    expect(first).not.toBe(second);

    noteTimelineItem(first, at);
    noteTimelineItem(second, at);
    // One tail, not two: the tie keeps the incumbent, and only it matches.
    expect(getTimelineTail()).toBe(first);
    expect([first, second].filter((key) => getTimelineTail() === key)).toHaveLength(1);
  });

  it("is stable across re-renders and for the remounted row once the opening is complete", () => {
    const at = nextAt();
    const text = "x".repeat(120);
    const streamed = textItemTailKey("assistant", at, text);
    expect(textItemTailKey("assistant", at, text)).toBe(streamed);
    // The history row is mounted with the finished text: same opening, same key.
    expect(textItemTailKey("assistant", at, `${text} and the rest of the reply`)).toBe(streamed);
  });

  it("carries the tail along while a reply's opening grows", () => {
    const at = nextAt();
    const short = textItemTailKey("assistant", at, "Hel");
    const longer = textItemTailKey("assistant", at, "Hello there");
    expect(short).not.toBe(longer);

    noteTimelineItem(short, at);
    // The row's child notes the new key first; the tie keeps the old one ...
    noteTimelineItem(longer, at);
    expect(getTimelineTail()).toBe(short);
    // ... and the row's own effect then renames it.
    renameTimelineItem(short, longer);
    expect(getTimelineTail()).toBe(longer);
  });

  it("does not move a tail that another item holds", () => {
    const a = nextAt();
    const b = nextAt();
    const older = textItemTailKey("assistant", a, "older reply");
    const newer = textItemTailKey("assistant", b, "newer reply");
    noteTimelineItem(older, a);
    noteTimelineItem(newer, b);
    renameTimelineItem(older, textItemTailKey("assistant", a, "older reply, grown"));
    expect(getTimelineTail()).toBe(newer);
  });
});
