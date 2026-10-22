import { describe, expect, it } from "vitest";
import { launches, shellOpenCommand, type PathEntry } from "../../server/open-path";

const file = (mode = 0o644): PathEntry => ({ isDirectory: () => false, isFile: () => true, mode });
const folder: PathEntry = { isDirectory: () => true, isFile: () => false, mode: 0o755 };

describe("path press shell command", () => {
  it("opens a file in its default app and a folder in Finder on macOS", () => {
    expect(shellOpenCommand("darwin", "/repo/README.md", file())).toEqual({ command: "open", args: ["/repo/README.md"] });
    expect(shellOpenCommand("darwin", "/repo/src", folder)).toEqual({ command: "open", args: ["/repo/src"] });
  });

  it("only reveals what opening would launch: apps, scripts, executables", () => {
    for (const [target, entry] of [
      ["/Applications/Paseo.app", folder],
      ["/Applications/Paseo.app/", folder],
      ["/repo/run.command", file()],
      ["/repo/deploy.sh", file()],
      ["/repo/tool.py", file()],
      ["/repo/bin/paseo", file(0o755)],
    ] as const) {
      expect(launches(target, entry)).toBe(true);
      expect(shellOpenCommand("darwin", target, entry)).toEqual({ command: "open", args: ["-R", target] });
    }
    expect(launches("/repo/bin", folder)).toBe(false);
  });

  it("keeps the file manager on Windows and the containing directory elsewhere", () => {
    expect(shellOpenCommand("win32", "C:\\repo\\a.ts", file())).toEqual({ command: "explorer.exe", args: ["/select,C:\\repo\\a.ts"], windowsVerbatimArguments: true });
    expect(shellOpenCommand("linux", "/repo/a.ts", file())).toEqual({ command: "xdg-open", args: ["/repo"] });
  });
});
