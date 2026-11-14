import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentUpdateCheck, identifyInstallation, parseAgentDiagnostic } from "../../server/agent-updates";
import { hasAgentUpdate, agentUpdatesRpc } from "../../shared/agent-updates";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const diagnostic = (path: string, version = "codex-cli 1.0.0") => `Codex\n  Resolved path: ${path}\n  Version: ${version}`;
const entry = (provider: string, enabled = true, source = "builtin") => ({ provider, enabled, source, status: "ready" });
async function finish(check: ReturnType<typeof createAgentUpdateCheck>, paseo: Parameters<ReturnType<typeof createAgentUpdateCheck>>[1]) {
  for (let i = 0; i < 40 && check("status", paseo).state === "checking"; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  return agentUpdatesRpc.output.parse(check("status", paseo));
}
function api(entries = [entry("codex")], read = async () => ({ diagnostic: diagnostic("/opt/codex") })) {
  return { providers: { snapshot: vi.fn(async () => ({ entries })), diagnostic: vi.fn(read) } } as unknown as Parameters<ReturnType<typeof createAgentUpdateCheck>>[1];
}
const fetchVersion = vi.fn(async () => new Response(JSON.stringify({ latest: "1.2.0" }))) as unknown as typeof fetch;
const identify = vi.fn(async () => ({ method: "unknown" as const, command: null }));

describe("host-scoped agent checks", () => {
  it("checks only enabled snapshot providers, coalesces calls and reports actual diagnostic binary", async () => {
    const paseo = api([entry("codex"), entry("gemini", false)]);
    const check = createAgentUpdateCheck({ fetchVersion, identify });
    expect(check("status", paseo).state).toBe("idle");
    check("check", paseo); check("check", paseo);
    const result = await finish(check, paseo);
    expect(result.entries).toEqual([expect.objectContaining({ provider: "codex", executable: "/opt/codex", current: "1.0.0", latest: "1.2.0", status: "available", method: "unknown", command: null })]);
    expect(paseo.providers.snapshot).toHaveBeenCalledOnce();
    expect(paseo.providers.diagnostic).toHaveBeenCalledTimes(1);
    expect(hasAgentUpdate(result)).toBe(true);
  });
  it("isolates provider errors and never sends raw diagnostics or credentials to clients", async () => {
    const paseo = api([entry("claude"), entry("codex")]);
    vi.mocked(paseo.providers.diagnostic).mockRejectedValueOnce(new Error("SECRET_API_KEY")).mockResolvedValueOnce({ diagnostic: diagnostic("/custom/codex") } as never);
    const check = createAgentUpdateCheck({ fetchVersion, identify });
    check("check", paseo);
    const result = await finish(check, paseo);
    expect(result.entries.map((row) => row.status)).toEqual(["error", "available"]);
    expect(JSON.stringify(result)).not.toContain("SECRET_API_KEY");
  });
  it("does not map custom providers to built-in release sources", async () => {
    const fetchLatest = vi.fn(fetchVersion);
    const paseo = api([entry("codex", true, "custom")]);
    const check = createAgentUpdateCheck({ fetchVersion: fetchLatest as unknown as typeof fetch, identify });
    check("check", paseo);
    expect((await finish(check, paseo)).entries[0]).toMatchObject({ status: "unknown", latest: null });
    expect(fetchLatest).not.toHaveBeenCalled();
  });
  it("does not mark unknown or newer installed versions as updates", async () => {
    for (const version of ["unknown", "error: probe failed", "codex-cli 2.0.0", "1.2.0-beta.2"]) {
      const paseo = api(undefined, async () => ({ diagnostic: diagnostic("/opt/codex", version) }));
      const check = createAgentUpdateCheck({ fetchVersion, identify });
      check("check", paseo);
      expect(hasAgentUpdate(await finish(check, paseo))).toBe(false);
    }
  });
  it("publishes completed providers before a slow provider finishes", async () => {
    let resolve!: (value: { diagnostic: string }) => void;
    const slow = new Promise<{ diagnostic: string }>((done) => { resolve = done; });
    const paseo = api([entry("claude"), entry("codex")]);
    vi.mocked(paseo.providers.diagnostic).mockReturnValueOnce(slow as never).mockResolvedValueOnce({ diagnostic: diagnostic("/opt/codex") } as never);
    const check = createAgentUpdateCheck({ fetchVersion, identify });
    check("check", paseo);
    for (let i = 0; i < 10 && check("status", paseo).entries.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(check("status", paseo)).toMatchObject({ state: "checking", entries: [expect.objectContaining({ provider: "codex" })] });
    resolve({ diagnostic: diagnostic("/opt/claude", "2.0.0 (Claude Code)") });
    await finish(check, paseo);
  });
  it("reports snapshot failure explicitly and allows manual retry", async () => {
    const paseo = api();
    vi.mocked(paseo.providers.snapshot).mockRejectedValueOnce(new Error("secret"));
    const check = createAgentUpdateCheck({ fetchVersion, identify });
    check("check", paseo);
    expect(await finish(check, paseo)).toMatchObject({ state: "failed", entries: [] });
    check("check", paseo);
    expect((await finish(check, paseo)).state).toBe("done");
  });
  it("automatic status checks respect the 24-hour interval", async () => {
    const paseo = api();
    const check = createAgentUpdateCheck({ fetchVersion, identify });
    check("status", paseo, true);
    await finish(check, paseo);
    check("status", paseo, true);
    expect(paseo.providers.snapshot).toHaveBeenCalledOnce();
  });
});

it("does not guess version or executable from ambiguous diagnostics", () => {
  expect(parseAgentDiagnostic("  PATH matches: /wrong/codex\n  Version: 1.0.0-beta.1")).toEqual({ executable: null, current: null });
  expect(parseAgentDiagnostic("  Resolved path: not found\n  Version: unknown")).toEqual({ executable: null, current: null });
  expect(parseAgentDiagnostic(diagnostic("/one") + "\n  Resolved path: /two").executable).toBeNull();
  expect(parseAgentDiagnostic(diagnostic("/real", "2.1.100 (Claude Code)")).current).toBe("2.1.100");
});

it("does not generate npm commands with the daemon runtime, even when an owning npm exists", async () => {
  const path = await mkdtemp(join(tmpdir(), "better-paseo-agent-update-test-")); directories.push(path);
  const prefix = await realpath(path);
  const packageRoot = join(prefix, "lib/node_modules/@openai/codex");
  const npm = join(prefix, "lib/node_modules/npm/bin");
  await mkdir(packageRoot, { recursive: true }); await mkdir(npm, { recursive: true }); await mkdir(join(prefix, "bin"));
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "@openai/codex" }));
  await writeFile(join(packageRoot, "cli.js"), ""); await writeFile(join(npm, "npm-cli.js"), "");
  const binary = join(prefix, "bin/codex"); await symlink(join(packageRoot, "cli.js"), binary);
  expect(await identifyInstallation(binary, "codex")).toEqual({ method: "npm", command: null });
  expect(await identifyInstallation(binary, "claude")).toEqual({ method: "unknown", command: null });
});

