import { describe, expect, it, vi } from "vitest";
import {
  CLAUDE_DISALLOWED_TOOLS,
  codexMcpOverrides,
  helperRestrictionsFor,
  leastPrivilegeModeId,
  resolveHelperRestrictions,
  restrictedHelperConfig,
  runRestrictedHelper,
} from "../../server/helper-restrictions";
import type { PaseoApi } from "../../server/paseo-types";

// Mode lists as Paseo 0.17.3 reports them.
const MODES = {
  claude: [
    { id: "plan", label: "Plan Mode", colorTier: "planning" },
    { id: "default", label: "Always Ask", colorTier: "safe" },
    { id: "acceptEdits", label: "Accept File Edits", colorTier: "moderate" },
    { id: "auto", label: "Auto mode", colorTier: "moderate" },
    { id: "bypassPermissions", label: "Bypass", colorTier: "dangerous" },
  ],
  codex: [
    { id: "auto", label: "Default Permissions", colorTier: "moderate" },
    { id: "auto-review", label: "Auto-review", colorTier: "moderate" },
    { id: "full-access", label: "Full Access", colorTier: "dangerous" },
  ],
  omp: [
    { id: "full", label: "Full Access", colorTier: "dangerous", isUnattended: true },
    { id: "write", label: "Write Approval", colorTier: "moderate" },
    { id: "ask", label: "Always Ask", colorTier: "safe" },
  ],
  antigravity: [
    { id: "default", label: "Default" },
    { id: "accept-edits", label: "Accept edits" },
    { id: "auto", label: "Auto" },
    { id: "plan", label: "Plan" },
    { id: "full-access", label: "Full access", colorTier: "dangerous", isUnattended: true },
  ],
  copilot: [
    { id: "https://agentclientprotocol.com/protocol/session-modes#agent", label: "Agent", colorTier: "moderate" },
    { id: "https://agentclientprotocol.com/protocol/session-modes#plan", label: "Plan", colorTier: "planning" },
    { id: "allow-all", label: "Autopilot", colorTier: "dangerous", isUnattended: true },
  ],
  opencode: [
    { id: "build", label: "Build", colorTier: "moderate" },
    { id: "plan", label: "Plan", colorTier: "planning" },
  ],
  muse: [
    { id: "onRequest", label: "Default", colorTier: "safe" },
    { id: "promptUnmatched", label: "Ask", colorTier: "moderate" },
    { id: "denyUnmatched", label: "Strict", colorTier: "safe" },
    { id: "allowAll", label: "Full access", colorTier: "dangerous", isUnattended: true },
  ],
};

describe("least privilege helper mode", () => {
  it.each([
    ["claude", "plan"],
    ["codex", "auto"],
    ["omp", "ask"],
    ["antigravity", "default"],
    ["copilot", "https://agentclientprotocol.com/protocol/session-modes#plan"],
    ["opencode", "plan"],
    ["muse", "denyUnmatched"],
  ] as const)("picks %s → %s", (provider, expected) => {
    expect(leastPrivilegeModeId(provider, MODES[provider])).toBe(expected);
  });

  it("prefers Goose's chat mode, which runs no tools", () => {
    expect(leastPrivilegeModeId("goose", [{ id: "auto" }, { id: "approve" }, { id: "chat" }])).toBe("chat");
  });

  it("prefers a read-only mode wherever it is listed", () => {
    expect(leastPrivilegeModeId("x", [
      { id: "auto", label: "Default Permissions", colorTier: "moderate" },
      { id: "read-only", label: "Read Only", colorTier: "safe" },
    ])).toBe("read-only");
  });

  it("never picks a dangerous or unattended mode", () => {
    expect(leastPrivilegeModeId("x", [
      { id: "yolo", colorTier: "dangerous" },
      { id: "headless", isUnattended: true },
    ])).toBeUndefined();
  });
});

