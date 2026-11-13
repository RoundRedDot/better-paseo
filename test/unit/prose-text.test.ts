/**
 * Prose on iOS goes through the host's UITextView pair, so a long press puts
 * down a cursor and handles instead of one "Copy" for the whole run. Web and
 * Android keep `<Text selectable>`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockOS = globalThis as { __rnMockOS?: string };

async function load(hasNativePair: boolean) {
  vi.resetModules();
  vi.doMock("react-native", async () => {
    const rn = await import("./helpers/rn-mock");
    return { ...rn, UIManager: { hasViewManagerConfig: (name: string) => hasNativePair && name === "RNUITextView" } };
  });
  await import("./helpers/quiet-renderer");
  const TestRenderer = (await import("react-test-renderer")).default;
  const { act } = await import("react-test-renderer");
  const prose = await import("../../client/ui/prose-text");
  return { TestRenderer, act, ...prose };
}

afterEach(() => {
  vi.doUnmock("react-native");
  mockOS.__rnMockOS = undefined;
});

type Node = { type: string; props: Record<string, unknown>; children: Node[] | null };

async function render(hasNativePair: boolean, onPress?: () => void) {
  const { TestRenderer, act, ProseText, ProseSpan } = await load(hasNativePair);
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        ProseText,
        { style: { fontSize: 15, lineHeight: 22, color: "#111", marginBottom: 8 } },
        "See ",
        React.createElement(
          ProseSpan,
          { style: { color: "#06c", textDecorationLine: "underline" }, onPress },
          "the ",
          React.createElement(ProseSpan, { style: { fontWeight: "600" } }, "report"),
        ),
        ".",
      ),
    );
  });
  return renderer.toJSON() as unknown as Node;
}

describe("ProseText on iOS", () => {
  it("is one native text view whose runs are flat fragments in source order", async () => {
    const root = await render(true);
    expect(root.type).toBe("RNUITextView");
    expect(root.props.selectable).toBe(true);
    // Layout stays on the root; the fragments carry text attributes only.
    expect(root.props.style).toMatchObject({ marginBottom: 8 });
    const runs = root.children ?? [];
    expect(runs.map((run) => run.type)).toEqual([
      "RNUITextViewChild",
      "RNUITextViewChild",
      "RNUITextViewChild",
      "RNUITextViewChild",
    ]);
    expect(runs.map((run) => run.props.text).join("")).toBe("See the report.");
    for (const run of runs) expect(run.props.style).not.toHaveProperty("marginBottom");
  });

  it("clears the root's fill, which UITextView otherwise paints system black in dark mode", async () => {
    const root = await render(true);
    expect(root.props.style).toMatchObject({ backgroundColor: "transparent", marginBottom: 8 });
  });

  it("keeps a fill the block asks for on the root", async () => {
    const { TestRenderer, act, ProseText } = await load(true);
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(ProseText, { style: { backgroundColor: "#222" } }, "x"));
    });
    expect((renderer.toJSON() as unknown as Node).props.style).toMatchObject({ backgroundColor: "#222" });
  });

  it("lets a nested run inherit its parent's style and press handler", async () => {
    const onPress = vi.fn();
    const root = await render(true, onPress);
    const [, the, report, dot] = root.children ?? [];
    expect(the?.props.style).toMatchObject({ color: "#06c", fontSize: 15, textDecorationLine: "underline" });
    expect(report?.props.style).toMatchObject({ color: "#06c", fontWeight: "semibold" });
    expect(the?.props.onPress).toBe(onPress);
    expect(report?.props.onPress).toBe(onPress);
    expect(dot?.props.onPress).toBeUndefined();
  });

  it("falls back to selectable Text when the host lacks the native pair", async () => {
    const root = await render(false);
    expect(root.type).toBe("Text");
    expect(root.props.selectable).toBe(true);
  });
});

describe("ProseText in a drawer sliding in on iOS", () => {
  async function drawer() {
    const loaded = await load(true);
    const { createBodyScroll } = await import("../../client/details/shell/body-handover");
    const body = createBodyScroll();
    // Each native root instance seen: a new one is a remount.
    const roots = new Set<unknown>();
    let renderer!: ReturnType<typeof loaded.TestRenderer.create>;
    const seen = () => renderer.root.findAll((node) => (node.type as unknown) === "RNUITextView").forEach((node) => roots.add(node));
    const tree = (text: string, color = "#111") => React.createElement(loaded.ProseRedrawContext.Provider, { value: body },
      React.createElement(loaded.ProseText, { style: { fontSize: 15 } },
        "Prompt ", React.createElement(loaded.ProseSpan, { style: { color } }, text)));
    const mount = async (element: React.ReactElement) => {
      await loaded.act(async () => {
        renderer = loaded.TestRenderer.create(element);
      });
      seen();
    };
    return {
      ...loaded, body, tree, mount,
      update: async (element: React.ReactElement) => { await loaded.act(async () => { renderer.update(element); }); seen(); },
      rest: async () => { await loaded.act(async () => { body.redraw(); }); seen(); },
      mounts: () => roots.size,
      text: () => ((renderer.toJSON() as unknown as Node).children ?? []).map((run) => run.props.text).join(""),
    };
  }

  it("keeps text drawn before the slide mounted when the drawer rests", async () => {
    const view = await drawer();
    await view.mount(view.tree("body"));
    view.body.slideIn();
    // The drawer's own renders hand the text new elements with the same runs.
    await view.update(view.tree("body"));
    await view.rest();
    // Mounting it again showed a fresh UITextView, blank for a frame: the body flashed.
    expect(view.mounts()).toBe(1);
    expect(view.text()).toBe("Prompt body");
  });

  it("draws text that changed while sliding again once, at rest", async () => {
    const view = await drawer();
    await view.mount(view.tree("body"));
    view.body.slideIn();
    // Highlighting that lands late: same words, new colour.
    await view.update(view.tree("body", "#06c"));
    expect(view.mounts()).toBe(1);
    await view.rest();
    expect(view.mounts()).toBe(2);
    await view.rest();
    expect(view.mounts()).toBe(2);
    expect(view.text()).toBe("Prompt body");
  });

  it("draws text that first mounted while sliding again at rest", async () => {
    const view = await drawer();
    view.body.slideIn();
    await view.mount(view.tree("late"));
    await view.rest();
    expect(view.mounts()).toBe(2);
  });

  it("leaves text that changes at rest to draw in place", async () => {
    const view = await drawer();
    await view.mount(view.tree("body"));
    view.body.slideIn();
    await view.rest();
    await view.update(view.tree("streamed"));
    await view.rest();
    expect(view.mounts()).toBe(1);
    expect(view.text()).toBe("Prompt streamed");
  });
});

describe("ProseText off iOS", () => {
  it("does not let the Android system font scale the reading size", async () => {
    mockOS.__rnMockOS = "android";
    const root = await render(true);
    expect(root.type).toBe("Text");
    expect(root.props.allowFontScaling).toBe(false);
    // Selection handles otherwise insert the font's top padding and the line drops.
    expect(root.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ includeFontPadding: false, textAlignVertical: "top" })]),
    );
    const nested = (root.children ?? []).filter((child) => typeof child === "object");
    expect(nested[0]?.props.allowFontScaling).toBe(false);
    expect(nested[0]?.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ includeFontPadding: false, textAlignVertical: "top" })]),
    );
  });

  it("is the nested selectable Text it replaced", async () => {
    mockOS.__rnMockOS = "web";
    const root = await render(true);
    expect(root.type).toBe("Text");
    expect(root.props.selectable).toBe(true);
    const nested = (root.children ?? []).filter((child) => typeof child === "object");
    expect(nested.map((child) => child.type)).toEqual(["Text"]);
  });
});

describe("fragmentStyle", () => {
  it("zeroes the view shadow, which the native child draws as a text shadow", async () => {
    const { fragmentStyle } = await load(true);
    // React Native's default view shadow offset is (0, -3): left in, every run
    // draws a ghost copy three points higher.
    expect(fragmentStyle(null, { fontSize: 15 })).toMatchObject({
      shadowColor: "transparent",
      shadowOffset: { width: 0, height: 0 },
      backgroundColor: "transparent",
    });
  });

  it("names every weight the native side draws", async () => {
    const { nativeFontWeight } = await load(true);
    const weights = ["100", "300", "400", "500", "600", "700", "800", "bold", undefined] as const;
    expect(weights.map((weight) => nativeFontWeight(weight))).toEqual([
      "ultraLight",
      "light",
      "normal",
      "medium",
      "semibold",
      "bold",
      "heavy",
      "bold",
      "normal",
    ]);
  });
});
