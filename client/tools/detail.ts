/**
 * Whether opening a tool row would show anything its header does not
 * already say. A row without detail neither opens nor previews: a sub-agent
 * whose only payload is its one-line description (no prompt, log or
 * actions), a shell call that printed nothing, a read that returned no
 * content.
 */
import { isImagePath } from "../image-file";
import { stringifyValue, type ToolCallView } from "./classify";

/** CJK and other full-width characters take two cells of the row. */
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

function cells(text: string): number {
  let width = 0;
  for (const char of text) width += WIDE.test(char) ? 2 : 1;
  return width;
}

/**
 * True when `text` is drawn whole on the row: one line within `budget`
 * cells. Wider text is cut there, so the opened body still adds the rest.
 */
export function fitsRow(text: string | undefined, budget: number): boolean {
  const trimmed = text?.trim() ?? "";
  return !trimmed.includes("\n") && cells(trimmed) <= budget;
}

/** More than the header's one-line error under the row says. */
function errorDetail(view: ToolCallView, budget: number): boolean {
  if (!view.error) return false;
  return !fitsRow(view.error.replace(/\u001b\[[0-9;]*m/g, ""), budget);
}

function hasArguments(value: unknown): boolean {
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.keys(value).length > 0;
  return stringifyValue(value) !== undefined;
}

function bodyDetail(view: ToolCallView, budget: number): boolean {
  switch (view.tool) {
    case "bash":
    case "shell":
      return Boolean(view.shell?.stdout || view.shell?.stderr || view.output) ||
        !fitsRow(view.shell?.command || view.command, budget);
    case "git":
      // The header names the git operation, not the command line.
      return Boolean(view.shell?.stdout || view.shell?.stderr || view.output || view.shell?.command || view.command);
    case "read":
    case "write":
      return isImagePath(view.filePath) || Boolean(view.code);
    case "edit":
      return Boolean(view.diff || view.code);
    case "thinking":
      return !fitsRow(view.thinking?.text || view.code || view.output, budget);
    case "plan":
    case "plain_text":
      return !fitsRow(view.text, budget);
    case "sub_agent": {
      const agent = view.subAgent;
      return Boolean(agent?.prompt || agent?.actions?.length || agent?.log) || !fitsRow(agent?.description, budget);
    }
    case "search": {
      const search = view.search;
      return Boolean(search?.files?.length || search?.webResults?.length || search?.annotations?.length || search?.content);
    }
    case "fetch":
      return Boolean(view.fetch && (view.fetch.url || view.fetch.prompt || view.fetch.result));
    case "worktree_setup":
      return Boolean(view.worktree && (view.worktree.commands.length > 0 || view.worktree.log));
    case "unknown":
      return hasArguments(view.input) || Boolean(view.output);
    case "mcp":
      if (view.mcp) {
        return hasArguments(view.mcp.arguments) || view.mcp.result !== undefined || Boolean(view.mcp.error);
      }
      break;
    case "hub":
      if (view.hub) return true;
      break;
    case "paseo":
      if (view.paseo) return true;
      break;
    case "github":
      return Boolean(view.github);
  }
  // A kind without its typed record draws its raw output.
  return Boolean(view.output);
}

/**
 * `budget` is the header's target budget in cells. A row whose text is cut
 * there, or that carries output, an error beyond its first line, or a typed
 * record, has detail.
 */
export function toolHasDetail(view: ToolCallView, budget: number): boolean {
  if (Array.isArray(view.questionData?.questions) && view.questionData.questions.length > 0) return true;
  return bodyDetail(view, budget) || errorDetail(view, budget);
}
