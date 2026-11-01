import { describe, expect, it } from "vitest";
import { errorAction } from "../../client/tasks/cards/error-action";

describe("error actions", () => {
  it.each([
    ["claude", "You've hit your monthly spend limit · your 5-hour limit resets 5:30pm", "支出上限"],
    ["claude", "You've hit your session limit · resets 5:30pm", "重置"],
    ["claude", "Prompt is too long", "缩短输入"],
    ["claude", "API Error: 529 Overloaded", "服务暂不可用"],
    ["codex", "credit_balance_exhausted", "余额"],
    ["codex", "organization_usage_limit_exceeded", "账户用量"],
    ["chatgpt", "subscription_sharing_usage_limit_exceeded", "账户用量"],
    ["codex", "context_length_exceeded", "缩短输入"],
    ["cursor", "Please authenticate to continue. Run `/login` to log in.", "登录状态"],
    ["cursor", "Connection closed before response completed", "网络和代理"],
    ["grok", "Provider exited with code 1: rate limit reached", "降低请求频率"],
    ["grok", "Provider exited with code 1", "运行日志"],
    ["claude", "API Error: 403 Forbidden", "权限"],
    ["codex", "sandbox_error", "运行环境"],
    ["codex", "model_not_found", "模型名称"],
    ["cursor", "invalid_request_error", "输入和配置"],
    ["grok", "HTTP 429", "限速和用量"],
    ["grok", "HTTP 503", "服务暂不可用"],
  ])("gives %s error %s an actionable hint", (_provider, message, expected) => {
    expect(errorAction(message, "zh")).toContain(expected);
    expect(errorAction(message, "en")).toBeTruthy();
  });

  it("does not turn an unknown error or a bare status number into a diagnosis", () => {
    expect(errorAction("Something unexpected happened", "zh")).toBeNull();
    expect(errorAction("Process 429 exited", "en")).toBeNull();
  });
});
