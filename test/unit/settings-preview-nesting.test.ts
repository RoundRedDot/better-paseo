import React from "react";
import { afterAll, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

// React Native Web draws role "button" as <button>, and a <button> inside a
// <button> is invalid HTML: React warns "<button> cannot be a descendant of
// <button>" and flags a hydration error. The settings page showed it from its
// preview's Read and Edit rows, and the timeline from every row's hover copy
// buttons and the hover copy icon of a path, all inside the row's button.
//
// The trees are walked as web draws them, with a pointer that hovers (or
// touch, where an opened row keeps its actions at its end) and every row
// hovered, so the actions a pointer brings up are mounted.

const env = vi.hoisted(() => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  return { hover: true, touch: false, expanded: false };
});
afterAll(() => {
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput,
    copyText: async () => {}, useToast: () => ({ show() {}, error() {} }), useRevealedText: (text: string) => text };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
vi.mock("../../client/ui/use-input-capabilities", async (original) => ({
  ...await original<object>(),
  useInputCapabilities: (compact = false) => ({ hover: env.hover, touch: env.touch, compact, native: false }),
}));
vi.mock("../../client/ui/use-hover", () => ({
  useHover: () => ({ hovered: env.hover, hoverProps: {} }),
}));
vi.mock("../../client/state/disclosure-store", async (original) => ({
  ...await original<object>(),
  useDisclosure: () => [env.expanded, () => {}],
}));
vi.mock("../../client/components/selection-actions", async (original) => ({
  ...await original<object>(),
  useSelectionActions() {},
}));
vi.mock("../../client/components/hub-live", () => ({ TimelineTailHub: () => null }));
vi.mock("../../client/state/preference-sync-slot", () => ({ PreferenceSyncSlot: () => null }));
vi.mock("../../client/ui/path-text", async (original) => ({
  ...await original<object>(),
  usePathContextValue: () => ({ roots: [{ kind: "workspace", path: "/w" }], cwd: "/w", mode: "relative" }),
}));
vi.mock("../../client/image-file", async (original) => ({
  ...await original<object>(),
  useImageFile: () => null,
}));

import { buildThemeTokens } from "../../client/components/theme-tokens";
import { SettingsPreview } from "../../client/settings-preview";
import { SETTINGS_STRINGS } from "../../client/i18n/settings-page-strings";
import { DEFAULT_PREFERENCES } from "../../client/preferences";
import { LiveToolCallRenderer, type LiveToolCallPayload } from "../../client/live-renderers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const COLORS = { surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" };
const tokens = buildThemeTokens(COLORS);

/** A DOM element stand-in for refs; it keeps the attributes set on it. */
function createNodeMock() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    addEventListener() {}, removeEventListener() {},
    contains: () => false, closest: () => null, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    measure() {}, measureInWindow() {}, focus() {}, blur() {},
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => "" },
  };
}
type NodeMock = ReturnType<typeof createNodeMock>;

const host = (node: ReactTestInstance) => typeof node.type === "string";
/** Drawn as a <button>: RNW turns the role prop "button" into the element. */
const drawnAsButton = (node: ReactTestInstance) => host(node) && (node.props.role ?? node.props.accessibilityRole) === "button";
/** A <div> whose ref gives the element role="button" (`useContainerButton`). */
function domButton(node: ReactTestInstance): boolean {
  const ref = node.props.ref as ((element: NodeMock) => void) | undefined;
  if (!host(node) || typeof ref !== "function") return false;
  const element = createNodeMock();
  ref(element);
  return element.attributes.get("role") === "button";
}
const name = (node: ReactTestInstance) => String(node.props.accessibilityLabel ?? node.type);

function nestedButtons(root: ReactTestInstance): string[] {
  const out: string[] = [];
  for (const node of root.findAll(drawnAsButton)) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (drawnAsButton(parent)) {
        out.push(`${name(node)} in ${name(parent)}`);
        break;
      }
    }
  }
  return out;
}

function render(element: React.ReactElement) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(element, { createNodeMock });
  });
  return renderer;
}

describe("the settings preview", () => {
  it.each([[true, true], [true, false], [false, true], [false, false]])("nests no button in a button (compact %s, hover preview %s)", (compact, hoverPreview) => {
    for (const hover of [false, true]) {
      env.hover = hover;
      env.touch = !hover;
      for (const language of ["en", "zh"] as const) {
        const renderer = render(React.createElement(SettingsPreview, {
          tokens, preferences: { ...DEFAULT_PREFERENCES, hoverPreview }, compact, t: SETTINGS_STRINGS[language],
        }));
        expect(nestedButtons(renderer.root)).toEqual([]);
        act(() => renderer.unmount());
      }
    }
  });
});

