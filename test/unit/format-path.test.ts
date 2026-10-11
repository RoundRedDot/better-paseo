import { describe, expect, it } from "vitest";
import {
  formatPath,
  normalizePath,
  pathRootsFor,
  splitSelector,
  type FormatPathContext,
} from "../../client/paths/format-path";

const app: FormatPathContext = { roots: [{ path: "/projects/app" }], cwd: "/projects/app", mode: "relative" };

describe("formatPath", () => {
  it("shows a path inside the root relative to it", () => {
    expect(formatPath("/projects/app/src/a.ts", app)).toEqual({
      absolutePath: "/projects/app/src/a.ts",
      displayPath: "src/a.ts",
      label: null,
      projectRoot: "/projects/app",
      suffix: "",
    });
  });

  it("shows the root itself as ./", () => {
    expect(formatPath("/projects/app", app).displayPath).toBe("./");
    expect(formatPath("/projects/app/", app).displayPath).toBe("./");
  });

  it("matches by whole segments: app-backup is not inside app", () => {
    const result = formatPath("/projects/app-backup/x.ts", app);
    expect(result.displayPath).toBe("/projects/app-backup/x.ts");
    expect(result.projectRoot).toBeNull();
  });

  it("keeps a path outside every root absolute", () => {
    expect(formatPath("/etc/hosts", app).displayPath).toBe("/etc/hosts");
  });

  it("accepts a root written with a trailing slash", () => {
    const ctx = { ...app, roots: [{ path: "/projects/app/" }] };
    expect(formatPath("/projects/app/src/a.ts", ctx).displayPath).toBe("src/a.ts");
  });

  it("folds . and .. and repeated slashes before matching", () => {
    expect(formatPath("/projects/app/src/../lib//./b.ts", app)).toMatchObject({
      absolutePath: "/projects/app/lib/b.ts",
      displayPath: "lib/b.ts",
    });
    // `..` that climbs out of the root no longer matches it.
    expect(formatPath("/projects/app/../other/c.ts", app).displayPath).toBe("/projects/other/c.ts");
  });

  it("draws relative input as written and resolves it against cwd", () => {
    expect(formatPath("src/a.ts:12", app)).toEqual({
      absolutePath: "/projects/app/src/a.ts",
      displayPath: "src/a.ts",
      label: null,
      projectRoot: null,
      suffix: ":12",
    });
    expect(formatPath("../shared/x.ts", app).absolutePath).toBe("/projects/shared/x.ts");
  });

  it("leaves everything as it is when no root or cwd is known", () => {
    const unknown: FormatPathContext = { roots: [], mode: "relative" };
    expect(formatPath("/projects/app/src/a.ts", unknown).displayPath).toBe("/projects/app/src/a.ts");
    expect(formatPath("src/a.ts", unknown)).toMatchObject({
      absolutePath: "src/a.ts",
      displayPath: "src/a.ts",
    });
  });

  it("keeps selectors in the suffix", () => {
    expect(formatPath("/projects/app/a.ts:12", app)).toMatchObject({ displayPath: "a.ts", suffix: ":12" });
    expect(formatPath("/projects/app/a.ts:12:3", app).suffix).toBe(":12:3");
    expect(formatPath("/projects/app/a.md#L10", app).suffix).toBe("#L10");
    expect(formatPath("/projects/app/a.ts?raw", app).suffix).toBe("?raw");
    expect(formatPath("/projects/app/a.ts:12", app).absolutePath).toBe("/projects/app/a.ts");
  });

  it("handles Windows drive paths case-insensitively, with either slash", () => {
    const win: FormatPathContext = { roots: [{ path: "C:\\Users\\me\\proj" }], mode: "relative" };
    expect(formatPath("c:\\users\\ME\\proj\\src\\a.ts", win)).toMatchObject({
      absolutePath: "c:/users/ME/proj/src/a.ts",
      displayPath: "src/a.ts",
    });
    expect(formatPath("C:/Users/me/proj/src/a.ts:7", win)).toMatchObject({ displayPath: "src/a.ts", suffix: ":7" });
    expect(formatPath("C:\\Users\\me\\proj-old\\a.ts", win).displayPath).toBe("C:/Users/me/proj-old/a.ts");
    expect(formatPath("D:\\Users\\me\\proj\\a.ts", win).projectRoot).toBeNull();
  });

  it("matches UNC paths", () => {
    const unc: FormatPathContext = { roots: [{ path: "\\\\server\\share\\proj" }], mode: "relative" };
    expect(formatPath("\\\\SERVER\\share\\proj\\a.ts", unc).displayPath).toBe("a.ts");
  });

  it("keeps POSIX matching case-sensitive", () => {
    expect(formatPath("/Projects/App/a.ts", app).projectRoot).toBeNull();
  });

  it("prefers the worktree root and labels the main checkout as a secondary root", () => {
    const roots = pathRootsFor({
      directory: "/repo/.worktrees/feat",
      projectRootPath: "/repo",
      projectDisplayName: "repo",
      cwd: "/repo/.worktrees/feat/pkg",
    });
    expect(roots).toEqual([{ path: "/repo/.worktrees/feat" }, { path: "/repo", label: "repo" }]);
    const ctx: FormatPathContext = { roots, cwd: "/repo/.worktrees/feat/pkg", mode: "relative" };
    expect(formatPath("/repo/.worktrees/feat/src/a.ts", ctx)).toMatchObject({
      displayPath: "src/a.ts",
      label: null,
    });
    expect(formatPath("/repo/src/a.ts", ctx)).toMatchObject({
      displayPath: "repo/src/a.ts",
      label: "repo",
      projectRoot: "/repo",
    });
  });

  it("falls back to the absolute path for a symlinked spelling of the root", () => {
    // macOS: /tmp is a symlink to /private/tmp; there is no realpath here.
    const ctx: FormatPathContext = { roots: [{ path: "/tmp/proj" }], mode: "relative" };
    expect(formatPath("/private/tmp/proj/a.ts", ctx).displayPath).toBe("/private/tmp/proj/a.ts");
  });

  it("shows absolute paths in absolute mode", () => {
    const ctx: FormatPathContext = { ...app, mode: "absolute" };
    expect(formatPath("/projects/app/src/a.ts", ctx).displayPath).toBe("/projects/app/src/a.ts");
    expect(formatPath("src/a.ts", ctx).displayPath).toBe("/projects/app/src/a.ts");
  });
});

