import { afterEach, describe, expect, it } from "vitest";
import { LOAD_MARKS_GLOBAL, loadMark, loadMarks, resetLoadMarks } from "../../client/debug/load-marks";
import { clientEntry } from "../../scripts/build-client.mjs";

// One load's timing marks (`client/debug/load-marks.ts`), started by the install build's entry.

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[LOAD_MARKS_GLOBAL];
});

describe("load marks", () => {
  it("keeps the first time of each mark", () => {
    resetLoadMarks();
    loadMark("row.first", 100);
    loadMark("row.first", 200);
    loadMark("chunk.request", 150);
    expect(loadMarks()).toEqual({ "row.first": 100, "chunk.request": 150 });
  });

  it("adds to the record the install entry started, and hands out copies", () => {
    (globalThis as Record<string, unknown>)[LOAD_MARKS_GLOBAL] = { "entry.start": 1 };
    loadMark("contribute.start", 2);
    const copy = loadMarks();
    copy["entry.start"] = 99;
    expect(loadMarks()).toEqual({ "entry.start": 1, "contribute.start": 2 });
  });

  it("the install entry marks the start, the compile and the run of the bundle", () => {
    const entry = clientEntry("module.exports.default = () => () => {};");
    const start = entry.indexOf('"entry.start"');
    const compiled = entry.indexOf('marks["entry.compiled"]');
    const run = entry.indexOf("factory(require, bundle, bundle.exports);");
    const evaluated = entry.indexOf('marks["entry.evaluated"]');
    expect(start).toBeGreaterThan(-1);
    expect(start < compiled && compiled < run && run < evaluated).toBe(true);
  });
});
