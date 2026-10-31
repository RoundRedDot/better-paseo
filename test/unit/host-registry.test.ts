import { describe, expect, it } from "vitest";
import { createHostRegistry, singleHostRegistry } from "../../server/tasks/host-registry";

describe("host-registry", () => {
  it("lists and resolves a single host", async () => {
    const daemon = { available: () => true, connect: async () => null };
    const registry = singleHostRegistry(daemon, "h1", "Host One", true);
    expect(registry.list()).toEqual([{ id: "h1", label: "Host One", local: true }]);
    expect(registry.get("h1")).not.toBeNull();
    expect(registry.get("nope")).toBeNull();
    expect(await registry.connect("h1")).toBeNull();
    expect(await registry.connect("nope")).toBeNull();
  });

  it("aggregates multiple hosts", async () => {
    const a = { available: () => true, connect: async () => null };
    const b = { available: () => false, connect: async () => null };
    const registry = createHostRegistry(
      [
        { id: "a", label: "A", local: true },
        { id: "b", label: "B", local: false },
      ],
      { a, b },
    );
    expect(registry.list().map((h) => h.id)).toEqual(["a", "b"]);
    expect(registry.get("a")).not.toBeNull();
    expect(registry.get("b")).not.toBeNull();
    expect(registry.get("a")!.available()).toBe(true);
    expect(registry.get("b")!.available()).toBe(false);
  });

  it("skips hosts without a connector", () => {
    const registry = createHostRegistry([{ id: "x", label: "X", local: true }], {});
    expect(registry.list()).toEqual([{ id: "x", label: "X", local: true }]);
    expect(registry.get("x")).toBeNull();
  });
});
