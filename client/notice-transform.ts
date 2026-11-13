/**
 * The `notification` transformer: the host's tinted ⓘ card a finished
 * background job produces becomes the plugin's own notice row. Paseo 0.14
 * lists `notification` among the transformable item types, so this replaces
 * the stylesheet hack that used to re-chrome the host's rectangle.
 */
import type { PluginTimelineTransformResult } from "@getpaseo/plugin";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

type NotificationItem = Extract<AgentTimelineItem, { type: "notification" }>;

export function transformNotification({ item }: { item: NotificationItem }): PluginTimelineTransformResult | undefined {
  if (item.type !== "notification") return undefined;
  return {
    items: [
      {
        type: "plugin" as const,
        kind: "omp-notice",
        version: 1,
        data: { level: item.level, message: item.message },
      },
    ],
  };
}
