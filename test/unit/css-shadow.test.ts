import { expect, it } from "vitest";
import { cssShadow } from "../../client/ui/tokens/css-shadow";

it("writes a theme elevation as a CSS box-shadow", () => {
  expect(
    cssShadow({ shadowColor: "#000000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 5, elevation: 1 }),
  ).toBe("0px 2px 5px rgba(0, 0, 0, 0.08)");
  expect(
    cssShadow({ shadowColor: "#1a2b3c", shadowOffset: { width: 1, height: 3 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 1 }),
  ).toBe("1px 3px 6px rgba(26, 43, 60, 0.12)");
});
