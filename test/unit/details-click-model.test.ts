import { describe, expect, it } from "vitest";
import { rowPressAction, type RowPressInput } from "../../client/details/click-model";

const base: RowPressInput = {
  pointer: false,
  hasBody: true,
  readsImage: false,
  isCurrent: false,
  form: "drawer",
};

describe("row press action", () => {
  it("opens details on touch and always expands in place with a pointer", () => {
    expect(rowPressAction(base)).toBe("details");
    expect(rowPressAction({ ...base, form: null })).toBe("details");
    expect(rowPressAction({ ...base, pointer: true })).toBe("expand");
    expect(rowPressAction({ ...base, pointer: true, form: null })).toBe("expand");
    expect(rowPressAction({ ...base, pointer: true, form: "side" })).toBe("expand");
  });

  it("opens image readers directly on touch, expands them with a pointer, and gives inert rows no action", () => {
    expect(rowPressAction({ ...base, readsImage: true })).toBe("viewer");
    expect(rowPressAction({ ...base, pointer: true, readsImage: true })).toBe("expand");
    expect(rowPressAction({ ...base, hasBody: false })).toBe("none");
    expect(rowPressAction({ ...base, hasBody: false, readsImage: true })).toBe("none");
    expect(rowPressAction({ ...base, hasBody: false, pointer: true })).toBe("none");
  });

  it("closes the current row on touch in no-scrim forms, and expands it with a pointer", () => {
    expect(rowPressAction({ ...base, isCurrent: true })).toBe("none");
    expect(rowPressAction({ ...base, isCurrent: true, form: "floating" })).toBe("close");
    expect(rowPressAction({ ...base, isCurrent: true, form: "side" })).toBe("close");
    expect(rowPressAction({ ...base, isCurrent: true, readsImage: true })).toBe("none");
    expect(rowPressAction({ ...base, isCurrent: true, pointer: true, form: "side" })).toBe("expand");
  });
});
