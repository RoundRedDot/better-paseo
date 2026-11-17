import { afterEach, describe, expect, it, vi } from "vitest";
import { editorCommand, EditorUnavailableError, installedEditors } from "../../server/editor-target";
import { preferencesSchema } from "../../shared/preferences-settings";

const fs = vi.hoisted(() => ({ existing: new Set<string>(), executable: new Set<string>(), directories: new Set<string>(), unreadable: new Set<string>(), statErrors: new Set<string>(), realpath: new Map<string, string>(), realpathErrors: new Set<string>(), appImages: new Set<string>(), elf: new Set<string>(), handles: new Map<number, string>(), nextFd: 100, versions: new Map<string, string>() }));
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
  statSync: (path: string) => { if (fs.statErrors.has(path)) throw new Error("EACCES"); return { isFile: () => !fs.directories.has(path) }; },
  realpathSync: (path: string) => { if (fs.realpathErrors.has(path)) throw new Error("EACCES"); return fs.realpath.get(path) ?? path; },
  openSync: (path: string) => { if (fs.unreadable.has(path)) throw new Error("EACCES"); const fd = fs.nextFd++; fs.handles.set(fd, path); return fd; },
  readSync: (fd: number, buffer: Buffer) => {
    if (fs.elf.has(fs.handles.get(fd)!)) {
      Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(buffer);
      return 4;
    }
    if (!fs.appImages.has(fs.handles.get(fd)!)) return 0;
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0, 0x41, 0x49, 2]).copy(buffer);
    return Math.min(buffer.length, 11);
  },
  closeSync: (fd: number) => { fs.handles.delete(fd); },
}));
const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; fs.existing.clear(); fs.executable.clear(); fs.directories.clear(); fs.unreadable.clear(); fs.statErrors.clear(); fs.realpath.clear(); fs.realpathErrors.clear(); fs.appImages.clear(); fs.elf.clear(); fs.handles.clear(); fs.versions.clear(); });

