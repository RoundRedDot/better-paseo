/**
 * A file link in a card's details reveals the file through this plugin's
 * server, on this plugin's host. Another host's card has its file elsewhere:
 * its links copy the path instead of opening a same-named path here.
 */
import React from "react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { (globalThis as { __rnMockOS?: string }).__rnMockOS = "web"; });
const reveal = vi.hoisted(() => vi.fn(async () => ({ revealed: true, error: null })));
const copy = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../client/ui/use-input-capabilities", () => ({
  noteHover() {},
  useInputCapabilities: () => ({ hover: true, touch: false, compact: false, native: false }),
}));
vi.mock("react-native", async () => ({ ...await import("./helpers/rn-mock"), UIManager: { hasViewManagerConfig: () => true } }));
vi.mock("../../client/ui/use-copy", () => ({ useCopy: () => ({ copy }) }));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => ({ data: undefined }), useRpc: () => reveal }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: object) => React.createElement("Icon", props),
    ScrollView: rn.ScrollView,
    Modal: rn.View,
    TextInput: rn.TextInput,
    copyText: async () => {},
    useRevealedText: (text: string) => text,
    useToast: () => ({ show() {}, error() {} }),
  };
});
await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { TaskDetailCards } = await import("../../client/tasks/cards/detail-cards");
const { BOARD_STRINGS } = await import("../../client/tasks/board/strings");
const { sampleCards } = await import("../../client/tasks/sample-cards");
import type { ReactTestRenderer } from "react-test-renderer";
import type { TaskCard, TaskHost } from "../../client/tasks/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

const theme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f7f7f8",
    surface2: "#efeff1",
    border: "#e2e2e6",
    foreground: "#1b1b1f",
    foregroundMuted: "#6b6b75",
    accent: "#3b6fe0",
    accentForeground: "#ffffff",
    statusSuccess: "#1f8a5b",
    statusWarning: "#a36a00",
    statusDanger: "#d93636",
  },
};
const REMOTE: TaskHost = { id: "srv-remote", label: "remote-box", remote: true };
const LOCAL: TaskHost = { id: "srv-own", label: "This Mac", remote: false };
const base = sampleCards()[0]!;

let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  vi.clearAllMocks();
});

async function pressLink(host: TaskHost) {
  const card: TaskCard = { ...base, host, location: { ...base.location, cwd: "/work/app" } };
  await act(async () => {
    tree = TestRenderer.create(
      <TaskDetailCards
        card={card}
        theme={theme}
        language="en"
        strings={BOARD_STRINGS.en.sidebar}
        now={0}
        tabs
        firstPrompt={{ prompt: { state: "ready", text: "See [the notes](/work/app/notes/plan.md) first." }, load() {} }}
      />,
    );
  });
  const links = tree!.root.findAll((node) => node.props.accessibilityRole === "link" && typeof node.props.onPress === "function");
  expect(links.length).toBeGreaterThan(0);
  await act(async () => links[0]!.props.onPress());
}

describe("a file link in a card's details", () => {
  it("reveals the file for this host's card", async () => {
    await pressLink(LOCAL);
    expect(reveal).toHaveBeenCalledWith({ cwd: "/work/app", path: "/work/app/notes/plan.md" });
    expect(copy).not.toHaveBeenCalled();
  });

  it("copies the path for another host's card, without revealing anything here", async () => {
    await pressLink(REMOTE);
    expect(reveal).not.toHaveBeenCalled();
    expect(copy).toHaveBeenCalledWith("/work/app/notes/plan.md", expect.anything());
  });
});
