/**
 * Copy and wrapping on a code block. A block that names a language carries Copy in its
 * header; plain text has no header, so Copy floats over the first line's end
 * instead. A bare block sits in a tool body whose row copies, and an open
 * fence offers nothing until it closes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  const { SyntaxHighlightBlock } = await import("../../client/components/syntax-highlight");
  const tokens = buildThemeTokens({
    surface0: "#0f1115",
    surface1: "#16191f",
    surface2: "#1d2128",
    border: "#2a2f37",
    foreground: "#e6e8eb",
    foregroundMuted: "#9aa1ab",
    accent: "#4f8cff",
    accentForeground: "#ffffff",
    statusSuccess: "#4cb782",
    statusWarning: "#d9a53f",
    statusDanger: "#e5484d",
  });

  /** How many "Copy code" buttons the block draws. */
  function copyButtons(props: Record<string, unknown>): number {
    let renderer: ReturnType<typeof TestRenderer.create> | undefined;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(SyntaxHighlightBlock, { code: "echo hi", tokens, scrollX: true, ...props }),
      );
    });
    const found = renderer!.root.findAll(
      (node) => typeof node.type === "string" && node.props.accessibilityLabel === "Copy code",
    );
    act(() => renderer!.unmount());
    return found.length;
  }

  /** Whether the block scrolls sideways rather than wrapping its lines. */
  function scrollsSideways(props: Record<string, unknown>): boolean {
    let renderer: ReturnType<typeof TestRenderer.create> | undefined;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(SyntaxHighlightBlock, { code: "echo hi", tokens, scrollX: true, ...props }),
      );
    });
    const found = renderer!.root.findAll((node) => node.props.horizontal === true);
    act(() => renderer!.unmount());
    return found.length > 0;
  }
  return { copyButtons, scrollsSideways };
}

afterEach(() => {
  vi.doUnmock("react-native");
  vi.doUnmock("@getpaseo/plugin/client/react-native");
  vi.doUnmock("@getpaseo/plugin/client");
});

describe("code block copy", () => {
  it("offers Copy on a plain-text block, which has no header", async () => {
    const { copyButtons } = await load();
    expect(copyButtons({ language: "plaintext" })).toBe(1);
  });

  it("keeps Copy in the header of a block that names its language", async () => {
    const { copyButtons } = await load();
    expect(copyButtons({ language: "bash" })).toBe(1);
  });

  it("wraps a plain-text block, which has no Wrap toggle, and scrolls a named one", async () => {
    const { scrollsSideways } = await load();
    expect(scrollsSideways({ language: "plaintext" })).toBe(false);
    expect(scrollsSideways({ language: "bash" })).toBe(true);
  });

  it("offers nothing on a bare block or an open fence", async () => {
    const { copyButtons } = await load();
    expect(copyButtons({ language: "plaintext", bare: true })).toBe(0);
    expect(copyButtons({ language: "plaintext", highlight: false })).toBe(0);
  });
});
