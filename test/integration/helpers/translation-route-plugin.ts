/**
 * TEST ONLY: the route plugin the translation integration tests install. It runs Better Paseo's
 * real translation service inside the daemon behind one RPC, as the installed plugin does.
 */
import fs from "node:fs";
import path from "node:path";

export const ROUTE = "bp-translation-route";
const routeFixture = path.resolve(__dirname, "../translation-route");
const repoRoot = path.resolve(__dirname, "../../..");
/** The real modules the route plugin runs; the daemon bundles only files inside a plugin. */
const ROUTE_SOURCES = [
  "server/translation/service.ts",
  "server/translation/text-generation.ts",
  "server/paseo-types.ts",
  "shared/timeline-translation.ts",
  "shared/translation-languages.ts",
  "shared/model-catalog.ts",
];
/** TEST ONLY: Better Paseo's translation service with fixed settings, behind one RPC. */
const ROUTE_ENTRY = `import { defineRpc } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { createTimelineTranslator } from "./server/translation/service";
import { timelineTranslationSettingsSchema, translationConfigSignature } from "./shared/timeline-translation";

const probeRpc = defineRpc({
  name: "probe.translate",
  input: z.object({ agentId: z.string(), provider: z.string(), model: z.string(), text: z.string(), cancelAfterMs: z.number().optional() }),
  output: z.unknown(),
});

export default function contribute(server: PluginServerContext) {
  const stop: unknown = server.handle(probeRpc, async ({ agentId, provider, model, text, cancelAfterMs }, { paseo }) => {
    const values = timelineTranslationSettingsSchema.parse({ enabled: true, customModel: true, provider, model, prompt: "Translate." });
    const translator = createTimelineTranslator({
      settings: { id: "timeline-translation", read: async () => ({ status: "ready", values, revision: "it" }) } as never,
      timeoutMs: 30_000,
    });
    const providers = paseo.providers as unknown as { generateText?: unknown };
    const hostHasTextApi = typeof providers.generateText === "function";
    const configSignature = translationConfigSignature(values, "en", { provider, model });
    // As the client does: check without the text first, and send it only when the check passes.
    const checked = await translator.check({ agentId, interfaceLanguage: "en", configSignature }, paseo);
    if (checked.state !== "ready") return { state: checked, started: false, hostHasTextApi };
    const started = translator.request({ action: "start", agentId, text, sourceKind: "assistant_message", interfaceLanguage: "en", configSignature }, paseo);
    const handle = started.state === "running" ? started.handle ?? "" : "";
    if (cancelAfterMs !== undefined) setTimeout(() => translator.request({ action: "cancel", handle }, paseo), cancelAfterMs);
    const deadline = Date.now() + 60_000;
    let state = translator.request({ action: "status", handle }, paseo);
    while (state.state === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = translator.request({ action: "status", handle }, paseo);
    }
    return { state, started: true, hostHasTextApi };
  });
  return typeof stop === "function" ? stop : () => undefined;
}
`;

/** The route plugin, assembled in `home` from the fixture manifest and the real sources. */
export function assembleRoutePlugin(home: string): string {
  const dir = path.join(home, "translation-route");
  fs.mkdirSync(dir, { recursive: true });
  for (const file of ["paseo-plugin.json", "package.json"]) fs.copyFileSync(path.join(routeFixture, file), path.join(dir, file));
  for (const file of ROUTE_SOURCES) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, file), path.join(dir, file));
  }
  fs.writeFileSync(path.join(dir, "index.server.ts"), ROUTE_ENTRY);
  return dir;
}
