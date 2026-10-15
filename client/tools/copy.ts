/**
 * What a tool header copies (plan §3.8 item 2): the primary action is the
 * object the header shows, then the rest; each is a button on the row
 * and in its preview. The table itself
 * lives in `copy/content.ts`; this only maps a tool view onto its sources.
 */
import { copyPlan, type CopyPlan } from "../copy/content";
import { stringifyValue, type ToolCallView } from "./classify";

/** Resolves a path as reported by the tool to the absolute one. */
export type ResolvePath = (path: string) => string;

export function toolCopyPlan(view: ToolCallView, resolve: ResolvePath): CopyPlan {
  if (view.questionData) {
    return copyPlan({ kind: "mcp", args: { questions: view.questionData.questions },
      result: view.text ?? view.output ?? stringifyValue(view.questionData.answers ?? view.questionData.result) });
  }
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
        summary: view.search?.annotations?.join("\n\n"),
        files: view.search?.files?.map(resolve) ?? view.search?.webResults?.map((row) => row.url),
      });
    case "mcp":
      return copyPlan({
        kind: "mcp",
        result: stringifyValue(view.mcp?.result),
        args: view.mcp?.arguments ?? view.input,
      });
    case "fetch":
      return copyPlan({ kind: "fetch", url: view.fetch?.url ?? "", result: view.fetch?.result });
    case "worktree_setup":
      return copyPlan({
        kind: "worktree",
        absolutePath: view.worktree?.worktreePath ? resolve(view.worktree.worktreePath) : "",
        log: view.worktree?.log,
      });
    case "sub_agent":
      return copyPlan({
        kind: "sub-agent",
        description: view.subAgent?.description,
        prompt: view.subAgent?.prompt,
        log: view.subAgent?.log,
      });
    case "plan":
    case "plain_text":
    case "thinking":
      return copyPlan({
        kind: "reasoning",
        text: view.text ?? view.thinking?.text ?? view.code ?? view.output ?? "",
      });
    default:
      // paseo, hub, github and unknown: the result, then the arguments.
      return copyPlan({ kind: "mcp", result: view.output ?? view.github?.text, args: view.input });
  }
}
