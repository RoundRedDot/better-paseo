/**
 * Claude's task notifications, as Paseo hands them on: a `task_notification`
 * call whose label is the task's summary, whose text is the raw
 * `<task-notification>` envelope when Claude sent one, and whose metadata
 * names the task, the call that started it and its output file.
 *
 * Claude notifies on every task, a foreground command included. That
 * notification only repeats the command's own description beside the row
 * that already shows it finishing, so it is dropped (`isTaskEcho`).
 */
import type { ActivityData, ActivityInput, ActivitySection } from "./activity";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function tag(raw: string, name: string): string | undefined {
  return text(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(raw)?.[1]);
}

/** `Background command "Run tests" completed (exit code 0)`, `Agent "Fix it" failed: API error`. */
const SUMMARY = /^((?:Background )?(?:shell )?(?:command|agent|task|monitor))\s+"([\s\S]+?)"\s+([\s\S]*)$/i;

/** A notification that adds nothing to the row of the call it reports on. */
export function isTaskEcho(detail: Record<string, unknown>, metadata: Record<string, unknown> | undefined): boolean {
  if (text(metadata?.outputFile)) return false;
  const label = text(detail.label) ?? "";
  const body = text(detail.text);
  if (body && body !== label) return false;
  return !SUMMARY.test(label);
}

export function readTaskNotification({ status, detail, metadata }: ActivityInput): ActivityData {
  const raw = typeof detail.text === "string" && detail.text.includes("<task-notification>") ? detail.text : undefined;
  const summary = (raw && tag(raw, "summary")) ?? text(detail.label) ?? "Background task";
  const state = (text(metadata?.status) ?? (raw && tag(raw, "status")) ?? status).toLowerCase();
  const failed = status === "failed" || state === "failed" || state === "error";
  const stopped = !failed && (status === "canceled" || state === "stopped" || state === "killed");

  const parsed = SUMMARY.exec(summary);
  const kind = parsed?.[1] ?? "";
  const subject = parsed?.[2] ?? summary;
  const rest = parsed?.[3] ?? "";
  const exit = /exit code (-?\d+)/.exec(rest)?.[1];
  // What follows "failed:" is the reason; a reason a status line already says is not repeated.
  const reason = /^(?:failed|errored):\s*([\s\S]+)$/.exec(rest)?.[1] ??
    (failed && !/^(?:failed|completed|finished)\b/.test(rest) && rest ? rest : undefined);

  // Without a quoted subject, the summary itself still says what kind of task it was.
  const said = kind || summary;
  const noun = /agent/i.test(said) ? "Subtask" : /command/i.test(said) ? "Command" : "Task";
  const verb = `${noun} ${failed ? "failed" : stopped ? "stopped" : "finished"}`;
  const outputFile = text(metadata?.outputFile) ?? (raw ? tag(raw, "output-file") : undefined);
  const sections: ActivitySection[] = [];
  const result = raw ? tag(raw, "result") : undefined;
  if (result) sections.push({ label: "Result", text: result, format: "markdown" });
  const note = raw ? tag(raw, "note") : undefined;
  if (note) sections.push({ label: "Note", text: note, format: "markdown" });
  if (outputFile) sections.push({ label: "Output", text: outputFile, format: "path" });
  return {
    verb, target: subject, meta: exit !== undefined ? [`exit ${exit}`] : [],
    icon: failed ? "CircleX" : stopped ? "CircleSlash" : "CircleCheck",
    failed: failed || (exit !== undefined && exit !== "0"), success: !failed && !stopped && (exit ?? "0") === "0",
    // The host's error is the whole summary, which the row already reads.
    error: reason ?? null,
    sections,
  };
}
