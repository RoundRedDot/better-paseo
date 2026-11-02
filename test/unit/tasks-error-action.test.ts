import { describe, expect, it } from "vitest";
import { errorAction } from "../../client/tasks/cards/error-action";
import { cardErrorReset, formatCardError } from "../../client/tasks/cards/format";

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

  // Until 235250eb's successor these were kept verbatim; an instant now becomes the card's reset time.
  it("turns Claude's \"try again at\" into the reset time", () => {
    const error = "You've hit your session limit. Try again at 5:30pm (Asia/Singapore)";
    expect(formatCardError(error, "claude", "zh")).toBe("Claude 用量已达上限 · 额度重置时间：5:30pm (Asia/Singapore)");
    expect(formatCardError(error, "claude", "en")).toBe("Claude usage limit reached · Resets 5:30pm (Asia/Singapore)");
  });

  it("shows Claude's epoch reset as a local clock time", () => {
    const tz = process.env.TZ;
    process.env.TZ = "Asia/Shanghai";
    try {
      // 1792660800 is 2026-10-22T09:20:00Z, 17:20 in Shanghai.
      const error = "Claude AI usage limit reached|1792660800";
      const sameDay = Date.parse("2026-10-22T02:00:00Z");
      const dayBefore = Date.parse("2026-10-21T02:00:00Z");
      expect(formatCardError(error, "claude", "zh", sameDay)).toBe("Claude 用量已达上限 · 额度重置时间：17:20");
      expect(formatCardError(error, "claude", "en", sameDay)).toBe("Claude usage limit reached · Resets 17:20");
      expect(formatCardError(error, "claude", "zh", dayBefore)).toBe("Claude 用量已达上限 · 额度重置时间：10/22 17:20");
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it.each([
    "You've hit your session limit. Try again in 5 minutes.",
    "You've hit your session limit · resets in 2 hours",
    "Claude AI usage limit reached|soon",
  ])("keeps a Claude reset it cannot place in time: %s", (error) => {
    expect(formatCardError(error, "claude", "zh")).toBe(error);
    expect(formatCardError(error, "claude", "en")).toBe(error);
  });
});

describe("card error reset times", () => {
  it.each([
    ["You've hit your monthly spend limit · your 5-hour limit resets 5:30pm (Asia/Singapore)", { fiveHour: true, time: "5:30pm (Asia/Singapore)" }],
    ["You've hit your session limit · resets 5:30pm", { fiveHour: false, time: "5:30pm" }],
    ["You've hit your weekly limit · resets Nov 5, 9am", { fiveHour: false, time: "Nov 5, 9am" }],
    ["You've hit your usage limit. Upgrade to Pro or try again at 3:04 PM.", { fiveHour: false, time: "3:04 PM" }],
    ["Usage limit reached. Your limit resets at 9:00 AM. Upgrade for more.", { fiveHour: false, time: "9:00 AM" }],
  ])("finds the instant in %s", (error, reset) => {
    expect(cardErrorReset(error, 0)).toEqual(reset);
  });

  it.each([
    "You've hit your usage limit. Try again in 5 minutes.",
    "rate_limit_error; retry after 30 seconds",
    "Your limit resets in 2 hours",
    "Your limit resets 30 seconds",
    "You've hit your usage limit. Please try again at a later time.",
    "Unexpected failure",
  ])("finds no instant in %s", (error) => {
    expect(cardErrorReset(error, 0)).toBeNull();
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

  it.each(["codex", "cursor", "grok", "omp", "pi", "copilot", "gemini", "antigravity", "opencode", "custom-provider"])("keeps unknown, ambiguous, and duration details for %s", (provider) => {
    for (const error of ["Unexpected failure", "HTTP 429", "You've hit your usage limit. Try again in 5 minutes.", "rate_limit_error; retry after 30 seconds"]) {
      expect(formatCardError(error, provider, "zh")).toBe(error);
    }
  });

  // These kept the provider's English until the card could place the time; an instant is now the reset time.
  it.each(["codex", "cursor", "grok", "custom-provider"])("shows a %s limit's reset time in the card's language", (provider) => {
    const error = "You've hit your usage limit. Try again at 5:30pm (Asia/Singapore)";
    expect(formatCardError(error, provider, "zh")).toBe("账户用量已达上限 · 额度重置时间：5:30pm (Asia/Singapore)");
    expect(formatCardError(error, provider, "en")).toBe("Account usage limit reached · Resets 5:30pm (Asia/Singapore)");
    expect(formatCardError("insufficient_quota · resets 9am", provider, "zh")).toBe("账户额度不足 · 额度重置时间：9am");
  });

  it("keeps a provider error whose summary is not a limit when it names a time", () => {
    for (const error of ["rate_limit_error; try again at 5:30pm", "credit_balance_exhausted · resets 9am"]) {
      expect(formatCardError(error, "codex", "zh")).toBe(error);
    }
  });
});

describe("error actions", () => {
  it.each([
    ["claude", "You've hit your monthly spend limit · your 5-hour limit resets 5:30pm", "支出上限"],
    ["claude", "You've hit your session limit · resets 5:30pm", "额度恢复"],
    ["claude", "Prompt is too long", "缩短输入"],
    ["claude", "API Error: 529 Overloaded", "稍后继续"],
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
    ["grok", "HTTP 503", "稍后继续"],
  ])("gives %s error %s an actionable hint", (_provider, message, expected) => {
    expect(errorAction(message, "zh")).toContain(expected);
    expect(errorAction(message, "en")).toBeTruthy();
  });

  it("waits for the reset the card shows, and asks to check usage without one", () => {
    for (const error of ["You've hit your session limit · resets 5:30pm", "Claude AI usage limit reached|1792660800", "You've hit your usage limit."]) {
      expect(errorAction(error, "zh", true)).toBe("额度重置后继续未完成的工作。");
      expect(errorAction(error, "en", true)).toBe("Continue the unfinished work after the limit resets.");
      expect(errorAction(error, "zh")).toBe("检查账户用量，额度恢复后继续。");
      expect(errorAction(error, "en")).toBe("Check account usage and continue once the limit is restored.");
    }
  });

  it("does not repeat the reason in the overload step", () => {
    expect(errorAction("API Error: 529 Overloaded", "zh")).toBe("检查已完成的操作，稍后继续。");
    expect(errorAction("HTTP 503", "en")).toBe("Review completed actions and continue later.");
    // The spending limit keeps its own step whether or not a reset is shown.
    expect(errorAction("You've hit your monthly spend limit · your 5-hour limit resets 5:30pm", "zh", true)).toContain("支出上限");
  });

  it("does not turn an unknown error or a bare status number into a diagnosis", () => {
    expect(errorAction("Something unexpected happened", "zh")).toBeNull();
    expect(errorAction("Process 429 exited", "en")).toBeNull();
  });
});
