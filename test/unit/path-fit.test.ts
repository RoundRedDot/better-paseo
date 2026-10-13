import { describe, expect, it } from "vitest";
import {
  budgetForWidth,
  fitMiddle,
  monoAdvance,
  shownPath,
  truncateMiddle,
} from "../../client/paths/truncate-middle";

const READ = "/Users/dev/workspace/acme-chat/server/handlers/response-handler.ts";

describe("fitMiddle", () => {
  it("is truncateMiddle whenever …/name fits", () => {
    for (const budget of [22, 30, 40, 60]) {
      expect(fitMiddle(READ, budget)).toBe(truncateMiddle(READ, budget));
    }
  });

  it("never exceeds the budget and keeps the name's start and extension", () => {
    // "…/response-handler.ts" is 21 characters; below that the name is cut.
    for (let budget = 5; budget < 21; budget++) {
      const out = fitMiddle(READ, budget);
      expect(out.length).toBeLessThanOrEqual(budget);
      expect(out.startsWith("…/r")).toBe(true);
      expect(out.endsWith(budget >= 9 ? ".ts" : "s")).toBe(true);
      // Cut in the middle, never at the end.
      expect(out.endsWith("…")).toBe(false);
    }
    expect(fitMiddle(READ, 14)).toBe("…/respon…er.ts");
  });

  it("falls back to the name alone at tiny budgets", () => {
    expect(fitMiddle(READ, 4).length).toBeLessThanOrEqual(4);
    expect(fitMiddle("abcdefghij", 5)).toBe("ab…ij");
  });
});

describe("budgetForWidth", () => {
  it("counts monospace characters per face", () => {
    // 13pt SF Mono ≈ 7.8pt per character: 200pt holds 25, less one of slack.
    expect(budgetForWidth(200, 13, "ui-monospace")).toBe(24);
    // A custom Iosevka is narrower: 6.5pt per character.
    expect(budgetForWidth(200, 13, '"Iosevka", ui-monospace')).toBe(29);
    // An unknown custom face is guessed a little wide.
    expect(budgetForWidth(200, 13, "Fancy Mono")).toBe(23);
  });

  it("waits for a measurement", () => {
    expect(budgetForWidth(0, 13, "monospace")).toBeNull();
    expect(budgetForWidth(-5, 13, "monospace")).toBeNull();
    expect(budgetForWidth(200, 0, "monospace")).toBeNull();
  });

  it("never returns a budget too small to show …/x", () => {
    expect(budgetForWidth(10, 13, "monospace")).toBe(4);
  });

  it("knows the common faces", () => {
    expect(monoAdvance("Iosevka Term")).toBe(0.5);
    // Paseo's own default web stack ("Follow Paseo" without host typography).
    expect(monoAdvance("SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace")).toBe(0.6);
    expect(monoAdvance("Menlo")).toBe(0.6);
    expect(monoAdvance(undefined)).toBe(0.6);
  });

  it("fits the measured slot from the iOS reads-20 row", () => {
    // A compact header on a 402pt phone leaves the target about 190pt; the
    // fixed 40-character budget overflowed it and the row cut the file name.
    const budget = budgetForWidth(190, 13, "ui-monospace");
    expect(budget).toBe(23);
    const shown = fitMiddle(READ, budget ?? 0);
    expect(shown.length).toBeLessThanOrEqual(23);
    // An absolute path keeps its root: `/…/name`.
    expect(shown).toBe("/…/response-handler.ts");
  });
});

describe("shownPath", () => {
  const relative = { displayPath: "server/handlers/response-handler.ts", label: null, suffix: ":12" };
  const secondary = {
    displayPath: "better-paseo/docs/plans/2026-10-11-ui-ux-rendering-upgrade.md",
    label: "better-paseo",
    suffix: "",
  };

  it("keeps the suffix with the file name", () => {
    const out = shownPath(relative, 30, true);
    expect(out.label).toBeNull();
    expect(out.text.length).toBeLessThanOrEqual(30);
    expect(out.text.endsWith("response-handler.ts:12")).toBe(true);
  });

  it("keeps a secondary root's label when the path still has room", () => {
    const out = shownPath(secondary, 60, true);
    expect(out.label).toBe("better-paseo");
    expect(out.label!.length + 1 + out.text.length).toBeLessThanOrEqual(60);
    expect(out.text.endsWith("2026-10-11-ui-ux-rendering-upgrade.md")).toBe(true);
  });

  it("drops the label rather than squeeze the file name in a measured slot", () => {
    const out = shownPath(secondary, 24, true);
    expect(out.label).toBeNull();
    expect(out.text.length).toBeLessThanOrEqual(24);
    expect(out.text.endsWith(".md")).toBe(true);
  });

  it("keeps the fixed-budget behaviour when not measured", () => {
    const out = shownPath(secondary, 24, false);
    expect(out.label).toBe("better-paseo");
    expect(out.text).toBe("…/2026-10-11-ui-ux-rendering-upgrade.md");
  });
});

describe("ellipsis", () => {
  it("fits the slot and never ends on an ellipsis", () => {
    const path = "/Users/dev/workspace/acme-chat/client/lib/an-unreasonably-long-module-name-for-a-cursor-store.ts";
    for (let cells = 8; cells < 60; cells++) {
      const out = fitMiddle(path, cells);
      expect(out.length).toBeLessThanOrEqual(cells);
      expect(out.endsWith("…")).toBe(false);
    }
  });

  it("drops a label before it would cut the file name", () => {
    const secondary = {
      displayPath: "better-paseo/docs/plans/2026-10-11-ui-ux-rendering-upgrade.md",
      label: "better-paseo",
      suffix: "",
    };
    // 41 cells: the label leaves 29, too few for "…/2026-10-11-ui-ux-rendering-upgrade.md" (39).
    const out = shownPath(secondary, 41, true);
    expect(out.label).toBeNull();
    expect(out.text).toBe("…/2026-10-11-ui-ux-rendering-upgrade.md");
  });
});
