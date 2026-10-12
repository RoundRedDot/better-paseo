/**
 * An exit code as a row draws it: `✓` for success, `✗ 2` for a failure. The
 * words (`exit 0`) stay in summaries, accessibility labels and copies; only
 * the drawn text turns into a mark.
 */
export function exitMark(code: number): string {
  return code === 0 ? "✓" : `✗ ${code}`;
}

/** The code of an `exit N` meta entry, or undefined for any other entry. */
export function parseExitMeta(entry: string): number | undefined {
  const match = /^exit (-?\d+)$/.exec(entry);
  return match ? Number(match[1]) : undefined;
}
