import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
const host = vi.hoisted(() => ({ mounts: vi.fn(), unmounts: vi.fn(), renders: vi.fn() }));
vi.mock("@getpaseo/plugin/client/ui", () => ({
  Markdown: function Markdown(props: { children: string }) {
    expect(typeof props.children).toBe("string");
    expect(Object.keys(props)).toEqual(["children"]);
    host.renders(props.children);
    React.useEffect(() => { host.mounts(); return () => { host.unmounts(); }; }, []);
    return React.createElement("HostMarkdown", props);
  },
}));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: "Icon", TextInput: rn.TextInput, ScrollView: rn.ScrollView,
    copyText: async () => true,
    useToast: () => ({ show() {}, error() {}, success() {} }),
    useRevealedText: (text: string) => text,
  };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));

import { MarkdownView, type MarkdownViewProps } from "../../client/components/markdown/markdown-view";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { resetEnhancerPreferences } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const platform = globalThis as { __rnMockOS?: string };
const tokens = buildThemeTokens({
  surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20",
});
let renderer: ReturnType<typeof TestRenderer.create>;
const view = (text: string, props: Partial<MarkdownViewProps> = {}) =>
  React.createElement(MarkdownView, { text, tokens, variant: "document", ...props });
const render = (text: string, props: Partial<MarkdownViewProps> = {}) => {
  act(() => { renderer = TestRenderer.create(view(text, props)); });
};
const diagrams = () => renderer.root.findAll((node) => String(node.type) === "HostMarkdown");
const source = 'flowchart TD\n A["客户端 Apple 验单"] --> B{"成功？<br/>是或否"}\n B -- 是 --> C[完成]';
const fence = (code = source, language = "mermaid", marker = "```") => `${marker}${language}\n${code}\n${marker}`;

afterEach(() => {
  act(() => renderer?.unmount());
  vi.clearAllMocks();
  delete platform.__rnMockOS;
  resetEnhancerPreferences();
});

describe("host Mermaid diagrams", () => {
  it.each(["web", "ios", "android"])("hands only the diagram source to the host on %s", (os) => {
    platform.__rnMockOS = os;
    render(`# Heading\n\n${fence()}\n\nOther **Markdown**.\n\n\`\`\`ts\nconst x = 1;\n\`\`\``);
    expect(diagrams()).toHaveLength(1);
    expect(diagrams()[0]!.props.children).toBe(fence());
  });

  it.each([
    "flowchart TD\n A --> B",
    "sequenceDiagram\n Alice->>Bob: Hello",
    "stateDiagram-v2\n [*] --> Idle",
    "classDiagram\n Animal <|-- Duck",
    "erDiagram\n CUSTOMER ||--o{ ORDER : places",
    "gantt\n title Plan\n Task :2026-11-06, 1d",
    "pie\n title Shares\n \"A\" : 1",
    "mindmap\n root((Root))\n  Child",
    "timeline\n title History\n 2026 : Release",
    "gitGraph\n commit",
    "journey\n title Day\n section Work\n Code: 5: Me",
  ])("delegates the Mermaid type without a plugin parser: %s", (code) => {
    render(fence(code));
    expect(diagrams()[0]!.props.children).toBe(fence(code));
  });

  it.each(["document", "compact", "terminal"] as const)("renders diagrams in the %s variant", (variant) => {
    render(fence(), { variant });
    expect(diagrams()).toHaveLength(1);
  });

  it.each(["```", "~~~~", "````"])("accepts %s fences with language metadata", (marker) => {
    render(fence(source, 'Mermaid title="Receipt"', marker));
    expect(diagrams()[0]!.props.children).toBe(fence(source, 'Mermaid title="Receipt"', marker));
  });

  it.each(["web", "ios", "android"])("waits for the closing fence on %s", (os) => {
    platform.__rnMockOS = os;
    const open = `\`\`\`mermaid\n${source}`;
    render(open, { streaming: true });
    expect(diagrams()).toHaveLength(0);
    act(() => renderer.update(view(`${open}\n\``, { streaming: true })));
    expect(diagrams()).toHaveLength(0);
    act(() => renderer.update(view(`${open}\n\`\``, { streaming: true })));
    expect(diagrams()).toHaveLength(0);
    act(() => renderer.update(view(fence(), { streaming: true })));
    expect(diagrams()).toHaveLength(1);
  });

  it("renders an unclosed fence when the reply ends", () => {
    const open = `\`\`\`mermaid\n${source}`;
    render(open, { streaming: true });
    act(() => renderer.update(view(open)));
    expect(diagrams()[0]!.props.children).toBe(open);
  });

  it.each(["web", "ios", "android"])("keeps a completed diagram mounted as a reply grows and settles on %s", (os) => {
    platform.__rnMockOS = os;
    render(fence(), { streaming: true });
    const initial = diagrams()[0];
    act(() => renderer.update(view(`${fence()}\n\nFollowing`, { streaming: true })));
    act(() => renderer.update(view(`${fence()}\n\nFollowing paragraph.`, { streaming: true })));
    act(() => renderer.update(view(`${fence()}\n\nFollowing paragraph.`)));
    expect(diagrams()[0]).toBe(initial);
    expect(host.mounts).toHaveBeenCalledTimes(1);
    expect(host.unmounts).not.toHaveBeenCalled();
  });

  it("retains compact folding until the reader expands the code block", () => {
    render(fence(), { variant: "compact", collapseCode: true });
    expect(diagrams()).toHaveLength(0);
    const summary = renderer.root.find((node) => String(node.type) === "Pressable" &&
      node.props.accessibilityLabel === "Show mermaid, 3 lines");
    act(() => summary.props.onPress());
    expect(diagrams()).toHaveLength(1);
  });

  it("keeps custom text rendering in charge of code blocks", () => {
    render(fence(), { renderText: (text) => text });
    expect(diagrams()).toHaveLength(0);
  });

  it.each(["ts", "plantuml", "dot", "drawio", "vega"])("keeps %s code on the existing renderer", (language) => {
    render(fence("A --> B", language));
    expect(diagrams()).toHaveLength(0);
  });

  it("delegates malformed Mermaid source without interpreting it", () => {
    render(fence("flowchart TD\n A[unfinished"));
    expect(diagrams()[0]!.props.children).toBe(fence("flowchart TD\n A[unfinished"));
  });
});
