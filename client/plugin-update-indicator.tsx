import { useEffect } from "react";
import { usePluginUpdateIndicator } from "./tasks/board/update-indicator";

export function PluginUpdateIndicator({ hostId, onChange }: { hostId: string; onChange(available: boolean): void }) {
  const available = usePluginUpdateIndicator(hostId, true);
  useEffect(() => { onChange(available); }, [available, onChange]);
  return null;
}
