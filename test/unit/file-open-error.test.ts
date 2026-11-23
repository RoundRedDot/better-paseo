import { afterEach, describe, expect, it, vi } from "vitest";
import { fileOpenError, revealWithSetting } from "../../client/i18n/file-open-error";
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

  describe("path presses", () => {
    const original = getEnhancerPreferences();
    afterEach(() => updateEnhancerPreferences({ fileOpenApp: original.fileOpenApp, language: original.language }));

    it("sends the current setting and toasts a localised failure", async () => {
      updateEnhancerPreferences({ fileOpenApp: "zed", language: "zh" });
      const revealPath = vi.fn(async () => ({ revealed: null, error: "missing", errorKind: "editor_unavailable" as const, errorApp: "zed" as const }));
      const toast = { error: vi.fn() };
      revealWithSetting(revealPath, toast, "/repo", "/repo/a.ts");
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Zed 未安装或其命令不在 PATH 中"));
      expect(revealPath).toHaveBeenCalledWith({ cwd: "/repo", path: "/repo/a.ts", expectedApp: "zed" });
    });

    it("stays quiet on success and toasts a rejected call", async () => {
      const toast = { error: vi.fn() };
      revealWithSetting(async () => ({ revealed: "/a", error: null }), toast, "", "/a");
      revealWithSetting(async () => { throw new Error("offline"); }, toast, "", "/a");
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Error: offline"));
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
  });
});
