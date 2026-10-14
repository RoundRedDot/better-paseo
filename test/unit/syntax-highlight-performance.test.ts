import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => {}) }));

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => rpc.call,
}));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: rn.View,
    copyText: clipboard.copyText,
    useToast: () => ({ show: vi.fn(), error: vi.fn() }),
  };
});

import { buildThemeTokens } from "../../client/components/theme-tokens";
import {
  LARGE_BLOCK_LINES,
  SyntaxHighlightBlock,
  lineNumberWidth,
  maxLineNumber,
} from "../../client/components/syntax-highlight";
import {
  disablePerf,
  enablePerf,
  perfSnapshot,
  resetPerf,
} from "../../client/debug/perf";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function counter(name: string): number {
  return perfSnapshot().counters[name] ?? 0;
}

function styleObject(style: unknown): Record<string, unknown> {
  if (!Array.isArray(style)) return (style ?? {}) as Record<string, unknown>;
  return Object.assign({}, ...style.map((item) => (item ?? {}) as object));
}

function lineNumberNodes(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (node) =>
      (node.type as unknown) === "Text" &&
      Array.isArray(node.props.style) &&
      node.props.style.some(
        (part: unknown) =>
          typeof part === "object" && part !== null && "textAlign" in part && part.textAlign === "right",
      ),
  );
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (value && typeof value === "object" && "children" in value) {
    return textContent((value as { children: unknown }).children);
  }
  return "";
}

async function render(
  code: string,
  props: Partial<React.ComponentProps<typeof SyntaxHighlightBlock>> = {},
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(SyntaxHighlightBlock, {
        code,
        tokens,
        ...props,
      }),
    );
  });
  return renderer;
}

afterEach(() => {
  disablePerf();
  resetPerf();
  rpc.call.mockReset();
  rpc.call.mockImplementation(() => Promise.resolve(null));
  clipboard.copyText.mockClear();
});

describe("maxLineNumber", () => {
  it("matches Math.max null and empty-array gutter semantics", () => {
    expect(maxLineNumber([])).toBe(Number.NEGATIVE_INFINITY);
    expect(lineNumberWidth(maxLineNumber([]), tokens.typography.mono.size)).toBe(
      lineNumberWidth(1, tokens.typography.mono.size),
    );
    expect(maxLineNumber([null, 4, null, 27])).toBe(27);
    expect(maxLineNumber([null, null])).toBe(0);
    expect(maxLineNumber([4, 27, 3])).toBe(27);
  });

  it("handles a numbers array far beyond the visible-row limit", () => {
    expect(500_000).toBeGreaterThan(LARGE_BLOCK_LINES);
    const numbers: Array<number | null> = Array(500_000).fill(null);
    numbers[499_999] = 500_000;
    expect(() => maxLineNumber(numbers)).not.toThrow();
    expect(maxLineNumber(numbers)).toBe(500_000);
  });
});

describe("SyntaxHighlightBlock line numbers and gutter", () => {
  it("keeps the non-diff total path and its line numbers", async () => {
    const code = "one\ntwo\nthree";
    const renderer = await render(code, { language: "typescript", showLineNumbers: true });
    const numbers = lineNumberNodes(renderer);
    expect(numbers.map((node) => node.props.children)).toEqual([1, 2, 3]);
    expect(numbers.map((node) => styleObject(node.props.style).width)).toEqual([
      lineNumberWidth(3, tokens.typography.mono.size),
      lineNumberWidth(3, tokens.typography.mono.size),
      lineNumberWidth(3, tokens.typography.mono.size),
    ]);
    act(() => renderer.unmount());
  });

  it("draws null entries blank and sizes the gutter to the largest diff line", async () => {
    const code = "@@ -4,2 +8,2 @@\n-old\n+new\n keep\n\\ No newline at end of file";
    const renderer = await render(code, { language: "diff", showLineNumbers: true });
    const numbers = lineNumberNodes(renderer);
    expect(numbers.map((node) => node.props.children)).toEqual(["", 4, 8, 9, ""]);
    expect(numbers.map((node) => styleObject(node.props.style).width)).toEqual(
      Array(5).fill(lineNumberWidth(9, tokens.typography.mono.size)),
    );
    act(() => renderer.unmount());
  });

  it("keeps an all-null diff gutter at the one-digit minimum", async () => {
    const renderer = await render("@@ -0,0 +0,0 @@", {
      language: "diff",
      showLineNumbers: true,
    });
    const numbers = lineNumberNodes(renderer);
    expect(numbers.map((node) => node.props.children)).toEqual([""]);
    expect(styleObject(numbers[0]!.props.style).width).toBe(
      lineNumberWidth(0, tokens.typography.mono.size),
    );
    act(() => renderer.unmount());
  });

  it("copies the complete original code string unchanged", async () => {
    const code = "@@ -4,1 +8,1 @@\n-old\n+new";
    const renderer = await render(code, { language: "diff", showLineNumbers: true });
    const copy = renderer.root.findByProps({ accessibilityLabel: "Copy code" });
    await act(async () => {
      (copy.props.onPress as () => void)();
      await Promise.resolve();
    });
    expect(clipboard.copyText).toHaveBeenCalledWith(code);
    act(() => renderer.unmount());
  });

  it("uses local tokenisation after the highlight request fails", async () => {
    rpc.call.mockRejectedValueOnce(new Error("daemon unavailable"));
    const code = "const localFallback = 42;";
    const renderer = await render(code, { language: "typescript" });
    expect(textContent(renderer.toJSON())).toContain(code);
    act(() => renderer.unmount());
  });
});

describe("max line number render counter", () => {
  it("does not recompute for stable numbers and increments once for new code", async () => {
    enablePerf();
    resetPerf();
    const firstCode = "@@ -1,1 +1,1 @@\n-old";
    const renderer = await render(firstCode, {
      language: "diff",
      showLineNumbers: true,
    });
    expect(counter("code.maxLineNumber")).toBe(1);

    await act(async () => {
      renderer.update(
        React.createElement(SyntaxHighlightBlock, {
          code: firstCode,
          tokens,
          language: "diff",
          showLineNumbers: true,
        }),
      );
    });
    expect(counter("code.maxLineNumber")).toBe(1);

    await act(async () => {
      renderer.update(
        React.createElement(SyntaxHighlightBlock, {
          code: "@@ -1,1 +9,1 @@\n-old",
          tokens,
          language: "diff",
          showLineNumbers: true,
        }),
      );
    });
    expect(counter("code.maxLineNumber")).toBe(2);
    act(() => renderer.unmount());
  });

  it("records nothing while probes are disabled", async () => {
    disablePerf();
    resetPerf();
    const renderer = await render("@@ -1,1 +1,1 @@\n-old", {
      language: "diff",
      showLineNumbers: true,
    });
    await act(async () => {
      renderer.update(
        React.createElement(SyntaxHighlightBlock, {
          code: "@@ -1,1 +3,1 @@\n-old",
          tokens,
          language: "diff",
          showLineNumbers: true,
        }),
      );
    });
    expect(counter("code.maxLineNumber")).toBe(0);
    act(() => renderer.unmount());
  });
});
