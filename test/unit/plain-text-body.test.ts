/**
 * A `plain_text` tool call (a task notification, an ACP or Codex result)
 * carries tool output: its opened body is set in the code face.
 */
import { afterEach, expect, it, vi } from "vitest";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.doUnmock("react-native");
  vi.doUnmock("@getpaseo/plugin/client/react-native");
  vi.doUnmock("@getpaseo/plugin/client");
});

it("draws a plain_text body in the monospace face, marked as code", async () => {
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
  const { StyleSheet } = await import("./helpers/rn-mock");
  const { buildThemeTokens } = await import("../../client/components/theme-tokens");
  const { ToolCallout } = await import("../../client/components/tool-callouts");
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
  const text = "python3 - <<'EOF'\np='client/components/markdown/render/styles.ts'\nEOF";
  const data = classifyTool({
    name: "task_notification",
    status: "completed",
    callId: "plain-1",
    error: null,
    detail: { type: "plain_text", label: "python3 - <<'EOF' …", text },
  });
  let renderer: ReturnType<typeof TestRenderer.create> | undefined;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(ToolCallout, { data, tokens, expanded: true, onExpandedChange: () => {} }),
    );
  });
  const body = renderer!.root.find(
    (node) => (node.type as unknown) === "Text" && node.props.children === text,
  );
  const style = StyleSheet.flatten(body.props.style) as { fontFamily?: string };
  expect(style.fontFamily).toBe(tokens.fontMono);
  expect(body.props.dataSet).toMatchObject({ pmono: "" });
  act(() => renderer!.unmount());
});
