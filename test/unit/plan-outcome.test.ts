/**
 * A plan's verdict (approved, rejected, canceled) is what the host's own plan
 * card titles itself with. The row says it among its meta; the opened body and
 * its preview, which show no row, lead with the host's title.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.doUnmock("react-native");
  vi.doUnmock("@getpaseo/plugin/client/react-native");
  vi.doUnmock("@getpaseo/plugin/client");
});

async function load() {
  vi.resetModules();
  vi.doMock("react-native", () => import("./helpers/rn-mock"));
  vi.doMock("@getpaseo/plugin/client/react-native", async () => {
    const rn = await import("./helpers/rn-mock");
    return {
      Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
      TextInput: rn.TextInput,
      ScrollView: rn.ScrollView,
      FlatList: rn.ScrollView,
      Modal: rn.View,
      copyText: () => Promise.resolve(true),
      useToast: () => ({ show() {}, error() {}, success() {} }),
      useRevealedText: (text: string) => text,
    };
  });
  vi.doMock("@getpaseo/plugin/client", () => ({
    useAgent: () => undefined,
    useWorkspace: () => undefined,
    useRpc: () => () => new Promise(() => {}),
    usePaseo: () => ({}),
    useSettings: () => ({ data: undefined, status: "loading" }),
  }));
  await import("./helpers/quiet-renderer");
  const TestRenderer = (await import("react-test-renderer")).default;
  const { act } = await import("react-test-renderer");
  const { buildThemeTokens } = await import("../../client/components/theme-tokens");
  const { ToolCallout } = await import("../../client/components/tool-callouts");
  const { DisclosureHeader } = await import("../../client/ui/disclosure-header");
  const { classifyTool } = await import("../../client/tools/classify");
  const tokens = buildThemeTokens({
    surface0: "#ffffff",
    surface1: "#f6f6f6",
    surface2: "#eeeeee",
    border: "#dddddd",
    foreground: "#111111",
    foregroundMuted: "#666666",
    accent: "#4f8cff",
    accentForeground: "#ffffff",
    statusSuccess: "#4cb782",
    statusWarning: "#d9a53f",
    statusDanger: "#e5484d",
  });
  return { TestRenderer, act, tokens, ToolCallout, DisclosureHeader, classifyTool };
}

const texts = (renderer: { root: { findAll(predicate: (node: { type: unknown; props: Record<string, unknown> }) => boolean): Array<{ props: Record<string, unknown> }> } }) =>
  renderer.root.findAll((node) => node.type === "Text").map((node) => node.props.children);

describe("plan verdict", () => {
  it.each([
    [{ approved: false }, "rejected", "Rejected plan"],
    [{ status: "canceled" }, "canceled", "Canceled plan"],
    [{ approved: true }, "approved", "Approved plan"],
  ])("%o: the row says %s, the body leads with %s", async (extra, meta, title) => {
    const { TestRenderer, act, tokens, ToolCallout, DisclosureHeader, classifyTool } = await load();
    const data = classifyTool({
      name: "plan_approval",
      status: "completed",
      callId: "plan-1",
      error: null,
      detail: { type: "plan", text: "# Ship it\n1. Build\n2. Test" },
      ...extra,
    });
    let renderer: ReturnType<typeof TestRenderer.create> | undefined;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ToolCallout, { data, tokens, expanded: true, onExpandedChange: () => {} }),
      );
    });
    const header = renderer!.root.findByType(DisclosureHeader);
    expect(header.props.meta).toEqual([meta]);
    expect(header.props.iconIsStatus).toBe(false);
    expect(texts(renderer!)).toContain(title);
    act(() => renderer!.unmount());
  });

  it("adds no title to a plan still waiting for its verdict", async () => {
    const { TestRenderer, act, tokens, ToolCallout, classifyTool } = await load();
    const data = classifyTool({
      name: "ExitPlanMode",
      status: "running",
      callId: "plan-2",
      error: null,
      detail: { type: "plan", text: "# Ship it\n1. Build" },
    });
    let renderer: ReturnType<typeof TestRenderer.create> | undefined;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ToolCallout, { data, tokens, expanded: true, onExpandedChange: () => {} }),
      );
    });
    const shown = texts(renderer!);
    for (const title of ["Rejected plan", "Canceled plan", "Approved plan"]) expect(shown).not.toContain(title);
    act(() => renderer!.unmount());
  });
});
