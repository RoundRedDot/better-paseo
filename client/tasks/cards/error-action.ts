import type { TasksLanguage } from "../i18n";

/** Only classify explicit provider errors; an ambiguous status code is not a diagnosis. */
export function errorAction(error: string, language: TasksLanguage): string | null {
  const zh = language === "zh";
  if (/credit_balance_exhausted|credit balance is too low|insufficient_quota/i.test(error)) {
    return zh ? "检查服务商的余额和用量限制，再继续未完成的工作。" : "Check the provider's balance and usage limits, then continue the unfinished work.";
  }
  if (/project_spend_limit_exceeded|organization_spend_limit_exceeded|monthly spend limit|org.s monthly usage limit/i.test(error)) {
    return zh ? "检查账户或组织的支出上限，调整后继续未完成的工作。" : "Check the account or organization spending limit before continuing the unfinished work.";
  }
  if (/subscription_sharing_usage_limit_exceeded|usage_limit_exceeded|you've hit your [^\n]*limit|you're out of extra usage|claude ai usage limit reached|individual quota reached/i.test(error)) {
    return zh ? "检查账户用量；如有重置时间，等待重置后继续。" : "Check account usage and continue after the limit resets, if a reset is shown.";
  }
  if (/rate_limit_exceeded|rate_limit_error|rate limit (?:reached|exceeded)|too many requests/i.test(error)) {
    return zh ? "降低请求频率，稍后继续未完成的工作。" : "Reduce request frequency and continue the unfinished work after a delay.";
  }
  if (/\b(?:http|status|api error:)\s*429\b/i.test(error)) {
    return zh ? "检查服务商的限速和用量详情，按原始错误提示处理。" : "Check the provider's rate and usage limits and follow the original error.";
  }
  if (/context_length_exceeded|context window (?:is )?(?:full|exceeded)|prompt is too long|maximum context length/i.test(error)) {
    return zh ? "缩短输入或整理上下文，再开启新会话继续。" : "Shorten the input or summarize the context, then continue in a new session.";
  }
  if (/invalid api key|authentication_error|authentication failed|unauthorized|please authenticate|token_expired|invalid_refresh_token|\b(?:http|status|api error:)\s*401\b/i.test(error)) {
    return zh ? "检查登录状态或 API 凭据，修正后重试。" : "Check your sign-in or API credentials, correct them, and retry.";
  }
  if (/permission_error|permission denied|forbidden|access denied|\b(?:http|status|api error:)\s*403\b/i.test(error)) {
    return zh ? "检查错误详情中的权限和资源访问设置，再重试。" : "Check the permissions and resource access in the error details, then retry.";
  }
  if (/model_not_found|resource_not_found|model (?:is )?(?:not found|unavailable)/i.test(error)) {
    return zh ? "检查模型名称和账户访问权限，必要时更换模型。" : "Check the model name and account access; select another model if needed.";
  }
  if (/invalid_request_error|invalid_request\b|bad request/i.test(error)) {
    return zh ? "检查错误详情中的输入和配置，修正后重试。" : "Check the input and configuration in the error details, correct them, and retry.";
  }
  if (/sandbox_error|mcp_server_startup_failed/i.test(error)) {
    return zh ? "检查运行环境及相关服务的配置和日志，修正后重试。" : "Check the environment and related service configuration and logs, then retry.";
  }
  if (/request_timeout|api.?timeout|timed? ?out|connection_failed|connection (?:closed|failed|refused|reset)|network error|econnreset|econnrefused|enotfound/i.test(error)) {
    return zh ? "检查网络和代理，确认已完成的操作后继续。" : "Check the network and proxy, then continue after reviewing completed actions.";
  }
  if (/overloaded_error|server_overloaded|server_is_overloaded|(?:api error:|http|status)\s*(?:500|502|503|504|529)\b/i.test(error)) {
    return zh ? "服务暂不可用；检查已完成的操作，稍后继续。" : "The service is unavailable; review completed actions and continue later.";
  }
  if (/provider exited|process exited|process terminated/i.test(error)) {
    return zh ? "查看错误详情和运行日志，处理退出原因后继续。" : "Check the error details and runtime logs, resolve the exit cause, and continue.";
  }
  return null;
}
