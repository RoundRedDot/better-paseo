import type { ToolCallView } from "../tools/classify";
import type { TranslationSourceKind } from "./store";

export type ToolTranslationTarget = {
  id: "prompt" | "result";
  text: string;
  kind: TranslationSourceKind;
  streaming: boolean;
};

/** Only prose fields with an unambiguous owner are offered for translation. */
export function toolTranslationTargets(data: ToolCallView): ToolTranslationTarget[] {
  const targets: ToolTranslationTarget[] = [];
  const add = (id: ToolTranslationTarget["id"], text: string | undefined, kind: TranslationSourceKind, streaming = false) => {
    if (text?.trim()) targets.push({ id, text, kind, streaming });
  };
  if (data.paseo?.createAgent) add("prompt", data.paseo.createAgent.initialPrompt, "user_message");
  if (data.paseo?.sendAgentPrompt) add("prompt", data.paseo.sendAgentPrompt.prompt, "user_message");
  if (data.subAgent) {
    add("prompt", data.subAgent.prompt, "user_message");
    add("result", data.subAgent.log, "assistant_message", data.status === "running");
  }
  if (data.agentStatus?.status === "finished") add("result", data.agentStatus.body, "assistant_message");
  if (data.tool === "plan") add("result", data.text, "tool_output", data.status === "running");
  if (data.tool === "fetch") add("result", data.fetch?.result, "tool_output", data.status === "running");
  if (data.tool === "search") add("result", data.search?.annotations?.join("\n\n"), "tool_output", data.status === "running");
  return targets;
}

/** Translate only the identified prose, leaving metadata and copy sources intact. */
export function translatedTool(data: ToolCallView, translated: Partial<Record<ToolTranslationTarget["id"], string>>): ToolCallView {
  if (!translated.prompt && !translated.result) return data;
  if (data.paseo?.createAgent && translated.prompt) return { ...data, paseo: { ...data.paseo, createAgent: { ...data.paseo.createAgent, initialPrompt: translated.prompt } } };
  if (data.paseo?.sendAgentPrompt && translated.prompt) return { ...data, paseo: { ...data.paseo, sendAgentPrompt: { ...data.paseo.sendAgentPrompt, prompt: translated.prompt } } };
  if (data.subAgent) return { ...data, subAgent: { ...data.subAgent, prompt: translated.prompt ?? data.subAgent.prompt, log: translated.result ?? data.subAgent.log } };
  if (data.agentStatus?.status === "finished" && translated.result) return { ...data, agentStatus: { ...data.agentStatus, body: translated.result } };
  if (data.tool === "plan" && translated.result) return { ...data, text: translated.result };
  if (data.tool === "fetch" && data.fetch && translated.result) return { ...data, fetch: { ...data.fetch, result: translated.result } };
  if (data.tool === "search" && data.search && translated.result) return { ...data, search: { ...data.search, annotations: [translated.result] } };
  return data;
}
