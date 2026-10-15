/**
 * A streamed chunk redraws only what it changed (the timeline's take on the
 * preview's per-line reuse, `27e5e81`): finished blocks keep their elements,
 * and inside the open tail a list item, a table row or a code line the chunk
 * left alone is not drawn again. What is drawn must be exactly what a fresh
 * mount of the same text draws, at every chunk of every stream fixture.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";

const drawn = { Text: [] as string[] };
vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  const Text = rn.Text as unknown as React.ComponentType<Record<string, unknown>>;
  return {
    ...rn,
    // Every render of a Text is one a native renderer would update.
    Text: function CountedText(props: Record<string, unknown>) {
      drawn.Text.push(textOf(props.children));
      return React.createElement(Text, props);
    },
  };
});
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
const TestRenderer = (await import("react-test-renderer")).default;
const { act } = await import("react-test-renderer");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");
const { fixtureNames, streamTexts } = await import("./helpers/stream-texts");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function textOf(children: unknown): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  if (React.isValidElement(children)) return textOf((children.props as { children?: unknown }).children);
  return "";
}

const tokens = buildThemeTokens({
  surface0: "#ffffff",
  surface1: "#f6f6f7",
  surface2: "#ececee",
  border: "#e2e2e6",
  foreground: "#1b1b1f",
  foregroundMuted: "#6b6b75",
  accent: "#3b6fe0",
  accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b",
  statusWarning: "#a36a00",
  statusDanger: "#d23c3c",
});

type Variant = "document" | "compact";
const view = (text: string, streaming: boolean, variant: Variant = "document") =>
  React.createElement(MarkdownView, { text, tokens, variant, streaming, compact: variant === "compact" });

/** The tree as a native renderer gets it; handlers drop out. */
function snapshot(renderer: ReturnType<typeof TestRenderer.create>): string {
  return JSON.stringify(renderer.toJSON());
}

function fresh(text: string, streaming: boolean, variant: Variant): string {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => { renderer = TestRenderer.create(view(text, streaming, variant)); });
  const out = snapshot(renderer);
  act(() => renderer.unmount());
  return out;
}

/** The Texts one chunk draws, after `before` was drawn. */
function textsDrawn(before: string, after: string): string[] {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => { renderer = TestRenderer.create(view(before, true)); });
  drawn.Text.length = 0;
  act(() => renderer.update(view(after, true)));
  const out = [...drawn.Text];
  act(() => renderer.unmount());
  return out;
}

describe("a streamed chunk draws what a fresh mount draws", () => {
  for (const variant of ["document", "compact"] as const) {
    it(`${variant}: every chunk of every fixture`, () => {
      let chunks = 0;
      for (const fixture of fixtureNames()) {
        for (const item of streamTexts(fixture)) {
          if (item.text.trim() === "") continue;
          let renderer: ReturnType<typeof TestRenderer.create> | undefined;
          let text = "";
          for (const delta of item.deltas) {
            text += delta;
            act(() => {
              if (renderer) renderer.update(view(text, true, variant));
              else renderer = TestRenderer.create(view(text, true, variant));
            });
            chunks += 1;
            expect(snapshot(renderer!), `${fixture}#${item.index} at ${text.length}`).toBe(fresh(text, true, variant));
          }
          act(() => renderer!.update(view(item.text, false, variant)));
          expect(snapshot(renderer!), `${fixture}#${item.index} settled`).toBe(fresh(item.text, false, variant));
          act(() => renderer!.unmount());
        }
      }
      expect(chunks).toBeGreaterThan(1000);
    }, 300_000);
  }
});

