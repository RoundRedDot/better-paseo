import type { TasksLanguage } from "../i18n";

/**
 * The card's times, numbers and display labels. Pure, so the settings preview, the details
 * sheet and the tests share them; the language is an argument.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const THINKING_LABELS = new Map([
  ["none", "n"], ["minimal", "min"], ["low", "l"], ["medium", "m"],
  ["high", "h"], ["xhigh", "xh"], ["extra high", "xh"], ["max", "max"],
]);

/** Visible effort labels only; hints and accessibility keep the provider's full name. */
export function formatThinkingLevel(label: string): string {
  return THINKING_LABELS.get(label.trim().toLowerCase()) ?? label;
}

/** A running turn: "45s", "12m 30s", "1h 5m". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / SECOND));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

/** Whole minutes, coarser than a running turn: "30s", "4m", "1h 5m". */
function coarse(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < MINUTE) return `${Math.floor(safe / SECOND)}s`;
  const minutes = Math.floor(safe / MINUTE);
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return rest > 0 ? `${Math.floor(minutes / 60)}h ${rest}m` : `${Math.floor(minutes / 60)}h`;
}

/** How long a request has waited: "等待 4m" / "Waiting 4m". */
export function formatWait(ms: number, language: TasksLanguage): string {
  return language === "zh" ? `等待 ${coarse(ms)}` : `Waiting ${coarse(ms)}`;
}

