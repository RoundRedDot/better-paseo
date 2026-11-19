import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createAgentUpdateCheck, customReleasePackage, identifyInstallation, parseAgentDiagnostic, openCodeServerVersion } from "../../server/agent-updates";
import { hasAgentUpdate, agentUpdatesRpc, retainAgentUpdates } from "../../shared/agent-updates";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const diagnostic = (path: string, version = "codex-cli 1.0.0") => `Codex\n  Resolved path: ${path}\n  Version: ${version}`;
const entry = (provider: string, enabled = true, source = "builtin") => ({ provider, enabled, source, status: "ready" });
async function finish(check: ReturnType<typeof createAgentUpdateCheck>, paseo: Parameters<ReturnType<typeof createAgentUpdateCheck>>[1]) {
  for (let i = 0; i < 40 && check("status", paseo).state === "checking"; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  return agentUpdatesRpc.output.parse(check("status", paseo));
}
function api(entries = [entry("codex")], read = async () => ({ diagnostic: diagnostic("/opt/codex") })) {
  return { providers: { snapshot: vi.fn(async () => ({ entries })), diagnostic: vi.fn(read) }, config: { get: vi.fn(async () => ({ config: { providers: {} } })) } } as unknown as Parameters<ReturnType<typeof createAgentUpdateCheck>>[1];
}
const fetchVersion = vi.fn(async () => new Response(JSON.stringify({ latest: "1.2.0" }))) as unknown as typeof fetch;
const identify = vi.fn(async () => ({ method: "unknown" as const, command: null }));

it.each([["gemini", "@google/gemini-cli"], ["claude", "@anthropic-ai/claude-code"]])("verifies an inherited %s installation from its parent package", async (parent, packageName) => {
  const dir = await mkdtemp(join(tmpdir(), "better-paseo-inherited-owner-")); directories.push(dir);
  const root = join(await realpath(dir), "lib/node_modules", packageName);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: packageName, version: "1.0.0" }));
  const executable = join(root, "cli.js"); await writeFile(executable, "");
  const paseo = api([entry("copy", true, "custom")], async () => ({ diagnostic: diagnostic(executable, "1.0.0") }));
  vi.mocked(paseo.config.get).mockResolvedValue({ config: { providers: { copy: { extends: "middle" }, middle: { extends: parent } } } } as never);
  const check = createAgentUpdateCheck({ fetchVersion, identify });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ releasePackage: packageName, status: "available", updateAvailable: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: packageName, version: "0.9.0" }));
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ releasePackage: packageName, status: "reference", updateAvailable: false });
});

it("verifies overridden built-in commands before claiming an update", async () => {
  const dir = await mkdtemp(join(tmpdir(), "better-paseo-override-owner-")); directories.push(dir);
  const root = join(await realpath(dir), "lib/node_modules/@openai/codex");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@openai/codex", version: "1.0.0" }));
  const executable = join(root, "cli.js"); await writeFile(executable, "");
  const paseo = api([entry("codex")], async () => ({ diagnostic: diagnostic(executable) }));
  vi.mocked(paseo.config.get).mockResolvedValue({ config: { providers: { codex: { command: [executable] } } } } as never);
  const check = createAgentUpdateCheck({ fetchVersion, identify });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ status: "available", updateAvailable: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@openai/codex", version: "0.9.0" }));
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ status: "reference", updateAvailable: false, command: null });
});

it("shows a configured parent provider as a reference without claiming a verified update", async () => {
  const paseo = api([entry("copy-one", true, "custom"), entry("copy-two", true, "custom")], async () => ({ diagnostic: diagnostic("/different/wrapper", "1.0.0") }));
  vi.mocked(paseo.config.get).mockResolvedValue({ config: { providers: { "copy-one": { extends: "codex", env: { SECRET: "secret-value" } }, "copy-two": { extends: "copy-one" } } } } as never);
  const check = createAgentUpdateCheck({ fetchVersion, identify, customSource: async () => null });
  check("check", paseo);
  const result = await finish(check, paseo);
  expect(result.entries).toEqual(["copy-one", "copy-two"].map((provider) => expect.objectContaining({ provider, current: "1.0.0", latest: "1.2.0", status: "reference", releasePackage: "@openai/codex", updateAvailable: false, command: null })));
  expect(paseo.config.get).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain("secret-value");
  expect(hasAgentUpdate(result)).toBe(false);
});

