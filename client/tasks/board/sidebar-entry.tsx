import React from "react";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";

/** Placeholder until the board slice lands: the row without counts. */
export function TasksSidebarEntry(props: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="SquareKanban"
      label="Tasks"
      active={props.currentScreen?.screenId === "tasks"}
      onPress={() => props.openScreen({ screenId: "tasks" })}
    />
  );
}