describe("helper restrictions per provider", () => {
  it("runs Claude in plan mode with every tool denied, no user MCP servers and a sandbox", () => {
    const restrictions = helperRestrictionsFor("claude", MODES.claude);
    expect(restrictions).toEqual({
      supported: true,
      modeId: "plan",
      options: {
        disallowedTools: [...CLAUDE_DISALLOWED_TOOLS],
        extraArgs: { "strict-mcp-config": null },
        sandbox: { enabled: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false },
      },
    });
    for (const tool of ["Bash", "Read", "ToolSearch", "ListAgents", "ReportFindings", "mcp__paseo"]) {
      expect(CLAUDE_DISALLOWED_TOOLS).toContain(tool);
    }
  });

  it("keeps Claude in plan mode when its modes cannot be read", () => {
    expect(helperRestrictionsFor("claude", undefined)).toMatchObject({ supported: true, modeId: "plan" });
  });

  it.each(["codex", "codex-newapi"])("puts %s in the read-only sandbox without approvals and Paseo tools", (provider) => {
    expect(helperRestrictionsFor(provider, MODES.codex)).toEqual({
      supported: true,
      modeId: "auto",
      options: { sandbox_mode: "read-only", approval_policy: "never", web_search: "disabled" },
      mcpServers: { paseo: { type: "stdio", command: "/usr/bin/false", args: [] } },
    });
  });

  it("denies every OpenCode tool without a Paseo placeholder", () => {
    expect(helperRestrictionsFor("opencode", MODES.opencode)).toEqual({ supported: true, modeId: "plan", options: { permission: "deny" } });
  });

  it("runs Muse strict inside its sandbox", () => {
    expect(helperRestrictionsFor("muse", MODES.muse)).toEqual({
      supported: true,
      modeId: "denyUnmatched",
      options: { sandbox: { enabled: true, network: "restricted" } },
    });
  });

  it("replaces Paseo's tools only on providers seen to accept the placeholder", () => {
    expect(helperRestrictionsFor("omp", MODES.omp)).toMatchObject({ modeId: "ask", mcpServers: { paseo: expect.any(Object) } });
    expect(helperRestrictionsFor("antigravity", MODES.antigravity)).toMatchObject({ modeId: "default", mcpServers: { paseo: expect.any(Object) } });
    expect(helperRestrictionsFor("copilot", MODES.copilot)).not.toHaveProperty("mcpServers");
  });

  it("refuses Pi and providers without a safe mode", () => {
    expect(helperRestrictionsFor("pi", [])).toEqual({ supported: false });
    expect(helperRestrictionsFor("grok", [])).toEqual({ supported: false });
    expect(helperRestrictionsFor("x", [{ id: "yolo", colorTier: "dangerous" }])).toEqual({ supported: false });
    expect(helperRestrictionsFor("x", undefined)).toEqual({ supported: false });
  });

  it("reads modes only when the snapshot does not list them", async () => {
    const listModes = vi.fn(async () => ({ error: null, modes: MODES.omp }));
    const paseo = { providers: { listModes } } as unknown as PaseoApi;
    expect(await resolveHelperRestrictions(paseo, "omp", MODES.omp)).toMatchObject({ modeId: "ask" });
    expect(listModes).not.toHaveBeenCalled();
    expect(await resolveHelperRestrictions(paseo, "omp", undefined)).toMatchObject({ modeId: "ask" });
    expect(listModes).toHaveBeenCalledExactlyOnceWith("omp");
    listModes.mockRejectedValueOnce(new Error("offline"));
    expect(await resolveHelperRestrictions(paseo, "omp", undefined)).toEqual({ supported: false });
  });

  it("disables the user's own Codex MCP servers by name and keeps Paseo's placeholder", async () => {
    const paseo = { providers: { listModes: vi.fn() } } as unknown as PaseoApi;
    const toml = [
      'model = "gpt-5.5"',
      "[mcp_servers.github]",
      'command = "docker"',
      'args = ["run", "github-mcp"]',
      "[mcp_servers.github.env]",
      'TOKEN = "secret"',
      '[mcp_servers."notion"]',
      'url = "https://mcp.notion.com/mcp"',
      "  [mcp_servers.pinky] # phone",
      'command = "pinky"',
      "[profiles.fast]",
      'url = "not a server"',
    ].join("\n");
    expect(codexMcpOverrides(toml)).toEqual({
      github: { type: "stdio", command: "/usr/bin/false", args: [] },
      notion: { type: "http", url: "http://127.0.0.1:9/mcp" },
      pinky: { type: "stdio", command: "/usr/bin/false", args: [] },
    });
    const restrictions = await resolveHelperRestrictions(paseo, "codex-newapi", MODES.codex, async () => toml);
    expect(restrictions).toMatchObject({ supported: true, options: { sandbox_mode: "read-only" } });
    expect(Object.keys((restrictions as { mcpServers: object }).mcpServers).sort()).toEqual(["github", "notion", "paseo", "pinky"]);
  });

  it("keeps the Codex restrictions when its config cannot be read", async () => {
    const paseo = { providers: { listModes: vi.fn() } } as unknown as PaseoApi;
    expect(await resolveHelperRestrictions(paseo, "codex", MODES.codex, async () => { throw new Error("EACCES"); }))
      .toEqual(helperRestrictionsFor("codex", MODES.codex));
    const read = vi.fn(async () => "[mcp_servers.github]");
    await resolveHelperRestrictions(paseo, "omp", MODES.omp, read);
    expect(read).not.toHaveBeenCalled();
  });

  it("puts only the fields it has into the agent config", () => {
    expect(restrictedHelperConfig({ supported: true, modeId: "ask" })).toEqual({ modeId: "ask" });
  });
});

