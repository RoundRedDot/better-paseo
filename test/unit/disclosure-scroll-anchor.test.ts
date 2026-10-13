import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The native timeline is an inverted list: it holds its bottom still, so a
// body opening under a row pushes the row up the screen. The row has to stay
// where it was pressed, and the body open below it.

type ListContextValue = {
  getScrollMetrics(): { offset: number };
  getOutermostParentListRef(): {
    props: { inverted: boolean };
    scrollToOffset(params: { offset: number; animated?: boolean }): void;
  };
};

function listContext(): React.Context<ListContextValue | null> {
  const store = globalThis as { __bcListContext?: React.Context<ListContextValue | null> };
  store.__bcListContext ??= React.createContext<ListContextValue | null>(null);
  return store.__bcListContext;
}

vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  const VirtualizedList = { contextType: listContext() };
  return { ...rn, VirtualizedList, default: { ...rn.default, VirtualizedList } };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));

const pluginRuntime = (sticky: boolean) => async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput,
    copyText: async () => {}, useToast: () => ({ show() {}, error() {} }),
    useRevealedText: (text: string) => text,
    ...(sticky ? { useTimelineStickyHeader: () => null } : {}),
  };
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Loaded = {
  TestRenderer: typeof import("react-test-renderer");
  act: typeof import("react-test-renderer").act;
  tokens: ReturnType<typeof import("../../client/components/theme-tokens").buildThemeTokens>;
  ToolCallout: typeof import("../../client/components/tool-callouts").ToolCallout;
  ReasoningCard: typeof import("../../client/components/reasoning-trace").ReasoningCard;
  createReasoningSegmenter: typeof import("../../client/reasoning/segment").createReasoningSegmenter;
  classifyTool: typeof import("../../client/tools/classify").classifyTool;
  STICKY_SUPPORTED: boolean;
};

async function load(sticky: boolean): Promise<Loaded> {
  vi.resetModules();
  vi.doMock("@getpaseo/plugin/client/react-native", pluginRuntime(sticky));
  await import("./helpers/quiet-renderer");
  const { default: TestRenderer, act } = await import("react-test-renderer");
  const { buildThemeTokens } = await import("../../client/components/theme-tokens");
  const { ToolCallout } = await import("../../client/components/tool-callouts");
  const { ReasoningCard } = await import("../../client/components/reasoning-trace");
  const { createReasoningSegmenter } = await import("../../client/reasoning/segment");
  const { classifyTool } = await import("../../client/tools/classify");
  const { STICKY_SUPPORTED } = await import("../../client/ui/sticky-header");
  const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
    foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
    statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
  current = { TestRenderer, act, tokens, ToolCallout, ReasoningCard, createReasoningSegmenter, classifyTool, STICKY_SUPPORTED };
  return current;
}

/**
 * Renders `card` inside a fake inverted list, presses its row and reports the
 * scroll the press asked for. The row sits at y=500 when pressed and, once the
 * body opens, the list has pushed it up to y=300.
 */
async function pressRow(card: (expanded: boolean, toggle: () => void) => React.ReactElement, sticky = false) {
  const env = await load(sticky);
  const scrollToOffset = vi.fn();
  const list: ListContextValue = {
    getScrollMetrics: () => ({ offset: 1000 }),
    getOutermostParentListRef: () => ({ props: { inverted: true }, scrollToOffset }),
  };
  let rowY = 500;
  function Harness() {
    const [expanded, setExpanded] = React.useState(false);
    return React.createElement(listContext().Provider, { value: list },
      card(expanded, () => setExpanded((open) => !open)));
  }
  let renderer!: ReturnType<typeof env.TestRenderer.create>;
  env.act(() => {
    renderer = env.TestRenderer.create(React.createElement(Harness), {
      createNodeMock: () => ({ measureInWindow: (done: (x: number, y: number) => void) => done(0, rowY) }),
    });
  });
  const row = () => renderer.root.find((node: import("react-test-renderer").ReactTestInstance) =>
    (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "button" && "aria-expanded" in node.props);
  env.act(() => row().props.onPressIn());
  rowY = 300;
  env.act(() => row().props.onPress());
  const expanded = row().props["aria-expanded"];
  env.act(() => renderer.unmount());
  return { env, scrollToOffset, expanded };
}

afterEach(() => {
  vi.doUnmock("@getpaseo/plugin/client/react-native");
});

describe("opening a disclosure row in the native timeline", () => {
  it("scrolls a tool row back to where it was pressed", async () => {
    const { env, scrollToOffset, expanded } = await pressRow((open, toggle) => {
      return React.createElement(ToolCard, { open, toggle });
    });
    expect(env.STICKY_SUPPORTED).toBe(false);
    expect(expanded).toBe(true);
    // Pushed up 200pt; an inverted list's offset grows away from the bottom.
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 1200, animated: false });
  });

  it("keeps the correction when the opened card moves its row into StickyCard", async () => {
    const { env, scrollToOffset, expanded } = await pressRow((open, toggle) => {
      return React.createElement(ToolCard, { open, toggle });
    }, true);
    expect(env.STICKY_SUPPORTED).toBe(true);
    expect(expanded).toBe(true);
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 1200, animated: false });
  });

  it("scrolls a thought row back to where it was pressed", async () => {
    const { scrollToOffset, expanded } = await pressRow((open, toggle) => {
      return React.createElement(ThoughtCard, { open, toggle });
    }, true);
    expect(expanded).toBe(true);
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 1200, animated: false });
  });
});

function ToolCard({ open, toggle }: { open: boolean; toggle(): void }) {
  const env = loaded();
  const data = React.useMemo(() => env.classifyTool({ name: "Bash", status: "completed", detail: {
    type: "shell", command: "ls", output: "a\nb\n",
  } }), [env]);
  return React.createElement(env.ToolCallout, {
    data, tokens: env.tokens, expanded: open, onExpandedChange: () => toggle(),
  });
}

function ThoughtCard({ open, toggle }: { open: boolean; toggle(): void }) {
  const env = loaded();
  const segmentation = React.useMemo(
    () => env.createReasoningSegmenter().update("Checking the list. Then the tests.", { streaming: false }),
    [env],
  );
  return React.createElement(env.ReasoningCard, {
    segmentation, streaming: false, durationMs: 1200, expanded: open, onToggle: toggle,
    tokens: env.tokens, storeKey: "thought:anchor", copyText: "Checking the list. Then the tests.",
  });
}

// The cards render with whichever module graph `load` built last.
let current: Loaded | null = null;
function loaded(): Loaded {
  if (!current) throw new Error("load() first");
  return current;
}
