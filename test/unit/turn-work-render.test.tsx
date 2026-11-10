import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES, updateEnhancerPreferences } from "../../client/preferences";
import { getDisclosure, resetDisclosureStore } from "../../client/state/disclosure-store";
import type { TurnWorkGroup } from "../../client/state/turn-work";
import { turnWorkDisclosureKey } from "../../client/state/turn-work-projection";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null }));
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => ({}), useAgent: () => false }));
const state = vi.hoisted(() => ({ group: null as TurnWorkGroup | null, observed: [] as string[] }));
vi.mock("../../client/state/turn-footers", () => ({ useTurnWork: (_paseo: unknown, agentId: string) => {
  state.observed.push(agentId);
  return state.group;
} }));
await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { LiveTurnWorkRenderer, TurnWorkItem } = await import("../../client/components/turn-work");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = { colors: { surface0: "#202020", surface1: "#303030", surface2: "#404040", border: "#555555",
  foreground: "#eeeeee", foregroundMuted: "#aaaaaa", accent: "#aabbff", accentForeground: "#000000",
  statusSuccess: "#00bb00", statusDanger: "#ff0000", statusWarning: "#ffff00" } };
function summary(platform: "web" | "ios" | "android") {
  return <LiveTurnWorkRenderer agentId="a" theme={theme} layout={{ platform, compact: platform !== "web" }}
    host={{ id: "local", label: "Local" }} timestamp={new Date(1000)}
    item={{ type: "plugin", kind: "omp-turn-work", version: 1, data: { groupKey: "e:1", anchor: "one", count: 2, failed: 1 } }} />;
}
const buttons = (renderer: ReturnType<typeof TestRenderer.create>) => renderer.root.findAll((node) => node.type as unknown === "Pressable");
afterEach(() => { state.group = null; state.observed = []; resetDisclosureStore(); updateEnhancerPreferences({ ...DEFAULT_PREFERENCES }); });

describe("completed work summary", () => {
  it("does not observe or fetch work on hosts without source identity", async () => {
    updateEnhancerPreferences({ autoCollapseTurnWork: true });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(
      <TurnWorkItem agentId="a" timestamp={new Date(1000)} sourceKey="one">Original work</TurnWorkItem>,
    ); });
    try {
      expect(renderer.toJSON()).toBe("Original work");
      expect(state.observed).toEqual([]);
      await act(async () => { renderer.update(
        <TurnWorkItem agentId="a" timestamp={new Date(1000)} sourceKey="one"
          workSource={{ agentId: "another-agent", sourceId: "source-1", sourceCursor: { epoch: "e", seq: 1 } }}>Original work</TurnWorkItem>,
      ); });
      expect(state.observed).toEqual([]);
    } finally { await act(async () => renderer.unmount()); }
  });
  it("keeps the summary visible while history is temporarily unavailable", async () => {
    updateEnhancerPreferences({ language: "en" });
    state.group = null;
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(summary("web")); });
    try { expect(buttons(renderer)[0]!.props.accessibilityLabel).toBe("Work process, 2 steps, 1 failed"); }
    finally { await act(async () => renderer.unmount()); }
  });
  it.each(["web", "ios", "android"] as const)("shows failure counts and preserves expansion across remounts on %s", async (platform) => {
    updateEnhancerPreferences({ autoCollapseTurnWork: true, language: "zh" });
    state.group = { key: "e:1", epoch: "e", anchor: "one", members: ["one", "two"], failed: 1 };
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(summary(platform)); });
    try {
      expect(buttons(renderer)).toHaveLength(1);
      expect(buttons(renderer)[0]!.props.accessibilityLabel).toBe("工作过程, 2 步, 1 步失败");
      expect(buttons(renderer)[0]!.props.accessibilityState).toEqual({ expanded: false });
      await act(async () => buttons(renderer)[0]!.props.onPress());
      expect(getDisclosure(turnWorkDisclosureKey("a", "e:1"))).toBe(true);
      await act(async () => renderer.unmount());
      await act(async () => { renderer = TestRenderer.create(summary(platform)); });
      expect(buttons(renderer)[0]!.props.accessibilityState).toEqual({ expanded: true });
      await act(async () => buttons(renderer)[0]!.props.onPress());
      expect(getDisclosure(turnWorkDisclosureKey("a", "e:1"))).toBe(false);
    } finally { await act(async () => renderer.unmount()); }
  });
});
