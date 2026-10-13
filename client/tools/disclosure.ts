/**
 * Which tool cards start open, and the key their open state is stored under
 * (plan §3.3 items 1–2).
 */
import type { ToolDetailPreference } from "../preferences";
import { disclosureKey, fallbackDisclosureKey } from "../state/disclosure-store";
import type { ToolCallView } from "./classify";

/**
 * Collapsed for running, completed and failed alike, except a failure, which
 * opens when the reader chose "expand on failure".
 */
export function defaultToolExpanded(view: ToolCallView, preference: ToolDetailPreference): boolean {
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
