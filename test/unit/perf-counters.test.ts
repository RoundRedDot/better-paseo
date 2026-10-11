import { afterEach, describe, expect, it } from "vitest";
import { disablePerf, enablePerf, perfCount, perfSnapshot, resetPerf } from "../../client/debug/perf";
import { createPerfStore } from "../../client/debug/store";

afterEach(() => {
  disablePerf();
  resetPerf();
});

describe("named perf counters", () => {
  it("add up per name in the store and clear on reset", () => {
    const store = createPerfStore();
    store.count("md.finalRerender", 1);
    store.count("md.finalRerender", 2);
    store.count("md.blockRender", 1);
    expect(store.snapshot().counters).toEqual({ "md.finalRerender": 3, "md.blockRender": 1 });
    store.reset();
    expect(store.snapshot().counters).toEqual({});
  });

  it("record nothing while the probes are off", () => {
    perfCount("md.finalRerender");
    expect(perfSnapshot().counters).toEqual({});
  });

  it("count once enabled", () => {
    enablePerf();
    perfCount("md.finalRerender");
    perfCount("md.finalRerender", 4);
    expect(perfSnapshot().counters).toEqual({ "md.finalRerender": 5 });
  });
});
