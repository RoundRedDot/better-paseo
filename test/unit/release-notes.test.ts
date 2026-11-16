import { expect, it } from "vitest";
import { releaseNoteLine } from "../../client/release-notes";

it("lifts release-note group titles out of the bullet list", () => {
  expect(releaseNoteLine("时间线")).toEqual({ kind: "heading", text: "时间线" });
  expect(releaseNoteLine("Timeline")).toEqual({ kind: "heading", text: "Timeline" });
  expect(releaseNoteLine("任务面板")).toEqual({ kind: "heading", text: "任务面板" });
  expect(releaseNoteLine("Task panel")).toEqual({ kind: "heading", text: "Task panel" });
  expect(releaseNoteLine("# 新分组")).toEqual({ kind: "heading", text: "新分组" });
  expect(releaseNoteLine("# New group")).toEqual({ kind: "heading", text: "New group" });
  expect(releaseNoteLine("简洁：只保留对话和结果。")).toEqual({ kind: "bullet", text: "简洁：只保留对话和结果。" });
  expect(releaseNoteLine("Fix scrolling")).toEqual({ kind: "bullet", text: "Fix scrolling" });
  expect(releaseNoteLine("Market release notes")).toEqual({ kind: "bullet", text: "Market release notes" });
});
