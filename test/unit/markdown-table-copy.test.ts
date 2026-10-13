import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

const { copyText } = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => {}) }));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
    TextInput: rn.TextInput,
    ScrollView: rn.ScrollView,
    Modal: rn.View,
    copyText,
    useToast: () => ({ show() {}, error() {}, success() {} }),
    useRevealedText: (text: string) => text,
  };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
  usePaseo: () => ({}),
  useSettings: () => ({ data: undefined, status: "loading" }),
}));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tokens = buildThemeTokens({
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ececee", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0",
  accentForeground: "#ffffff", statusSuccess: "#1f8a5b", statusWarning: "#a36a00",
  statusDanger: "#d23c3c",
});
let renderer: ReturnType<typeof TestRenderer.create> | undefined;

function render(text: string, streaming = false, variant: "document" | "compact" | "terminal" = "document") {
  act(() => {
    const view = React.createElement(MarkdownView, { text, tokens, variant, streaming });
    if (renderer) renderer.update(view);
    else renderer = TestRenderer.create(view);
  });
  return renderer!;
}

function buttons() {
  return renderer!.root.findAll((node) => String(node.type) === "Pressable"
    && ["Copy", "Copied"].includes(node.props.accessibilityLabel));
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  copyText.mockClear();
});

describe("Markdown table copy", () => {
  it.each(["document", "compact", "terminal"] as const)(
    "%s copies the entire table source with formatting and alignment",
    async (variant) => {
      const source = "| Name | Value |\n| :--- | ---: |\n| **bold** | `a\\|b` |\n| [link](https://example.com) | 42 |\n";
      render(source, false, variant);
      expect(buttons()).toHaveLength(1);
      const button = buttons()[0]!;
      // The copy control precedes the first header text, inside the same cell.
      let cell = button.parent!;
      while (String(cell.type) !== "View") cell = cell.parent!;
      expect(cell.findAll((node) => String(node.type) === "Text")[0]!.children)
        .toEqual(["Name"]);
      expect(cell.children[0]).toBe(button.parent!.parent);
      await act(async () => { button.props.onPress(); });
      expect(copyText).toHaveBeenCalledExactlyOnceWith(source);
      expect(buttons()[0]!.props.accessibilityLabel).toBe("Copied");
    },
  );

  it("copies each table separately, excluding surrounding prose", async () => {
    const first = "| A | B |\n| --- | --- |\n| one | two |\n";
    const second = "| C | D |\n| --- | --- |\n| three | four |\n";
    render(`Before\n\n${first}\nBetween\n\n${second}\nAfter`);
    expect(buttons()).toHaveLength(2);
    await act(async () => { buttons()[0]!.props.onPress(); });
    await act(async () => { buttons()[1]!.props.onPress(); });
    expect(copyText.mock.calls.map(([text]) => text)).toEqual([first.trimEnd(), second.trimEnd()]);
  });

  it("copies the latest rows during streaming and after completion", async () => {
    const header = "| A | B |\n| --- | --- |\n";
    render(header, true);
    await act(async () => { buttons()[0]!.props.onPress(); });
    expect(copyText).toHaveBeenLastCalledWith(header.trimEnd());
    const updated = header + "| one | two |\n";
    render(updated, true);
    await act(async () => { buttons()[0]!.props.onPress(); });
    expect(copyText).toHaveBeenLastCalledWith(updated);
    const completed = updated + "| three | four |\n";
    render(completed);
    await act(async () => { buttons()[0]!.props.onPress(); });
    expect(copyText).toHaveBeenLastCalledWith(completed);
  });
});
