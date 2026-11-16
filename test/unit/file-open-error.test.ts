import { describe, expect, it } from "vitest";
import { fileOpenError } from "../../client/i18n/file-open-error";

describe("file open errors", () => {
  it("localises known errors while retaining launcher details", () => {
    expect(fileOpenError({ error: "unavailable", errorKind: "settings_unavailable" }, "zh")).toBe("文件打开设置不可用");
    expect(fileOpenError({ error: "missing", errorKind: "editor_unavailable", errorApp: "vscode" }, "zh")).toBe("VS Code 未安装或其命令不在 PATH 中");
    expect(fileOpenError({ error: "exit 1", errorKind: "launch_failed", errorApp: "zed" }, "zh")).toBe("无法打开文件（exit 1）");
    expect(fileOpenError({ error: "missing", errorKind: "editor_unavailable", errorApp: "zed" }, "en")).toBe("missing");
  });

  it("preserves errors from older servers without a structured kind", () => {
    expect(fileOpenError({ error: "old server failure" }, "zh")).toBe("old server failure");
  });
});
