/**
 * `/bc-perf on | off | reset | dump [label]`: the perf probes' control surface
 * for hosts with no console (production Electron, iOS). Registered always, but
 * it does nothing until a user types it; `dump` ships the probe snapshot to the
 * daemon machine, which writes it under /tmp/bc-perf.
 */
import { Dimensions, Platform } from "react-native";
import type { PluginClientSlashCommandContribution } from "@getpaseo/plugin/client";
import { perfDumpRpc } from "../../shared/perf-rpc";
import { disablePerf, enablePerf, perfOn, perfSnapshot, resetPerf } from "./perf";
import { fontProbeSnapshot } from "./font-probe-store";

function heapBytes(): number | null {
  const memory = (globalThis.performance as { memory?: { usedJSHeapSize: number } } | undefined)
    ?.memory;
  return memory ? memory.usedJSHeapSize : null;
}

export const perfSlashCommand: PluginClientSlashCommandContribution = {
  name: "bc-perf",
  description: "Better Paseo perf probes (debug)",
  argumentHint: "on | off | reset | dump [label]",
  context: "agent",
  async onSubmit(context) {
    const [action = "", ...rest] = context.args.trim().split(/\s+/);
    switch (action) {
      case "on":
        enablePerf();
        return;
      case "off":
        disablePerf();
        return;
      case "reset":
        resetPerf();
        return;
      case "dump": {
        const window = Dimensions.get("window");
        const result = await context.rpc(perfDumpRpc, {
          label: rest.join("-") || "dump",
          platform: Platform.OS,
          data: {
            at: new Date().toISOString(),
            enabled: perfOn(),
            platform: Platform.OS,
            platformVersion: String(Platform.Version),
            window: { width: window.width, height: window.height, scale: window.scale },
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
            agent: { id: context.agent.id },
            heapBytes: heapBytes(),
            commandFont: fontProbeSnapshot(),
            snapshot: perfSnapshot(),
          },
        });
        console.info("[better-paseo] perf dump", result);
        return;
      }
      default:
        console.info("[better-paseo] /bc-perf on | off | reset | dump [label]");
    }
  },
};
