/**
 * Unpaced text is drawn in the commit that brings it.
 *
 * The host's `useRevealedText` keeps showing the old text until a passive
 * effect settles it, so a longer text appears one commit late. Paseo's web
 * list follows the bottom in the commit that brings new stream data; a reply
 * that grows a commit later is painted pushed down for a frame, then scrolled
 * back. Here the hook is replaced by one that never catches up (`STALE`):
 * wherever the plugin does not pace the text, the real text must show anyway.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function load(os: "web" | "ios", settleInEffect = false) {
  const revealCalls: Array<{ text: string; phase: string }> = [];
  const reasoningRenders: unknown[] = [];
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
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
      useRevealedText: (text: string, phase: string) => {
        revealCalls.push({ text, phase });
        // The pinned host begins fully revealed, retargets without advancing,
        // and force-renders in a passive effect only when completing a backlog.
        const position = React.useRef({ target: text, revealed: text.length });
        const [, forceRender] = React.useState(0);
        if (position.current.target !== text) {
          position.current = { target: text, revealed: Math.min(position.current.revealed, text.length) };
        }
        React.useEffect(() => {
          if (settleInEffect && phase !== "streaming" && position.current.revealed < position.current.target.length) {
            position.current = { ...position.current, revealed: position.current.target.length };
            forceRender((n) => n + 1);
          }
        }, [text, phase]);
        return settleInEffect ? position.current.target.slice(0, position.current.revealed) : "STALE";
      },
    };
  });
  vi.doMock("@getpaseo/plugin/client", () => ({
    useAgent: () => undefined,
    useWorkspace: () => undefined,
    useRpc: () => () => Promise.resolve(null),
    usePaseo: () => ({ agents: { ref: () => ({ refresh: () => Promise.resolve(null) }) } }),
    useSettings: () => ({ data: undefined, status: "loading" }),
  }));
  vi.doMock("../../client/components/reasoning-trace", async () => {
    const actual = await vi.importActual<typeof import("../../client/components/reasoning-trace")>("../../client/components/reasoning-trace");
    return { ...actual, ReasoningCard: (props: React.ComponentProps<typeof actual.ReasoningCard>) => {
      reasoningRenders.push(props);
      return React.createElement(actual.ReasoningCard, props);
    } };
  });
  await import("./helpers/quiet-renderer");
  const TestRenderer = (await import("react-test-renderer")).default;
  const { act } = await import("react-test-renderer");
  const renderers = await import("../../client/live-renderers");
  return { TestRenderer, act, renderers, revealCalls, reasoningRenders };
}

const theme = {
  colors: {
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
  },
};

async function renderedText(
  os: "web" | "ios",
  kind: "assistant" | "reasoning",
  text: string,
): Promise<string> {
  const { TestRenderer, act, renderers } = await load(os);
  const Component =
    kind === "assistant" ? renderers.LiveAssistantRenderer : renderers.LiveReasoningRenderer;
  const props = {
    agentId: `agent-${os}-${kind}`,
    theme,
    host: { id: "h", label: "h" },
    layout: { compact: os !== "web", platform: os },
    timestamp: new Date(1_000),
    item: { type: "plugin", kind, version: 1, data: { text, phase: "streaming" } },
  } as never;
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Component, props));
  });
  const out = JSON.stringify(renderer.toJSON());
  await act(async () => renderer.unmount());
  return out;
}

afterEach(() => {
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("reveal and the commit that brings the text", () => {
  it.each(["ios", "web"] as const)("does not redraw a collapsed %s card for reveal settlement and opens its current text whole", async (os) => {
    const { TestRenderer, act, renderers, revealCalls, reasoningRenders } = await load(os, true);
    const props = (text: string) => ({
      agentId: `collapsed-reveal-${os}`, theme, host: { id: "h", label: "h" },
      layout: { compact: os !== "web", platform: os }, timestamp: new Date(1000),
      item: { type: "plugin", kind: "omp-reasoning", version: 1, data: { text, phase: "streaming" } },
    } as never);
    const first = "The first sentence is complete. ";
    const latest = `${first}The newest sentence has arrived.`;
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(renderers.LiveReasoningRenderer, props(first))); });
    try {
      revealCalls.length = 0;
      reasoningRenders.length = 0;
      await act(async () => { renderer.update(React.createElement(renderers.LiveReasoningRenderer, props(latest))); });
      expect(JSON.stringify(renderer.toJSON())).toContain("The newest sentence has arrived.");
      expect(reasoningRenders).toHaveLength(1);
      const header = renderer.root.findAll((node) => node.props.accessibilityLabel === "Thinking: The newest sentence has arrived." && typeof node.props.onPress === "function")[0]!;
      await act(async () => { header.props.onPress(); });
      expect(revealCalls.some((call) => call.text === latest && call.phase === "streaming")).toBe(true);
      expect(JSON.stringify(renderer.toJSON())).toContain("The first sentence is complete.");
      const copy = renderer.root.findAll((node) => node.props.label === "Copy thought" && typeof node.props.text === "function")[0]!;
      expect(copy.props.text()).toBe(latest);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it("draws a streaming reply on web as it arrived", async () => {
    const out = await renderedText("web", "assistant", "Fresh words from the stream");
    expect(out).toContain("Fresh words from the stream");
    expect(out).not.toContain("STALE");
  });

  it("still paces a streaming reply on iOS", async () => {
    const out = await renderedText("ios", "assistant", "Fresh words from the stream");
    expect(out).toContain("STALE");
  });

  it("previews a collapsed, streaming thought as it arrived", async () => {
    const out = await renderedText("web", "reasoning", "**Planning the fix**\n\nReading turn-state.ts first.");
    expect(out).toContain("Planning");
    expect(out).not.toContain("STALE");
  });
});
