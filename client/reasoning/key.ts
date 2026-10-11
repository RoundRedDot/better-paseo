/**
 * A reasoning item's identity (plan §3.4 item 2). Neither the transformer nor
 * the renderer receives an item id, and the host rewrites a thought's
 * timestamp on every chunk, so the key is the agent plus a hash of the first
 * 80 characters: reasoning only ever appends, so its opening is stable.
 *
 * Until the text reaches 80 characters the hash changes with each chunk.
 * `useReasoningKey` follows that growth inside one mounted card and carries
 * the reader's choice and the duration record over to each new key, so an
 * early click on a short thought is not lost.
 */
import { useRef } from "react";
import { getDisclosure, hashText, setDisclosure } from "../state/disclosure-store";
import { carryObservation } from "./observed";

export const REASONING_KEY_PREFIX = 80;

export function reasoningKey(agentId: string, text: string): string {
  return `${agentId}:reasoning:${hashText(text.slice(0, REASONING_KEY_PREFIX))}`;
}

/**
 * Moves state from `from` to `to` when `to` names the same growing text. Pure
 * module-state bookkeeping; returns true when anything was carried.
 */
export function carryReasoningState(from: string, to: string): boolean {
  let carried = false;
  const choice = getDisclosure(from);
  if (choice !== undefined && getDisclosure(to) === undefined) {
    // Nobody reads `to` yet (it is new), so no other card wakes up mid-render.
    setDisclosure(to, choice);
    carried = true;
  }
  carryObservation(from, to);
  return carried;
}

export function useReasoningKey(agentId: string, text: string): string {
  const prefix = text.slice(0, REASONING_KEY_PREFIX);
  const key = reasoningKey(agentId, text);
  const previous = useRef<{ key: string; prefix: string } | null>(null);
  const last = previous.current;
  if (
    last &&
    last.key !== key &&
    last.prefix.length < REASONING_KEY_PREFIX &&
    prefix.startsWith(last.prefix)
  ) {
    carryReasoningState(last.key, key);
  }
  previous.current = { key, prefix };
  return key;
}
