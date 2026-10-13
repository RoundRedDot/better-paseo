/**
 * What each copy entry puts on the clipboard (plan §3.8 item 2, BC-10).
 *
 * Only raw content: no step numbers, icons, line numbers or prompt glyphs a
 * card draws around it, and terminal output without ANSI escapes. The rule
 * for the primary action is "copy the thing the header shows".
 */

export type CopySource =
  /** Bash, Shell and Git calls. */
  | { kind: "shell"; command: string; stdout?: string; stderr?: string }
  | { kind: "read" | "write"; absolutePath: string; content?: string }
  /** `newString` is the protocol's replacement text, when the provider sent one. */
  | { kind: "edit"; absolutePath: string; patch?: string; newString?: string }
  /** `files` are absolute paths; `summary` is a web search's text answer. */
  | { kind: "search"; query: string; summary?: string; files?: readonly string[] }
  /** MCP and Paseo calls. */
  | { kind: "mcp"; result?: string; args?: unknown }
  /** One reasoning section, or the whole thought. */
  | { kind: "reasoning"; text: string }
  | { kind: "code"; code: string }
  | { kind: "path"; absolutePath: string }
  /** A web fetch: the URL the header shows, then what came back. */
  | { kind: "fetch"; url: string; result?: string }
  /** A worktree setup: its directory, then the setup log. */
  | { kind: "worktree"; absolutePath: string; log?: string }
  /** A delegated sub-agent: what it was asked (title, then full prompt), then its log. */
  | { kind: "sub-agent"; description?: string; prompt?: string; log?: string };

export type CopyActionId =
  | "command"
  | "output"
  | "command-output"
  | "path"
  | "content"
  | "patch"
  | "new-content"
  | "query"
  | "summary"
  | "files"
  | "result"
  | "args"
  | "text"
  | "code"
  | "url"
  | "log"
  | "description"
  | "prompt";

export interface CopyAction {
  id: CopyActionId;
  label: string;
  text: string;
}

export interface CopyPlan {
  /** The header's own object. Null when the source carries nothing to copy. */
  primary: CopyAction | null;
  /** The other copies, after the primary; empty values are left out. */
  menu: CopyAction[];
}

// CSI (colours, cursor moves), OSC (titles, hyperlinks) and the lone
// two-byte escapes. Written out rather than pulled from a package: the
// plugin bundle inlines every dependency.
const ANSI_PATTERN =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]|\u009b[0-?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/**
 * The new side of a unified diff: context and added lines of every hunk, in
 * order, without the `+`/` ` column. File headers, hunk headers and
 * `\ No newline` markers are dropped. For a patch with several hunks this is
 * the changed regions, not the whole file — the patch holds no more.
 */
export function newContentFromPatch(patch: string): string {
  const out: string[] = [];
  const lines = patch.split("\n");
  let inHunk = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    // The next file's header. Checked as a pair, because inside a hunk a
    // removed `-- x` or an added `++ x` line looks like half of one.
    if (
      line.startsWith("diff --git ") ||
      (line.startsWith("--- ") && (lines[index + 1] ?? "").startsWith("+++ "))
    ) {
      inHunk = false;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("\\")) continue;
    if (line.startsWith("+") || line.startsWith(" ")) out.push(line.slice(1));
    else if (line === "") out.push("");
  }
  // A patch ends with a newline, which splits into one empty trailing line.
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

function action(id: CopyActionId, label: string, text: string | undefined): CopyAction | null {
  return text ? { id, label, text } : null;
}

/** Terminal text as it reads: no ANSI escapes, no trailing blank lines. */
function terminalText(text: string | undefined): string | undefined {
  return text ? stripAnsi(text).replace(/\n+$/, "") : undefined;
}

function joinOutput(stdout?: string, stderr?: string): string {
  return [stdout, stderr]
    .map((part) => (part ? stripAnsi(part).replace(/\n+$/, "") : ""))
    .filter(Boolean)
    .join("\n");
}

function stringifyArgs(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return undefined;
  }
}

function plan(primary: CopyAction | null, ...menu: Array<CopyAction | null>): CopyPlan {
  return { primary, menu: menu.filter((entry): entry is CopyAction => entry !== null) };
}

export function copyPlan(source: CopySource): CopyPlan {
  switch (source.kind) {
    case "shell": {
      const command = source.command.trim();
      const output = joinOutput(source.stdout, source.stderr);
      return plan(
        action("command", "Copy command", command),
        action("output", "Copy output", output),
        command && output ? action("command-output", "Copy command and output", `$ ${command}\n${output}`) : null,
      );
    }
    case "read":
    case "write":
      return plan(
        action("path", "Copy path", source.absolutePath),
        action("content", "Copy file content", source.content),
      );
    case "edit":
      return plan(
        action("path", "Copy path", source.absolutePath),
        action("patch", "Copy patch", source.patch),
        action(
          "new-content",
          "Copy new content",
          source.newString ?? (source.patch ? newContentFromPatch(source.patch) : undefined),
        ),
      );
    case "search":
      return plan(
        action("query", "Copy query", source.query),
        action("summary", "Copy summary", source.summary?.trim()),
        action("files", "Copy file list", source.files?.join("\n")),
      );
    case "mcp":
      return plan(
        action("result", "Copy result", source.result),
        action("args", "Copy arguments", stringifyArgs(source.args)),
      );
    case "reasoning":
      return plan(action("text", "Copy", source.text.trim()));
    case "code":
      return plan(action("code", "Copy code", source.code));
    case "path":
      return plan(action("path", "Copy path", source.absolutePath));
    case "fetch":
      return plan(action("url", "Copy URL", source.url.trim()), action("result", "Copy result", source.result));
    case "worktree":
      return plan(
        action("path", "Copy path", source.absolutePath),
        action("log", "Copy log", terminalText(source.log)),
      );
    case "sub-agent":
      return plan(
        action("description", "Copy description", source.description?.trim()),
        action("prompt", "Copy prompt", source.prompt?.trim()),
        action("log", "Copy log", terminalText(source.log)),
      );
  }
}
