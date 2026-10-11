/**
 * Which tool cards start open, and the key their open state is stored under
 * (plan §3.3 items 1–2).
 */
import type { ToolDetailPreference } from "../preferences";
import { disclosureKey, fallbackDisclosureKey } from "../state/disclosure-store";
import type { ToolCallView } from "./classify";

/**
 * Collapsed for running, completed and failed alike. Two exceptions: an
 * `ask` that is still waiting for its answer stays open (the host draws the
 * answer controls, and the question is the point), and a failure opens when
 * the reader chose "expand on failure".
 */
export function defaultToolExpanded(view: ToolCallView, preference: ToolDetailPreference): boolean {
  if (view.tool === "ask") {
    return view.status === "running" && !(view.askAnswer && view.askAnswer.length > 0);
  }
  return view.status === "failed" && preference === "expand-failed";
}

/**
 * `${agentId}:${callId}`; without a call id, the name plus a hash of what the
 * call was asked to do. Never the output, which grows while the call runs,
 * and never the timestamp, which the host rewrites on every chunk.
 */
export function toolDisclosureKey(agentId: string, view: ToolCallView): string {
  if (view.callId) return disclosureKey(agentId, view.callId);
  const identity = view.input ?? {
    filePath: view.filePath,
    command: view.command,
    query: view.search?.query,
    url: view.fetch?.url,
  };
  return fallbackDisclosureKey(agentId, view.name ?? view.tool, identity);
}
