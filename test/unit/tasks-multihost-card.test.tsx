/**
 * A card from another Paseo host: its host badge, and only the actions that
 * reach the agent's own host. Stop, Mark read and unread, Unarchive and the
 * titles go through this plugin's server, which answers for its own host.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

vi.hoisted(() => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", async (original) => ({ ...await original<object>(), useRpc: () => async () => ({ revealed: null, error: null }) }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => react.createElement("Icon", props),
    Modal: Object.assign(
      (props: Record<string, unknown> & { children?: React.ReactNode }) => props.open ? react.createElement("Modal", props, props.children) : null,
      { Content: (props: Record<string, unknown> & { children?: React.ReactNode }) => react.createElement("ModalContent", props, props.children) },
    ),
    ScrollView: rn.ScrollView,
    copyText: async () => {},
    useToast: () => ({ show() {}, error() {} }),
  };
});

import "./helpers/quiet-renderer";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { CARD_PRESETS } from "../../shared/tasks-settings";
import { previewSampleCards as sampleCards } from "../../client/tasks/sample-cards";
import type { TaskCard, TaskHost } from "../../client/tasks/model";
import { DetailActionBar, TaskCardView, type TaskCardViewProps } from "../../client/tasks/cards";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";

afterAll(() => {
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

const THEME = {
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

const NOW = Date.parse("2026-10-20T09:00:00.000Z");
const REMOTE: TaskHost = { id: "srv-remote", label: "remote-box", remote: true };
const LOCAL: TaskHost = { id: "srv-own", label: "This Mac", remote: false };

let renderer: TestRenderer.ReactTestRenderer | null = null;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
});

function sample(id: string, host?: TaskHost): TaskCard {
  const card = sampleCards(NOW).find((item) => item.id === id)!;
  return host ? { ...card, host } : card;
}

function props(card: TaskCard): TaskCardViewProps {
  return {
    card,
    fields: { ...CARD_PRESETS.full.fields, labelLimit: CARD_PRESETS.full.labelLimit },
    theme: THEME,
    compact: false,
    permissionButtons: [],
    stopPhase: "idle",
    focused: false,
    highlighted: false,
    now: NOW,
    language: "en",
    onReveal: () => {},
    onOpen: () => {},
    onStop: () => {},
    onRead: () => {},
    onUnread: () => {},
    onArchive: () => {},
    onUnarchive: () => {},
    onPermission: () => {},
  };
}

async function render(element: React.ReactElement): Promise<ReactTestInstance> {
  await act(async () => {
    renderer = TestRenderer.create(element, { createNodeMock: (node) => ({ props: node.props }) });
  });
  return renderer!.root;
}

const ids = (root: ReactTestInstance) => new Set(root.findAll((node) => typeof node.type === "string" && typeof node.props.testID === "string").map((node) => node.props.testID as string));

describe("a remote host's card", () => {
  it("names its host and keeps Open, but no Stop", async () => {
    const remote = ids(await render(<TaskCardView {...props(sample("sample-running", REMOTE))} />));
    expect(remote.has("pill-host")).toBe(true);
    expect(remote.has("task-card-stop")).toBe(false);
    expect(remote.has("task-card-open-tab")).toBe(true);
    const local = ids(await render(<TaskCardView {...props(sample("sample-running", LOCAL))} />));
    expect(local.has("pill-host")).toBe(false);
    expect(local.has("task-card-stop")).toBe(true);
  });

  it("draws its host's name in the badge", async () => {
    const root = await render(<TaskCardView {...props(sample("sample-running", REMOTE))} />);
    const pill = root.find((node) => typeof node.type === "string" && node.props.testID === "pill-host");
    const texts = pill.findAll((node) => (node.type as unknown) === "Text").flatMap((node) => node.children.filter((child) => typeof child === "string"));
    expect(texts).toContain("remote-box");
  });

  it("has no Mark read in review, and Archive but no Mark unread when done", async () => {
    const review = { ...sample("sample-unread", REMOTE), readable: true };
    expect(ids(await render(<TaskCardView {...props(review)} />)).has("task-card-read")).toBe(false);
    expect(ids(await render(<TaskCardView {...props({ ...review, host: LOCAL })} />)).has("task-card-read")).toBe(true);
    const done = ids(await render(<TaskCardView {...props(sample("sample-done", REMOTE))} />));
    expect(done.has("task-card-archive")).toBe(true);
    expect(done.has("task-card-unread")).toBe(false);
  });

  it("has no Unarchive when archived", async () => {
    expect(ids(await render(<TaskCardView {...props(sample("sample-archived", REMOTE))} />)).has("task-card-unarchive")).toBe(false);
    expect(ids(await render(<TaskCardView {...props(sample("sample-archived", LOCAL))} />)).has("task-card-unarchive")).toBe(true);
  });

  it("leaves the same actions out of its details' action bar", async () => {
    const markRead = { pending: () => false, press: vi.fn() };
    const bar = (card: TaskCard) => (
      <DetailActionBar
        card={card}
        theme={THEME}
        language="en"
        strings={BOARD_STRINGS.en.sidebar}
        onOpen={() => {}}
        stop={null}
        markRead={markRead}
        markUnread={markRead}
        archive={{ pending: () => false, press: vi.fn() }}
      />
    );
    const review = { ...sample("sample-unread"), readable: true };
    const labels = (root: ReactTestInstance) => root.findAll((node) => typeof node.type === "string" && typeof node.props.accessibilityLabel === "string").map((node) => node.props.accessibilityLabel as string);
    const local = labels(await render(bar({ ...review, host: LOCAL })));
    const remote = labels(await render(bar({ ...review, host: REMOTE })));
    expect(local.some((label) => /mark as read/i.test(label))).toBe(true);
    expect(remote.some((label) => /mark as read/i.test(label))).toBe(false);
  });
});