it("reports configuration failure without claiming a reference or leaking errors", async () => {
  const paseo = api([entry("custom", true, "custom")]);
  vi.mocked(paseo.config.get).mockRejectedValue(new Error("secret-config"));
  const check = createAgentUpdateCheck({ fetchVersion, identify, customSource: async () => null });
  check("check", paseo);
  const result = await finish(check, paseo);
  expect(result.entries[0]).toMatchObject({ status: "error", issue: "config_failed", latest: null });
  expect(JSON.stringify(result)).not.toContain("secret-config");
});

it("does not infer a release from unsupported or cyclic provider ancestry", async () => {
  const paseo = api([entry("custom", true, "custom")]);
  vi.mocked(paseo.config.get).mockResolvedValue({ config: { providers: { custom: { extends: "next" }, next: { extends: "custom" } } } } as never);
  const fetchLatest = vi.fn(fetchVersion);
  const check = createAgentUpdateCheck({ fetchVersion: fetchLatest as unknown as typeof fetch, identify, customSource: async () => null });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ status: "unknown", latest: null, updateAvailable: false });
  expect(fetchLatest).not.toHaveBeenCalled();
});

it.each([["copy-claude", "claude", "@anthropic-ai%2fclaude-code"], ["copy-omp", "omp", "@oh-my-pi%2fpi-coding-agent"]])("uses the configured parent for %s", async (id, parent, packageName) => {
  const paseo = api([entry(id, true, "custom")]);
  vi.mocked(paseo.config.get).mockResolvedValue({ config: { providers: { [id]: { extends: parent } } } } as never);
  const releaseFetch = vi.fn(fetchVersion);
  const check = createAgentUpdateCheck({ fetchVersion: releaseFetch as unknown as typeof fetch, identify, customSource: async () => null });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ status: "reference", updateAvailable: false });
  expect(String(releaseFetch.mock.calls[0]?.[0])).toContain(packageName);
});

it("clears a prior verified update when only a reference remains", async () => {
  const paseo = api([entry("custom", true, "custom")]);
  vi.mocked(paseo.config.get).mockResolvedValue({ config: { providers: { custom: { extends: "codex" } } } } as never);
  const source = vi.fn(async (): Promise<string | null> => null)
    .mockResolvedValueOnce("@openai/codex").mockResolvedValueOnce(null);
  const check = createAgentUpdateCheck({ fetchVersion, identify, customSource: source });
  check("check", paseo); const previous = await finish(check, paseo);
  expect(hasAgentUpdate(previous)).toBe(true);
  check("check", paseo); const next = await finish(check, paseo);
  expect(next.entries[0]).toMatchObject({ status: "reference", updateAvailable: false });
  expect(hasAgentUpdate(retainAgentUpdates(previous, next))).toBe(false);
});

it("reads a wildcard OpenCode server through its verified loopback registration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "better-paseo-opencode-wildcard-")); directories.push(dir);
  const file = join(dir, "service.json");
  const requests: Array<{ host: string | undefined; auth: string | undefined }> = [];
  const server = createServer((request, response) => {
    requests.push({ host: request.headers.host, auth: request.headers.authorization });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ version: "2.3.1", pid: process.pid }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const selected = `http://0.0.0.0:${address.port}`;
  try {
    await writeFile(file, JSON.stringify({ url: selected, password: "fixture-secret", pid: process.pid, version: "2.3.1" }));
    const paseo = api([entry("opencode")], async () => ({ diagnostic: `OpenCode server: ${selected}` }));
    const check = createAgentUpdateCheck({ fetchVersion: vi.fn(async () => new Response(JSON.stringify({ latest: "2.3.2" }))) as unknown as typeof fetch, identify, serverVersion: (url) => openCodeServerVersion(url, file) });
    check("check", paseo);
    expect((await finish(check, paseo)).entries[0]).toMatchObject({ current: "2.3.1", latest: "2.3.2", status: "available", updateAvailable: true });
    expect(requests).toEqual([{ host: `127.0.0.1:${address.port}`, auth: `Basic ${Buffer.from("opencode:fixture-secret").toString("base64")}` }]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

it("only uses a wildcard server credential for a matching local endpoint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "better-paseo-opencode-wildcard-owner-")); directories.push(dir);
  const file = join(dir, "service.json");
  const probe = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ version: "2.3.1", pid: 123 }), { headers: { "content-type": "application/json" } }));
  const service = { url: "http://127.0.0.1:4096", password: "fixture-secret", pid: 123, version: "2.3.1" };
  await writeFile(file, JSON.stringify(service));
  expect(await openCodeServerVersion("http://0.0.0.0:4096", file, probe as unknown as typeof fetch)).toBe("2.3.1");
  expect(String(probe.mock.calls[0]?.[0])).toBe("http://127.0.0.1:4096/api/info");
  probe.mockClear();
  for (const url of ["http://127.0.0.1:4097", "http://0.0.0.0:4097", "http://remote.example:4096"]) {
    await writeFile(file, JSON.stringify({ ...service, url }));
    expect(await openCodeServerVersion("http://0.0.0.0:4096", file, probe as unknown as typeof fetch)).toBeNull();
  }
  expect(probe).not.toHaveBeenCalled();
});

