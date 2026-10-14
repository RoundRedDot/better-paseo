/**
 * Native views per collapsed timeline row (plan §3.2, S7 design spec §4).
 *
 * Every row of a long turn is mounted at once, so what one collapsed row costs
 * is multiplied by the length of the conversation. These tests mount the real
 * components over a host-element `react-native` stand-in and count the views a
 * native renderer would create, on iOS and on web.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
    TextInput: rn.TextInput,
    ScrollView: rn.ScrollView,
    Modal: rn.View,
    copyText: () => Promise.resolve(true),
    useToast: () => ({ show() {}, error() {}, success() {} }),
    useRevealedText: (text: string) => text,
  };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
  usePaseo: () => ({ agents: { ref: () => ({ refresh: () => Promise.resolve(null) }) } }),
  useSettings: () => ({ data: undefined, status: "loading" }),
}));

const { countHostViews } = await import("./helpers/host-count");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { ToolCallout } = await import("../../client/components/tool-callouts");
const { ReasoningCard } = await import("../../client/components/reasoning-trace");
const { classifyTool } = await import("../../client/tools/classify");
const { NoticeCallout } = await import("../../client/components/notice-callout");
const { TaskList } = await import("../../client/components/task-list");

const colors = {
  surface0: "#0f1115",
  surface1: "#16191f",
  surface2: "#1d2128",
  foreground: "#e6e8eb",
  foregroundMuted: "#9aa1ab",
  accent: "#4f8cff",
  accentForeground: "#ffffff",
  statusDanger: "#e5484d",
  border: "#2a2f37",
} as unknown as Parameters<typeof buildThemeTokens>[0];

const tokens = buildThemeTokens(colors);

function call(name: string, detail: Record<string, unknown>, status = "completed", error: string | null = null) {
  return classifyTool({ name, status, detail, callId: `c-${name}-${status}`, error });
}

const bash = call("Bash", { type: "shell", command: "npm test", output: "ok", exitCode: 0, durationMs: 1200 });
const read = call("Read", { type: "read", filePath: "/w/src/a.ts", offset: 10, limit: 71 });
const running = call("Bash", { type: "shell", command: "npm run soak" }, "running");
const failed = call(
  "Bash",
  { type: "shell", command: "npm run check:hermes", output: "hermesc: error: invalid class syntax", exitCode: 1 },
  "failed",
  "hermesc: error: invalid class syntax",
);

function tool(data: ReturnType<typeof classifyTool>, compact: boolean) {
  return React.createElement(ToolCallout, { data, tokens, compact, expanded: false, onExpandedChange: () => {} });
}

/** Budgets the S7 rows are held to: iOS (compact) and web (desktop). */
const BUDGET = {
  stringTarget: 6,
  pathTarget: 8,
  failed: 7,
  reasoning: 6,
  notice: 5,
  /**
   * Four tasks: the header row and four task rows; the ring is a quarter full.
   * The header's window button (its slot, press and icon) adds three.
   */
  tasks: 30,
} as const;

describe("collapsed row view budget", () => {
  const cases: Array<[string, () => React.ReactElement, number]> = [
    ["tool, string target (bash)", () => tool(bash, true), BUDGET.stringTarget],
    ["tool, path target (read)", () => tool(read, true), BUDGET.pathTarget],
    ["tool, running", () => tool(running, true), BUDGET.stringTarget],
    ["tool, failed with error line", () => tool(failed, true), BUDGET.failed],
    [
      "reasoning, done",
      () =>
        React.createElement(ReasoningCard, {
          segmentation: { kind: "sections", sections: [{ title: "Check", body: "x" }], steps: 1 },
          streaming: false,
          durationMs: 8000,
          expanded: false,
          onToggle: () => {},
          tokens,
          compact: true,
          storeKey: "budget",
          copyText: "x",
        }),
      BUDGET.reasoning,
    ],
    [
      "notice, warning",
      () =>
        React.createElement(NoticeCallout, {
          data: { id: "n", level: "warning", message: "The daemon restarted twice in 30s." },
          tokens,
        }),
      BUDGET.notice,
    ],
    [
      "task list, four tasks",
      () =>
        React.createElement(TaskList, {
          data: {
            id: "t",
            phaseName: "Checklist Progress",
            tasks: [
              { id: "1", title: "Rename plugin", phase: "x", status: "completed" },
              { id: "2", title: "Build the showcase", phase: "x", status: "in_progress" },
              { id: "3", title: "Capture every component", phase: "x", status: "pending" },
              { id: "4", title: "Open the file editor", phase: "x", status: "blocked" },
            ],
          },
          tokens,
        }),
      BUDGET.tasks,
    ],
  ];

  for (const [name, element, budget] of cases) {
    it(`${name}: within ${budget} views on iOS and web`, () => {
      const ios = countHostViews(element(), "ios");
      const web = countHostViews(element(), "web");
      // Printed so the evidence can quote the measured numbers.
      console.log(`[render-budget] ${name}: ios ${ios.views} (depth ${ios.depth}) web ${web.views} (depth ${web.depth})`, JSON.stringify(ios.byType));
      expect(ios.views).toBeLessThanOrEqual(budget);
      expect(web.views).toBeLessThanOrEqual(budget + 1);
    });
  }
});