const ROWS: Record<string, LiveToolCallPayload> = {
  read: { name: "Read", status: "completed", callId: "r", detail: { type: "read", filePath: "/w/src/a.ts", offset: 10, limit: 5, content: "a\nb\nc" } },
  edit: { name: "Edit", status: "completed", callId: "e", detail: { type: "edit", filePath: "/w/src/a.ts",
    unifiedDiff: "@@ -1,2 +1,2 @@\n-a\n+b\n c\n" } },
  write: { name: "Write", status: "completed", callId: "w", detail: { type: "write", filePath: "/w/notes.md", content: "# Notes\n\ntext" } },
  shell: { name: "Bash", status: "completed", callId: "s", detail: { type: "shell", command: "ls -la", cwd: "/w/src", output: "a.ts", exitCode: 0 } },
  failed: { name: "Bash", status: "failed", callId: "f", error: "exit 2", detail: { type: "shell", command: "npm test", cwd: "/w", output: "1 failed", exitCode: 2 } },
  search: { name: "Grep", status: "completed", callId: "g", detail: { type: "search", query: "useHover", content: "src/a.ts:1: useHover" } },
  fetch: { name: "WebFetch", status: "completed", callId: "u", detail: { type: "fetch", url: "https://example.com", result: "page" } },
  unknown: { name: "mcp__linear__get_issue", status: "completed", callId: "m", detail: { type: "unknown", input: { id: "X-1" }, output: { title: "t" } } },
};

function row(payload: LiveToolCallPayload, compact: boolean) {
  return React.createElement(LiveToolCallRenderer, {
    agentId: "nesting", host: { id: "local", label: "Local" },
    layout: { compact, platform: "web" }, theme: { colors: COLORS } as never,
    timestamp: new Date(1_000), item: { type: "plugin", kind: "omp-tool-call", version: 1, data: payload },
  } as never);
}

describe("a timeline row", () => {
  const cases = Object.keys(ROWS).flatMap((tool) => [false, true].flatMap((compact) =>
    (["hover", "touch", "hybrid"] as const).flatMap((pointer) => [false, true].map((expanded) => [tool, compact, pointer, expanded] as const))));

  it.each(cases)("%s nests no button in a button (compact %s, %s, open %s)", (tool, compact, pointer, expanded) => {
    env.hover = pointer !== "touch";
    env.touch = pointer !== "hover";
    env.expanded = expanded;
    const renderer = render(row(ROWS[tool]!, compact));
    expect(nestedButtons(renderer.root)).toEqual([]);
    act(() => renderer.unmount());
  });

  it("keeps the row and the path buttons for a screen reader and the keyboard, around their copy buttons", () => {
    env.hover = true;
    env.touch = false;
    env.expanded = false;
    for (const tool of ["read", "edit"]) {
      const renderer = render(row(ROWS[tool]!, false));
      const rows = renderer.root.findAll((node) => host(node) && node.props["aria-expanded"] !== undefined);
      expect(rows.length).toBe(1);
      // The row is a <div> on web (no role prop), with role="button" in the DOM.
      expect(rows.map((node) => [drawnAsButton(node), domButton(node)])).toEqual([[false, true]]);
      // Its hover copy buttons are mounted inside it, as real <button>s.
      const copies = rows[0]!.findAll((node) => drawnAsButton(node) && /^Copy/.test(String(node.props.accessibilityLabel)));
      expect(copies.length).toBeGreaterThan(0);
      // The path inside the row is a button too, the same way.
      const path = rows[0]!.findAll((node) => host(node) && node.props.accessibilityLabel === "/w/src/a.ts");
      expect(path.map(domButton)).toEqual([true]);
      act(() => renderer.unmount());
    }
  });

  it("puts the hover copy icon of a path inside the path's button", async () => {
    env.hover = true;
    env.touch = false;
    const { PathText } = await import("../../client/ui/path-text");
    const renderer = render(React.createElement(PathText, { path: "/w/src/a.ts", tokens, copyOnHover: true }));
    const path = renderer.root.find((node) => host(node) && node.props.accessibilityLabel === "/w/src/a.ts");
    expect(domButton(path)).toBe(true);
    expect(path.findAll((node) => drawnAsButton(node)).map(name)).toEqual(["Copy path"]);
    expect(nestedButtons(renderer.root)).toEqual([]);
    act(() => renderer.unmount());
  });
});