it("reads the selected authenticated OpenCode service version", async () => {
  const dir = await mkdtemp(join(tmpdir(), "better-paseo-opencode-")); directories.push(dir);
  const file = join(dir, "service.json");
  await writeFile(file, JSON.stringify({ url: "http://127.0.0.1:49374", password: "test-secret", pid: 123, version: "2.2.6" }));
  const probe = vi.fn(async () => new Response(JSON.stringify({ version: "2.2.6", pid: 123 }), { headers: { "content-type": "application/json" } }));
  expect(await openCodeServerVersion("http://127.0.0.1:49374", file, probe as unknown as typeof fetch)).toBe("2.2.6");
  expect(await openCodeServerVersion("http://127.0.0.1:49375", file, probe as unknown as typeof fetch)).toBeNull();
  expect(probe).toHaveBeenCalledOnce();
  const changed = vi.fn(async () => new Response(JSON.stringify({ version: "2.2.6", pid: 124 }), { headers: { "content-type": "application/json" } }));
  expect(await openCodeServerVersion("http://127.0.0.1:49374", file, changed as unknown as typeof fetch)).toBeNull();
});

it("does not send local service credentials to remote or redirected endpoints", async () => {
  const dir = await mkdtemp(join(tmpdir(), "better-paseo-opencode-boundaries-")); directories.push(dir);
  const file = join(dir, "service.json");
  await writeFile(file, JSON.stringify({ url: "http://127.0.0.1:49374", password: "test-secret", pid: 123, version: "2.2.6" }));
  const probe = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    expect(options?.redirect).toBe("error");
    return new Response("not json", { headers: { "content-type": "text/plain" } });
  });
  expect(await openCodeServerVersion("http://remote.example:49374", file, probe as typeof fetch)).toBeNull();
  expect(probe).not.toHaveBeenCalled();
  expect(await openCodeServerVersion("http://127.0.0.1:49374", file, probe as typeof fetch)).toBeNull();
  expect(probe).toHaveBeenCalledOnce();
});

it("keeps the remote OpenCode service unknown when the host only supplies its address", async () => {
  const paseo = api([entry("opencode")], async () => ({ diagnostic: "OpenCode server: http://remote.example:1234" }));
  const releaseFetch = vi.fn(fetchVersion);
  const check = createAgentUpdateCheck({ fetchVersion: releaseFetch as unknown as typeof fetch, identify });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ current: null, latest: null, status: "unknown", updateAvailable: false });
  expect(releaseFetch).not.toHaveBeenCalled();
});

it("checks the selected OpenCode server independently of a local command override", async () => {
  const paseo = api([entry("opencode")], async () => ({ diagnostic: "OpenCode server: http://127.0.0.1:49374" }));
  vi.mocked(paseo.config.get).mockResolvedValue({ config: { providers: { opencode: { command: ["/custom/opencode"] } } } } as never);
  const check = createAgentUpdateCheck({ fetchVersion: vi.fn(async () => new Response(JSON.stringify({ latest: "2.3.0" }))) as unknown as typeof fetch, identify, serverVersion: async () => "2.2.6" });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ current: "2.2.6", latest: "2.3.0", status: "available", updateAvailable: true });
});

