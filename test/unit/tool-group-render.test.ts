import { describe, expect, it, vi } from "vitest";

// Tool rows sit one step behind the prose at rest and come back to full
// contrast on hover, press or when opened (docs/prototypes/quiet-tool-rows.md).

vi.mock("react-native", async () => import("./helpers/rn-mock"));
const paging = vi.hoisted(() => ({ maximized: false, bind: vi.fn(), release: vi.fn() }));
vi.mock("../../client/web", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../client/web")>(),
  bindPreviewPaging: paging.bind,
}));
vi.mock("../../client/ui/hover-preview", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../client/ui/hover-preview")>(),
  usePreviewPanel: () => ({ maximized: paging.maximized, close() {} }),
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput, copyText: async () => {}, useToast: () => ({ show() {}, error() {} }) };
});

const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { DisclosureHeader } = await import("../../client/ui/disclosure-header");
const React = await import("react");
await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { StyleSheet } = await import("./helpers/rn-mock");
const { ToolCallout, previewCopyActions } = await import("../../client/components/tool-callouts");
const { ToolbarButton, TOOLBAR_TOOLTIP_MS } = await import("../../client/ui/toolbar-button");
const { HoverPreviewHeader } = await import("../../client/ui/hover-preview");
const { updateEnhancerPreferences } = await import("../../client/preferences");
const { classifyTool } = await import("../../client/tools/classify");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;


const tokens = buildThemeTokens({
  surface0: "#fff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
  foreground: "#18181b", foregroundMuted: "#62626b", accent: "#2563eb", accentForeground: "#fff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
});
const calls = ["first", "second"].map((callId, index) => classifyTool({
  callId, name: "Edit", status: index ? "failed" : "completed", error: index ? "Permission denied" : null,
  detail: { type: "edit", filePath: "src/a.ts", unifiedDiff: "@@ -1 +1 @@\n-old\n+" + callId },
}));

