/**
 * What a tool header copies (plan §3.8 item 2): the primary action is the
 * object the header shows, the `⋯` menu holds the rest. The table itself
 * lives in `copy/content.ts`; this maps a tool view onto it.
 */
import { copyPlan, stripAnsi, type CopyAction, type CopyPlan } from "../copy/content";
import { stringifyValue, type ToolCallView } from "./classify";

/** Resolves a path as reported by the tool to the absolute one. */
export type ResolvePath = (path: string) => string;

function mcpLike(result: string | undefined, args: unknown): CopyPlan {
  return copyPlan({ kind: "mcp", result, args });
}

function textPlan(primary: CopyAction | null, ...menu: Array<CopyAction | null>): CopyPlan {
  return { primary, menu: menu.filter((entry): entry is CopyAction => entry !== null && entry.text !== "") };
}

function entry(id: CopyAction["id"], label: string, text: string | undefined): CopyAction | null {
  return text ? { id, label, text } : null;
}

export function toolCopyPlan(view: ToolCallView, resolve: ResolvePath): CopyPlan {
  switch (view.tool) {
    case "bash":
    case "shell":
    case "git":
      return copyPlan({
        kind: "shell",
        command: view.shell?.command ?? view.command ?? "",
        stdout: view.shell?.stdout ?? view.output,
        stderr: view.shell?.stderr,
      });
    case "read":
    case "write":
      return copyPlan({
        kind: view.tool,
        absolutePath: view.filePath ? resolve(view.filePath) : "",
        content: view.code,
      });
    case "edit":
      return copyPlan({
        kind: "edit",
        absolutePath: view.filePath ? resolve(view.filePath) : "",
        patch: view.diff,
        newString: view.newString,
      });
    case "search":
      return copyPlan({
        kind: "search",
        query: view.search?.query ?? "",
        files: view.search?.files?.map(resolve) ?? view.search?.webResults?.map((row) => row.url),
      });
    case "mcp":
      return mcpLike(stringifyValue(view.mcp?.result), view.mcp?.arguments ?? view.input);
    case "fetch":
      return textPlan(
        entry("text", "Copy URL", view.fetch?.url),
        entry("result", "Copy result", view.fetch?.result),
      );
    case "worktree_setup":
      return textPlan(
        entry("path", "Copy path", view.worktree?.worktreePath ? resolve(view.worktree.worktreePath) : undefined),
        entry("output", "Copy log", view.worktree?.log ? stripAnsi(view.worktree.log) : undefined),
      );
    case "sub_agent":
      return textPlan(
        entry("text", "Copy description", view.subAgent?.description),
        entry("output", "Copy log", view.subAgent?.log ? stripAnsi(view.subAgent.log) : undefined),
      );
    case "plan":
    case "plain_text":
    case "thinking":
      return copyPlan({ kind: "reasoning", text: view.text ?? view.thinking?.text ?? view.code ?? view.output ?? "" });
    case "ask":
      return textPlan(
        entry("text", "Copy question", view.askQuestion),
        entry("result", "Copy answer", view.askAnswer?.join(", ")),
      );
    case "eval":
      return textPlan(
        entry("code", "Copy code", (view.cells ?? []).map((cell) => cell.code).join("\n\n") || view.code),
        entry("output", "Copy output", (view.cells ?? []).map((cell) => cell.output ?? "").filter(Boolean).join("\n") || undefined),
      );
    default:
      // paseo, hub, task, github and unknown: the result, then the arguments.
      return mcpLike(view.output ?? view.github?.text, view.input);
  }
}
