import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
const state = vi.hoisted(() => ({
  open: vi.fn(), close: vi.fn(), register: vi.fn(), update: vi.fn(), release: vi.fn(), copy: vi.fn(async (_text: string) => {}),
  current: null as string | null, linger: null as string | null, form: "side", marker: "off", reduced: false,
  handlers: new Map<string, Set<(event: unknown) => void>>(), showPopover: vi.fn(), hidePopover: vi.fn(),
}));
vi.mock("../../client/details/block-registry", () => ({ registerBlock: (entry: unknown) => {
  state.register(entry); return { update: state.update, release: state.release };
} }));
vi.mock("../../client/details/details-store", () => ({
  detailsApi: { open: state.open, close: state.close },
  useDetails: () => ({ openId: state.current, lingerId: state.linger, form: state.form }),
  useMarkerPhase: () => state.marker,
}));
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: vi.fn(() => state.reduced) }));
vi.mock("../../client/ui/use-input-capabilities", () => ({ noteHover: () => {}, useInputCapabilities: () => {
  const native = (globalThis as { __rnMockOS?: string }).__rnMockOS !== "web";
  return { native, hover: !native, touch: native, compact: native };
} }));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput,
    copyText: state.copy, useToast: () => ({ show() {}, error() {} }) };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}), useSettings: () => ({ status: "loading" }),
}));
vi.mock("../../client/components/image-viewer", () => ({ ImageViewer: (props: { open: boolean }) => props.open ? React.createElement("ImageViewer", props) : null }));
vi.mock("../../client/web", async (original) => ({
  ...await original<typeof import("../../client/web")>(),
  openPreviewLayer: () => () => {},
}));
import { BlockPlacementContext } from "../../client/details/contracts";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { ToolCallout } from "../../client/components/tool-callouts";
import { Favicon } from "../../client/components/web-favicon";
import { classifyTool } from "../../client/tools/classify";
import { toolHasDetail } from "../../client/tools/detail";
import { Linking } from "./helpers/rn-mock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tokens = buildThemeTokens({ surface0: "#ffffff", surface1: "#eeeeee", surface2: "#dddddd", border: "#cccccc",
  foreground: "#111111", foregroundMuted: "#666666", accent: "#0000ff", accentForeground: "#ffffff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
let renderer: ReturnType<typeof TestRenderer.create> | undefined;
const placement = { agentId: "agent", at: 100, kind: "tool" as const };
function render(element: React.ReactElement) {
  act(() => { renderer = TestRenderer.create(<BlockPlacementContext.Provider value={placement}>{element}</BlockPlacementContext.Provider>, {
    createNodeMock: () => ({ measureInWindow: (done: (...box: number[]) => void) => done(0, 0, 350, 28), addEventListener() {}, removeEventListener() {} }),
  }); });
  return renderer!;
}
const byTest = (id: string) => renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === "string");
const textOf = (node: ReactTestInstance): string => node.children.map((child) => typeof child === "string" ? child : textOf(child)).join("");

function webSearch(detail: Record<string, unknown>) {
  return classifyTool({ name: "web_search", status: "completed", callId: "ws_1", error: null,
    detail: { type: "search", toolName: "web_search", ...detail } });
}

