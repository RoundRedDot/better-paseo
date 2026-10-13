import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => import("./helpers/rn-mock"));

import { WIDE_SETTINGS_MAX, findWidthCap, type WidthCapNode } from "../../client/ui/wide-host-column";

interface FakeNode extends WidthCapNode {
  name: string;
  maxWidth: string;
  parentElement: FakeNode | null;
}

/** A chain from the outermost node to the innermost, which is returned. */
function chain(...maxWidths: Array<[string, string]>): FakeNode {
  let parent: FakeNode | null = null;
  for (const [name, maxWidth] of maxWidths) {
    parent = { name, maxWidth, parentElement: parent, style: { maxWidth: "" } };
  }
  return parent!;
}

const read = (node: FakeNode) => node.maxWidth;

describe("findWidthCap", () => {
  it("finds Paseo's 720 page column above the plugin's wrappers", () => {
    const root = chain(
      ["scroll", "none"],
      ["page", "720px"],
      ["settings-content", "none"],
      ["error-boundary", "none"],
      ["plugin-root", "none"],
    );
    expect(findWidthCap(root, read)?.name).toBe("page");
  });

  it("does not count the node it starts from", () => {
    const root = chain(["page", "none"], ["plugin-root", "600px"]);
    expect(findWidthCap(root, read)).toBeNull();
  });

  it("ignores percentages and leaves a host that is already wide enough alone", () => {
    expect(findWidthCap(chain(["page", "100%"], ["root", "none"]), read)).toBeNull();
    expect(findWidthCap(chain(["page", `${WIDE_SETTINGS_MAX}px`], ["root", "none"]), read)).toBeNull();
    expect(findWidthCap(chain(["outer", "720px"], ["page", "1600px"], ["root", "none"]), read)).toBeNull();
  });

  it("gives up after a bounded number of ancestors", () => {
    const pairs: Array<[string, string]> = [["far", "720px"]];
    for (let index = 0; index < 20; index += 1) pairs.push([`wrapper-${index}`, "none"]);
    expect(findWidthCap(chain(...pairs), read)).toBeNull();
  });

  it("handles a detached node", () => {
    expect(findWidthCap(null, read)).toBeNull();
  });
});