describe("restricted helper run", () => {
  function helper(results: Array<{ status: string; pending?: string[] }>) {
    const queue = results.map((entry) => ({
      status: entry.status, error: null, lastMessage: entry.status === "idle" ? "done" : null,
      final: entry.pending ? { pendingPermissions: entry.pending.map((id) => ({ id, name: "bash" })) } : null,
    }));
    return {
      run: vi.fn(async () => queue.shift()!),
      waitForFinish: vi.fn(async () => queue.shift()!),
      respondToPermission: vi.fn(async () => {}),
      refresh: vi.fn(async () => null),
    };
  }

  it("denies each permission request and waits for the turn to end", async () => {
    const fake = helper([{ status: "permission", pending: ["a", "b"] }, { status: "permission", pending: ["c"] }, { status: "idle" }]);
    const result = await runRestrictedHelper(fake as never, "prompt", 5000);
    expect(result).toMatchObject({ status: "idle", lastMessage: "done" });
    expect((fake.respondToPermission.mock.calls as unknown as Array<[{ requestId: string }]>).map(([call]) => call.requestId)).toEqual(["a", "b", "c"]);
    expect(fake.respondToPermission).toHaveBeenCalledWith({ requestId: "a", response: expect.objectContaining({ behavior: "deny" }) });
    expect(fake.waitForFinish).toHaveBeenCalledTimes(2);
  });

  it("stops after repeated requests instead of looping", async () => {
    const fake = helper(Array.from({ length: 20 }, (_, index) => ({ status: "permission", pending: [`p${index}`] })));
    const result = await runRestrictedHelper(fake as never, "prompt", 5000);
    expect(result.status).toBe("permission");
    expect(fake.respondToPermission).toHaveBeenCalledTimes(8);
  });

  it("passes an ordinary turn through untouched", async () => {
    const fake = helper([{ status: "idle" }]);
    expect(await runRestrictedHelper(fake as never, "prompt", 5000)).toMatchObject({ status: "idle" });
    expect(fake.respondToPermission).not.toHaveBeenCalled();
  });
});
