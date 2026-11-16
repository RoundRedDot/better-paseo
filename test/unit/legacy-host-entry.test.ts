/**
 * The old `client/react-native` entry is read through one guarded `require`:
 * Paseo removes the entry after 2027-04-20, and a host without it must still
 * load the plugin.
 */
import { describe, expect, it } from "vitest";
import { readLegacyHostEntry } from "../../client/ui/legacy-host-entry";

describe("readLegacyHostEntry", () => {
  it("is the host's module where the host has the entry", () => {
    const entry = { useRevealedText: (text: string) => text };
    expect(readLegacyHostEntry(() => entry)).toBe(entry);
  });

  it("is an empty module where the host's require throws", () => {
    const entry = readLegacyHostEntry(() => {
      throw new Error('Module "@getpaseo/plugin/client/react-native" is not available in plugin client code');
    });
    expect(entry).toEqual({});
    expect("useRevealedText" in entry).toBe(false);
  });

  it("is an empty module for anything that is not a module", () => {
    expect(readLegacyHostEntry(() => null)).toEqual({});
    expect(readLegacyHostEntry(() => undefined)).toEqual({});
    expect(readLegacyHostEntry(() => "module")).toEqual({});
  });
});
