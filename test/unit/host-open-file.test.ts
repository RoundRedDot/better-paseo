import { afterEach, expect, it } from "vitest";
import {
  linesFromSuffix,
  openHostOrReveal,
  rememberHostOpenFile,
} from "../../client/host-open-file";

afterEach(() => {
  rememberHostOpenFile("agent", undefined);
});

it("reads a line or a line range off a path suffix", () => {
  expect(linesFromSuffix(":12")).toEqual({ lineStart: 12 });
  expect(linesFromSuffix(":12:3")).toEqual({ lineStart: 12 });
  expect(linesFromSuffix("#L10")).toEqual({ lineStart: 10 });
  expect(linesFromSuffix("#L10-L20")).toEqual({ lineStart: 10, lineEnd: 20 });
  expect(linesFromSuffix("?raw")).toEqual({});
});

it("opens the host file pane when the renderer was given openFile", () => {
  const opened: unknown[] = [];
  rememberHostOpenFile("agent", (location) => opened.push(location));
  const revealed: string[] = [];

  openHostOrReveal("agent", "/tmp/app.ts:12", (path) => revealed.push(path));

  expect(opened).toEqual([{ path: "/tmp/app.ts", lineStart: 12 }]);
  expect(revealed).toEqual([]);
});

it("reveals through the daemon when the host has no openFile", () => {
  const revealed: string[] = [];
  openHostOrReveal("agent", "/tmp/app.ts:12", (path) => revealed.push(path));
  expect(revealed).toEqual(["/tmp/app.ts"]);
});
