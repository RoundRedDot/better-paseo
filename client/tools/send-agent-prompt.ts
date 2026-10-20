import { z } from "zod";
import type { PaseoSendAgentPromptData } from "../../shared/contracts";
import { readPaseoResult } from "./paseo-result";

const resultSchema = z.object({
  success: z.boolean().optional(),
  disposition: z.string().optional(),
  status: z.string().optional(),
  guidance: z.string().optional(),
});

/** MCP structured results and JSON text are the two public response transports. */
export function readSendAgentPrompt(input: Record<string, unknown>, output: unknown, outputText: string | undefined,
  status: string): PaseoSendAgentPromptData {
  const envelope = output && typeof output === "object" ? output as Record<string, unknown> : undefined;
  const parsed = resultSchema.safeParse(readPaseoResult(output, outputText));
  const fields = parsed.success ? parsed.data : undefined;
  const state = status === "canceled" ? "canceled" :
    status === "failed" || envelope?.isError === true || fields?.success === false ? "failed" :
    status === "running" ? "sending" : fields?.success === true ? "sent" : "unconfirmed";
  return {
    agentId: typeof input.agentId === "string" ? input.agentId : undefined,
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    state, success: fields?.success, disposition: fields?.disposition, agentStatus: fields?.status,
    guidance: fields?.guidance, sessionMode: typeof input.sessionMode === "string" ? input.sessionMode : undefined,
    arguments: input, result: output,
  };
}