beforeEach(() => { (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios"; });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });

describe("web search rows", () => {
  it("names an opened address by its site, then the rest of the address", () => {
    render(<ToolCallout data={webSearch({ query: "https://chatgpt.com/s/t_6b06f0de15fc819184d679e4b324c5c3" })} tokens={tokens} compact />);
    const [target] = byTest("web-link-target");
    expect(target).toBeDefined();
    const text = textOf(target!);
    expect(text.startsWith("chatgpt.com")).toBe(true);
    expect(text.endsWith("e4b324c5c3")).toBe(true);
    // The favicon stands in the icon slot, outside the target; no magnifier.
    expect(target!.findAll((node) => node.props.testID === "web-favicon-image")).toHaveLength(0);
    expect(byTest("web-favicon-image").map((node) => node.props.source)).toEqual([{ uri: "https://chatgpt.com/favicon.ico" }]);
    expect(renderer!.root.findAll((node) => node.props.name === "Search")).toHaveLength(0);
  });

  it("opens an address in the system browser from its arrow, without toggling the row", () => {
    const open = vi.spyOn(Linking, "openURL");
    const toggled = vi.fn();
    const href = "https://developer.apple.com/documentation/uikit/uisheetpresentationcontroller";
    render(<ToolCallout data={webSearch({ query: href })} tokens={tokens} compact expanded={false} onExpandedChange={toggled} />);
    const [arrow] = renderer!.root.findAll((node) => node.props.testID === "web-link-open" && typeof node.props.onPress === "function");
    expect(arrow!.props.accessibilityRole).toBe("link");
    expect(renderer!.root.findAll((node) => node.props.name === "ArrowUpRight").length).toBeGreaterThan(0);
    const stop = vi.fn();
    act(() => arrow!.props.onPress({ stopPropagation: stop }));
    expect(stop).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(href);
    expect(toggled).not.toHaveBeenCalled();
  });

  it("opens an address row to that page, drawn as its one result", () => {
    const open = vi.spyOn(Linking, "openURL");
    const href = "https://chatgpt.com/s/t_6b06f0de15fc819184d679e4b324c5c3";
    const view = webSearch({ query: href });
    expect(toolHasDetail(view, 40)).toBe(true);
    render(<ToolCallout data={view} tokens={tokens} compact expanded onExpandedChange={() => {}} />);
    const [row] = renderer!.root.findAll((node) => node.props.testID === "web-result-row" && typeof node.props.onPress === "function");
    expect(textOf(row!)).toContain("chatgpt.com/s/t_6b06f0de15fc819184d679e4b324c5c3");
    expect(renderer!.root.findAll((node) => typeof node.type === "string" && textOf(node) === "No results.")).toHaveLength(0);
    act(() => row!.props.onPress());
    expect(open).toHaveBeenCalledWith(href);
  });

  it("does not open a plain query that brought nothing back", () => {
    expect(toolHasDetail(webSearch({ query: "expo sheet detents" }), 40)).toBe(false);
  });

  it("keeps the magnifier and no arrow for a plain query", () => {
    render(<ToolCallout data={webSearch({ query: "expo sheet detents" })} tokens={tokens} compact />);
    expect(byTest("web-link-open")).toHaveLength(0);
    expect(renderer!.root.findAll((node) => node.props.name === "Search").length).toBeGreaterThan(0);
  });

  it("keeps a plain query as quoted text and shows the result sites beside it", () => {
    render(<ToolCallout data={webSearch({ query: "expo sheet detents", webResults: [
      { title: "Modals", url: "https://docs.expo.dev/router/advanced/modals/" },
      { title: "Sheet", url: "https://developer.apple.com/documentation/uikit" },
      { title: "Repo", url: "https://github.com/expo/expo" },
      { title: "Other page, same site", url: "https://github.com/expo/router" },
      { title: "npm", url: "https://www.npmjs.com/package/expo-router" },
    ] })} tokens={tokens} compact />);
    expect(byTest("web-link-target")).toHaveLength(0);
    const [stack] = byTest("web-favicon-stack");
    expect(stack!.findAll((node) => node.props.testID === "web-favicon-image" && typeof node.type === "string")
      .map((node) => node.props.source.uri)).toEqual([
      "https://docs.expo.dev/favicon.ico", "https://developer.apple.com/favicon.ico", "https://github.com/favicon.ico",
    ]);
  });

  it("lists each result with its site and opens it on press", () => {
    const open = vi.spyOn(Linking, "openURL");
    render(<ToolCallout data={webSearch({ query: "expo", webResults: [
      { title: "Modals – Expo Router", url: "https://docs.expo.dev/router/advanced/modals/" },
    ] })} tokens={tokens} compact expanded onExpandedChange={() => {}} />);
    const [row] = renderer!.root.findAll((node) => node.props.testID === "web-result-row" && typeof node.props.onPress === "function");
    expect(textOf(row!)).toContain("Modals – Expo Router");
    expect(textOf(row!)).toContain("docs.expo.dev/router/advanced/modals/");
    expect(row!.findAll((node) => node.props.testID === "web-result-open").length).toBeGreaterThan(0);
    expect(row!.findAll((node) => node.props.name === "ArrowUpRight").length).toBeGreaterThan(0);
    act(() => row!.props.onPress());
    expect(open).toHaveBeenCalledWith("https://docs.expo.dev/router/advanced/modals/");
  });

  it("shows a globe while the favicon loads, the favicon once drawn, and a globe for a site without one", () => {
    render(<Favicon host="loads.example.dev" size={16} tokens={tokens} />);
    expect(byTest("web-favicon-globe")).toHaveLength(1);
    expect(byTest("web-favicon-image")[0]!.props.style).toMatchObject({ opacity: 0 });
    act(() => byTest("web-favicon-image")[0]!.props.onLoad());
    expect(byTest("web-favicon-globe")).toHaveLength(0);
    expect(byTest("web-favicon-image")[0]!.props.style).toMatchObject({ opacity: 1 });
    act(() => renderer?.unmount());

    render(<Favicon host="no-icon.example.dev" size={16} tokens={tokens} />);
    act(() => byTest("web-favicon-image")[0]!.props.onError());
    expect(byTest("web-favicon-image")).toHaveLength(0);
    const [globe] = byTest("web-favicon-globe");
    expect(globe!.findAll((node) => node.props.name === "Globe").length).toBeGreaterThan(0);
    act(() => renderer?.unmount());
    // Later rows for the same site draw the globe at once, without asking again.
    render(<Favicon host="no-icon.example.dev" size={16} tokens={tokens} />);
    expect(byTest("web-favicon-image")).toHaveLength(0);
    expect(byTest("web-favicon-globe")).toHaveLength(1);
  });

});