it("keeps the actual version when installation ownership cannot be read", async () => {
  const paseo = api();
  const check = createAgentUpdateCheck({ fetchVersion, identify: async () => { throw new Error("not readable"); } });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ current: "1.0.0", latest: "1.2.0", status: "available", method: "unknown", command: null });
});

it("reports a latest-version failure without discarding the installed binary", async () => {
  const paseo = api();
  const failedFetch = vi.fn(async () => new Response("", { status: 503 }));
  const check = createAgentUpdateCheck({ fetchVersion: failedFetch as unknown as typeof fetch, identify });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ executable: "/opt/codex", current: "1.0.0", latest: null, status: "error" });
});

it("keeps confirmed availability during checking, snapshot failure and per-provider failure until a successful comparison", async () => {
  const paseo = api();
  const check = createAgentUpdateCheck({ fetchVersion, identify });
  check("check", paseo); await finish(check, paseo);
  expect(hasAgentUpdate(check("check", paseo))).toBe(true);
  await finish(check, paseo);
  vi.mocked(paseo.providers.snapshot).mockRejectedValueOnce(new Error("secret"));
  check("check", paseo);
  expect(hasAgentUpdate(await finish(check, paseo))).toBe(true);
  vi.mocked(paseo.providers.diagnostic).mockRejectedValueOnce(new Error("secret"));
  check("check", paseo);
  const failed = await finish(check, paseo);
  expect(failed.entries[0]).toMatchObject({ status: "error", issue: "diagnostic_failed", updateAvailable: true });
  vi.mocked(paseo.providers.diagnostic).mockResolvedValueOnce({ diagnostic: diagnostic("/opt/codex", "codex-cli 1.2.0") } as never);
  check("check", paseo);
  expect(hasAgentUpdate(await finish(check, paseo))).toBe(false);
});

