/**
 * The text of a tool call's error, as the transformer stores it.
 *
 * The protocol types `error` as `unknown`. Providers send a string, an
 * `Error`-like `{ message }`, or some other object; `String()` on the latter
 * two gives `"[object Object]"`, which then reads as the failure itself.
 */
export function toolErrorText(error: unknown): string | null {
  if (error === null || error === undefined || error === false || error === "") return null;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      // A cycle: fall through to the generic text.
    }
    return "Tool call failed";
  }
  return String(error);
}