describe("pathRootsFor", () => {
  it("uses one root when the workspace is the project", () => {
    expect(pathRootsFor({ directory: "/repo", projectRootPath: "/repo/", cwd: "/repo/sub" })).toEqual([
      { path: "/repo" },
    ]);
  });

  it("falls back to the agent cwd when nothing else is known", () => {
    expect(pathRootsFor({ cwd: "/somewhere" })).toEqual([{ path: "/somewhere" }]);
    expect(pathRootsFor({})).toEqual([]);
  });

  it("labels a secondary root with its directory name when no project name is given", () => {
    expect(pathRootsFor({ directory: "/w/feat", projectRootPath: "/code/main" })[1]).toEqual({
      path: "/code/main",
      label: "main",
    });
  });
});

describe("splitSelector and normalizePath", () => {
  it("splits like the daemon's stripSelector", () => {
    expect(splitSelector("  src/a.ts:55-85 ")).toEqual({ path: "src/a.ts", suffix: ":55-85" });
    expect(splitSelector("C:\\a\\b.ts:3")).toEqual({ path: "C:\\a\\b.ts", suffix: ":3" });
    expect(splitSelector("plain")).toEqual({ path: "plain", suffix: "" });
  });

  it("normalises separators, dots and roots", () => {
    expect(normalizePath("a\\b\\..\\c/")).toBe("a/c");
    expect(normalizePath("/../a")).toBe("/a");
    expect(normalizePath("../a")).toBe("../a");
    expect(normalizePath("C:\\")).toBe("C:/");
    expect(normalizePath("./")).toBe(".");
  });
});
