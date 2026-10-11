import { describe, expect, it, vi } from "vitest";
import { createLatestPromptRegistry } from "../../client/state/latest-prompt";

describe("latest prompt registry (F2, defect D3)", () => {
  it("answers for a card before it is noted, so the first render is right", () => {
    const registry = createLatestPromptRegistry();
    expect(registry.isNewest("a", "u1", 100)).toBe(true);
    registry.note("a", "u1", 100);
    expect(registry.isNewest("a", "u0", 50)).toBe(false);
    expect(registry.isNewest("a", "u2", 200)).toBe(true);
  });

  it("moves to a newer prompt and notifies once per new prompt, not per repeat", () => {
    const registry = createLatestPromptRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.note("a", "u1", 100);
    registry.note("a", "u1", 100);
    registry.note("a", "u0", 50);
    expect(listener).toHaveBeenCalledTimes(1);
    registry.note("a", "u2", 200);
    expect(registry.latest("a")).toBe("u2");
    expect(registry.isNewest("a", "u1", 100)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps agents apart", () => {
    const registry = createLatestPromptRegistry();
    registry.note("a", "u1", 100);
    registry.note("b", "v1", 50);
    expect(registry.latest("a")).toBe("u1");
    expect(registry.latest("b")).toBe("v1");
    expect(registry.isNewest("b", "v1", 50)).toBe(true);
  });

  it("breaks timestamp ties by key, stably", () => {
    const registry = createLatestPromptRegistry();
    registry.note("a", "m2", 100);
    registry.note("a", "m1", 100);
    expect(registry.latest("a")).toBe("m2");
    expect(registry.isNewest("a", "m1", 100)).toBe(false);
  });
});
