import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISCLOSURE_LIMIT,
  disclosureKey,
  fallbackDisclosureKey,
  getDisclosure,
  resetDisclosureStore,
  setDisclosure,
  subscribeDisclosure,
} from "../../client/state/disclosure-store";

/** What `useDisclosure` returns, without React: the choice, else the default. */
const expanded = (key: string, defaultExpanded: boolean) => getDisclosure(key) ?? defaultExpanded;

describe("disclosure store", () => {
  beforeEach(() => resetDisclosureStore());

  it("keys tool calls by agent and call id", () => {
    expect(disclosureKey("agent-1", "call-9")).toBe("agent-1:call-9");
  });

  it("answers with the default until the reader chooses", () => {
    const key = disclosureKey("a", "c1");
    expect(expanded(key, false)).toBe(false);
    expect(expanded(key, true)).toBe(true);
  });

  it("keeps the reader's choice over any later default", () => {
    const key = disclosureKey("a", "c1");
    // Expanded while running...
    setDisclosure(key, true);
    // ...the tool completes and the renderer's default becomes collapsed.
    expect(expanded(key, false)).toBe(true);
    setDisclosure(key, false);
    // A failed tool may default to expanded; the explicit collapse still wins.
    expect(expanded(key, true)).toBe(false);
  });

  it("survives a remount: state lives in the module, not the component", () => {
    const key = disclosureKey("a", "c2");
    setDisclosure(key, true);
    // A remounted card reads the same key afresh.
    expect(getDisclosure(key)).toBe(true);
  });

  it("separates agents that reuse a call id", () => {
    setDisclosure(disclosureKey("a", "c1"), true);
    expect(getDisclosure(disclosureKey("b", "c1"))).toBeUndefined();
  });

  it("evicts the least recently chosen key beyond the limit", () => {
    for (let index = 0; index < DISCLOSURE_LIMIT; index++) setDisclosure(`k${index}`, true);
    // Choosing k0 again makes it the most recent.
    setDisclosure("k0", false);
    setDisclosure("overflow", true);
    expect(getDisclosure("k0")).toBe(false);
    expect(getDisclosure("k1")).toBeUndefined();
    expect(getDisclosure("k2")).toBe(true);
    expect(getDisclosure("overflow")).toBe(true);
  });

  it("wakes only the listeners of the changed key", () => {
    const a = vi.fn();
    const b = vi.fn();
    const stopA = subscribeDisclosure("a:1", a);
    subscribeDisclosure("b:1", b);
    setDisclosure("a:1", true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    stopA();
    setDisclosure("a:1", false);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("builds a fallback key from name and input, independent of key order", () => {
    const one = fallbackDisclosureKey("a", "bash", { command: "ls", cwd: "/x" });
    const two = fallbackDisclosureKey("a", "bash", { cwd: "/x", command: "ls" });
    expect(one).toBe(two);
    expect(one.startsWith("a:bash:")).toBe(true);
    expect(fallbackDisclosureKey("a", "bash", { command: "pwd" })).not.toBe(one);
  });
});
