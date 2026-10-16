/**
 * The one timestamp format of the timeline (S7 design spec §3.5, §3.8):
 * `HH:mm` today, `Sep 16, 06:47` on any other day, `Sep 16 2025, 06:47` in
 * another year. Twenty-four-hour digits, so every time in a turn has the same
 * width and lines up in its column.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Local timestamp to the minute; omit today's date and the current year. */
export function formatFooterStamp(date: Date, now: Date = new Date()): string {
  const sameDay = date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const stamp = formatFullStamp(date).slice(0, -3);
  if (sameDay) return stamp.slice(11);
  return date.getFullYear() === now.getFullYear() ? stamp.slice(5) : stamp;
}

/** Complete local timestamp for hover hints, including the full date and seconds. */
export function formatFullStamp(date: Date): string {
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
}

/** Compact footer text by default; spaced, localized units for hover hints. */
export function formatDuration(durationMs: number, style: "compact" | "zh" | "en" = "compact"): string {
  const seconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const rest = seconds % 60;
  const units = style === "en" ? ["h", "min", "s"] : ["小时", "分", "秒"];
  const gap = style === "compact" ? "" : " ";
  return [hours > 0 ? `${hours}${gap}${units[0]}` : null,
    hours > 0 || minutes > 0 ? `${minutes}${gap}${units[1]}` : null,
    `${rest}${gap}${units[2]}`].filter((part) => part !== null).join(gap);
}

export function formatStamp(date: Date, now: Date = new Date()): string {
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return clock;
  const day = `${MONTHS[date.getMonth()] ?? ""} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear()
    ? `${day}, ${clock}`
    : `${day} ${date.getFullYear()}, ${clock}`;
}
