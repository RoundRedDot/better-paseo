/**
 * The plugin's own paced reveal (ported from Paseo's `useRevealedText`, whose
 * `client/react-native` entry is deprecated in 0.16 and removed after
 * 2027-04-20). It must not depend on that entry, and must pace like the host.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceTextReveal,
  beginTextReveal,
  computeRevealStep,
  isTextRevealPacingSupported,
  nextTextRevealFrame,
  retargetTextReveal,
  visibleRevealedText,
} from "../../client/ui/text-reveal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("text reveal policy", () => {
  it("drains the backlog over the horizon with a one-character floor", () => {
    expect(computeRevealStep({ backlog: 0, elapsedMs: 16 })).toBe(0);
    expect(computeRevealStep({ backlog: 300, elapsedMs: 15 })).toBe(30);
    expect(computeRevealStep({ backlog: 3, elapsedMs: 1 })).toBe(1);
    expect(computeRevealStep({ backlog: 300, elapsedMs: 150 })).toBe(300);
    // A long stall is clamped, not a wild step past the backlog.
    expect(computeRevealStep({ backlog: 300, elapsedMs: 10_000 })).toBe(300);
  });

  it("shows a first text whole and paces only growth", () => {
    const first = beginTextReveal("Hello");
    expect(visibleRevealedText(first)).toBe("Hello");
    const grown = retargetTextReveal(first, "Hello, world");
    expect(visibleRevealedText(grown, { streaming: true })).toBe("Hello");
    const later = advanceTextReveal(grown, 1000 / 60);
    expect(later.revealed).toBeGreaterThan(5);
    expect(later.revealed).toBeLessThan(12);
  });

  it("never cuts inside a grapheme cluster", () => {
    expect(isTextRevealPacingSupported()).toBe(true);
    const text = "ok 👨‍👩‍👧 done";
    for (let revealed = 0; revealed <= text.length; revealed++) {
      const shown = visibleRevealedText({ target: text, revealed }, { streaming: true });
      expect(shown.includes("‍") ? shown.includes("👨‍👩‍👧") : true).toBe(true);
    }
  });

  it("holds back an unpaired regional indicator while streaming", () => {
    const half = "Flag: \u{1F1EF}";
    expect(visibleRevealedText(beginTextReveal(half), { streaming: true })).toBe("Flag: ");
    expect(visibleRevealedText(beginTextReveal(half), { streaming: false })).toBe(half);
  });

  it("caps frames at 60Hz and carries the remainder", () => {
    expect(nextTextRevealFrame(1000, 1008)).toBeNull();
    expect(nextTextRevealFrame(1000, 1020)).toEqual({ elapsedMs: 20, frameAtMs: 1020 - (20 % (1000 / 60)) });
  });
});

describe("useRevealedText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("../../client/ui/legacy-host-entry");
    vi.resetModules();
  });

  it("paces growth on its own frame clock, even where the old entry offers a hook", async () => {
    const frames: Array<(at: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", (run: (at: number) => void) => frames.push(run));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.resetModules();
    vi.doMock("../../client/ui/legacy-host-entry", () => ({
      LEGACY_HOST_ENTRY: { useRevealedText: () => "FROM THE HOST" },
    }));
    const { useRevealedText } = await import("../../client/ui/use-revealed-text");
    const TestRenderer = (await import("react-test-renderer")).default;
    const { act } = await import("react-test-renderer");

    const seen: string[] = [];
    function Probe(props: { text: string; phase: "streaming" | "complete" }) {
      seen.push(useRevealedText(props.text, props.phase));
      return null;
    }
    const long = `Start ${"x".repeat(200)}`;
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { text: "Start", phase: "streaming" })); });
    expect(seen.at(-1)).toBe("Start");
    await act(async () => { renderer.update(React.createElement(Probe, { text: long, phase: "streaming" })); });
    expect(seen.at(-1)).toBe("Start");
    let at = 0;
    await act(async () => { at += 1000 / 60; frames.shift()!(at); });
    const partial = seen.at(-1)!;
    expect(partial.length).toBeGreaterThan(5);
    expect(partial.length).toBeLessThan(long.length);
    await act(async () => { renderer.update(React.createElement(Probe, { text: long, phase: "complete" })); });
    expect(seen.at(-1)).toBe(long);
    expect(seen).not.toContain("FROM THE HOST");
    await act(async () => renderer.unmount());
  });
});
