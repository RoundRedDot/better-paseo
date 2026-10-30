import { Platform } from "react-native";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { perfDumpRpc } from "../../shared/perf-rpc";
import { loadMarks } from "./load-marks";

/**
 * Bench builds only (`BC_LOAD_TRACE=1 node scripts/build-client.mjs`): send
 * this load's marks to the daemon machine `LOAD_TRACE_DUMP_MS` after
 * `contribute`, where `/bc-perf dump` would write them
 * (`/tmp/bc-perf/<platform>-load-*.json`). A normal install defines the flag
 * false and a checkout leaves it undefined, so neither sends anything.
 */
declare const __BC_LOAD_TRACE__: boolean | undefined;

export const LOAD_TRACE_DUMP_MS = 20_000;

export function scheduleLoadTraceDump(client: PluginClientContext): () => void {
  if (typeof __BC_LOAD_TRACE__ === "undefined" || !__BC_LOAD_TRACE__) return () => {};
  const timer = setTimeout(() => {
    void client
      .rpc(perfDumpRpc, {
        label: "load",
        platform: Platform.OS,
        data: { at: new Date().toISOString(), platform: Platform.OS, loadMarks: loadMarks() },
      })
      .catch((error: unknown) => console.warn("[better-paseo] load trace dump failed", error));
  }, LOAD_TRACE_DUMP_MS);
  return () => clearTimeout(timer);
}