/** Shapes the fixtures do not hold, each one able to change a part drawn before. */
const STRESS = [
  "# Plan",
  "",
  "1. one",
  "2. two",
  "3. three",
  "4. four",
  "5. five",
  "6. six",
  "7. seven",
  "8. eight",
  "9. nine",
  "10. ten widens the number column",
  "",
  "- [ ] open task",
  "- [x] done task",
  "  - nested **bold** item",
  "    ```ts",
  "    const inner = `<div>${x}</div>`;",
  "    ```",
  "  - another nested `code` item",
  "",
  "- tight item becomes",
  "",
  "- loose when a blank line arrives",
  "",
  "> quoted first paragraph",
  ">",
  "> quoted second paragraph with [a link](https://example.com)",
  "> - quoted list item",
  "",
  "| item | count |",
  "| --- | --- |",
  "| apples | 12 |",
  "| pears | 7 |",
  "| plums | many |",
  "",
  "```ts",
  "const a = 1;",
  "const html = `",
  "<section>",
  "  <p>hi</p>",
  "</section>`;",
  "const b = 2;",
  "```",
  "",
  "```diff",
  "@@ -1,2 +1,2 @@",
  "-old line",
  "+new line",
  " same line",
  "```",
  "",
  "Closing words with *emphasis* and a trailing `span`.",
].join("\n");

describe("a stress document streamed a character at a time and in uneven chunks", () => {
  const chunkings = { characters: () => 1, uneven: (step: number) => (step % 13) + 1 };
  for (const variant of ["document", "compact"] as const) for (const [name, next] of Object.entries(chunkings)) {
    it(`${variant}, ${name}: draws what a fresh mount draws at every chunk`, () => {
      let renderer!: ReturnType<typeof TestRenderer.create>;
      act(() => { renderer = TestRenderer.create(view("", true, variant)); });
      for (let end = 1, step = 1; end <= STRESS.length; step = next(step), end += step) {
        const text = STRESS.slice(0, end);
        act(() => renderer.update(view(text, true, variant)));
        expect(snapshot(renderer), `at ${end}: ${JSON.stringify(text.slice(-30))}`).toBe(fresh(text, true, variant));
      }
      act(() => renderer.update(view(STRESS, false, variant)));
      expect(snapshot(renderer)).toBe(fresh(STRESS, false, variant));
      act(() => renderer.unmount());
    }, 120_000);
  }
});

describe("a streamed chunk draws only what it changed", () => {
  it("leaves the finished blocks before the tail alone", () => {
    const before = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n\nFour";
    expect(textsDrawn(before, `${before}th grows`)).toEqual(["Fourth grows"]);
  });

  it("draws the line a chunk extends in an open fence, not the lines above it", () => {
    const before = "```ts\nconst a = 1;\nconst b = 2;\nconst c";
    const texts = textsDrawn(before, `${before} = 3;`);
    expect(texts).toContain("const c = 3;");
    expect(texts).not.toContain("const a = 1;");
    expect(texts).not.toContain("const b = 2;");
  });

  it("draws the list item a chunk extends, not the items above it", () => {
    const before = "- alpha one\n- beta two\n- gamma";
    const texts = textsDrawn(before, `${before} three`);
    expect(texts).toContain("gamma three");
    expect(texts).not.toContain("alpha one");
    expect(texts).not.toContain("beta two");
  });

  it("draws the table row a chunk extends, not the rows above it", () => {
    const before = "| name | role |\n| --- | --- |\n| ada | engineer |\n| alan | resea";
    const texts = textsDrawn(before, `${before}rch`);
    expect(texts).not.toContain("ada");
    expect(texts).not.toContain("name");
    expect(texts).toContain("research");
  });

  it("draws every row again when a column widens", () => {
    const before = "| a | b |\n| --- | --- |\n| x | y |\n| z | w";
    const texts = textsDrawn(before, `${before} that is now much wider than the rest`);
    expect(texts).toContain("x");
  });

  it("draws the whole tail while it holds a link definition", () => {
    // The paragraph's source stays put, but the definition below it says where its link goes.
    const before = "> see [the docs][d]\n>\n> [d]: https://example.com/a";
    expect(textsDrawn(before, `${before}b`).join("|")).toContain("the docs");
  });
});