it("uses structured issue codes without transmitting underlying failure details", async () => {
  const cases = [
    { diagnostic: "  Version: 1.0.0", issue: "executable_unknown" },
    { diagnostic: diagnostic("/opt/codex", "unknown"), issue: "version_unknown" },
    { diagnostic: diagnostic("/opt/codex"), issue: "installation_unknown" },
  ];
  for (const item of cases) {
    const paseo = api(undefined, async () => ({ diagnostic: item.diagnostic }));
    const check = createAgentUpdateCheck({ fetchVersion, identify }); check("check", paseo);
    expect((await finish(check, paseo)).entries[0]?.issue).toBe(item.issue);
  }
});

it.each([
  ["omp/18.20.0", "18.20.0"],
  ["omp 16.3.8", "16.3.8"],
  ["oh-my-pi v17.0.0", "17.0.0"],
  ["grok 1.0.77 (abcdef123456)", "1.0.77"],
  ["grok 1.0.77", "1.0.77"],
])("recognizes the verified provider version format %s", (raw, version) => {
  expect(parseAgentDiagnostic(diagnostic("/selected/provider", raw))).toEqual({ executable: "/selected/provider", current: version });
});

it.each([
  "omp/18.20.0-beta.1", "grok 1.0.77-alpha.1 (abcdef123)",
  "Using Node v22.0.0", "grok 1.0.77 (PRIVATE_TOKEN)", "unverified-cli 1.0.77",
])("keeps unsupported, noisy or unverified version output unknown: %s", (raw) => {
  expect(parseAgentDiagnostic(diagnostic("/selected/provider", raw)).current).toBeNull();
});

it("compares actual OMP and Grok diagnostic versions against their official stable dist-tags", async () => {
  const paseo = api([entry("omp"), entry("grok")]);
  vi.mocked(paseo.providers.diagnostic)
    .mockResolvedValueOnce({ diagnostic: diagnostic("/selected/omp", "omp/18.20.0") } as never)
    .mockResolvedValueOnce({ diagnostic: diagnostic("/selected/grok", "grok 1.0.77 (abcdef123456)") } as never);
  const releaseFetch = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify({ latest: String(url).includes("oh-my-pi") ? "18.20.1" : "1.0.78", next: "999.0.0", beta: "1000.0.0" })));
  const check = createAgentUpdateCheck({ fetchVersion: releaseFetch as unknown as typeof fetch, identify });
  check("check", paseo);
  const result = await finish(check, paseo);
  expect(result.entries).toEqual([
    expect.objectContaining({ provider: "omp", executable: "/selected/omp", current: "18.20.0", latest: "18.20.1", updateAvailable: true, method: "unknown", issue: "installation_unknown", command: null }),
    expect.objectContaining({ provider: "grok", executable: "/selected/grok", current: "1.0.77", latest: "1.0.78", updateAvailable: true, method: "unknown", issue: "installation_unknown", command: null }),
  ]);
  expect(releaseFetch.mock.calls.map((args) => args[0])).toEqual([
    "https://registry.npmjs.org/-/package/@oh-my-pi%2fpi-coding-agent/dist-tags",
    "https://registry.npmjs.org/-/package/@xai-official%2fgrok/dist-tags",
  ]);
});

it("does not fall through to another registry or release source when stable tags are invalid", async () => {
  const paseo = api([entry("grok")]);
  const releaseFetch = vi.fn(async () => new Response(JSON.stringify({ latest: "not-a-version", beta: "2.0.0" })));
  const check = createAgentUpdateCheck({ fetchVersion: releaseFetch as unknown as typeof fetch, identify });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ status: "error", issue: "latest_fetch_failed", latest: null, command: null });
  expect(releaseFetch).toHaveBeenCalledOnce();
});
