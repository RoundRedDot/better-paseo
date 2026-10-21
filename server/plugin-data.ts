import { homedir } from "node:os";
import { join } from "node:path";

/** Where this plugin keeps its files: under the daemon's home, apart from every other plugin. */
export function pluginDataDir(): string {
  const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
  return join(home, "plugin-data", "better-paseo");
}
