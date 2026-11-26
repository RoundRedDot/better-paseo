import { createHash, randomUUID } from "node:crypto";
import type { ChatForkInput } from "../shared/chat-fork-rpc";
import type { PaseoApi } from "./paseo-types";
import { connectHostDaemon } from "./tasks/provider-subagents";

/** Keep the same agent and creation receipt when a client retries a request. */
function forkAgentId(agentId: string, requestKey: string): string {
  const hex = createHash("sha256").update(JSON.stringify([agentId, requestKey])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function forkChat(input: ChatForkInput, paseo: PaseoApi, connect = connectHostDaemon) {
  const agentId = forkAgentId(input.agentId, input.requestKey);
  const source = await paseo.agents.ref(input.agentId).refresh();
  if (!source) throw new Error("The source conversation is no longer available.");
  const { agent, project } = source;
  const workspaceId = agent.workspaceId;
  if (input.target === "tab" && !workspaceId) {
    throw new Error("The source conversation has no workspace. Choose a new workspace.");
  }

  const daemon = await connect(`cid_better_paseo_fork_${randomUUID()}`);
  try {
    if (!daemon?.buildAgentForkContext) throw new Error("This Paseo host cannot fork conversations.");
    const { attachment } = await daemon.buildAgentForkContext(input.agentId, { boundaryCursor: input.cursor });
    if (!attachment) throw new Error("The selected reply has no conversation history.");

    const model = agent.model ?? agent.runtimeInfo?.model;
    const options = {
      agentId,
      config: {
        provider: model ? `${agent.provider}/${model}` : agent.provider,
        modeId: agent.currentModeId ?? agent.runtimeInfo?.modeId ?? undefined,
        thinkingOptionId: agent.thinkingOptionId ?? agent.runtimeInfo?.thinkingOptionId ?? undefined,
        options: agent.options,
      },
      prompt: input.prompt,
      attachments: [attachment],
    };
    const idempotencyKey = `better-paseo-fork:${agentId}`;
    if (input.target === "tab" && workspaceId) {
      const fork = await paseo.workspaces.ref(workspaceId).agents.create({ ...options, idempotencyKey });
      return { agentId: fork.id };
    }
    const cwd = project?.checkout.cwd || agent.cwd;
    await paseo.workspaces.create({
      source: { kind: "directory", path: cwd, projectId: project?.projectKey },
      agent: { ...options, cwd },
      idempotencyKey,
    });
    return { agentId };
  } finally {
    await daemon?.close().catch(() => {});
  }
}
