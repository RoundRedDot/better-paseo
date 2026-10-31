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
    expect(await finish(check)).toEqual({ state: "done", source: "git", current, latest, matches: false, checkedAt: expect.any(Number), notes: { status: "unavailable" }, versions: { status: "unavailable" } });
    expect(connect).toHaveBeenCalledOnce();
    expect(fetchVersion.mock.calls[0]?.[0]).toBe("https://plugins.paseo.sh/plugins/roundreddot/better-paseo.json");
    expect(fetchVersion.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(listPlugins).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("selects the marketplace release notes and maps both exact revisions", async () => {
    const connect = vi.fn(async () => ({ listPlugins: async () => plugins, close: async () => {} }) as never);
    const fetchVersion = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("plugins.paseo.sh")) return market();
      return new Response(JSON.stringify({ releases: [
        { hash: current, version: "1.0.1", build: 202610311637, notes: { zh: "- 当前版本", en: "- Installed version" } },
        { hash: latest, version: "1.0.0", build: 202610311557, notes: { zh: "- 修复滚动", en: "- Fix scrolling" } },
      ] }));
    });
    const check = createUpdateCheck({ fetchVersion: fetchVersion as typeof fetch, connect });
    check("check");
    expect(await finish(check)).toMatchObject({ state: "done", matches: false, versions: { status: "available", current: "1.0.1", latest: "1.0.0" }, notes: { status: "available", zh: "- 修复滚动", en: "- Fix scrolling" } });
    expect(String(fetchVersion.mock.calls[1]?.[0])).toBe("https://raw.githubusercontent.com/RoundRedDot/better-paseo-assets/main/releases.json");
    expect(fetchVersion).toHaveBeenCalledTimes(2);
  });

  it("does not invent a version or notes when a revision is missing", async () => {
    const connect = vi.fn(async () => ({ listPlugins: async () => plugins, close: async () => {} }) as never);
    const fetchVersion = (async (url: string | URL | Request) => String(url).includes("plugins.paseo.sh") ? market() : new Response(JSON.stringify({ releases: [{ hash: current, version: "1.0.1", build: 202610311637, notes: { zh: "- 当前", en: "- Installed" } }] }))) as typeof fetch;
    const check = createUpdateCheck({ fetchVersion, connect });
    check("check");
    expect(await finish(check)).toMatchObject({ state: "done", versions: { status: "available", current: "1.0.1", latest: null }, notes: { status: "missing" } });
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

it("starts an automatic check only when enabled, and cancels a pending startup read", async () => {
  const { startAutomaticUpdateCheck } = await import("../../server/update-check");
  for (const enabled of [true, false]) {
    const check = vi.fn(() => ({ state: "idle" as const }));
    startAutomaticUpdateCheck({ read: async () => ({ status: "ready", values: { autoUpdateCheck: enabled } }) }, check);
    await Promise.resolve();
    expect(check).toHaveBeenCalledTimes(enabled ? 1 : 0);
  }
  let resolve!: (value: { status: "ready"; values: { autoUpdateCheck: boolean } }) => void;
  const check = vi.fn(() => ({ state: "idle" as const }));
  const stop = startAutomaticUpdateCheck({ read: () => new Promise((done) => { resolve = done; }) }, check);
  stop();
  resolve({ status: "ready", values: { autoUpdateCheck: true } });
  await Promise.resolve();
  expect(check).not.toHaveBeenCalled();
});

it("recognizes marketplace installations when generating the update result", async () => {
  const installation = { ...plugins[0]!.installation, identity: { ...plugins[0]!.installation.identity, registry: { url: "https://plugins.paseo.sh", id: "roundreddot/better-paseo" } } };
  const connect = vi.fn(async () => ({ listPlugins: async () => [{ id: "better-paseo", installation }], close: async () => {} }) as never);
  const fetchVersion = (async (url: string | URL | Request) => String(url).includes("plugins.paseo.sh") ? market() : new Response("", { status: 404 })) as typeof fetch;
  const check = createUpdateCheck({ fetchVersion, connect });
  check("check");
  expect(await finish(check)).toMatchObject({ state: "done", source: "registry" });
});

it.each([
  ["1.0.1", 202610311637, "1.0.1", 202610311638, true],
  ["1.0.1", 202610311638, "1.0.1", 202610311637, false],
  ["1.0.1", 202610311637, "1.0.1", 202610311637, false],
  ["1.0.1", 202610311637, "1.0.0", 202610311700, false],
  ["1.0.1", 202610311637, "1.1.0", 202610311557, true],
] as const)("compares release %s build %i with %s build %i", async (currentVersion, currentBuild, marketVersion, marketBuild, expected) => {
  const { isNewerVersion } = await import("../../shared/update-check");
  expect(isNewerVersion(currentVersion, marketVersion, currentBuild, marketBuild)).toBe(expected);
});
