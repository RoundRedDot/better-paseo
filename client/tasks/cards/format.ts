import type { TasksLanguage } from "../i18n";

/**
 * The card's times and numbers. Pure, so the settings preview, the details
 * sheet and the tests share them; the language is an argument.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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

/** An estimate, the last turn's length: "约 8m" / "~8m"; never under a minute. */
export function formatApprox(ms: number, language: TasksLanguage): string {
  const minutes = Math.max(1, Math.round(Math.max(0, ms) / MINUTE));
  const body = minutes < 60 ? `${minutes}m` : minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`;
  return language === "zh" ? `约 ${body}` : `~${body}`;
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
