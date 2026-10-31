import { describe, expect, it, vi } from "vitest";
import { createUpdateCheck } from "../../server/update-check";

const current = "1".repeat(40);
const latest = "2".repeat(40);
const market = (commit = latest) => new Response(JSON.stringify({ id: "roundreddot/better-paseo", artifact: { kind: "git", remote: "https://github.com/RoundRedDot/better-paseo.git", commit } }), { status: 200 });
const plugins = [{ id: "better-paseo", installation: { identity: { kind: "git", remote: "https://github.com/RoundRedDot/better-paseo.git" }, currentRevision: current } }];

async function finish(check: ReturnType<typeof createUpdateCheck>) {
  for (let i = 0; i < 20 && check("status").state === "checking"; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  return check("status");
}

describe("market update check", () => {
  it("compares the installed commit to the market pin and coalesces requests", async () => {
    const fetchVersion = vi.fn(async (url: string | URL | Request, _options?: RequestInit) => String(url).includes("plugins.paseo.sh") ? market() : new Response("", { status: 404 }));
    const listPlugins = vi.fn(async () => plugins);
    const close = vi.fn(async () => {});
    const connect = vi.fn(async () => ({ listPlugins, close }) as never);
    const check = createUpdateCheck({ fetchVersion: fetchVersion as typeof fetch, connect });
    expect(check("check")).toEqual({ state: "checking" });
    expect(check("check")).toEqual({ state: "checking" });
    expect(await finish(check)).toEqual({ state: "done", current, latest, matches: false, checkedAt: expect.any(Number), notes: { status: "missing" } });
    expect(connect).toHaveBeenCalledOnce();
    expect(fetchVersion.mock.calls[0]?.[0]).toBe("https://plugins.paseo.sh/plugins/roundreddot/better-paseo.json");
    expect(fetchVersion.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(listPlugins).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("loads only release notes matching the official marketplace commit", async () => {
    const connect = vi.fn(async () => ({ listPlugins: async () => plugins, close: async () => {} }) as never);
    const fetchVersion = vi.fn(async (url: string | URL | Request) => String(url).includes("plugins.paseo.sh")
      ? market()
      : new Response(JSON.stringify({ commit: latest, zh: ["修复滚动"], en: ["Fix scrolling"] })));
    const check = createUpdateCheck({ fetchVersion: fetchVersion as typeof fetch, connect });
    check("check");
    expect(await finish(check)).toMatchObject({ state: "done", notes: { status: "available", zh: ["修复滚动"], en: ["Fix scrolling"] } });
    expect(String(fetchVersion.mock.calls[1]?.[0])).toContain(`/release-notes/${latest}.json`);
    const wrong = createUpdateCheck({ fetchVersion: (async (url: string | URL | Request) => String(url).includes("plugins.paseo.sh")
      ? market() : new Response(JSON.stringify({ commit: current, zh: ["旧版本"], en: ["Old version"] }))) as typeof fetch, connect });
    wrong("check");
    expect(await finish(wrong)).toMatchObject({ state: "done", notes: { status: "unavailable" } });
  });

  it("reports matching revisions and rejects malformed market data", async () => {
    const connect = vi.fn(async () => ({ listPlugins: async () => plugins, close: async () => {} }) as never);
    const same = createUpdateCheck({ fetchVersion: (async (url: string | URL | Request) => String(url).includes("plugins.paseo.sh") ? market(current) : new Response("", { status: 404 })) as typeof fetch, connect });
    same("check");
    expect(await finish(same)).toMatchObject({ state: "done", matches: true });
    const invalid = createUpdateCheck({ fetchVersion: (async () => new Response("{}")) as typeof fetch, connect });
    invalid("check");
    expect(await finish(invalid)).toEqual({ state: "failed" });
  });
  it("does not erase a successful result when closing the daemon connection fails", async () => {
    const connect = vi.fn(async () => ({ listPlugins: async () => plugins, close: async () => { throw new Error("close failed"); } }) as never);
    const fetchVersion = (async (url: string | URL | Request) => String(url).includes("plugins.paseo.sh") ? market() : new Response("", { status: 404 })) as typeof fetch;
    const check = createUpdateCheck({ fetchVersion, connect });
    expect(check("status")).toEqual({ state: "idle" });
    expect(connect).not.toHaveBeenCalled();
    check("check");
    expect(await finish(check)).toMatchObject({ state: "done", current, latest });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(check("status")).toMatchObject({ state: "done", current, latest });
  });

  it("distinguishes local and unsupported installations", async () => {
    const fetchVersion = (async () => market()) as typeof fetch;
    for (const [installation, expected] of [
      [{ identity: { kind: "directory" } }, "local"],
      [{ identity: { kind: "git", remote: "https://github.com/example/other.git" }, currentRevision: current }, "unsupported"],
    ] as const) {
      const connect = vi.fn(async () => ({ listPlugins: async () => [{ id: "better-paseo", installation }], close: async () => {} }) as never);
      const check = createUpdateCheck({ fetchVersion, connect });
      check("check");
      expect(await finish(check)).toEqual({ state: expected });
    }
  });

  it("rejects failed and oversized marketplace responses", async () => {
    const connect = vi.fn(async () => ({ listPlugins: async () => plugins, close: async () => {} }) as never);
    for (const response of [new Response("error", { status: 503 }), new Response("x".repeat(70_000))]) {
      const check = createUpdateCheck({ fetchVersion: (async () => response) as typeof fetch, connect });
      check("check");
      expect(await finish(check)).toEqual({ state: "failed" });
    }
  });

});