describe("grouped tool card presentation", () => {
  it("enables arrow paging only when maximized, keeps pages in range, and releases the binding", () => {
    paging.maximized = false;
    paging.bind.mockReset().mockReturnValue(paging.release);
    paging.release.mockClear();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    let preview!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(ToolCallout, {
      data: calls[0]!, groupCalls: calls, tokens,
    })); });
    const content = renderer.root.findByType(DisclosureHeader).props.previewContent as () => React.ReactElement;
    act(() => { preview = TestRenderer.create(content()); });
    expect(paging.bind).not.toHaveBeenCalled();
    paging.maximized = true;
    act(() => preview.update(content()));
    const step = (direction: -1 | 1) => {
      act(() => paging.bind.mock.calls.at(-1)![1](direction));
    };
    step(-1);
    expect(shown(preview.root)).toEqual(["first"]);
    step(1);
    expect(texts(preview.root)).toContain("2 / 2");
    expect(shown(preview.root)).toEqual(["second"]);
    step(1);
    expect(shown(preview.root)).toEqual(["second"]);
    step(-1);
    expect(shown(preview.root)).toEqual(["first"]);
    const releases = paging.release.mock.calls.length;
    act(() => { preview.unmount(); renderer.unmount(); });
    expect(paging.release).toHaveBeenCalledTimes(releases + 1);
    paging.maximized = false;
  });

  it("shows a circular count, exposes it to accessibility, and pages through the calls", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(ToolCallout, {
      data: calls[0]!, groupCalls: calls, tokens,
    })); });
    const header = renderer.root.findByType(DisclosureHeader);
    expect(header.props.count).toBe(2);
    const badge = renderer.root.findAll((node) => (node.type as unknown) === "Text" && node.props.children === 2)[0]!;
    let parent = badge.parent;
    while (parent && StyleSheet.flatten(parent.props.style).width !== 22) parent = parent.parent;
    expect(parent).not.toBeNull();
    const circle = StyleSheet.flatten(parent!.props.style);
    expect(circle.width).toBe(circle.height);
    expect(circle.borderRadius).toBe(circle.width as number / 2);
    const button = renderer.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel?.includes("2 operations"))[0]!;
    expect(button).toBeDefined();
    expect(renderer.root.findAllByType(ToolCallout)).toHaveLength(1);
    act(() => button.props.onPress());
    // One call at a time, stepped left and right, not stacked.
    expect(renderer.root.findAllByType(ToolCallout)).toHaveLength(1);
    expect(texts(renderer.root)).toContain("1 / 2");
    expect(shown(renderer.root)).toEqual(["first"]);
    const prev = pagerButton(renderer.root, "Previous operation");
    const next = pagerButton(renderer.root, "Next operation");
    expect(prev.props.disabled).toBe(true);
    expect(next.props.disabled).toBe(false);
    act(() => next.props.onPress());
    expect(texts(renderer.root)).toContain("2 / 2");
    expect(shown(renderer.root)).toEqual(["second"]);
    expect(texts(renderer.root)).toContain("Permission denied");
    expect(pagerButton(renderer.root, "Next operation").props.disabled).toBe(true);
    act(() => pagerButton(renderer.root, "Previous operation").props.onPress());
    expect(shown(renderer.root)).toEqual(["first"]);
    act(() => renderer.unmount());
  });

  it("puts the pager in the preview panel's toolbar", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(ToolCallout, {
      data: calls[0]!, groupCalls: calls, tokens,
    })); });
    const previewContent = renderer.root.findByType(DisclosureHeader).props.previewContent as () => React.ReactElement;
    let preview!: ReturnType<typeof TestRenderer.create>;
    act(() => { preview = TestRenderer.create(previewContent()); });
    const toolbar = preview.root.findByProps({ testID: "hover-preview-header" });
    const center = preview.root.findByProps({ testID: "hover-preview-center" });
    const start = preview.root.findByProps({ testID: "hover-preview-start" });
    expect(pagerButton(start, "Previous operation").props.disabled).toBe(true);
    expect(texts(center)).toEqual(["Edit"]);
    expect(center.findByProps({ testID: "hover-preview-icon" })).toBeDefined();
    // The copies of the call on view, once each: no `⋯`, no per-call numbering.
    const copies = () => toolbar.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel?.startsWith("Copy"))
      .map((node) => node.props.accessibilityLabel);
    expect(copies()).toEqual(["Copy path", "Copy patch", "Copy new content"]);
    expect(toolbar.findAll((node) => node.props.accessibilityLabel === "More actions")).toHaveLength(0);
    expect(texts(toolbar)).toContain("1 / 2");
    expect(shown(preview.root)).toEqual(["first"]);
    act(() => pagerButton(toolbar, "Next operation").props.onPress());
    expect(texts(toolbar)).toContain("2 / 2");
    expect(shown(preview.root)).toEqual(["second"]);
    expect(copies()).toEqual(["Copy path", "Copy patch", "Copy new content"]);
    act(() => { preview.unmount(); renderer.unmount(); });
  });

  it("names a toolbar button once a pointer rests on it", () => {
    vi.useFakeTimers();
    try {
      let renderer!: ReturnType<typeof TestRenderer.create>;
      act(() => { renderer = TestRenderer.create(React.createElement(ToolbarButton, {
        icon: "Link", label: "Copy path", onPress() {}, tokens,
      })); });
      const button = renderer.root.find((node) => (node.type as unknown) === "Pressable");
      expect(texts(renderer.root)).not.toContain("Copy path");
      act(() => button.props.onHoverIn());
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
      expect(texts(renderer.root)).toContain("Copy path");
      // Web Views are each a stacking context: the name rises with its button,
      // and sits on an opaque surface so the code under it does not show through.
      const anchor = renderer.root.findAll((node) => (node.type as unknown) === "View")[0]!;
      expect(StyleSheet.flatten(anchor.props.style).zIndex).toBe(1);
      const bubble = renderer.root.findAll((node) => (node.type as unknown) === "View" && StyleSheet.flatten(node.props.style).borderRadius !== undefined
        && StyleSheet.flatten(node.props.style).backgroundColor !== undefined).pop()!;
      expect(StyleSheet.flatten(bubble.props.style).backgroundColor).toBe(tokens.surface0);
      act(() => button.props.onHoverOut());
      expect(texts(renderer.root)).not.toContain("Copy path");
      act(() => renderer.unmount());
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["Read", "Edit", "Write"])("names the %s preview icon only while hovered", (name) => {
    vi.useFakeTimers();
    try {
      const call = classifyTool({ name, status: "completed", detail: { type: name.toLowerCase(), filePath: "/a.ts" } });
      let renderer!: ReturnType<typeof TestRenderer.create>;
      let preview!: ReturnType<typeof TestRenderer.create>;
      act(() => { renderer = TestRenderer.create(React.createElement(ToolCallout, { data: call, tokens })); });
      const content = renderer.root.findByType(DisclosureHeader).props.previewContent as () => React.ReactElement;
      act(() => { preview = TestRenderer.create(content()); });
      const icon = preview.root.findByProps({ testID: "hover-preview-icon" });
      const trigger = icon.find((node) => (node.type as unknown) === "Pressable");
      expect(trigger.props.accessibilityLabel).toBe(name);
      expect(trigger.props.accessibilityRole).toBe("image");
      expect(trigger.props.onPress).toBeUndefined();
      expect(texts(icon)).not.toContain(name);
      act(() => trigger.props.onHoverIn());
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS - 1); });
      expect(texts(icon)).not.toContain(name);
      act(() => { vi.advanceTimersByTime(1); });
      expect(texts(icon)).toContain(name);
      const slot = icon.find((node) => (node.type as unknown) === "View" && node.props.pointerEvents === "none");
      expect(StyleSheet.flatten(slot.props.style).alignItems).toBe("center");
      act(() => trigger.props.onHoverOut());
      expect(texts(icon)).not.toContain(name);
      // A pointer that leaves before the delay must not show a stale name.
      act(() => trigger.props.onHoverIn());
      act(() => trigger.props.onHoverOut());
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
      expect(texts(icon)).not.toContain(name);
      act(() => { preview.unmount(); renderer.unmount(); });
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates the preview icon's hovered type when paging through different operations", () => {
    vi.useFakeTimers();
    try {
      const operations = ["Read", "Write"].map((name) => classifyTool({
        name, status: "completed", detail: { type: name.toLowerCase(), filePath: "/a.ts" },
      }));
      let renderer!: ReturnType<typeof TestRenderer.create>;
      let preview!: ReturnType<typeof TestRenderer.create>;
      act(() => { renderer = TestRenderer.create(React.createElement(ToolCallout, {
        data: operations[0]!, groupCalls: operations, tokens,
      })); });
      const content = renderer.root.findByType(DisclosureHeader).props.previewContent as () => React.ReactElement;
      act(() => { preview = TestRenderer.create(content()); });
      const icon = preview.root.findByProps({ testID: "hover-preview-icon" });
      act(() => icon.find((node) => (node.type as unknown) === "Pressable").props.onHoverIn());
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
      expect(texts(icon)).toContain("Read");
      act(() => pagerButton(preview.root, "Next operation").props.onPress());
      expect(texts(icon)).toContain("Write");
      expect(texts(icon)).not.toContain("Read");
      expect(icon.find((node) => (node.type as unknown) === "Pressable").props.accessibilityLabel).toBe("Write");
      act(() => { preview.unmount(); renderer.unmount(); });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a button's name in the settings page's language, keeping the English label for assistive tech", () => {
    vi.useFakeTimers();
    updateEnhancerPreferences({ language: "zh" });
    try {
      let renderer!: ReturnType<typeof TestRenderer.create>;
      act(() => { renderer = TestRenderer.create(React.createElement(ToolbarButton, {
        icon: "Link", label: "Copy path", onPress() {}, tokens,
      })); });
      const button = renderer.root.find((node) => (node.type as unknown) === "Pressable");
      act(() => button.props.onHoverIn());
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
      expect(texts(renderer.root)).toContain("复制路径");
      expect(button.props.accessibilityLabel).toBe("Copy path");
      act(() => renderer.unmount());
    } finally {
      updateEnhancerPreferences({ language: "system" });
      vi.useRealTimers();
    }
  });

  it("opens the names of the toolbar's right-hand buttons leftwards, inside the panel", () => {
    vi.useFakeTimers();
    try {
      let renderer!: ReturnType<typeof TestRenderer.create>;
      act(() => { renderer = TestRenderer.create(React.createElement(HoverPreviewHeader, { tokens },
        React.createElement(ToolbarButton, { icon: "Copy", label: "Copy new content", onPress() {}, tokens }))); });
      const button = renderer.root.find((node) => (node.type as unknown) === "Pressable");
      act(() => button.props.onHoverIn());
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
      const slot = renderer.root.find((node) => (node.type as unknown) === "View" && node.props.pointerEvents === "none");
      const style = StyleSheet.flatten(slot.props.style);
      expect(style.right).toBe(0);
      expect(style.left).toBeUndefined();
      act(() => renderer.unmount());
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a copy that repeats an earlier one", () => {
    expect(previewCopyActions({
      primary: { id: "path", label: "Copy path", text: "/a" },
      menu: [{ id: "content", label: "Copy file content", text: "/a" }, { id: "patch", label: "Copy patch", text: "p" }],
    }).map((action) => action.id)).toEqual(["path", "patch"]);
  });
});

type Node = ReturnType<typeof TestRenderer.create>["root"];

function texts(root: Node): string[] {
  return root.findAll((node) => (node.type as unknown) === "Text")
    .flatMap((node) => [node.props.children].flat(Infinity))
    .filter((child): child is string => typeof child === "string");
}

/** Which calls have a body on screen (the header row's own `data` aside). */
function shown(root: Node): string[] {
  return root.findAll((node) => typeof node.type === "function" && node.type.name === "ToolBody")
    .map((node) => node.props.data.callId);
}

function pagerButton(root: Node, label: string) {
  return root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
}