it("compares the server version when the diagnostic only supplies its address", async () => {
  const paseo = api([entry("opencode")], async () => ({ diagnostic: "OpenCode server: http://127.0.0.1:49374" }));
  const serverVersion = vi.fn(async () => "2.2.6");
  const check = createAgentUpdateCheck({ fetchVersion: vi.fn(async () => new Response(JSON.stringify({ latest: "2.3.0" }))) as unknown as typeof fetch, identify, serverVersion });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ current: "2.2.6", latest: "2.3.0", status: "available", issue: "server_installation_unknown" });
  expect(serverVersion).toHaveBeenCalledWith("http://127.0.0.1:49374");
});

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
  ["grok 1.0.77 (abcdef123456) [stable]", "1.0.77"],
  ["opencode v2.2.6", "2.2.6"],
])("recognizes the verified provider version format %s", (raw, version) => {
  expect(parseAgentDiagnostic(diagnostic("/selected/provider", raw))).toEqual({ executable: "/selected/provider", current: version });
});

it.each([
  "omp/18.20.0-beta.1", "grok 1.0.77-alpha.1 (abcdef123)",
  "grok 1.0.77 (abcdef123456) [beta]",
  "Using Node v22.0.0", "grok 1.0.77 (PRIVATE_TOKEN)", "unverified-cli 1.0.77",
])("keeps unsupported, noisy or unverified version output unknown: %s", (raw) => {
  expect(parseAgentDiagnostic(diagnostic("/selected/provider", raw)).current).toBeNull();
});

it("recognizes only verified custom binaries and absolute wrappers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "better-paseo-release-source-")); directories.push(dir);
  const home = await realpath(dir);
  const root = join(home, "lib/node_modules/@openai/codex");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@openai/codex", version: "1.0.0" }));
  await writeFile(join(root, "codex.js"), "");
  const codex = join(home, "codex"); await symlink(join(root, "codex.js"), codex);
  const wrapper = join(home, "codex-newapi");
  await writeFile(wrapper, `#!/bin/sh\nset -eu\nexport EXAMPLE=1\nexec "${codex}" "$@"\n`);
  expect(await customReleasePackage("codex-newapi", wrapper, "1.0.0", home)).toBe("@openai/codex");
  expect(await customReleasePackage("codex-newapi", wrapper, "1.0.1", home)).toBeNull();
  expect(await customReleasePackage("custom-provider", wrapper, "1.0.0", home)).toBe("@openai/codex");
  await writeFile(wrapper, `#!/bin/sh\nPATH=/other\nexec "${codex}" "$@"\n`);
  expect(await customReleasePackage("codex-newapi", wrapper, "1.0.0", home)).toBeNull();
  await writeFile(wrapper, "#!/bin/sh\nexec codex \"$@\"\n");
  expect(await customReleasePackage("codex-newapi", wrapper, "1.0.0", home)).toBeNull();
  const bridgeRoot = join(home, "lib/node_modules/agy-acp-bridge");
  await mkdir(bridgeRoot, { recursive: true });
  await writeFile(join(bridgeRoot, "package.json"), JSON.stringify({ name: "agy-acp-bridge", version: "0.3.4" }));
  await writeFile(join(bridgeRoot, "index.js"), "");
  const bridge = join(home, "agy-acp-bridge"); await symlink(join(bridgeRoot, "index.js"), bridge);
  await writeFile(wrapper, `#!/bin/sh\nset -eu\nexec "${bridge}" "$@"\n`);
  expect(await customReleasePackage("antigravity", wrapper, "0.3.4", home)).toBe("agy-acp-bridge");
  await writeFile(wrapper, "#!/bin/sh\nexec agy-acp-bridge \"$@\"\n");
  expect(await customReleasePackage("antigravity", wrapper, "0.3.4", home)).toBeNull();
  const downloads = join(home, ".grok/downloads"); await mkdir(downloads, { recursive: true });
  const grok = join(downloads, "grok-1.0.77-macos-aarch64"); await writeFile(grok, "");
  expect(await customReleasePackage("grok", grok, "1.0.77", home)).toBe("@xai-official/grok");
  expect(await customReleasePackage("grok", grok, "1.0.78", home)).toBeNull();
  const grokRoot = join(home, "lib/node_modules/@xai-official/grok");
  await mkdir(grokRoot, { recursive: true });
  await writeFile(join(grokRoot, "package.json"), JSON.stringify({ name: "@xai-official/grok", version: "1.0.77" }));
  await writeFile(join(grokRoot, "index.js"), "");
  expect(await customReleasePackage("grok", join(grokRoot, "index.js"), "1.0.77", home)).toBe("@xai-official/grok");
});

