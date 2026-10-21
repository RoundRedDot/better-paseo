/**
 * What a streaming table mounts. A chunk updates what it changed in place:
 * no component drawn before is mounted again at the same place, and a table
 * mounts its chrome once, when it first appears. The copy menu's open state
 * (its animations, window size and composer lookups) waits for a selection.
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
  usePaseo: () => ({}),
  useSettings: () => ({ data: undefined, status: "loading" }),
}));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");
const { streamTexts } = await import("./helpers/stream-texts");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tokens = buildThemeTokens({
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ececee", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0",
  accentForeground: "#ffffff", statusSuccess: "#1f8a5b", statusWarning: "#a36a00",
  statusDanger: "#d23c3c",
});

interface Fiber {
  type: unknown;
  key: string | null;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  memoizedState: unknown;
}

function nameOf(fiber: Fiber): string {
  const type = fiber.type as { displayName?: string; name?: string; type?: { name?: string } } | string | null;
  if (typeof type === "string") return type;
  return type?.displayName ?? type?.name ?? type?.type?.name ?? "?";
}

/** Every fiber by its place in the tree: the names and keys (or indexes) down to it. */
function places(renderer: ReturnType<typeof TestRenderer.create>): Map<string, Fiber> {
  const out = new Map<string, Fiber>();
  const walk = (first: Fiber | null, prefix: string) => {
    let index = 0;
    for (let fiber = first; fiber; fiber = fiber.sibling, index++) {
      const place = `${prefix}/${nameOf(fiber)}:${fiber.key ?? index}`;
      out.set(place, fiber);
      walk(fiber.child, place);
    }
  };
  walk((renderer.root as unknown as { _currentFiber(): Fiber })._currentFiber(), "");
  return out;
}

const hasHooks = (fiber: Fiber) => typeof fiber.type !== "string" && fiber.memoizedState !== null;

/** The table fixture's reply, three characters a chunk. */
function chunks(): string[] {
  const reply = streamTexts("table-streaming").find((item) => item.kind === "assistant_message" && item.text.includes("| ---"))!;
  const out: string[] = [];
  for (let end = 3; end < reply.text.length + 3; end += 3) out.push(reply.text.slice(0, end));
  return out;
}

const view = (text: string, streaming: boolean) =>
  React.createElement(MarkdownView, { text, tokens, variant: "document", streaming });

describe("a streaming table mounts", () => {
  it("nothing again that it drew before, and its chrome once per table", () => {
    const texts = chunks();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(view(texts[0]!, true)); });
    let before = places(renderer);
    const remounts: string[] = [];
    const mounted = new Map<string, number>();
    for (const text of texts.slice(1)) {
      act(() => renderer.update(view(text, true)));
      const now = places(renderer);
      for (const [place, fiber] of now) {
        const old = before.get(place);
        if (!hasHooks(fiber)) continue;
        if (old && old !== fiber && old !== fiber.alternate) remounts.push(place);
        if (!old) mounted.set(nameOf(fiber), (mounted.get(nameOf(fiber)) ?? 0) + 1);
      }
      before = now;
    }
    act(() => renderer.unmount());
    expect(remounts).toEqual([]);
    const tables = (texts.at(-1)!.match(/\n\| ---/g) ?? []).length;
    expect(tables).toBeGreaterThan(1);
    expect(mounted.get("MdTable")).toBe(tables);
    expect(mounted.get("TableCopyMenuBody")).toBe(tables);
    // The selection menu's open state is not mounted for a table nobody selected.
    expect(mounted.get("SelectionMenu")).toBeUndefined();
    expect(mounted.get("HScroll")).toBeUndefined();
  });
});
