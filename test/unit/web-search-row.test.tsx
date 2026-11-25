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
import { identityColor } from "../../client/tasks/cards/project-icon";
import { classifyTool } from "../../client/tools/classify";
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
    expect(byTest("web-favicon-image")[0]!.props.source).toEqual({ uri: "https://chatgpt.com/favicon.ico" });
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
    act(() => row!.props.onPress());
    expect(open).toHaveBeenCalledWith("https://docs.expo.dev/router/advanced/modals/");
  });

  it("falls back to the site's letter when it has no favicon, at once for later rows", () => {
    render(<Favicon host="no-icon.example.dev" size={16} tokens={tokens} />);
    act(() => byTest("web-favicon-image")[0]!.props.onError());
    const [letter] = byTest("web-favicon-letter");
    expect(textOf(letter!)).toBe("E");
    expect(JSON.stringify(letter!.props.style)).toContain(identityColor("no-icon.example.dev"));
    act(() => renderer?.unmount());
    render(<Favicon host="no-icon.example.dev" size={16} tokens={tokens} />);
    expect(byTest("web-favicon-image")).toHaveLength(0);
    expect(byTest("web-favicon-letter")).toHaveLength(1);
  });
});
