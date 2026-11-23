import type { PaseoApi } from "./paseo-types";

/** Only the provider family leaves the daemon; configuration can contain secrets. */
export async function providerIsCodex(provider: string, paseo: Pick<PaseoApi, "config">): Promise<boolean> {
  if (provider === "codex") return true;
  try {
    const { config } = await paseo.config.get();
    return config.providers[provider]?.extends === "codex";
  } catch {
    throw new Error("Provider family lookup failed");
  }
}
