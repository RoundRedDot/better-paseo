import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

// The host's `useSettings` (packages/app/src/plugins/settings/use-settings.ts)
// has no optimistic update: while a save is in flight it reports
// `saving: true` with the old values, and the new values arrive with the
// save's answer. Changing a translation option must not dim the group's rows
// for that round trip, nor show the old choice until the answer lands.

const host = vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const listeners = new Set<() => void>();
  const host = {
    values: null as unknown,
    revision: "r1",
    saving: false,
    pending: null as null | { values: unknown; resolve: (ok: boolean) => void },
    saves: [] as { values: unknown; revision: string }[],
    state: null as unknown,
    listeners,
    publish() {
      host.state = {
        status: "ready", values: host.values, revision: host.revision, saving: host.saving, saveError: null,
        save: (values: unknown, revision: string) => {
          host.saves.push({ values, revision });
          host.saving = true;
          host.publish();
          return new Promise<boolean>((resolve) => { host.pending = { values, resolve }; });
        },
        reset: async () => true,
        reload: async () => {},
      };
      for (const listener of listeners) listener();
    },
    answer(ok = true) {
      const pending = host.pending!;
      host.pending = null;
      if (ok) {
        host.values = pending.values;
        host.revision = `${host.revision}+`;
      }
      host.saving = false;
      host.publish();
      pending.resolve(ok);
    },
  };
  return host;
});

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput };
});
const never = vi.hoisted(() => () => new Promise(() => {}));
vi.mock("@getpaseo/plugin/client", async () => {
  const react = await import("react");
  return {
    useAgent: () => undefined,
    useWorkspace: () => undefined,
    useRpc: () => never,
    usePaseo: () => host,
    useSettings: () => react.useSyncExternalStore(
      (listener: () => void) => { host.listeners.add(listener); return () => host.listeners.delete(listener); },
      () => host.state,
    ),
  };
});
vi.mock("../../client/components/marks", () => ({ useMarkBitmap: () => null }));

import { TimelineTranslationSettings } from "../../client/translation/settings";
import { DEFAULT_TIMELINE_TRANSLATION_SETTINGS } from "../../client/translation/settings-store";
import { ChoiceMenuSelect } from "../../client/settings-choice-menu";
import { SettingRow, type PageLook } from "../../client/settings-controls";
import { SETTINGS_STRINGS } from "../../client/i18n/settings-page-strings";
import { buildThemeTokens } from "../../client/components/theme-tokens";

const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
const look = { compact: false, t: SETTINGS_STRINGS.en, tokens } as PageLook;

let tree: TestRenderer.ReactTestRenderer | null = null;
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = null;
  host.listeners.clear();
  host.pending = null;
  host.saves = [];
});

async function mount() {
  host.values = { ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true, mode: "free", freeService: "microsoft" };
  host.revision = "r1";
  host.saving = false;
  host.publish();
  await act(async () => { tree = TestRenderer.create(<TimelineTranslationSettings look={look} />); });
}
const rows = () => tree!.root.findAllByType(SettingRow);
const service = () => tree!.root.findByType(ChoiceMenuSelect);

describe("translation settings while a change is saving", () => {
  it("keeps every row enabled and shows the new service until the save lands", async () => {
    await mount();
    expect(rows().every((row) => !row.props.disabled)).toBe(true);

    await act(async () => { service().props.onChange("google"); });
    expect(host.saving).toBe(true);
    expect(host.saves).toEqual([{ values: expect.objectContaining({ freeService: "google" }), revision: "r1" }]);
    expect(rows().filter((row) => row.props.disabled).map((row) => row.props.title)).toEqual([]);
    expect(service().props.value).toBe("google");

    await act(async () => host.answer());
    expect(rows().every((row) => !row.props.disabled)).toBe(true);
    expect(service().props.value).toBe("google");
  });

  it("refuses a second write while one is in flight, and falls back when the save fails", async () => {
    await mount();
    await act(async () => { service().props.onChange("google"); });
    await act(async () => { service().props.onChange("tencent"); });
    expect(host.saves).toHaveLength(1);
    expect(service().props.value).toBe("google");

    await act(async () => host.answer(false));
    expect(service().props.value).toBe("microsoft");
  });
});
