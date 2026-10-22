import { splitSelector } from "./paths/format-path";

/**
 * The host's timeline `openFile`, when this app build passes it.
 *
 * The published plugin types do not include the prop yet. A renderer records
 * the function it actually received, and path presses read it back by agent.
 * An older app leaves the prop unset, and the press falls back to `file.reveal`.
 */
export interface HostOpenFileLocation {
  path: string;
  lineStart?: number;
  lineEnd?: number;
}

export type HostOpenFile = (location: HostOpenFileLocation) => void;

const byAgent = new Map<string, HostOpenFile>();

export function rememberHostOpenFile(agentId: string, openFile: HostOpenFile | undefined): void {
  if (openFile) byAgent.set(agentId, openFile);
  else byAgent.delete(agentId);
}

export function readHostOpenFile(agentId: string): HostOpenFile | undefined {
  return byAgent.get(agentId);
}

export function openHostOrReveal(agentId: string, target: string, reveal: (path: string) => void): void {
  const openFile = readHostOpenFile(agentId);
  const { path, suffix } = splitSelector(target);
  if (openFile) {
    openFile({ path, ...linesFromSuffix(suffix) });
    return;
  }
  reveal(path);
}

/** `#L10`, `#L10-L20`, or a leading `:12`. `:12:3` keeps the line and drops the column. */
export function linesFromSuffix(suffix: string): { lineStart?: number; lineEnd?: number } {
  const hash = /^#L(\d+)(?:-L?(\d+))?/i.exec(suffix);
  if (hash?.[1]) {
    const lineStart = Number(hash[1]);
    return hash[2] ? { lineStart, lineEnd: Number(hash[2]) } : { lineStart };
  }
  const colon = /^:(\d+)/.exec(suffix);
  return colon?.[1] ? { lineStart: Number(colon[1]) } : {};
}
