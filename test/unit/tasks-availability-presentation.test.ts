import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null }));

import { shownIssue, taskIssueText } from "../../client/tasks/cards/availability-tag";
import { createTaskAvailability } from "../../server/tasks/availability";
import { tasksAvailabilityRpc } from "../../shared/task-availability";
import { availabilityBatchFixture } from "./helpers/availability-batch-fixture";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe("workspace availability presentation", () => {
  it("keeps recoverable archived history unmarked while preserving missing-workspace warnings and operation guards", async () => {
    const f = await availabilityBatchFixture({ workspaces: 40 });
    cleanups.push(f.cleanup);
    const read = createTaskAvailability(f.settings, () => true, async () => true, f.connect);
    const { entries } = tasksAvailabilityRpc.output.parse(await read(f.api, ["agent-1", "agent-4", "agent-5"]));
    const archived = entries[0]!.availability;
    expect(shownIssue(archived.issue)).toBeNull();
    expect(archived.blocked.unarchive).toBeUndefined();
    expect(taskIssueText(archived.blocked.rename!, "zh")).toBe(`工作区已归档，请先取消归档\n${f.root}`);
    expect(taskIssueText(archived.blocked.autoTitle!, "en")).toBe(`Workspace archived; unarchive it first\n${f.root}`);
    expect(shownIssue(entries[1]!.availability.issue)?.code).toBe("workspace_unavailable");
    expect(shownIssue(entries[2]!.availability.issue)?.code).toBe("directory_missing");
  });
});
