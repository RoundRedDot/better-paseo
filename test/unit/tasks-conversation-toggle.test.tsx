import React, { useState } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, TextInput: rn.TextInput };
});
import { FullConversationSwitch, SearchCoverageProvider, SearchInput } from "../../client/tasks/board/search-loading";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { useSearchFirstPrompts } from "../../client/tasks/data/search-first-prompts";
import { setConversationSearchLoader, useSearchConversations } from "../../client/tasks/data/search-conversations";
import { LANE_ORDER, type LaneId, type LaneModel } from "../../client/tasks/model";
import { sampleCards } from "../../client/tasks/sample-cards";
import type { ConversationSearchPage } from "../../shared/conversation-search";

let tree: TestRenderer.ReactTestRenderer | undefined;
beforeEach(() => { vi.useFakeTimers(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => tree?.unmount()); tree = undefined; setConversationSearchLoader(null); vi.useRealTimers(); });
const nodes = (id: string) => tree!.root.findAll((node) => typeof node.type === "string" && node.props.testID === id);

describe("full conversation switch", () => {
  it.each(["en", "zh"] as const)("defaults off, toggles incrementally and releases results on clear (%s)", async (language) => {
    const card = { ...sampleCards()[0]!, id: "target-task", closed: false };
    const lanes = Object.fromEntries(LANE_ORDER.map((id) => [id, { id, cards: id === card.lane ? [card] : [], hasMore: false, loading: false }])) as Record<LaneId, LaneModel>;
    const refetch = vi.fn(async () => ({ error: null, entries: [{ item: { type: "user_message", text: "first prompt" } }] }));
    const api = { agents: { ref: () => ({ timeline: { refetch } }) } } as never;
    let resolve!: (page: ConversationSearchPage) => void;
    const load = vi.fn(() => new Promise<ConversationSearchPage>((done) => { resolve = done; }));
    setConversationSearchLoader(load);
    let shown: ReadonlyMap<string, string> = new Map();
    let change!: (query: string) => void;
    function Probe() {
      const [full, setFull] = useState(false);
      const [query, setQuery] = useState("target");
      change = setQuery;
      const first = useSearchFirstPrompts(api, lanes, full ? "" : query);
      const conversation = useSearchConversations(api, lanes, full ? query : "");
      const search = full ? conversation : first;
      shown = search.messages;
      return <SearchCoverageProvider status={search.status} query={query} total={shown.size} strings={full ? BOARD_STRINGS[language].conversationSearchCoverage : BOARD_STRINGS[language].searchCoverage} fullConversation={full} onFullConversationChange={setFull} fullConversationLabel={BOARD_STRINGS[language].fullConversationSearch} fullConversationHint={BOARD_STRINGS[language].fullConversationHint}>
        <SearchInput value={query} onChangeText={setQuery} iconSize={13} iconColor="#777777" />
        <FullConversationSwitch theme={{ colors: { accent: "blue", accentForeground: "white", surface0: "white", surface2: "gray", border: "gray", foregroundMuted: "gray" } } as never} />
      </SearchCoverageProvider>;
    }
    act(() => { tree = TestRenderer.create(<Probe />); });
    expect(nodes("search-full-conversation-toggle")[0]!.props.accessibilityState.checked).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(load).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => nodes("search-full-conversation-toggle")[0]!.props.onPress());
    expect(nodes("search-full-conversation-toggle")[0]!.props.accessibilityState.checked).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(load).toHaveBeenCalledWith({ agentId: card.id, query: "target" });
    expect(nodes("search-spinner")).toHaveLength(1);
    await act(async () => { resolve({ match: "later target reply", nextCursor: null, unavailable: false, error: null }); });
    expect(shown.get(card.id)).toBe("later target reply");
    act(() => nodes("search-full-conversation-toggle")[0]!.props.onPress());
    expect(shown.get(card.id)).toBe("first prompt");
    act(() => nodes("search-full-conversation-toggle")[0]!.props.onPress());
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    act(() => change(""));
    await act(async () => { resolve({ match: "late target", nextCursor: null, unavailable: false, error: null }); });
    expect(shown.size).toBe(0);
    expect(nodes("search-spinner")).toHaveLength(0);
  });
});
