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
