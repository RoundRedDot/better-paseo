import { describe, expect, it, vi } from "vitest";
import { findHostHorizontalScroll } from "../../client/ui/host-horizontal-scroll";

// The host's HorizontalScrollContext value, found by its shape up a view's fiber.

describe("findHostHorizontalScroll", () => {
  const record = () => ({ registerScrollOffset: vi.fn(), unregisterScrollOffset: vi.fn(), isAnyScrolledRight: { value: false } });

  it("walks up from a host view's fiber to the provider's value", () => {
    const value = record();
    const root = { memoizedProps: { value }, return: null };
    const middle = { memoizedProps: { value: { other: true } }, return: root };
    const node = { __internalInstanceHandle: { memoizedProps: {}, return: middle } };
    expect(findHostHorizontalScroll(node)).toBe(value);
  });

  it("answers null without the host's shape, a fiber, or a node", () => {
    const partial = { registerScrollOffset() {}, unregisterScrollOffset() {} };
    expect(findHostHorizontalScroll({ __internalInstanceHandle: { memoizedProps: { value: partial }, return: null } })).toBeNull();
    expect(findHostHorizontalScroll({})).toBeNull();
    expect(findHostHorizontalScroll(null)).toBeNull();
  });

  it("gives up on a cycle or a throwing getter", () => {
    const loop: { memoizedProps: object; return?: unknown } = { memoizedProps: {} };
    loop.return = loop;
    expect(findHostHorizontalScroll({ __internalInstanceHandle: loop })).toBeNull();
    const throwing = { get __internalInstanceHandle() { throw new Error("gone"); } };
    expect(findHostHorizontalScroll(throwing)).toBeNull();
  });
});
