import { afterEach, describe, expect, it, vi } from "vitest";
import { editorCommand } from "../../server/editor-target";
import { preferencesSchema } from "../../shared/preferences-settings";

const fs = vi.hoisted(() => ({ existing: new Set<string>(), executable: new Set<string>(), realpath: new Map<string, string>() }));
vi.mock("node:fs", async (original) => ({
  ...await original<object>(),
  existsSync: (path: string) => fs.existing.has(path),
  accessSync: (path: string) => { if (!fs.executable.has(path)) throw new Error("ENOENT"); },
  realpathSync: (path: string) => fs.realpath.get(path) ?? path,
}));
const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; fs.existing.clear(); fs.executable.clear(); fs.realpath.clear(); });

describe("file open preference", () => {
  it("defaults to the system app and preserves a selected editor", () => {
    expect(preferencesSchema.parse({}).fileOpenApp).toBe("system");
    expect(preferencesSchema.parse({ fileOpenApp: "sublime" }).fileOpenApp).toBe("sublime");
  });

  it.each([
    ["vscode", "C:\\Users\\a\\AppData\\Local\\Programs\\Microsoft VS Code\\bin", "C:\\Users\\a\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"],
    ["cursor", "C:\\Users\\a\\AppData\\Local\\Programs\\Cursor\\resources\\app\\bin", "C:\\Users\\a\\AppData\\Local\\Programs\\Cursor\\Cursor.exe"],
  ] as const)("finds %s's Windows GUI from its command directory", (app, dir, exe) => {
    process.env.PATH = dir;
    delete process.env.LOCALAPPDATA;
    delete process.env.ProgramFiles;
    fs.existing.add(exe);
    expect(editorCommand(app, "win32")).toEqual({ command: exe, args: [], completion: "spawn" });
  });

  it("finds a macOS application and waits for the open command", () => {
    fs.existing.add("/Applications/Zed.app");
    expect(editorCommand("zed", "darwin")).toEqual({ command: "open", args: ["-a", "/Applications/Zed.app"], completion: "exit" });
  });

  it("finds Windows Sublime's command in the standard install directory", () => {
    process.env.PATH = "";
    process.env.ProgramFiles = "C:\\Program Files";
    fs.existing.add("C:\\Program Files\\Sublime Text\\subl.exe");
    expect(editorCommand("sublime", "win32")).toEqual({ command: "C:\\Program Files\\Sublime Text\\subl.exe", args: [], completion: "exit" });
  });

  it("waits for a CLI launcher but not Sublime's symlink to the GUI", () => {
    process.env.PATH = "/opt/bin";
    fs.executable.add("/opt/bin/zed");
    fs.executable.add("/opt/bin/subl");
    fs.realpath.set("/opt/bin/subl", "/opt/sublime_text/sublime_text");
    expect(editorCommand("zed", "linux").completion).toBe("exit");
    expect(editorCommand("sublime", "linux").completion).toBe("spawn");
  });

  it("does not wait for Cursor when its command links to an AppImage", () => {
    process.env.PATH = "/opt/bin";
    fs.executable.add("/opt/bin/cursor");
    fs.realpath.set("/opt/bin/cursor", "/opt/cursor/Cursor-2.0.AppImage");
    expect(editorCommand("cursor", "linux").completion).toBe("spawn");
  });

  it("reports an editor missing from PATH", () => {
    process.env.PATH = "";
    expect(() => editorCommand("zed", "linux")).toThrow("Zed is not installed");
  });
});