it("compares custom providers only after release ownership is verified", async () => {
  const paseo = api([entry("grok", true, "custom")], async () => ({ diagnostic: diagnostic("/selected/grok", "grok 1.0.77 (abcdef123456) [stable]") }));
  const customSource = vi.fn(async () => "@xai-official/grok");
  const check = createAgentUpdateCheck({ fetchVersion, identify, customSource });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ provider: "grok", current: "1.0.77", latest: "1.2.0", releasePackage: "@xai-official/grok", status: "available" });
  expect(customSource).toHaveBeenCalledWith("grok", "/selected/grok", "1.0.77", expect.any(String), undefined, null);
});

it("uses a daemon-verified wrapper target to identify a custom release source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "better-paseo-wrapper-owner-")); directories.push(dir);
  const root = join(await realpath(dir), "lib/node_modules/agy-acp-bridge");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "agy-acp-bridge", version: "0.3.4" }));
  const target = join(root, "index.js"); await writeFile(target, "");
  const wrapper = join(dir, "wrapper"); await writeFile(wrapper, '#!/bin/sh\nexec agy-acp-bridge "$@"\n');
  const paseo = api([entry("antigravity", true, "custom")], async () => ({ diagnostic: `Antigravity\n  Resolved path: ${wrapper}\n  Wrapper target: ${target}\n  Version: 0.3.4` }));
  const check = createAgentUpdateCheck({ fetchVersion, identify });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ current: "0.3.4", releasePackage: "agy-acp-bridge", latest: "1.2.0", status: "available" });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "agy-acp-bridge", version: "0.3.5" }));
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ releasePackage: null, latest: null, status: "unknown" });
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

it("compares the selected OpenCode server version against the v2 release source", async () => {
  const paseo = api([entry("opencode")], async () => ({ diagnostic: "OpenCode server: http://127.0.0.1:1234\n  Version: 2.2.6" }));
  const releaseFetch = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ latest: "2.3.0" })));
  const check = createAgentUpdateCheck({ fetchVersion: releaseFetch as unknown as typeof fetch, identify });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ current: "2.2.6", latest: "2.3.0", releasePackage: "@opencode/cli", updateAvailable: true, executable: null, issue: "server_installation_unknown" });
  expect(releaseFetch.mock.calls[0]?.[0]).toContain("@opencode%2fcli");
});

it("does not use a v1 release source when the OpenCode version is unknown", async () => {
  const paseo = api([entry("opencode")], async () => ({ diagnostic: "OpenCode server: http://127.0.0.1:1234" }));
  const releaseFetch = vi.fn(fetchVersion);
  const check = createAgentUpdateCheck({ fetchVersion: releaseFetch as unknown as typeof fetch, identify });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ current: null, latest: null, issue: "version_unknown" });
  expect(releaseFetch).not.toHaveBeenCalled();
});

it.each([["1.19.5", "opencode-ai"], ["opencode v2.2.6", "@opencode%2fcli"]])("selects the OpenCode release source for %s", async (version, packageName) => {
  const paseo = api([entry("opencode")], async () => ({ diagnostic: diagnostic("/opt/opencode", version) }));
  const releaseFetch = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ latest: "2.3.0" })));
  const check = createAgentUpdateCheck({ fetchVersion: releaseFetch as unknown as typeof fetch, identify });
  check("check", paseo);
  await finish(check, paseo);
  expect(releaseFetch.mock.calls[0]?.[0]).toContain(packageName);
});

it("does not fall through to another registry or release source when stable tags are invalid", async () => {
  const paseo = api([entry("grok")]);
  const releaseFetch = vi.fn(async () => new Response(JSON.stringify({ latest: "not-a-version", beta: "2.0.0" })));
  const check = createAgentUpdateCheck({ fetchVersion: releaseFetch as unknown as typeof fetch, identify });
  check("check", paseo);
  expect((await finish(check, paseo)).entries[0]).toMatchObject({ status: "error", issue: "latest_fetch_failed", latest: null, command: null });
  expect(releaseFetch).toHaveBeenCalledOnce();
});
