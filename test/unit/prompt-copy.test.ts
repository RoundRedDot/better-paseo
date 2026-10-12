/**
 * The prompt's Copy is always shown, pointer or touch: it is not a hover
 * reveal.
 */
import { afterEach, expect, it, vi } from "vitest";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  const scope = globalThis as Record<string, unknown>;
  delete scope.__rnMockOS;
  delete scope.document;
  delete scope.window;
  vi.doUnmock("react-native");
  vi.doUnmock("@getpaseo/plugin/client/react-native");
  vi.doUnmock("@getpaseo/plugin/client");
});

it("keeps the prompt's Copy visible and enabled on a hover device, unhovered", async () => {
  vi.resetModules();
  // A desktop browser: a fine pointer that can hover, which is where Copy
  // used to wait for the pointer.
  const scope = globalThis as Record<string, unknown>;
  scope.__rnMockOS = "web";
  scope.document = {};
  scope.window = {
    matchMedia: (query: string) => ({
      matches: query.includes("hover: hover"),
      addEventListener() {},
      removeEventListener() {},
    }),
  };
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
  const { UserMessage } = await import("../../client/components/user-message");
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
  let renderer: ReturnType<typeof TestRenderer.create> | undefined;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(UserMessage, { text: "这个弹出的菜单的阴影太重了", timestamp: new Date(), tokens }),
    );
  });
  const copy = renderer!.root.find(
    (node) => typeof node.type === "string" && node.props.accessibilityLabel === "Copy prompt",
  );
  const raw = copy.props.style;
  const style = StyleSheet.flatten(typeof raw === "function" ? raw({ pressed: false }) : raw) as {
    opacity?: number;
  };
  expect(style.opacity ?? 1).toBe(1);
  expect(copy.props.disabled).toBeFalsy();
  act(() => renderer!.unmount());

  // The host's rewind menu, when the renderer passes one, sits in that row.
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(UserMessage, {
        text: "回退",
        timestamp: new Date(),
        tokens,
        actions: React.createElement("RewindMenuStub", { testID: "rewind" }),
      }),
    );
  });
  expect(renderer!.root.findAll((node) => node.props.testID === "rewind")).toHaveLength(1);
  act(() => renderer!.unmount());
});
