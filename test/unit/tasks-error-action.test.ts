import { describe, expect, it } from "vitest";
import { errorAction } from "../../client/tasks/cards/error-action";
import { formatCardError } from "../../client/tasks/cards/format";

describe("Claude card error summaries", () => {
  it.each([
    ["You've hit your monthly spend limit · your 5-hour limit resets 5:30pm (Asia/Singapore)", "Claude 月度支出已达上限 · 5 小时额度重置时间：5:30pm (Asia/Singapore)", "Claude monthly spending limit reached · 5-hour limit resets 5:30pm (Asia/Singapore)"],
    ["You've hit your session limit · resets 5:30pm", "Claude 用量已达上限 · 额度重置时间：5:30pm", "Claude usage limit reached · Resets 5:30pm"],
    ["You've hit your weekly limit", "Claude 每周用量已达上限", "Claude weekly usage limit reached"],
    ["project_spend_limit_exceeded", "Claude 支出已达上限", "Claude spending limit reached"],
    ["org's monthly usage limit", "Claude 组织月度用量已达上限", "Claude organization monthly usage limit reached"],
    ["credit balance is too low", "Claude 账户余额不足", "Claude account balance is too low"],
    ["insufficient_quota", "Claude 账户额度不足", "Claude account quota is insufficient"],
    ["rate_limit_error", "Claude 请求过于频繁", "Claude request rate limit reached"],
    ["Prompt is too long", "Claude 上下文过长", "Claude context is too long"],
    ["authentication_error", "Claude 登录或 API 凭据有问题", "Claude sign-in or API credentials need attention"],
    ["API Error: 403 Forbidden", "Claude 访问权限不足", "Claude access denied"],
    ["model_not_found", "请求的模型或资源不可用", "Requested model or resource is unavailable"],
    ["invalid_request_error", "Claude 请求参数无效", "Claude request is invalid"],
    ["sandbox_error", "运行环境出错", "Execution environment error"],
    ["mcp_server_startup_failed", "MCP 服务启动失败", "MCP server failed to start"],
    ["Connection closed before response completed", "连接失败或超时", "Connection failed or timed out"],
    ["API Error: 529 Overloaded", "Claude 服务暂不可用", "Claude service is unavailable"],
  ])("summarizes %s in both languages", (error, zh, en) => {
    expect(formatCardError(error, "claude", "zh")).toBe(zh);
    expect(formatCardError(error, "claude", "en")).toBe(en);
  });

  it("preserves unknown Claude errors", () => {
    expect(formatCardError("Unexpected failure", "claude", "zh")).toBe("Unexpected failure");
  });

  it.each([
    "Claude AI usage limit reached|1792660800",
    "You've hit your session limit. Try again at 5:30pm (Asia/Singapore)",
  ])("preserves unparsed Claude reset details: %s", (error) => {
    expect(formatCardError(error, "claude", "zh")).toBe(error);
    expect(formatCardError(error, "claude", "en")).toBe(error);
  });
});

describe("other provider card error summaries", () => {
  it.each([
    ["codex", "You've hit your usage limit.", "账户用量已达上限", "Account usage limit reached"],
    ["codex", "credit_balance_exhausted", "账户余额不足", "Account balance is too low"],
    ["codex", "context_length_exceeded", "上下文过长", "Context is too long"],
    ["cursor", "Please authenticate to continue. Run `/login` to log in.", "登录或 API 凭据有问题", "Sign-in or API credentials need attention"],
    ["cursor", "invalid_request_error", "请求参数无效", "Request is invalid"],
    ["grok", "Provider exited with code 1: rate limit reached", "请求过于频繁", "Request rate limit reached"],
    ["grok", "HTTP 503", "服务暂不可用", "Service is unavailable"],
    ["omp", "insufficient_quota", "账户额度不足", "Account quota is insufficient"],
    ["omp", "mcp_server_startup_failed", "MCP 服务启动失败", "MCP server failed to start"],
    ["pi", "model_not_found", "请求的模型或资源不可用", "Requested model or resource is unavailable"],
    ["pi", "Connection closed before response completed", "连接失败或超时", "Connection failed or timed out"],
    ["copilot", "authentication_error", "登录或 API 凭据有问题", "Sign-in or API credentials need attention"],
    ["gemini", "rate_limit_error", "请求过于频繁", "Request rate limit reached"],
    ["antigravity", "context_length_exceeded", "上下文过长", "Context is too long"],
    ["opencode", "insufficient_quota", "账户额度不足", "Account quota is insufficient"],
    ["custom-provider", "model_not_found", "请求的模型或资源不可用", "Requested model or resource is unavailable"],
  ])("summarizes %s: %s in both languages", (provider, error, zh, en) => {
    expect(formatCardError(error, provider, "zh")).toBe(zh);
    expect(formatCardError(error, provider, "en")).toBe(en);
    expect(errorAction(error, "zh")).toBeTruthy();
    expect(errorAction(error, "en")).toBeTruthy();
  });

  it.each(["codex", "cursor", "grok", "omp", "pi", "copilot", "gemini", "antigravity", "opencode", "custom-provider"])("keeps unknown, ambiguous, and reset details for %s", (provider) => {
    for (const error of ["Unexpected failure", "HTTP 429", "You've hit your usage limit. Try again at 5:30pm (Asia/Singapore)", "rate_limit_error; retry after 30 seconds"]) {
      expect(formatCardError(error, provider, "zh")).toBe(error);
    }
  });
});

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
