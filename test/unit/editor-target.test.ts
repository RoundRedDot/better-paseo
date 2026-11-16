import { afterEach, describe, expect, it, vi } from "vitest";
import { editorCommand } from "../../server/editor-target";
import { preferencesSchema } from "../../shared/preferences-settings";

const fs = vi.hoisted(() => ({ existing: new Set<string>(), executable: new Set<string>(), realpath: new Map<string, string>(), appImages: new Set<string>(), handles: new Map<number, string>(), nextFd: 100, versions: new Map<string, string>() }));
vi.mock("node:child_process", async (original) => ({
  ...await original<object>(),
  execFile: (path: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    const version = fs.versions.get(path);
    queueMicrotask(() => callback(version ? null : new Error("not Zed"), version ?? "", ""));
  },
}));
vi.mock("node:fs", async (original) => ({
  ...await original<object>(),
  existsSync: (path: string) => fs.existing.has(path),
  accessSync: (path: string) => { if (!fs.executable.has(path)) throw new Error("ENOENT"); },
  realpathSync: (path: string) => fs.realpath.get(path) ?? path,
  openSync: (path: string) => { const fd = fs.nextFd++; fs.handles.set(fd, path); return fd; },
  readSync: (fd: number, buffer: Buffer) => {
    if (!fs.appImages.has(fs.handles.get(fd)!)) return 0;
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0, 0x41, 0x49, 2]).copy(buffer);
    return 11;
  },
  closeSync: (fd: number) => { fs.handles.delete(fd); },
}));
const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; fs.existing.clear(); fs.executable.clear(); fs.realpath.clear(); fs.appImages.clear(); fs.handles.clear(); fs.versions.clear(); });

describe("file open preference", () => {
  it("defaults to the system app and preserves a selected editor", () => {
    expect(preferencesSchema.parse({}).fileOpenApp).toBe("system");
    expect(preferencesSchema.parse({ fileOpenApp: "sublime" }).fileOpenApp).toBe("sublime");
  });

  it.each([
    ["vscode", "C:\\Users\\a\\AppData\\Local\\Programs\\Microsoft VS Code\\bin", "C:\\Users\\a\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"],
    ["cursor", "C:\\Users\\a\\AppData\\Local\\Programs\\Cursor\\resources\\app\\bin", "C:\\Users\\a\\AppData\\Local\\Programs\\Cursor\\Cursor.exe"],
  ] as const)("finds %s's Windows GUI from its command directory", async (app, dir, exe) => {
    process.env.PATH = dir;
    delete process.env.LOCALAPPDATA;
    delete process.env.ProgramFiles;
    fs.existing.add(exe);
    fs.existing.add(`${dir}\\${app === "vscode" ? "code" : "cursor"}.cmd`);
    fs.existing.add(exe.replace(/[^\\]+$/, "resources\\app\\product.json"));
    expect(await editorCommand(app, "win32")).toEqual({ command: exe, args: [], completion: "spawn" });
  });

  it("does not infer an editor from an unrelated PATH entry's parent", async () => {
    process.env.PATH = "D:\\Tools\\bin";
    process.env.ProgramFiles = "C:\\Program Files";
    delete process.env.LOCALAPPDATA;
    fs.existing.add("D:\\Tools\\Code.exe");
    fs.existing.add("C:\\Program Files\\Microsoft VS Code\\Code.exe");
    expect((await editorCommand("vscode", "win32")).command).toBe("C:\\Program Files\\Microsoft VS Code\\Code.exe");
  });

  it("recognises the VS Code Linux archive GUI on PATH", async () => {
    process.env.PATH = "/opt/VSCode";
    fs.executable.add("/opt/VSCode/code");
    fs.existing.add("/opt/VSCode/resources/app/product.json");
    expect((await editorCommand("vscode", "linux")).completion).toBe("spawn");
  });

  it("finds a macOS application and waits for the open command", async () => {
    fs.existing.add("/Applications/Zed.app");
    expect(await editorCommand("zed", "darwin")).toEqual({ command: "open", args: ["-a", "/Applications/Zed.app"], completion: "exit" });
  });

  it("finds Windows Sublime's command in the standard install directory", async () => {
    process.env.PATH = "";
    process.env.ProgramFiles = "C:\\Program Files";
    fs.existing.add("C:\\Program Files\\Sublime Text\\subl.exe");
    expect(await editorCommand("sublime", "win32")).toEqual({ command: "C:\\Program Files\\Sublime Text\\subl.exe", args: [], completion: "exit" });
  });

  it("waits for a CLI launcher but not Sublime's symlink to the GUI", async () => {
    process.env.PATH = "/opt/bin";
    fs.executable.add("/opt/bin/zed");
    fs.executable.add("/opt/bin/subl");
    fs.realpath.set("/opt/bin/subl", "/opt/sublime_text/sublime_text");
    expect((await editorCommand("zed", "linux")).completion).toBe("exit");
    expect((await editorCommand("sublime", "linux")).completion).toBe("spawn");
  });

  it("does not wait for Cursor when its command links to an AppImage", async () => {
    process.env.PATH = "/opt/bin";
    fs.executable.add("/opt/bin/cursor");
    fs.realpath.set("/opt/bin/cursor", "/opt/cursor/Cursor-2.0.AppImage");
    fs.appImages.add("/opt/cursor/Cursor-2.0.AppImage");
    expect((await editorCommand("cursor", "linux")).completion).toBe("spawn");
  });

  it("recognises an AppImage even without a file extension", async () => {
    process.env.PATH = "/opt/bin";
    fs.executable.add("/opt/bin/cursor");
    fs.appImages.add("/opt/bin/cursor");
    expect((await editorCommand("cursor", "linux")).completion).toBe("spawn");
  });

  it("prefers the Windows Zed CLI over its GUI and waits for its exit", async () => {
    process.env.PATH = "C:\\Users\\a\\AppData\\Local\\Programs\\Zed";
    process.env.LOCALAPPDATA = "C:\\Users\\a\\AppData\\Local";
    const cli = "C:\\Users\\a\\AppData\\Local\\Programs\\Zed\\bin\\zed.exe";
    fs.existing.add("C:\\Users\\a\\AppData\\Local\\Programs\\Zed\\zed.exe");
    fs.existing.add(cli);
    expect(await editorCommand("zed", "win32")).toEqual({ command: cli, args: [], completion: "exit" });
  });

  it("finds zeditor and avoids the ZFS daemon", async () => {
    process.env.PATH = "/usr/sbin:/opt/bin";
    fs.existing.add("/usr/sbin/zed");
    fs.executable.add("/usr/sbin/zed");
    fs.executable.add("/opt/bin/zeditor");
    expect((await editorCommand("zed", "linux")).command).toBe("/opt/bin/zeditor");
    fs.executable.delete("/opt/bin/zeditor");
    await expect(editorCommand("zed", "linux")).rejects.toThrow("Zed is not installed");
  });

  it("keeps a Zed editor when /usr/sbin and /usr/bin are merged", async () => {
    process.env.PATH = "/usr/bin";
    fs.existing.add("/usr/sbin/zed");
    fs.executable.add("/usr/bin/zed");
    fs.realpath.set("/usr/sbin/zed", "/usr/bin/zed");
    fs.versions.set("/usr/bin/zed", "Zed 1.0 – /usr/libexec/zed-editor");
    expect((await editorCommand("zed", "linux")).command).toBe("/usr/bin/zed");
  });

  it("reports an editor missing from PATH", async () => {
    process.env.PATH = "";
    await expect(editorCommand("zed", "linux")).rejects.toThrow("Zed is not installed");
  });
});
