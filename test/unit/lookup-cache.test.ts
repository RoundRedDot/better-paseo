import { describe, expect, it, vi } from "vitest";
import { cachedLookup } from "../../client/tools/lookup-cache";

describe("cachedLookup", () => {
  it("works a key out once, including an undefined answer", () => {
    const compute = vi.fn((key: string) => (key === "known" ? "icon" : undefined));
    const lookup = cachedLookup(compute);
    expect(lookup("known")).toBe("icon");
    expect(lookup("known")).toBe("icon");
    expect(lookup("other")).toBeUndefined();
    expect(lookup("other")).toBeUndefined();
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("starts over at its limit instead of growing", () => {
    const compute = vi.fn((key: string) => key.length);
    const lookup = cachedLookup(compute, 2);
    lookup("a");
    lookup("bb");
    lookup("ccc");
    lookup("a");
    expect(compute).toHaveBeenCalledTimes(4);
    lookup("ccc");
    expect(compute).toHaveBeenCalledTimes(4);
  });
});
