import { describe, expect, it } from "vitest";
import { leastPrivilegeModeId } from "../../server/helper-mode";

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
};

describe("least privilege helper mode", () => {
  it.each([
    ["claude", "plan"],
    ["codex", "auto"],
    ["omp", "ask"],
    ["antigravity", "default"],
  ] as const)("picks %s → %s", (provider, expected) => {
    expect(leastPrivilegeModeId(provider, MODES[provider])).toBe(expected);
  });

  it("uses Claude plan mode even when the list carries no tiers", () => {
    expect(leastPrivilegeModeId("claude", [{ id: "default" }, { id: "plan" }])).toBe("plan");
  });

  it("prefers a read-only mode wherever it is listed", () => {
    expect(leastPrivilegeModeId("codex", [
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

  it("returns nothing when the provider has no modes", () => {
    expect(leastPrivilegeModeId("grok", [])).toBeUndefined();
    expect(leastPrivilegeModeId("grok", undefined)).toBeUndefined();
  });
});
