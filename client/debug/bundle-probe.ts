/**
 * Debug-only proof that the host's plugin compiler bundles and loads the two
 * markdown dependencies (`marked`'s Lexer, `remend`). It is imported from
 * `index.client.tsx` and called behind the `debugPerf` flag, so the bundler
 * cannot tree-shake it away, yet a normal session never runs it.
 */
import { Lexer } from "marked";
import remend from "remend";

export interface BundleProbeResult {
  tokenKinds: string[];
  remended: string;
}

export function runBundleProbe(): BundleProbeResult {
  const tokens = new Lexer().lex("# Title\n\n```ts\nconst a = 1;\n```\n\n- one\n- **two");
  return {
    tokenKinds: tokens.map((token) => token.type),
    remended: remend("some **unfinished bold"),
  };
}
