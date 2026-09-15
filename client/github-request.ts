function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Reads a GitHub device request well enough to title its card.
 *
 * The call is a write to `xd://github` whose `content` is a JSON request, so
 * without this the card says only "GitHub" and the op — the one fact worth
 * reading at a glance — stays hidden inside the body.
 */
export function describeGitHubRequest(request: string | undefined): string | undefined {
  if (!request) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(request);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;

  const record = parsed as Record<string, unknown>;
  const op = asString(record.op);
  if (!op) return undefined;

  // Whichever of these the op carries, in the order a reader wants them.
  const subject =
    asString(record.path) ??
    asString(record.query) ??
    (typeof record.pr === "number" ? `#${record.pr}` : asString(record.pr)) ??
    asString(record.run) ??
    asString(record.branch);
  const repo = asString(record.repo);
  const tail = [repo, subject].filter(Boolean).join(" ");
  return tail ? `${op} ${tail}` : op;
}
