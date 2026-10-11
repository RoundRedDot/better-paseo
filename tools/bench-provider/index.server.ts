import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createBenchProvider } from "./server/provider";

export default function contribute(server: PluginServerContext) {
  server.registerProvider(createBenchProvider());
  return () => {};
}
