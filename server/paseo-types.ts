/**
 * The `@getpaseo/client` types the server uses, read off the plugin SDK.
 *
 * Paseo's plugin compiler resolves every import of a server-reachable module,
 * type-only ones too, and only skips the SDK, `@getpaseo/protocol/*` and the
 * host's own modules. `@getpaseo/client` is a dev dependency (the manifest
 * installs with `npm ci --omit=dev`), so naming it here would fail the
 * install with "Could not resolve type dependency". The SDK's server
 * contract carries the same `PaseoApi`; `test/unit/paseo-types.test.ts`
 * checks each alias against the client package.
 */
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

export type PaseoApi = PluginHandlerContext["paseo"];
type PaseoAgentHandle = ReturnType<PaseoApi["agents"]["ref"]>;
export type PaseoAgentTimelineHandle = PaseoAgentHandle["timeline"];
export type PaseoAgentTimelineEvent = Parameters<Parameters<PaseoAgentTimelineHandle["subscribe"]>[0]>[0];
export type PaseoAgentRefetchResult = NonNullable<Awaited<ReturnType<PaseoAgentHandle["refresh"]>>>;
// `list` is overloaded; `Parameters` and `ReturnType` read the last, plain overload.
export type PaseoAgentListOptions = NonNullable<Parameters<PaseoApi["agents"]["list"]>[0]>;
export type PaseoWorkspace = Awaited<ReturnType<PaseoApi["workspaces"]["list"]>>["entries"][number];
export type PaseoProviderModelsResult = Awaited<ReturnType<PaseoApi["providers"]["listModels"]>>;
