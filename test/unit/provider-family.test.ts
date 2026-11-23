import { describe, expect, it, vi } from "vitest";

vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => ({}), useRpc: () => vi.fn() }));
import { createProviderFamilyStore } from "../../client/state/provider-family";
import { providerIsCodex } from "../../server/provider-family";

describe("provider family", () => {
  it("returns only the configured family and does not expose environment values", async () => {
    const get = vi.fn(async () => ({ config: { providers: {
      "my-codex": { extends: "codex", env: { KEY: "secret-value" } },
      "my-claude": { extends: "claude" },
    } } }));
    const paseo = { config: { get } } as unknown as Parameters<typeof providerIsCodex>[1];
    expect(await providerIsCodex("my-codex", paseo)).toBe(true);
    expect(await providerIsCodex("my-claude", paseo)).toBe(false);
    expect(await providerIsCodex("unknown", paseo)).toBe(false);
    expect(await providerIsCodex("codex", paseo)).toBe(true);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("converts configuration errors without exposing their contents", async () => {
    const paseo = { config: { get: vi.fn().mockRejectedValue(new Error("secret-value")) } } as unknown as Parameters<typeof providerIsCodex>[1];
    await expect(providerIsCodex("custom", paseo)).rejects.toThrow("Provider family lookup failed");
  });

  it("shares in-flight reads and notifies subscribers once", async () => {
    const store = createProviderFamilyStore();
    const notify = vi.fn();
    const unsubscribe = store.subscribe(notify);
    let resolve!: (result: { codex: boolean }) => void;
    const read = vi.fn(() => new Promise<{ codex: boolean }>((done) => { resolve = done; }));
    const first = store.load("my-codex", read);
    const second = store.load("my-codex", read);
    expect(read).toHaveBeenCalledOnce();
    resolve({ codex: true });
    await Promise.all([first, second]);
    expect(store.get("my-codex")).toBe(true);
    expect(notify).toHaveBeenCalledOnce();
    await store.load("my-codex", read);
    expect(read).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("reports a failed lookup without caching it and permits a later retry", async () => {
    const store = createProviderFamilyStore();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const read = vi.fn().mockRejectedValueOnce(new Error("secret-value")).mockResolvedValueOnce({ codex: true });
    try {
      await store.load("my-codex", read);
      expect(store.get("my-codex")).toBeUndefined();
      expect(error).toHaveBeenCalledExactlyOnceWith("Could not determine provider family.");
      await store.load("my-codex", read);
      expect(store.get("my-codex")).toBe(true);
    } finally { error.mockRestore(); }
  });

  it("shares polling, retries failures, and applies provider changes until the last observer leaves", async () => {
    vi.useFakeTimers();
    const store = createProviderFamilyStore();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const read = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ codex: true }).mockResolvedValueOnce({ codex: false });
    const a = store.watch("custom", read);
    const b = store.watch("custom", read);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(store.get("custom")).toBe(true);
      a();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(store.get("custom")).toBe(false);
      expect(read).toHaveBeenCalledTimes(3);
      b();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(read).toHaveBeenCalledTimes(3);
    } finally { error.mockRestore(); vi.useRealTimers(); }
  });
});
