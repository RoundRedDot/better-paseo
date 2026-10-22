import { describe, expect, it } from "vitest";
import { rowPressAction, type RowPressInput } from "../../client/details/click-model";

const base: RowPressInput = {
  pointer: false,
  rowClick: "details",
  modifier: false,
  hasBody: true,
  readsImage: false,
  isCurrent: false,
  form: "drawer",
};

describe("row press action", () => {
  it("opens details on touch and honors pointer row-click settings", () => {
    expect(rowPressAction(base)).toBe("details");
    expect(rowPressAction({ ...base, pointer: true })).toBe("details");
    expect(rowPressAction({ ...base, pointer: true, rowClick: "expand" })).toBe("expand");
  });

  it("inverts pointer row-click settings for Cmd/Ctrl modifiers", () => {
    expect(rowPressAction({ ...base, pointer: true, modifier: true })).toBe("expand");
    expect(rowPressAction({ ...base, pointer: true, rowClick: "expand", modifier: true })).toBe("details");
    expect(rowPressAction({ ...base, modifier: true })).toBe("details");
  });

  it("opens image readers directly and gives inert rows no action", () => {
    expect(rowPressAction({ ...base, readsImage: true })).toBe("viewer");
    expect(rowPressAction({ ...base, pointer: true, readsImage: true })).toBe("viewer");
    expect(rowPressAction({ ...base, hasBody: false })).toBe("none");
    expect(rowPressAction({ ...base, hasBody: false, readsImage: true })).toBe("none");
  });

  it("closes the current row on pointer or no-scrim forms only", () => {
    expect(rowPressAction({ ...base, isCurrent: true })).toBe("none");
    expect(rowPressAction({ ...base, isCurrent: true, pointer: true })).toBe("close");
    expect(rowPressAction({ ...base, isCurrent: true, form: "floating" })).toBe("close");
    expect(rowPressAction({ ...base, isCurrent: true, form: "side" })).toBe("close");
    expect(rowPressAction({ ...base, isCurrent: true, readsImage: true })).toBe("none");
  });
});
