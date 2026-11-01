/**
 * Opening a card in the details reads its three messages at once, including
 * a closed agent. Search still leaves closed agents alone.
 */
import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
  TextInput: () => null,
  ScrollView: () => null,
  copyText: vi.fn(),
  useToast: () => ({ show() {}, error() {} }),
}));

import { useDetailReads } from "../../client/tasks/board/details-sidebar";
import type { BoardController } from "../../client/tasks/board/use-board";
import type { TaskCard } from "../../client/tasks/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE = {
  error: null,
  entries: [
    { timestamp: "2026-10-25T08:13:00Z", seqEnd: 1, item: { type: "user_message", text: "First prompt" } },
    { timestamp: "2026-10-25T09:00:00Z", seqEnd: 2, item: { type: "user_message", text: "Last sent" } },
    { timestamp: "2026-10-25T09:01:00Z", seqEnd: 3, item: { type: "assistant_message", text: "Last reply" } },
  ],
  hasNewer: false,
  hasOlder: false,
  epoch: "history",
  endCursor: { epoch: "history", seq: 3 },
  window: { nextSeq: 4 },
};

function timeline() {
  const refetch = vi.fn(async (_options: { direction?: string }) => PAGE);
  const api = { agents: { ref: () => ({ timeline: { refetch, subscribe: () => Object.assign(() => {}, { ready: Promise.resolve() }) } }) } };
  return { refetch, api };
}

function card(id: string, closed: boolean): TaskCard {
  return {
    id,
    closed,
    lane: closed ? "archived" : "done",
    status: closed ? "archived" : "done",
    timing: {
      createdAt: "2026-10-25T08:00:00Z",
      updatedAt: "2026-10-25T09:01:00Z",
      turnStartedAt: null,
      attentionAt: null,
      lastUserMessageAt: "2026-10-25T09:00:00Z",
      lastTurnMs: 60_000,
      lastTurnEndedAt: "2026-10-25T09:01:00Z",
    },
  } as TaskCard;
}

describe("detail timeline reads", () => {
  it("loads the first prompt, last sent message and last reply when a closed card opens", async () => {
    const { refetch, api } = timeline();
    const board = { paseo: api, visible: true } as unknown as BoardController;
    let reads: ReturnType<typeof useDetailReads> | null = null;
    function Probe(props: { card: TaskCard | undefined }) {
      reads = useDetailReads(board, props.card);
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<Probe card={undefined} />); });
    expect(refetch).not.toHaveBeenCalled();

    await act(async () => { renderer.update(<Probe card={card("closed-1", true)} />); });
    expect(refetch.mock.calls.map(([options]) => options.direction)).toEqual(["after", "tail", "tail"]);
    expect(reads!.firstPrompt?.prompt).toEqual({ state: "ready", text: "First prompt", timestamp: "2026-10-25T08:13:00Z" });
    expect(reads!.humanMessage?.prompt).toEqual({ state: "ready", text: "Last sent", timestamp: "2026-10-25T09:00:00Z" });
    expect(reads!.lastMessage?.prompt).toEqual({ state: "ready", text: "Last reply", timestamp: "2026-10-25T09:01:00Z" });

    await act(async () => { renderer.update(<Probe card={undefined} />); });
    expect(refetch).toHaveBeenCalledTimes(3);
    act(() => renderer.unmount());
  });

  it("still loads an open card", async () => {
    const { refetch, api } = timeline();
    const board = { paseo: api, visible: true } as unknown as BoardController;
    function Probe() {
      useDetailReads(board, card("open-1", false));
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<Probe />); });
    expect(refetch.mock.calls.map(([options]) => options.direction)).toEqual(["after", "tail", "tail"]);
    act(() => renderer.unmount());
  });
});
