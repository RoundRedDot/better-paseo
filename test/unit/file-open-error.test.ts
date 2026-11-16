import { describe, expect, it } from "vitest";
import { fileOpenError } from "../../client/i18n/file-open-error";

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

  it("preserves errors from older servers without a structured kind", () => {
    expect(fileOpenError({ error: "old server failure" }, "zh")).toBe("old server failure");
  });
});
