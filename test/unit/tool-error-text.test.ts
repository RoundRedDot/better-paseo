import { describe, expect, it } from "vitest";
import { toolErrorText } from "../../client/tools/error-text";

describe("toolErrorText", () => {
  it("is null when there is no error", () => {
    expect(toolErrorText(null)).toBeNull();
    expect(toolErrorText(undefined)).toBeNull();
    expect(toolErrorText("")).toBeNull();
  });

  it("keeps a string as it is", () => {
    expect(toolErrorText("Command exited with code 1")).toBe("Command exited with code 1");
  });

  it("reads the message of an Error-like object instead of [object Object]", () => {
    expect(toolErrorText({ message: "Command exited with code 1" })).toBe(
      "Command exited with code 1",
    );
    expect(toolErrorText(new Error("boom"))).toBe("boom");
  });

  it("reads the output of a tool_result block", () => {
    expect(toolErrorText({
      type: "tool_result",
      content: "Exit code 2\nerror: not found",
      is_error: true,
      tool_use_id: "toolu_1",
    })).toBe("Exit code 2\nerror: not found");
    expect(toolErrorText({
      type: "tool_result",
      content: [{ type: "text", text: "Exit code 1" }, { type: "text", text: "boom" }],
      is_error: true,
    })).toBe("Exit code 1\nboom");
  });

  it("serialises any other object", () => {
    expect(toolErrorText({ code: 2, reason: "denied" })).toBe('{"code":2,"reason":"denied"}');
  });

  it("never yields [object Object] for an object it cannot serialise", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(toolErrorText(cyclic)).toBe("Tool call failed");
    expect(toolErrorText({})).toBe("Tool call failed");
  });
});
