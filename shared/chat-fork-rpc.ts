import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const forkCursorSchema = z.object({
  epoch: z.string().min(1),
  seq: z.number().int().nonnegative(),
});

export type ForkCursor = z.output<typeof forkCursorSchema>;

export const chatForkRpc = defineRpc({
  name: "chat.fork",
  input: z.object({
    agentId: z.string().min(1),
    cursor: forkCursorSchema,
    target: z.enum(["tab", "workspace"]),
    prompt: z.string().trim().min(1),
    requestKey: z.string().min(1).max(100),
  }),
  output: z.object({ agentId: z.string() }),
});

export type ChatForkInput = z.output<typeof chatForkRpc.input>;
