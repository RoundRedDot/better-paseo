import { describe, expect, it } from "vitest";
import { exitMark, parseExitMeta } from "../../client/ui/exit-mark";

describe("exitMark", () => {
  it("draws a check for success and a cross with the code for a failure", () => {
    expect(exitMark(0)).toBe("✓");
    expect(exitMark(1)).toBe("✗ 1");
    expect(exitMark(130)).toBe("✗ 130");
  });

  it("reads the code from an exit meta entry only", () => {
    expect(parseExitMeta("exit 0")).toBe(0);
    expect(parseExitMeta("exit 2")).toBe(2);
    expect(parseExitMeta("exit -1")).toBe(-1);
    expect(parseExitMeta("1.2s")).toBeUndefined();
    expect(parseExitMeta("+3 −1")).toBeUndefined();
  });
});
