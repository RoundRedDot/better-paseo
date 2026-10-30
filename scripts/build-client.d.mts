/** Types for `build-client.mjs`, for the tests that run it. */
export interface ClientBuild {
  main: string;
  mainInputs: Set<string>;
  chunk: string;
  chunkInputs: Set<string>;
  chunkId: string;
  /** Each shared file and the names the chunk takes from it, or `"*"` for its whole namespace. */
  shared: Map<string, ReadonlySet<string> | "*">;
}
export const HOST_EXTERNALS: string[];
export function buildClient(options?: { root?: string }): Promise<ClientBuild>;
export function clientEntry(main: string): string;
export function chunkModule(chunkId: string, chunk: string): string;
export function sharedNames(code: string): Map<string, ReadonlySet<string> | "*">;