/** The last turn's rounded length: "8m" / "~8m"; never under a minute. */
export function formatApprox(ms: number, language: TasksLanguage): string {
  const minutes = Math.max(1, Math.round(Math.max(0, ms) / MINUTE));
  const body = minutes < 60 ? `${minutes}m` : minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`;
  return language === "zh" ? body : `~${body}`;
}

/** How long ago: "刚刚" / "just now", "5 分钟前" / "5m ago", "3 小时前" / "3h ago", "2 天前" / "2d ago". */
export function formatRelative(ms: number, language: TasksLanguage): string {
  const safe = Math.max(0, ms);
  const zh = language === "zh";
  if (safe < MINUTE) return zh ? "刚刚" : "just now";
  if (safe < HOUR) return zh ? `${Math.floor(safe / MINUTE)} 分钟前` : `${Math.floor(safe / MINUTE)}m ago`;
  if (safe < DAY) return zh ? `${Math.floor(safe / HOUR)} 小时前` : `${Math.floor(safe / HOUR)}h ago`;
  return zh ? `${Math.floor(safe / DAY)} 天前` : `${Math.floor(safe / DAY)}d ago`;
}

/** A turn's start in local time: "14:32" on the day of `now`, "10/20 14:32" on another day. */
export function formatClockTime(at: number, now: number): string {
  const date = new Date(at);
  const today = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay =
    date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return sameDay ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

/** Milliseconds since an ISO time; null when absent or unparseable. */
export function since(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : now - at;
}

/** Token counts: "950", "182k", "1.25M". */
export function formatTokens(count: number): string {
  if (count >= 1e6) return `${(count / 1e6).toFixed(2)}M`;
  if (count >= 1e3) return `${Math.round(count / 1e3)}k`;
  return String(Math.round(count));
}

/** A large count in three figures at most, for a narrow cell: 812k, 15.3M, 354M, 1.23B. */
export function formatTokenTotal(count: number): string {
  for (const [unit, size] of [["B", 1e9], ["M", 1e6], ["k", 1e3]] as const) {
    if (count >= size * 0.9995) {
      const scaled = count / size;
      return `${scaled >= 99.95 ? Math.round(scaled) : scaled >= 9.995 ? scaled.toFixed(1) : scaled.toFixed(2)}${unit}`;
    }
  }
  return String(Math.round(count));
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export type ContextTone = "normal" | "warning" | "danger";

/** The context bar's colour: warning above 80%, danger above 90%. */
export function contextTone(ratio: number): ContextTone {
  if (ratio > 0.9) return "danger";
  if (ratio > 0.8) return "warning";
  return "normal";
}

export function contextRatio(context: { usedTokens: number; maxTokens: number } | null): number | null {
  if (!context || !(context.maxTokens > 0)) return null;
  return Math.min(1, Math.max(0, context.usedTokens / context.maxTokens));
}

/**
 * A path with the home directory as "~": /Users/<name>/..., /home/<name>/...
 * and C:\Users\<name>\... Other paths come back unchanged.
 */
export function tildePath(path: string): string {
  const home = /^\/(?:Users|home)\/[^/]+(?=\/|$)/.exec(path) ?? /^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/i.exec(path);
  return home ? `~${path.slice(home[0].length)}` : path;
}

/** When a limit lifts, as the error states it. */
export interface CardErrorReset {
  /** Claude's "your 5-hour limit resets …", as opposed to the limit itself resetting. */
  fiveHour: boolean;
  /** The provider's own wording ("5:30pm (Asia/Singapore)"), or a local clock time for an epoch. */
  time: string;
}

/** The provider's time, up to the end of its sentence or its `·` segment, without the full stop. */
const RESET_TIME = String.raw`([^\n\u00b7]+?)(?:\.(?:\s|$)|\s*(?:\u00b7|\n|$))`;
const FIVE_HOUR_RESET = new RegExp(String.raw`your 5-hour limit resets (?:at )?` + RESET_TIME, "i");
const RESET_AT = new RegExp(String.raw`\b(?:resets|try again at) (?:at )?` + RESET_TIME, "i");
const DURATION = /^(?:in|after)\b|^\d+(?:\.\d+)?\s*(?:s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)$/i;

/**
 * The instant a limit resets: "resets X", "try again at X", or Claude's
 * "usage limit reached|<epoch seconds>". A duration ("resets in 5 minutes",
 * "retry after 30 seconds") is not an instant and gives null, so the card
 * keeps the provider's own words for it.
 */
export function cardErrorReset(error: string, now: number): CardErrorReset | null {
  const epoch = /claude ai usage limit reached\|(\d{9,13})\b/i.exec(error);
  if (epoch) {
    const value = Number(epoch[1]);
    return { fiveHour: false, time: formatClockTime(value < 1e12 ? value * 1000 : value, now) };
  }
  const fiveHour = FIVE_HOUR_RESET.exec(error);
  const time = (fiveHour ?? RESET_AT.exec(error))?.[1]?.trim();
  // A time of day or a date has a digit; "try again at a later time" is neither.
  if (!time || !/\d/.test(time) || DURATION.test(time)) return null;
  return { fiveHour: !!fiveHour, time };
}

function resetSuffix(reset: CardErrorReset | null, language: TasksLanguage): string {
  if (!reset) return "";
  return language === "zh"
    ? ` · ${reset.fiveHour ? "5 小时额度" : "额度"}重置时间：${reset.time}`
    : ` · ${reset.fiveHour ? "5-hour limit resets" : "Resets"} ${reset.time}`;
}

/** Reset or retry wording that `cardErrorReset` could not turn into an instant. */
const UNPARSED_RESET = /\b(?:resets?|retry after|try again (?:at|in))\b|usage limit reached\|/i;

/** Summarize recognized errors on the card; the details retain the full error. */
export function formatCardError(error: string, provider: string, language: TasksLanguage, now: number = Date.now()): string {
  const quota = /^Individual quota reached\. Please upgrade your subscription to increase your limits\. Resets in ([\dhms]+)\.$/i.exec(error.trim());
  if (provider === "antigravity" && quota) {
    return language === "zh" ? `个人额度已用完 · 报错时距重置 ${quota[1]}` : `Individual quota reached · Resets in ${quota[1]} at time of error`;
  }
  const match = /^(You've hit your [^\n\u00b7]*limit) \u00b7 raise it at https:\/\/claude\.ai\/settings\/usage\?\S+(?: \u00b7 (.+))?$/.exec(error);
  const original = match ? match[2] ? `${match[1]} \u00b7 ${match[2]}` : match[1]! : error;
  const reset = cardErrorReset(original, now);
  if (provider !== "claude") return formatProviderError(original, language, reset);

  const zh = language === "zh";
  if (!reset && UNPARSED_RESET.test(original)) return original;
  const suffix = resetSuffix(reset, language);
  if (/monthly spend limit/i.test(error)) return (zh ? "Claude 月度支出已达上限" : "Claude monthly spending limit reached") + suffix;
  if (/org.s monthly usage limit/i.test(error)) return (zh ? "Claude 组织月度用量已达上限" : "Claude organization monthly usage limit reached") + suffix;
  if (/project_spend_limit_exceeded|organization_spend_limit_exceeded/i.test(error)) return (zh ? "Claude 支出已达上限" : "Claude spending limit reached") + suffix;
  if (/you've hit your weekly limit/i.test(error)) return (zh ? "Claude 每周用量已达上限" : "Claude weekly usage limit reached") + suffix;
  if (/you've hit your session limit|claude ai usage limit reached|usage_limit_exceeded|you've hit your 5-hour limit|you're out of extra usage/i.test(error)) return (zh ? "Claude 用量已达上限" : "Claude usage limit reached") + suffix;
  if (/credit balance is too low|credit_balance_exhausted/i.test(error)) return zh ? "Claude 账户余额不足" : "Claude account balance is too low";
  if (/insufficient_quota/i.test(error)) return zh ? "Claude 账户额度不足" : "Claude account quota is insufficient";
  if (/rate_limit_exceeded|rate_limit_error|rate limit (?:reached|exceeded)|too many requests/i.test(error)) return zh ? "Claude 请求过于频繁" : "Claude request rate limit reached";
  if (/context_length_exceeded|context window (?:is )?(?:full|exceeded)|prompt is too long|maximum context length/i.test(error)) return zh ? "Claude 上下文过长" : "Claude context is too long";
  if (/invalid api key|authentication_error|authentication failed|unauthorized|please authenticate|token_expired|invalid_refresh_token|\b(?:http|status|api error:)\s*401\b/i.test(error)) return zh ? "Claude 登录或 API 凭据有问题" : "Claude sign-in or API credentials need attention";
  if (/permission_error|permission denied|forbidden|access denied|\b(?:http|status|api error:)\s*403\b/i.test(error)) return zh ? "Claude 访问权限不足" : "Claude access denied";
  if (/model_not_found|resource_not_found|model (?:is )?(?:not found|unavailable)/i.test(error)) return zh ? "请求的模型或资源不可用" : "Requested model or resource is unavailable";
  if (/invalid_request_error|invalid_request\b|bad request/i.test(error)) return zh ? "Claude 请求参数无效" : "Claude request is invalid";
  if (/sandbox_error/i.test(error)) return zh ? "运行环境出错" : "Execution environment error";
  if (/mcp_server_startup_failed/i.test(error)) return zh ? "MCP 服务启动失败" : "MCP server failed to start";
  if (/request_timeout|api.?timeout|timed? ?out|connection_failed|connection (?:closed|failed|refused|reset)|network error|econnreset|econnrefused|enotfound/i.test(error)) return zh ? "连接失败或超时" : "Connection failed or timed out";
  if (/overloaded_error|server_overloaded|server_is_overloaded|(?:api error:|http|status)\s*(?:500|502|503|504|529)\b/i.test(error)) return zh ? "Claude 服务暂不可用" : "Claude service is unavailable";
  return original;
}

function formatProviderError(error: string, language: TasksLanguage, reset: CardErrorReset | null): string {
  // A duration or an unrecognized reset keeps the provider's own words; an instant becomes the card's reset time.
  if (!reset && UNPARSED_RESET.test(error)) return error;
  const zh = language === "zh";
  const suffix = resetSuffix(reset, language);
  if (/credit_balance_exhausted|credit balance is too low/i.test(error)) return reset ? error : zh ? "账户余额不足" : "Account balance is too low";
  if (/insufficient_quota|individual quota reached/i.test(error)) return (zh ? "账户额度不足" : "Account quota is insufficient") + suffix;
  if (/project_spend_limit_exceeded|organization_spend_limit_exceeded|monthly spend limit|org.s monthly usage limit/i.test(error)) return (zh ? "账户或组织用量已达上限" : "Account or organization limit reached") + suffix;
  if (/subscription_sharing_usage_limit_exceeded|usage_limit_exceeded|you've hit your [^\n]*limit|you're out of extra usage/i.test(error)) return (zh ? "账户用量已达上限" : "Account usage limit reached") + suffix;
  // Past here no summary is a limit that resets: a time beside it would be read as one.
  if (reset) return error;
  if (/rate_limit_exceeded|rate_limit_error|rate limit (?:reached|exceeded)|too many requests/i.test(error)) return zh ? "请求过于频繁" : "Request rate limit reached";
  if (/context_length_exceeded|context window (?:is )?(?:full|exceeded)|prompt is too long|maximum context length/i.test(error)) return zh ? "上下文过长" : "Context is too long";
  if (/invalid api key|authentication_error|authentication failed|unauthorized|please authenticate|token_expired|invalid_refresh_token|\b(?:http|status|api error:)\s*401\b/i.test(error)) return zh ? "登录或 API 凭据有问题" : "Sign-in or API credentials need attention";
  if (/permission_error|permission denied|forbidden|access denied|\b(?:http|status|api error:)\s*403\b/i.test(error)) return zh ? "访问权限不足" : "Access denied";
  if (/model_not_found|resource_not_found|model (?:is )?(?:not found|unavailable)/i.test(error)) return zh ? "请求的模型或资源不可用" : "Requested model or resource is unavailable";
  if (/invalid_request_error|invalid_request\b|bad request/i.test(error)) return zh ? "请求参数无效" : "Request is invalid";
  if (/sandbox_error/i.test(error)) return zh ? "运行环境出错" : "Execution environment error";
  if (/mcp_server_startup_failed/i.test(error)) return zh ? "MCP 服务启动失败" : "MCP server failed to start";
  if (/request_timeout|api.?timeout|timed? ?out|connection_failed|connection (?:closed|failed|refused|reset)|network error|econnreset|econnrefused|enotfound/i.test(error)) return zh ? "连接失败或超时" : "Connection failed or timed out";
  if (/overloaded_error|server_overloaded|server_is_overloaded|(?:api error:|http|status)\s*(?:500|502|503|504|529)\b/i.test(error)) return zh ? "服务暂不可用" : "Service is unavailable";
  return error;
}