describe("file open preference", () => {
  it("defaults to the system app and preserves a selected editor", () => {
    expect(preferencesSchema.parse({}).fileOpenApp).toBe("system");
    expect(preferencesSchema.parse({ fileOpenApp: "sublime" }).fileOpenApp).toBe("sublime");
    expect(preferencesSchema.parse({ fileOpenApp: "windsurf" }).fileOpenApp).toBe("windsurf");
    expect(preferencesSchema.parse({ fileOpenApp: "nope" }).fileOpenApp).toBe("system");
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

  it("prefers an installed Windows GUI over a command shim and waits for the shim when it is the only match", async () => {
    process.env.PATH = "D:\\shims";
    process.env.ProgramFiles = "C:\\Program Files";
    delete process.env.LOCALAPPDATA;
    fs.existing.add("D:\\shims\\code.exe");
    fs.existing.add("C:\\Program Files\\Microsoft VS Code\\Code.exe");
    expect(await editorCommand("vscode", "win32")).toEqual({ command: "C:\\Program Files\\Microsoft VS Code\\Code.exe", args: [], completion: "spawn" });
    fs.existing.delete("C:\\Program Files\\Microsoft VS Code\\Code.exe");
    expect(await editorCommand("vscode", "win32")).toEqual({ command: "D:\\shims\\code.exe", args: [], completion: "exit" });
  });

  it("recognises the VS Code Linux archive GUI on PATH", async () => {
    process.env.PATH = "/opt/VSCode";
    fs.executable.add("/opt/VSCode/code");
    fs.existing.add("/opt/VSCode/resources/app/product.json");
    expect((await editorCommand("vscode", "linux")).completion).toBe("spawn");
  });

  it("waits for the Linux bin/code launcher rather than treating it as the GUI", async () => {
    process.env.PATH = "/opt/VSCode/bin";
    fs.executable.add("/opt/VSCode/bin/code");
    fs.existing.add("/opt/VSCode/resources/app/product.json");
    expect((await editorCommand("vscode", "linux")).completion).toBe("exit");
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

  it("recognises the extracted Cursor Electron executable", async () => {
    process.env.PATH = "/opt/bin";
    fs.executable.add("/opt/bin/cursor");
    fs.realpath.set("/opt/bin/cursor", "/opt/cursor/cursor");
    fs.elf.add("/opt/cursor/cursor");
    expect((await editorCommand("cursor", "linux")).completion).toBe("spawn");
  });

  it("prefers the Windows Zed CLI over its GUI and waits for its exit", async () => {
    process.env.PATH = "C:\\Users\\a\\AppData\\Local\\Programs\\Zed";
    process.env.LOCALAPPDATA = "C:\\Users\\a\\AppData\\Local";
    const cli = "C:\\Users\\a\\AppData\\Local\\Programs\\Zed\\bin\\zed.exe";
    fs.existing.add("C:\\Users\\a\\AppData\\Local\\Programs\\Zed\\Zed.exe");
    fs.existing.add(cli);
    expect(await editorCommand("zed", "win32")).toEqual({ command: cli, args: [], completion: "exit" });
  });

  it("opens with the Windows Zed GUI when the CLI is absent", async () => {
    process.env.PATH = "C:\\Users\\a\\AppData\\Local\\Programs\\Zed";
    process.env.LOCALAPPDATA = "C:\\Users\\a\\AppData\\Local";
    const gui = "C:\\Users\\a\\AppData\\Local\\Programs\\Zed\\Zed.exe";
    fs.existing.add(gui);
    expect(await editorCommand("zed", "win32")).toEqual({ command: gui, args: [], completion: "spawn" });
  });

  it("finds a Windows Zed GUI in a custom PATH directory", async () => {
    process.env.PATH = "D:\\Apps\\Zed";
    delete process.env.LOCALAPPDATA;
    delete process.env.ProgramFiles;
    const gui = "D:\\Apps\\Zed\\Zed.exe";
    fs.existing.add(gui);
    expect(await editorCommand("zed", "win32")).toEqual({ command: gui, args: [], completion: "spawn" });
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

  it.each(["zedit", "zed-cli"])("finds a Linux Zed CLI packaged as %s", async (command) => {
    process.env.PATH = "/opt/bin";
    fs.executable.add(`/opt/bin/${command}`);
    expect(await editorCommand("zed", "linux")).toEqual({ command: `/opt/bin/${command}`, args: [], completion: "exit" });
  });

  it("keeps a Zed editor when /usr/sbin and /usr/bin are merged", async () => {
    process.env.PATH = "/usr/bin";
    fs.existing.add("/usr/sbin/zed");
    fs.executable.add("/usr/bin/zed");
    fs.realpath.set("/usr/sbin/zed", "/usr/bin/zed");
    fs.versions.set("/usr/bin/zed", "Zed 1.0 – /usr/libexec/zed-editor");
    expect((await editorCommand("zed", "linux")).command).toBe("/usr/bin/zed");
  });

  it("verifies a Zed candidate if the ZFS path cannot be resolved", async () => {
    process.env.PATH = "/opt/bin";
    fs.existing.add("/usr/sbin/zed");
    fs.realpathErrors.add("/usr/sbin/zed");
    fs.executable.add("/opt/bin/zeditor");
    fs.versions.set("/opt/bin/zeditor", "Zed 1.0 – /opt/zed");
    expect((await editorCommand("zed", "linux")).command).toBe("/opt/bin/zeditor");
    fs.versions.delete("/opt/bin/zeditor");
    await expect(editorCommand("zed", "linux")).rejects.toThrow("EACCES");
  });

  it("reports Zed missing when there are no candidates, even if the ZFS path is unreadable", async () => {
    process.env.PATH = "";
    fs.existing.add("/usr/sbin/zed");
    fs.realpathErrors.add("/usr/sbin/zed");
    await expect(editorCommand("zed", "linux")).rejects.toBeInstanceOf(EditorUnavailableError);
  });

  it("reports an editor missing from PATH", async () => {
    process.env.PATH = "";
    await expect(editorCommand("zed", "linux")).rejects.toBeInstanceOf(EditorUnavailableError);
  });

  it("skips a directory named like the command and finds the next executable", async () => {
    process.env.PATH = "/first:/second";
    fs.executable.add("/first/cursor");
    fs.directories.add("/first/cursor");
    fs.executable.add("/second/cursor");
    expect((await editorCommand("cursor", "linux")).command).toBe("/second/cursor");
  });

  it("preserves an executable read error instead of reporting that it is absent", async () => {
    process.env.PATH = "/first";
    fs.executable.add("/first/cursor");
    fs.unreadable.add("/first/cursor");
    await expect(editorCommand("cursor", "linux")).rejects.toThrow("EACCES");
  });

  it.each(["unreadable", "statErrors", "realpathErrors"] as const)("tries the next executable after a candidate has %s", async (failure) => {
    process.env.PATH = "/first:/second";
    fs.executable.add("/first/cursor");
    fs.executable.add("/second/cursor");
    fs[failure].add("/first/cursor");
    expect((await editorCommand("cursor", "linux")).command).toBe("/second/cursor");
    fs.executable.delete("/second/cursor");
    await expect(editorCommand("cursor", "linux")).rejects.toThrow("EACCES");
  });

  it("rejects a macOS PATH shim that does not live inside the app", async () => {
    process.env.PATH = "/Users/a/.local/bin";
    fs.executable.add("/Users/a/.local/bin/cursor");
    fs.realpath.set("/Users/a/.local/bin/cursor", "/Users/a/.local/bin/cursor");
    await expect(editorCommand("cursor", "darwin")).rejects.toBeInstanceOf(EditorUnavailableError);
  });

  it("accepts a macOS PATH command that resolves inside the app bundle", async () => {
    process.env.PATH = "/Users/a/.local/bin";
    fs.executable.add("/Users/a/.local/bin/cursor");
    fs.realpath.set("/Users/a/.local/bin/cursor", "/Applications/Cursor.app/Contents/Resources/app/bin/cursor");
    expect(await editorCommand("cursor", "darwin")).toEqual({
      command: "/Users/a/.local/bin/cursor",
      args: [],
      completion: "exit",
    });
  });

  it("lists installed macOS apps in menu order and skips the rest", async () => {
    process.env.PATH = "";
    fs.existing.add("/Applications/Visual Studio Code.app");
    fs.existing.add("/Applications/Zed.app");
    fs.existing.add("/Applications/BBEdit.app");
    expect(await installedEditors("darwin")).toEqual(["vscode", "zed", "bbedit"]);
  });

  it("opens Windows Windsurf from its install folder and waits for the GUI", async () => {
    process.env.PATH = "";
    process.env.LOCALAPPDATA = "C:\\Users\\a\\AppData\\Local";
    delete process.env.ProgramFiles;
    delete process.env["ProgramFiles(x86)"];
    const exe = "C:\\Users\\a\\AppData\\Local\\Programs\\Windsurf\\Windsurf.exe";
    fs.existing.add(exe);
    expect(await editorCommand("windsurf", "win32")).toEqual({ command: exe, args: [], completion: "spawn" });
  });

  it("treats a Linux Windsurf binary beside product.json as the GUI", async () => {
    process.env.PATH = "/opt/Windsurf";
    fs.executable.add("/opt/Windsurf/windsurf");
    fs.existing.add("/opt/Windsurf/resources/app/product.json");
    expect(await editorCommand("windsurf", "linux")).toEqual({ command: "/opt/Windsurf/windsurf", args: [], completion: "spawn" });
  });

  it("trusts Xcode's command when the app bundle is absent", async () => {
    process.env.PATH = "/usr/bin";
    fs.executable.add("/usr/bin/xed");
    expect(await editorCommand("xcode", "darwin")).toEqual({ command: "/usr/bin/xed", args: [], completion: "exit" });
  });

  it("does not treat the Antigravity agent command as the IDE", async () => {
    process.env.PATH = "/Users/a/.local/bin";
    fs.executable.add("/Users/a/.local/bin/agy");
    await expect(editorCommand("antigravity", "linux")).rejects.toBeInstanceOf(EditorUnavailableError);
    fs.executable.add("/Users/a/.local/bin/antigravity");
    expect((await editorCommand("antigravity", "linux")).command).toBe("/Users/a/.local/bin/antigravity");
  });
});
