/**
 * TEST ONLY: attaches a stdio MCP server under a name no host knows to every
 * agent opened in a directory holding `bp-tool-free-probe.json`
 * (`test/integration/translation-tool-free.test.ts`). The file names the
 * server, the Node binary and probe script to run, and the log the probe
 * appends each JSON-RPC message to. Agents opened anywhere else are left
 * alone. Only type imports besides Node built-ins, so it installs from its
 * directory with no build.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";

export const PROBE_CONFIG = "bp-tool-free-probe.json";

interface ProbeConfig {
  name: string;
  command: string;
  script: string;
  log: string;
}

function probeFor(cwd: string): ProbeConfig | null {
  try {
    return JSON.parse(readFileSync(join(cwd, PROBE_CONFIG), "utf8")) as ProbeConfig;
  } catch {
    return null;
  }
}

export default function contribute(server: PluginServerContext) {
  return server.addHook("agent.open.before", async ({ request }) => {
    const probe = probeFor(request.cwd);
    if (!probe) return;
    return {
      ...request,
      mcpServers: {
        ...request.mcpServers,
        [probe.name]: { type: "stdio", command: probe.command, args: [probe.script], env: { BP_PROBE_LOG: probe.log } },
      },
    };
  });
}
