import { describe, expect, it } from "vitest";
import { classifyAgent, deriveAgentStateBucket } from "../../client/tasks/agent-state-bucket";

// The cases of upstream `packages/protocol/src/agent-state-bucket.test.ts`.
describe("deriveAgentStateBucket (copied from @getpaseo/protocol)", () => {
  it("prioritizes pending permissions as needs_input", () => {
    expect(
      deriveAgentStateBucket({ status: "idle", pendingPermissionCount: 1, requiresAttention: false, attentionReason: null }),
    ).toBe("needs_input");
  });

  it("keeps legacy permission attention in needs_input", () => {
    expect(
      deriveAgentStateBucket({ status: "idle", pendingPermissionCount: 0, requiresAttention: true, attentionReason: "permission" }),
    ).toBe("needs_input");
  });

  it("prioritizes error attention before running status", () => {
    expect(
      deriveAgentStateBucket({ status: "running", pendingPermissionCount: 0, requiresAttention: true, attentionReason: "error" }),
    ).toBe("failed");
  });

  it("treats unread finished agents as attention", () => {
    expect(
      deriveAgentStateBucket({ status: "idle", pendingPermissionCount: 0, requiresAttention: true, attentionReason: "finished" }),
    ).toBe("attention");
  });

  it("does not count initializing agents as running for workspace buckets", () => {
    expect(
      deriveAgentStateBucket({ status: "initializing", pendingPermissionCount: 0, requiresAttention: false, attentionReason: null }),
    ).toBe("done");
  });
});

describe("classifyAgent", () => {
  it("maps each bucket to its lane and icon", () => {
    expect(classifyAgent({ status: "running", pendingPermissionCount: 2 })).toEqual({ lane: "needs_input", status: "needs_input" });
    expect(classifyAgent({ status: "error" })).toEqual({ lane: "review", status: "failed" });
    expect(classifyAgent({ status: "running" })).toEqual({ lane: "running", status: "running" });
    expect(classifyAgent({ status: "idle", requiresAttention: true, attentionReason: "finished" })).toEqual({
      lane: "review",
      status: "unread",
    });
    expect(classifyAgent({ status: "idle" })).toEqual({ lane: "done", status: "done" });
    expect(classifyAgent({ status: "closed" })).toEqual({ lane: "done", status: "done" });
  });

  it("puts initializing agents in the running lane, as the spec's rule 3 says", () => {
    expect(classifyAgent({ status: "initializing" })).toEqual({ lane: "running", status: "running" });
  });

  it("still lets a permission or an error outrank initializing", () => {
    expect(classifyAgent({ status: "initializing", pendingPermissionCount: 1 }).lane).toBe("needs_input");
    expect(classifyAgent({ status: "initializing", attentionReason: "error" }).status).toBe("failed");
  });
});
