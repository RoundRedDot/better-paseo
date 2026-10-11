import { describe, expect, it } from "vitest";
import { truncateMiddle } from "../../client/paths/truncate-middle";

describe("truncateMiddle", () => {
  it("returns text that fits unchanged", () => {
    expect(truncateMiddle("src/a.ts", 40)).toBe("src/a.ts");
  });

  it("keeps the first segment and the directory next to the file", () => {
    expect(truncateMiddle("src/app/features/chat/components/ChatView.tsx", 30)).toBe(
      "src/…/components/ChatView.tsx",
    );
  });

  it("always keeps the file name, down to …/name", () => {
    expect(truncateMiddle("src/app/features/chat/components/ChatView.tsx", 14)).toBe("…/ChatView.tsx");
    expect(truncateMiddle("src/app/features/chat/components/ChatView.tsx", 3)).toBe("…/ChatView.tsx");
  });

  it("stays within budget whenever the file name allows it", () => {
    const path = "packages/app/src/components/agent-stream/strategy-native.tsx";
    // "…/strategy-native.tsx" is 21 characters, the shortest legal output.
    for (let budget = 21; budget < path.length; budget++) {
      const out = truncateMiddle(path, budget);
      expect(out.length).toBeLessThanOrEqual(budget);
      expect(out.endsWith("/strategy-native.tsx")).toBe(true);
      expect(out).toContain("…");
    }
  });

  it("keeps the leading slash of an absolute path", () => {
    expect(truncateMiddle("/Users/me/code/project/src/index.ts", 22)).toBe("/Users/…/src/index.ts");
  });

  it("keeps a selector suffix with the file name", () => {
    expect(truncateMiddle("src/very/deep/tree/file.ts:120", 20)).toBe("src/…/file.ts:120");
  });

  it("cuts a string without slashes in the middle", () => {
    expect(truncateMiddle("abcdefghijklmnopqrstuvwxyz", 9)).toBe("abcd…wxyz");
    expect(truncateMiddle("abcdefghij", 1)).toBe("…");
  });
});
