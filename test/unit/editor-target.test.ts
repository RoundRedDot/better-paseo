import { afterEach, describe, expect, it, vi } from "vitest";
import { editorCommand } from "../../server/editor-target";
import { preferencesSchema } from "../../shared/preferences-settings";

const originalPath = process.env.PATH;
afterEach(() => { process.env.PATH = originalPath; vi.restoreAllMocks(); });

describe("file open preference", () => {
  it("defaults to the system app and preserves a selected editor", () => {
    expect(preferencesSchema.parse({}).fileOpenApp).toBe("system");
    expect(preferencesSchema.parse({ fileOpenApp: "sublime" }).fileOpenApp).toBe("sublime");
  });

  it("reports an editor missing from PATH", () => {
    process.env.PATH = "";
    expect(() => editorCommand("zed", "linux")).toThrow("Zed is not installed");
  });
});
