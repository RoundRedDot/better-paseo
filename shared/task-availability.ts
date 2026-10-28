import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const taskIssueSchema = z.object({
  code: z.enum(["checking", "host_unavailable", "unsupported", "agent_missing", "directory_missing", "directory_not_directory", "directory_inaccessible", "workspace_unavailable", "project_unavailable", "title_settings_invalid", "provider_unavailable", "model_unavailable"]),
  detail: z.string().nullable(),
});
export type TaskIssue = z.output<typeof taskIssueSchema>;
export type TaskOperation = "rename" | "autoTitle" | "unarchive" | "archive" | "read" | "permission";
export const taskAvailabilitySchema = z.object({
  issue: taskIssueSchema.nullable(),
  blocked: z.object({
    rename: taskIssueSchema.optional(), autoTitle: taskIssueSchema.optional(), unarchive: taskIssueSchema.optional(),
    archive: taskIssueSchema.optional(), read: taskIssueSchema.optional(), permission: taskIssueSchema.optional(),
  }),
});
export type TaskAvailability = z.output<typeof taskAvailabilitySchema>;

export function unavailableTask(issue: TaskIssue): TaskAvailability {
  return { issue, blocked: { rename: issue, autoTitle: issue, unarchive: issue, archive: issue, read: issue, permission: issue } };
}

/** Paths are resolved from the host's agent records, never from client-supplied paths. */
export const tasksAvailabilityRpc = defineRpc({
  name: "tasks.availability",
  input: z.object({ agentIds: z.array(z.string().min(1)).min(1).max(100) }),
  output: z.object({ entries: z.array(z.object({ agentId: z.string(), availability: taskAvailabilitySchema })) }),
});
