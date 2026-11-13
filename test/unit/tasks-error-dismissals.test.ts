import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createErrorDismissals } from "../../server/tasks/error-dismissals";
import { isErrorDismissed } from "../../client/tasks/data/error-dismissals";
import type { TaskCard } from "../../client/tasks/model";

describe("task error dismissal", () => {
  it("persists only the selected agent's most recent dismissal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "task-error-dismissal-"));
    try {
      const path = join(dir, "dismissals.json");
      const store = createErrorDismissals(path);
      const entry = await store.dismiss("agent-a", "first error");
      await store.dismiss("agent-b", "other error");
      await store.dismiss("agent-a", "next error");
      const saved = await createErrorDismissals(path).list();
      expect(saved).toHaveLength(2);
      expect(saved.find((item) => item.agentId === "agent-a")?.error).toBe("next error");
      expect(entry.dismissedAt).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("shows a new error or a later occurrence of the same error", () => {
    const entry = { agentId: "a", error: "network error", dismissedAt: Date.parse("2026-01-02T00:00:00Z") };
    const card = { error: "network error", timing: { lastUserMessageAt: "2026-01-01T00:00:00Z", lastTurnEndedAt: null, attentionAt: null } } as TaskCard;
    expect(isErrorDismissed(card, entry)).toBe(true);
    expect(isErrorDismissed({ ...card, error: "another error" }, entry)).toBe(false);
    expect(isErrorDismissed({ ...card, timing: { ...card.timing, lastTurnEndedAt: "2026-01-03T00:00:00Z" } }, entry)).toBe(false);
  });
});
