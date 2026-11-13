import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { transformNotification } from "../../client/notice-transform";

type NotificationItem = Extract<AgentTimelineItem, { type: "notification" }>;

describe("notification transformer", () => {
  it("turns the host notice into the plugin's own notice row", () => {
    expect(
      transformNotification({
        item: { type: "notification", level: "info", message: "Background job bg_4 has completed." },
      }),
    ).toEqual({
      items: [
        {
          type: "plugin",
          kind: "omp-notice",
          version: 1,
          data: { level: "info", message: "Background job bg_4 has completed." },
        },
      ],
    });
  });

  it("keeps each level the host sends", () => {
    for (const level of ["info", "warning", "error"] as const) {
      const result = transformNotification({ item: { type: "notification", level, message: "x" } });
      expect(result?.items[0]?.data).toEqual({ level, message: "x" });
    }
  });

  it("leaves anything but a notification to the host", () => {
    expect(
      transformNotification({ item: { type: "error", message: "x" } as unknown as NotificationItem }),
    ).toBeUndefined();
  });
});
