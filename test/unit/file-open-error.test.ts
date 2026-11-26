import { afterEach, describe, expect, it, vi } from "vitest";
import { copyOpenerFallback, fileOpenError, openerFallbackPath, revealWithSetting } from "../../client/i18n/file-open-error";
import { getEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";

describe("file open errors", () => {
  it("localises known errors while retaining launcher details", () => {
    expect(fileOpenError({ error: "unavailable", errorKind: "settings_unavailable" }, "zh")).toBe("文件打开设置不可用");
    expect(fileOpenError({ error: "not synchronized", errorKind: "settings_unsynced" }, "zh")).toBe("文件打开设置尚未同步，请稍后重试");
    expect(fileOpenError({ error: "missing", errorKind: "editor_unavailable", errorApp: "vscode" }, "zh")).toBe("VS Code 未安装或其命令不在 PATH 中");
    expect(fileOpenError({ error: "Failed to open path (exit 1)", errorKind: "launch_failed", errorApp: "system" }, "zh")).toBe("打开失败（退出码 1）");
    expect(fileOpenError({ error: "Failed to open file with vscode (exit 1): Error detail", errorKind: "launch_failed", errorApp: "vscode" }, "zh")).toBe("VS Code 打开失败（退出码 1）：Error detail");
    expect(fileOpenError({ error: "spawn /usr/bin/code ENOENT", errorKind: "launch_failed", errorApp: "vscode" }, "zh")).toBe("VS Code 打开失败：spawn /usr/bin/code ENOENT");
    expect(fileOpenError({ error: "pending", errorKind: "launch_unconfirmed" }, "zh")).toBe("无法确认是否打开，目标可能已经打开");
    expect(fileOpenError({ error: "missing", errorKind: "editor_unavailable", errorApp: "zed" }, "en")).toBe("missing");
  });

  it.each(["en", "zh"] as const)("provides a general system opener fix in %s and retains details", (language) => {
    const message = fileOpenError({ error: "spawn xdg-open ENOENT", errorKind: "launch_failed", errorApp: "system", errorCode: "system_opener_unavailable" }, language);
    expect(message).toContain("spawn xdg-open ENOENT");
    expect(message).toContain("PATH");
    expect(message).not.toMatch(/Markdown|markdown/);
  });

  it("recognizes the previously deployed server's error kind", () => {
    const message = fileOpenError({ error: "spawn xdg-open ENOENT", errorKind: "system_opener_unavailable", errorApp: "system" }, "zh");
    expect(message).toContain("spawn xdg-open ENOENT");
    expect(message).toContain("PATH");
  });

  it("preserves errors from older servers without a structured kind", () => {
    expect(fileOpenError({ error: "old server failure" }, "zh")).toBe("old server failure");
  });

  describe("hosts with no system opener", () => {
    const unavailable = { error: "spawn xdg-open ENOENT", errorKind: "launch_failed" as const, errorApp: "system" as const, errorCode: "system_opener_unavailable" as const };

    it("copies the server's resolved path, or joins a relative press to the working directory for older servers", () => {
      expect(openerFallbackPath({ ...unavailable, path: "/srv/repo/src/a.ts" }, "/srv/repo", "src/a.ts:12")).toBe("/srv/repo/src/a.ts");
      expect(openerFallbackPath(unavailable, "/srv/repo/", "src/a.ts")).toBe("/srv/repo/src/a.ts");
      expect(openerFallbackPath({ error: "spawn xdg-open ENOENT", errorKind: "system_opener_unavailable" }, "/srv/repo", "/etc/hosts")).toBe("/etc/hosts");
      expect(openerFallbackPath(unavailable, "", "notes.md")).toBe("notes.md");
      expect(openerFallbackPath(unavailable, "C:\\repo", "D:\\x.txt")).toBe("D:\\x.txt");
    });

    it("leaves every other failure to the error toast", () => {
      expect(openerFallbackPath({ error: "Failed to open path (exit 1)", errorKind: "launch_failed", errorApp: "system" }, "/repo", "a.ts")).toBeNull();
      expect(openerFallbackPath({ error: "missing", errorKind: "editor_unavailable", errorApp: "zed" }, "/repo", "a.ts")).toBeNull();
      expect(openerFallbackPath({ error: "old server failure" }, "/repo", "a.ts")).toBeNull();
    });

    it("copies the path with the copy toast and reports it handled", async () => {
      const toast = { show: vi.fn(), error: vi.fn() };
      const copy = vi.fn(async () => undefined);
      expect(copyOpenerFallback({ ...unavailable, path: "/srv/repo/a.ts" }, "/srv/repo", "a.ts", toast, copy)).toBe(true);
      expect(copy).toHaveBeenCalledWith("/srv/repo/a.ts");
      await vi.waitFor(() => expect(toast.show).toHaveBeenCalledWith(expect.stringMatching(/path|路径/)));
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("falls back to the opener explanation when the clipboard refuses", async () => {
      const toast = { show: vi.fn(), error: vi.fn() };
      expect(copyOpenerFallback(unavailable, "/srv/repo", "a.ts", toast, async () => { throw new Error("denied"); })).toBe(true);
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("xdg-open")));
      expect(toast.show).not.toHaveBeenCalled();
    });

    it("does nothing for other failures", () => {
      const toast = { show: vi.fn(), error: vi.fn() };
      const copy = vi.fn(async () => undefined);
      expect(copyOpenerFallback({ error: "missing", errorKind: "editor_unavailable", errorApp: "zed" }, "/repo", "a.ts", toast, copy)).toBe(false);
      expect(copy).not.toHaveBeenCalled();
    });
  });

  describe("path presses", () => {
    const original = getEnhancerPreferences();
    afterEach(() => updateEnhancerPreferences({ fileOpenApp: original.fileOpenApp, language: original.language }));

    it("sends the current setting and toasts a localised failure", async () => {
      updateEnhancerPreferences({ fileOpenApp: "zed", language: "zh" });
      const revealPath = vi.fn(async () => ({ revealed: null, error: "missing", errorKind: "editor_unavailable" as const, errorApp: "zed" as const }));
      const toast = { show: vi.fn(), error: vi.fn() };
      revealWithSetting(revealPath, toast, "/repo", "/repo/a.ts");
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Zed 未安装或其命令不在 PATH 中"));
      expect(revealPath).toHaveBeenCalledWith({ cwd: "/repo", path: "/repo/a.ts", expectedApp: "zed" });
    });

    it("stays quiet on success and toasts a rejected call", async () => {
      const toast = { show: vi.fn(), error: vi.fn() };
      revealWithSetting(async () => ({ revealed: "/a", error: null }), toast, "", "/a");
      revealWithSetting(async () => { throw new Error("offline"); }, toast, "", "/a");
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Error: offline"));
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
  });
});
