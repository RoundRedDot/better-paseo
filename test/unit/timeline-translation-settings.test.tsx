import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";
import { measureHostTree } from "./helpers/yoga-host-layout";
import {
  DEFAULT_TRANSLATION_PROMPT,
  TRANSLATION_PROMPT_MAX_LENGTH,
  timelineTranslationSettingsSchema,
  type TimelineTranslationSettings,
} from "../../shared/timeline-translation";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { DEFAULT_PREFERENCES, resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { Section, SectionFooter, SettingRow } from "../../client/settings-controls";
import { SETTINGS_STRINGS } from "../../client/i18n/settings-page-strings";
import {
  getTranslationSettingsState,
  reportTranslationSettings,
  resetTranslationSettingsStoreForTests,
} from "../../client/translation/settings-store";

const mocks = vi.hoisted(() => ({
  settingsState: null as unknown,
  rpc: vi.fn(),
  /** The `PaseoApi` of the host whose installation renders the page; one per host. */
  host: {} as object,
  // The host's `useRpc` keeps one caller per installation and contract (`useCallback` on context and contract).
  callers: new WeakMap<object, Map<string, (input: unknown) => unknown>>(),
  saveSpy: vi.fn<(next: TimelineTranslationSettings, rev: string) => Promise<boolean>>(async () => true),
}));

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => mocks.settingsState,
  usePaseo: () => mocks.host,
  useRpc: (contract: { name: string }) => {
    const host = mocks.host;
    let callers = mocks.callers.get(host);
    if (!callers) mocks.callers.set(host, callers = new Map());
    let caller = callers.get(contract.name);
    if (!caller) callers.set(contract.name, caller = (input: unknown) => mocks.rpc(contract.name, input, host));
    return caller;
  },
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const ReactModule = await import("react");
  const Modal = Object.assign(
    (props: { open?: boolean; title?: string; children?: React.ReactNode }) =>
      props.open ? ReactModule.createElement("Modal", { title: props.title }, props.children) : null,
    {
      Content: (props: { children?: React.ReactNode }) =>
        ReactModule.createElement("ModalContent", null, props.children),
    },
  );
  return {
    Icon: (props: Record<string, unknown>) => ReactModule.createElement("Icon", props),
    Modal,
    TextInput: "TextInput",
    ScrollView: "ScrollView",
  };
});

import { placeLanguageMenu } from "../../client/translation/language-picker";
import { TimelineTranslationSettings as TimelineTranslationSettingsSection } from "../../client/translation/settings";
import { createEndpointStatusStore } from "../../client/translation/endpoint-status";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f6f6f7",
    surface2: "#ededef",
    border: "#e2e2e6",
    foreground: "#18181b",
    foregroundMuted: "#62626b",
    accent: "#2563eb",
    accentForeground: "#ffffff",
    statusSuccess: "#1f8a5b",
    statusWarning: "#a36a00",
    statusDanger: "#d92d20",
  },
};

function makeLook(compact = false, lang: "en" | "zh" = "en") {
  const tokens = buildThemeTokens(theme.colors, { ...DEFAULT_PREFERENCES, language: lang }, { platform: "web" });
  return { compact, tokens, t: SETTINGS_STRINGS[lang] };
}

function makeReadySettings(values: Partial<TimelineTranslationSettings> = {}, options?: { saveResult?: boolean; reload?: () => Promise<void> }) {
  const parsed = timelineTranslationSettingsSchema.parse(values);
  return {
    status: "ready" as const,
    values: parsed,
    revision: "rev-1",
    saving: false,
    saveError: null,
    save: vi.fn(async (next: TimelineTranslationSettings, rev: string) => {
      await mocks.saveSpy(next, rev);
      return options?.saveResult ?? true;
    }),
    reset: vi.fn(async () => true),
    reload: options?.reload ?? vi.fn(async () => {}),
  };
}

function textValues(root: ReactTestInstance): string[] {
  return root
    .findAll((node) => (node.type as unknown) === "Text")
    .map((node) => {
      const children = node.props.children;
      if (typeof children === "string") return children;
      if (Array.isArray(children)) return children.filter((c) => typeof c === "string").join("");
      return "";
    })
    .filter(Boolean);
}

let renderer: ReturnType<typeof TestRenderer.create> | undefined;

beforeEach(() => {
  resetEnhancerPreferences();
  updateEnhancerPreferences({ language: "en" });
  resetTranslationSettingsStoreForTests();
  // A fresh host per test: its endpoint status store starts empty.
  mocks.host = {};
  mocks.saveSpy.mockReset();
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (name: string, input: { endpoint?: string }) => {
    if (name === "translation.endpoint-status") return statusFor(input.endpoint ?? "", { status: "none" });
    throw new Error(`unexpected RPC ${name}`);
  });
});

const OK_ENDPOINT = "https://api.example.test/v1";

/** What the daemon would answer for `endpoint`; tests only need the ok and invalid shapes. */
function statusFor(endpoint: string, key: unknown) {
  if (!endpoint) return { endpoint: { status: "empty" }, key };
  if (endpoint.startsWith("http://") && !endpoint.startsWith("http://127.0.0.1")) {
    return { endpoint: { status: "invalid", problem: "insecure_remote" }, key };
  }
  const origin = new URL(endpoint).origin;
  return { endpoint: { status: "ok", requestUrl: `${endpoint.replace(/\/$/, "")}/chat/completions`, origin, loopback: false }, key };
}

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("timeline translation settings", () => {
  it("defaults translation to off while preserving saved choices", () => {
    expect(timelineTranslationSettingsSchema.parse({}).enabled).toBe(false);
    expect(timelineTranslationSettingsSchema.parse({ enabled: false }).enabled).toBe(false);
    expect(timelineTranslationSettingsSchema.parse({ enabled: true }).enabled).toBe(true);
  });

  it("collapses translation controls while disabled and restores saved settings when enabled", async () => {
    const saved = { endpoint: "https://api.example.test/v1", endpointModel: "saved-model", targetLanguage: "ja", prompt: "Keep formatting." };
    const page = <TimelineTranslationSettingsSection look={makeLook()} />;
    const show = async (enabled: boolean) => {
      mocks.settingsState = makeReadySettings({ ...saved, enabled });
      await act(async () => {
        if (renderer) renderer.update(React.cloneElement(page));
        else renderer = TestRenderer.create(page);
      });
    };
    const field = (label: string) => renderer!.root.findAll((node) =>
      (node.type as unknown) === "TextInput" && node.props.accessibilityLabel === label);
    await show(false);
    expect(field("API Base URL")).toHaveLength(0);
    expect(field("API key")).toHaveLength(0);
    expect(field("Model")).toHaveLength(0);
    expect(renderer!.root.findAllByType(SectionFooter)).toHaveLength(0);
    expect(textValues(renderer!.root)).not.toContain("Restore default translation settings");
    const master = renderer!.root.find((node) => node.props.accessibilityRole === "switch" && node.props.accessibilityLabel === "Enable translation");
    await act(async () => master.props.onPress());
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(expect.objectContaining({ ...saved, enabled: true }), "rev-1");
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "translation.api-key")).toEqual([]);
    await show(true);
    expect(field("API Base URL")[0]!.props.value).toBe(saved.endpoint);
    expect(field("Model")[0]!.props.value).toBe(saved.endpointModel);
    expect(renderer!.root.findAllByType(SectionFooter)).toHaveLength(1);
    await show(false);
    expect(field("API Base URL")).toHaveLength(0);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "translation.api-key")).toEqual([]);
  });

  it("keeps a save error visible when translation is disabled", async () => {
    mocks.settingsState = { ...makeReadySettings({ enabled: false }), saveError: "Write rejected" };
    await act(async () => { renderer = TestRenderer.create(<TimelineTranslationSettingsSection look={makeLook()} />); });
    expect(textValues(renderer!.root)).toContain("Write rejected");
    expect(renderer!.root.findAllByType(SectionFooter)).toHaveLength(0);
  });

  it("toggles master switch, searches 119 languages, and saves selected target language", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, targetLanguage: "interface" });

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(TimelineTranslationSettingsSection, { look: makeLook() }),
      );
    });

    const masterSwitch = renderer!.root.find(
      (n) => n.props.accessibilityRole === "switch" && n.props.accessibilityLabel === "Enable translation",
    );
    await act(async () => {
      masterSwitch.props.onPress();
    });
    expect(mocks.saveSpy).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }), "rev-1");

    // Open target language picker, search by code and select Serbian (Latin).
    const langTrigger = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Target language",
    );
    await act(async () => {
      langTrigger.props.onPress();
    });

    const searchInput = renderer!.root.find((n) => (n.type as unknown) === "TextInput" && n.props.placeholder === "Search language or code...");
    await act(async () => {
      searchInput.props.onChangeText("sr-latn");
    });

    const textsAfterFilter = textValues(renderer!.root);
    expect(textsAfterFilter.some((t) => t.includes("Serbian (Latin)"))).toBe(true);
    expect(textsAfterFilter.some((t) => t.includes("Japanese"))).toBe(false);

    const clear = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Clear search");
    await act(async () => { clear.props.onPress(); });
    expect(textValues(renderer!.root).some((t) => t.includes("Japanese"))).toBe(true);
    await act(async () => { searchInput.props.onChangeText("sr-latn"); });

    const srLatnOption = renderer!.root.find(
      (n) =>
        n.props.accessibilityRole === "button" &&
        n.props.accessibilityState?.selected === false &&
        n.findAll((c) => (c.type as unknown) === "Text" && c.props.children === "sr-Latn").length > 0,
    );
    await act(async () => {
      srLatnOption.props.onPress();
    });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetLanguage: "sr-Latn" }),
      "rev-1",
    );
  });

  it("places the web language menu beside its control, sized to the side it opens on", () => {
    const chrome = 63;
    const viewport = { width: 1024, height: 768 };
    for (const top of [8, 100, 300, 420, 520, 600, 690, 724]) {
      const rect = { top, bottom: top + 36, right: 600, width: 200 };
      const place = placeLanguageMenu(rect, viewport);
      const height = place.listMaxHeight + chrome;
      const menuTop = place.top ?? viewport.height - place.bottom! - height;
      const menuBottom = place.top !== undefined ? place.top + height : viewport.height - place.bottom!;
      // Never over the control, and inside the window whenever that side holds a short list.
      expect(menuBottom <= rect.top || menuTop >= rect.bottom, `top ${top}`).toBe(true);
      const room = place.top !== undefined ? viewport.height - rect.bottom - 14 : rect.top - 14;
      if (room >= chrome + 96) expect(menuTop >= 8 && menuBottom <= viewport.height - 8, `top ${top}`).toBe(true);
    }
    // Opening upward anchors the menu's bottom to the control, so a filtered, shorter list stays attached.
    expect(placeLanguageMenu({ top: 600, bottom: 636, right: 600, width: 200 }, viewport)).toEqual({ bottom: 174, left: 320, width: 280, listMaxHeight: 340 });
    expect(placeLanguageMenu({ top: 212, bottom: 248, right: 600, width: 200 }, { width: 1024, height: 300 })).toMatchObject({ bottom: 94, listMaxHeight: 135 });
  });

  it("keeps the web language menu on its control while the page scrolls", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const listeners = new Map<string, (event: Event) => void>();
    vi.stubGlobal("window", {
      innerWidth: 1024, innerHeight: 768,
      addEventListener: (type: string, listener: (event: Event) => void) => { listeners.set(type, listener); },
      removeEventListener: (type: string) => { listeners.delete(type); },
    });
    try {
      let rect = { top: 100, bottom: 136, right: 600, width: 200, left: 400, height: 36 };
      class BrowserNode extends EventTarget {}
      vi.stubGlobal("Node", BrowserNode);
      const menuChild = new BrowserNode();
      const measure = vi.fn(() => rect);
      mocks.settingsState = makeReadySettings({ enabled: true });
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() }), {
          createNodeMock: () => ({ style: {}, getBoundingClientRect: measure, contains: (node: unknown) => node === menuChild }),
        });
      });
      const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Target language");
      await act(async () => { trigger.props.onPress(); });
      const menuPlacement = () => renderer!.root.find((n) => String(n.type) === "View" && n.findAll((c) => (c.type as unknown) === "TextInput").length > 0 &&
        JSON.stringify(n.props.style).includes("fixed")).props.style.flat().find((part: { top?: number }) => part && "top" in part);
      const initialPlacement = menuPlacement();
      expect(initialPlacement).toMatchObject({ top: 142, bottom: "auto", right: "auto", margin: 0 });
      measure.mockClear();
      await act(async () => { listeners.get("scroll")!({ target: menuChild } as unknown as Event); });
      expect(measure).not.toHaveBeenCalled();
      await act(async () => { listeners.get("scroll")!(new Event("scroll")); });
      expect(menuPlacement()).toBe(initialPlacement);
      rect = { ...rect, top: 40, bottom: 76 };
      await act(async () => { listeners.get("scroll")!(new Event("scroll")); });
      expect(menuPlacement().top).toBe(82);
      // Near the window's bottom it opens upward. `top: auto` releases a popover's
      // UA `inset: 0`, which otherwise pins it to the top (checked in Chromium).
      rect = { ...rect, top: 600, bottom: 636 };
      await act(async () => { listeners.get("scroll")!(new Event("scroll")); });
      expect(menuPlacement()).toMatchObject({ top: "auto", right: "auto", bottom: 174 });
      await act(async () => renderer!.unmount());
      renderer = undefined;
      expect(listeners.has("scroll")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  const input = (label: string) => renderer!.root.find((n) => (n.type as unknown) === "TextInput" && n.props.accessibilityLabel === label);
  const pressable = (label: string) => renderer!.root.find((n) => typeof n.type === "string" && n.props.accessibilityRole === "button" && n.props.accessibilityLabel === label);
  const render = async (values: Partial<TimelineTranslationSettings>, lang: "en" | "zh" = "en") => {
    mocks.settingsState = makeReadySettings({ enabled: true, ...values });
    const page = <TimelineTranslationSettingsSection look={makeLook(false, lang)} />;
    await act(async () => {
      if (renderer) renderer.update(page);
      else renderer = TestRenderer.create(page);
    });
    await act(async () => {});
  };

  it("keeps edits as drafts until Save configuration and saves them together", async () => {
    await render({ endpoint: "", endpointModel: "" });
    await act(async () => input("API Base URL").props.onChangeText(`  ${OK_ENDPOINT} `));
    await act(async () => input("Model").props.onChangeText("gpt-test"));
    expect(mocks.saveSpy).not.toHaveBeenCalled();
    await act(async () => pressable("Save configuration").props.onPress());
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(expect.objectContaining({ endpoint: OK_ENDPOINT, endpointModel: "gpt-test" }), "rev-1");
  });

  it("tests unsaved values and reports the result without saving", async () => {
    mocks.rpc.mockImplementation(async (name: string, request: { endpoint: string }) => {
      if (name === "translation.test") return { ok: true };
      return statusFor(request.endpoint, { status: "none" });
    });
    await render({ endpoint: "", endpointModel: "" });
    await act(async () => input("API Base URL").props.onChangeText(OK_ENDPOINT));
    await act(async () => input("API key").props.onChangeText("example-key"));
    await act(async () => input("Model").props.onChangeText("model-one"));
    await act(async () => pressable("Test connection").props.onPress());
    expect(mocks.rpc).toHaveBeenCalledWith("translation.test", { endpoint: OK_ENDPOINT, model: "model-one", apiKey: "example-key" }, mocks.host);
    expect(textValues(renderer!.root)).toContain("Connection successful. The model responded.");
    expect(mocks.saveSpy).not.toHaveBeenCalled();
    await act(async () => input("Model").props.onChangeText("model-two"));
    expect(textValues(renderer!.root)).not.toContain("Connection successful. The model responded.");
  });

  it("shows a failed connection test and allows retry", async () => {
    mocks.rpc.mockImplementation(async (name: string, request: { endpoint: string }) => {
      if (name === "translation.test") throw new Error("HTTP 401");
      return statusFor(request.endpoint, { status: "none" });
    });
    await render({ endpoint: OK_ENDPOINT, endpointModel: "m" });
    await act(async () => pressable("Test connection").props.onPress());
    expect(textValues(renderer!.root)).toContain("Connection failed: HTTP 401");
    expect(pressable("Test connection").props.disabled).toBe(false);
  });

  it("saves a key only after its endpoint and clears the write-only draft", async () => {
    const key = "sk-settings-SECRET-42";
    let saved = false;
    mocks.rpc.mockImplementation(async (name: string, request: { endpoint: string; action?: string }) => {
      if (name === "translation.api-key") saved = request.action === "save";
      return statusFor(request.endpoint, saved ? { status: "saved", origin: "https://api.example.test", matches: true, masked: "sk-t****1234" } : { status: "none" });
    });
    await render({ endpoint: OK_ENDPOINT, endpointModel: "m" });
    expect(input("API key").props.secureTextEntry).toBe(true);
    await act(async () => pressable("Show API key").props.onPress());
    expect(input("API key").props.secureTextEntry).toBe(false);
    await act(async () => input("API key").props.onChangeText(key));
    await act(async () => pressable("Save configuration").props.onPress());
    expect(mocks.saveSpy).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("translation.api-key", { action: "save", endpoint: OK_ENDPOINT, apiKey: key }, mocks.host);
    expect(input("API key").props.value).toBe("");
    expect(input("API key").props.secureTextEntry).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain(key);
    await act(async () => pressable("Clear key").props.onPress());
    expect(mocks.rpc).toHaveBeenLastCalledWith("translation.api-key", { action: "clear", endpoint: OK_ENDPOINT }, mocks.host);
  });

  it("shows the saved mask and reveals the key only on request", async () => {
    let saved = true;
    mocks.rpc.mockImplementation(async (name: string, request: { endpoint: string; action?: string }) => {
      if (name === "translation.reveal-key") return { origin: "https://api.example.test", apiKey: "sk-test-1234" };
      if (name === "translation.api-key") saved = false;
      return statusFor(request.endpoint, saved ? { status: "saved", origin: "https://api.example.test", matches: true, masked: "sk-t****1234" } : { status: "none" });
    });
    await render({ endpoint: OK_ENDPOINT, endpointModel: "m" });
    expect(input("API key").props.placeholder).toBe("sk-t****1234");
    expect(mocks.rpc.mock.calls.some(([name]) => name === "translation.reveal-key")).toBe(false);
    await act(async () => pressable("Show API key").props.onPress());
    expect(input("API key").props.placeholder).toBe("sk-test-1234");
    await act(async () => pressable("Hide API key").props.onPress());
    expect(input("API key").props.placeholder).toBe("sk-t****1234");
    await act(async () => input("API key").props.onChangeText("new-secret"));
    await act(async () => pressable("Test connection").props.onPress());
    expect(mocks.rpc).toHaveBeenCalledWith("translation.test", { endpoint: OK_ENDPOINT, model: "m", apiKey: "new-secret" }, mocks.host);
    await act(async () => pressable("Clear key").props.onPress());
    expect(input("API key").props.placeholder).toBe("Paste a new key");
  });

  it("does not reveal a key after it was cleared while the read was pending", async () => {
    let resolve!: (value: unknown) => void;
    mocks.rpc.mockImplementation(async (name: string, request: { endpoint: string }) => {
      if (name === "translation.reveal-key") return new Promise((done) => { resolve = done; });
      if (name === "translation.api-key") return statusFor(request.endpoint, { status: "none" });
      return statusFor(request.endpoint, { status: "saved", origin: "https://api.example.test", matches: true, masked: "sk-t****1234" });
    });
    await render({ endpoint: OK_ENDPOINT, endpointModel: "m" });
    act(() => pressable("Show API key").props.onPress());
    await act(async () => pressable("Clear key").props.onPress());
    await act(async () => resolve({ origin: "https://api.example.test", apiKey: "sk-test-1234" }));
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("sk-test-1234");
    expect(input("API key").props.placeholder).toBe("Paste a new key");
  });

  it("applies and updates the web font directly on all three inputs", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    mocks.settingsState = makeReadySettings({ enabled: true, endpoint: OK_ENDPOINT, endpointModel: "m" });
    const nodes = new Map<string, { style: { fontFamily: string } }>();
    const look = makeLook();
    await act(async () => {
      renderer = TestRenderer.create(<TimelineTranslationSettingsSection look={look} />, {
        createNodeMock(element) {
          if (element.type !== "TextInput") return null;
          const node = { style: { fontFamily: "" } };
          nodes.set((element.props as { accessibilityLabel: string }).accessibilityLabel, node);
          return node;
        },
      });
    });
    for (const label of ["API Base URL", "API key", "Model"]) expect(nodes.get(label)?.style.fontFamily).toBe(look.tokens.fontMono);
    const changed = { ...look, tokens: { ...look.tokens, fontMono: "Menlo, monospace" } };
    await act(async () => renderer!.update(<TimelineTranslationSettingsSection look={changed} />));
    for (const label of ["API Base URL", "API key", "Model"]) expect(nodes.get(label)?.style.fontFamily).toBe(changed.tokens.fontMono);
  });

  it.each(["API Base URL", "API key", "Model"])("changes the %s border on focus", async (label) => {
    await render({ endpoint: OK_ENDPOINT, endpointModel: "m" });
    const border = () => label === "API key" ? input(label).parent!.props.style : input(label).props.style;
    const color = () => Object.assign({}, ...border().filter(Boolean)).borderColor;
    expect(color()).toBe(makeLook().tokens.v2.border);
    await act(async () => input(label).props.onFocus());
    expect(color()).toBe(makeLook().tokens.foregroundMuted);
    await act(async () => input(label).props.onBlur());
    expect(color()).toBe(makeLook().tokens.v2.border);
  });

  it("does not send the key if saving the endpoint fails", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, endpoint: OK_ENDPOINT, endpointModel: "m" }, { saveResult: false });
    await act(async () => { renderer = TestRenderer.create(<TimelineTranslationSettingsSection look={makeLook()} />); });
    await act(async () => input("API Base URL").props.onChangeText("https://new.example.test/v1"));
    await act(async () => input("API key").props.onChangeText("draft-key"));
    await act(async () => pressable("Save configuration").props.onPress());
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "translation.api-key")).toEqual([]);
    expect(input("API key").props.value).toBe("draft-key");
    expect(textValues(renderer!.root)).toContain("Could not save configuration.");
  });

  it("does not carry one host's saved key status into another host", async () => {
    const hostA = {};
    const hostB = {};
    mocks.rpc.mockImplementation(async (_name: string, request: { endpoint: string }, host: object) => statusFor(request.endpoint,
      host === hostA ? { status: "saved", origin: "https://api.example.test", matches: true, masked: "sk-t****1234" } : { status: "none" }));
    mocks.host = hostA;
    await render({ endpoint: OK_ENDPOINT, endpointModel: "m" });
    expect(textValues(renderer!.root)).toContain("A key is saved for https://api.example.test.");
    mocks.host = hostB;
    await render({ endpoint: OK_ENDPOINT, endpointModel: "m" });
    expect(textValues(renderer!.root)).not.toContain("A key is saved for https://api.example.test.");
    expect(textValues(renderer!.root)).toContain("No key saved: requests carry no Authorization header.");
  });

  it("reads again when a key write is overtaken by a read on the same host", async () => {
    const store = createEndpointStatusStore();
    const deferred = () => {
      let resolve!: (value: unknown) => void;
      const promise = new Promise<never>((done) => { resolve = done as never; });
      return { promise, resolve };
    };
    const write = deferred();
    const firstRead = deferred();
    const reads = vi.fn()
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(async () => statusFor(OK_ENDPOINT, { status: "saved", origin: "https://api.example.test", matches: true, masked: "sk-t****1234" }));
    const writing = store.write(OK_ENDPOINT, () => write.promise);
    void store.read(OK_ENDPOINT, reads);
    // The read went out before the write was applied: it still sees no key.
    firstRead.resolve(statusFor(OK_ENDPOINT, { status: "none" }));
    await Promise.resolve(); await Promise.resolve();
    expect(store.snapshot()).toMatchObject({ status: "ready", value: { key: { status: "none" } } });
    write.resolve(statusFor(OK_ENDPOINT, { status: "saved", origin: "https://api.example.test", matches: true, masked: "sk-t****1234" }));
    expect(await writing).toEqual({ kind: "superseded" });
    // The overtaken write does not publish its own answer, but the latest read runs once more.
    await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.snapshot()).toMatchObject({ status: "ready", value: { key: { status: "saved" } } }));
  });

  it("keeps the draft and shows the error when saving a key fails", async () => {
    mocks.rpc.mockImplementation(async (name: string, request: { endpoint: string }) => {
      if (name === "translation.api-key") throw new Error("The API key must be printable ASCII without spaces.");
      return statusFor(request.endpoint, { status: "none" });
    });
    await render({ endpoint: OK_ENDPOINT, endpointModel: "m" });
    await act(async () => input("API key").props.onChangeText("has space"));
    await act(async () => pressable("Save configuration").props.onPress());
    expect(input("API key").props.value).toBe("has space");
    expect(textValues(renderer!.root)).toContain("The API key must be printable ASCII without spaces.");
  });

  it("warns that a key saved for another origin blocks translation", async () => {
    mocks.rpc.mockImplementation(async (_name: string, request: { endpoint: string }) =>
      statusFor(request.endpoint, { status: "saved", origin: "https://old.example.test", matches: false, masked: "sk-t****1234" }));
    await render({ endpoint: OK_ENDPOINT, endpointModel: "m" });
    expect(textValues(renderer!.root)).toContain(
      "The saved key belongs to https://old.example.test. Translation is blocked until you save a key for this endpoint or clear it.");
    expect(pressable("Clear key").props.disabled).toBe(false);
  });

  it.each([
    ["en", ["directly to the endpoint above", "The request offers no tools", "Stored unencrypted", "does not use the conversation's provider, model or account"]],
    ["zh", ["直接发送到上方端点", "请求不提供任何工具", "以明文保存在 daemon 所在机器", "不使用会话的 Provider、模型或账号"]],
  ] as const)("states where text goes and how the key is stored (%s)", async (lang, phrases) => {
    updateEnhancerPreferences({ language: lang });
    await render({ endpoint: OK_ENDPOINT, endpointModel: "m" }, lang);
    const texts = textValues(renderer!.root).join("\n");
    for (const phrase of phrases) expect(texts).toContain(phrase);
    expect(texts).not.toMatch(/helper agent|辅助 Agent/);
  });

  it("shows only the latest endpoint status when an earlier read answers last", async () => {
    let answerFirst!: (value: unknown) => void;
    mocks.rpc.mockImplementationOnce(() => new Promise((resolve) => { answerFirst = resolve; }));
    await render({ endpoint: "https://first.example.test/v1", endpointModel: "m" });
    await render({ endpoint: OK_ENDPOINT, endpointModel: "m" });
    expect(textValues(renderer!.root)).toContain("The Paseo daemon sends selected text to POST https://api.example.test/v1/chat/completions.");
    await act(async () => answerFirst(statusFor("https://first.example.test/v1", { status: "none" })));
    const texts = textValues(renderer!.root);
    expect(texts).toContain("The Paseo daemon sends selected text to POST https://api.example.test/v1/chat/completions.");
    expect(texts.join("\n")).not.toContain("first.example.test");
  });

  it("lists the endpoint rows in order and edits/resets the prompt", async () => {
    mocks.settingsState = makeReadySettings({
      enabled: true,
      endpoint: OK_ENDPOINT,
      endpointModel: "test-model",
    });

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(TimelineTranslationSettingsSection, { look: makeLook() }),
      );
    });
    await act(async () => {});

    expect(mocks.rpc).toHaveBeenCalledWith("translation.endpoint-status", { endpoint: OK_ENDPOINT }, mocks.host);
    const allTexts = textValues(renderer!.root).join("\n");
    expect(allTexts).not.toMatch(/Provider|Thinking level|Disable thinking/);
    const section = renderer!.root.findByType(Section);
    expect(section.findAllByType(SettingRow).map((row) => row.props.title)).toEqual([
      "Enable translation", "API Base URL", "API key", "Model", "Test connection", "Target language",
      "Translation prompt", "Restore default translation settings",
    ]);
    expect(section.findByType(SectionFooter)).toBeDefined();

    // Open prompt modal, change prompt, save, then test 2-step reset.
    const editBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Edit prompt",
    );
    await act(async () => {
      editBtn.props.onPress();
    });

    const modalInput = renderer!.root.find(
      (n) => (n.type as unknown) === "TextInput" && n.props.multiline === true,
    );
    expect(modalInput.props.maxLength).toBe(8000);
    await act(async () => {
      modalInput.props.onChangeText("Keep identifiers exact. Translate cleanly.");
    });

    const saveBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Save",
    );
    await act(async () => {
      saveBtn.props.onPress();
    });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: "Keep identifiers exact. Translate cleanly." }),
      "rev-1",
    );

    const resetBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Reset · Restore default translation settings",
    );
    await act(async () => {
      resetBtn.props.onPress();
    });
    // First click asks for confirmation without saving yet.
    const confirmBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Confirm · Restore default translation settings",
    );
    await act(async () => {
      confirmBtn.props.onPress();
    });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: DEFAULT_TRANSLATION_PROMPT, enabled: false, targetLanguage: "interface", endpoint: "", endpointModel: "" }),
      "rev-1",
    );
    // Restoring defaults leaves the saved key alone: no key RPC.
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "translation.api-key")).toEqual([]);
  });

  it("shows an untouched earlier default prompt as the default and saves the current text", async () => {
    const legacyDefault =
      "Translate the supplied text into the target language. Preserve Markdown, code blocks, inline code, commands, paths, links, and technical identifiers. Return only the translation, without explanations.";
    const button = (label: string) => renderer!.root.find(
      (node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === label,
    );
    const promptInput = () => renderer!.root.find(
      (node) => typeof node.type === "string" && node.props.multiline === true,
    );
    const render = async (prompt: string) => {
      mocks.settingsState = makeReadySettings({ enabled: true, prompt });
      await act(async () => { renderer = TestRenderer.create(<TimelineTranslationSettingsSection look={makeLook()} />); });
    };

    await render("Keep it terse.");
    expect(textValues(renderer!.root)).not.toContain("Keep it terse.");
    await act(async () => button("Edit prompt").props.onPress());
    expect(promptInput().props.value).toBe("Keep it terse.");
    expect(button("Save").props.disabled).toBe(true);
    await act(async () => button("Reset prompt").props.onPress());
    expect(promptInput().props.value).toBe(DEFAULT_TRANSLATION_PROMPT);
    expect(mocks.saveSpy).not.toHaveBeenCalled();
    await act(async () => button("Save").props.onPress());
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: DEFAULT_TRANSLATION_PROMPT }), "rev-1");
    act(() => renderer!.unmount());

    // The host parses saved settings before exposing them to the page.
    await render(legacyDefault);
    await act(async () => button("Edit prompt").props.onPress());
    expect(promptInput().props.value).toBe(DEFAULT_TRANSLATION_PROMPT);
    expect(button("Save").props.disabled).toBe(true);
    await act(async () => button("Cancel").props.onPress());

    const masterSwitch = renderer!.root.find(
      (n) => n.props.accessibilityRole === "switch" && n.props.accessibilityLabel === "Enable translation",
    );
    await act(async () => {
      masterSwitch.props.onPress();
    });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, prompt: DEFAULT_TRANSLATION_PROMPT }),
      "rev-1",
    );
  });

  it("keeps the editor limit aligned with the translation schema", () => {
    const longestPrompt = "a".repeat(TRANSLATION_PROMPT_MAX_LENGTH);
    expect(timelineTranslationSettingsSchema.parse({ prompt: ` ${longestPrompt} ` }).prompt).toBe(longestPrompt);
    expect(timelineTranslationSettingsSchema.parse({ prompt: `${longestPrompt}a` }).prompt).toBe(DEFAULT_TRANSLATION_PROMPT);
  });

  it("keeps the footer in place while saving and shows errors in context", async () => {
    const ready = makeReadySettings({ enabled: true, endpoint: OK_ENDPOINT, endpointModel: "m" });
    mocks.settingsState = ready;
    mocks.rpc.mockRejectedValue(new Error("Status offline"));
    const look = makeLook();
    const page = <TimelineTranslationSettingsSection look={look} />;
    await act(async () => { renderer = TestRenderer.create(page); });
    const root = () => renderer!.root.findByType(Section).find((node) => (node.type as unknown) === "View" && "aria-busy" in node.props);
    const footerTop = () => {
      const footer = renderer!.root.findByType(SectionFooter).findAll((node) => (node.type as unknown) === "View")[0]!;
      return measureHostTree(root(), { width: 320, wrapText: true }).get(footer)!.top;
    };
    const updateState = async (next: unknown) => {
      mocks.settingsState = next;
      await act(async () => renderer!.update(React.cloneElement(page)));
    };
    const alerts = () => renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "alert");
    const topBeforeSave = footerTop();
    await updateState({ ...ready, saving: true });
    expect(root().props["aria-busy"]).toBe(true);
    expect(footerTop()).toBe(topBeforeSave);
    const enabled = renderer!.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Enable translation");
    expect(enabled.props.disabled).toBe(true);
    await updateState({ ...ready, saveError: "Write rejected" });
    expect(root().props["aria-busy"]).toBe(false);
    expect(alerts().map((node) => node.children.join(""))).toEqual(["Write rejected"]);
    for (const alert of alerts()) expect(alert.props.style).toContainEqual(expect.objectContaining({ color: look.tokens.danger }));
    const texts = textValues(renderer!.root);
    const statusLine = texts.findIndex((text) => text === "Could not check the endpoint: Status offline");
    expect(statusLine).toBeGreaterThan(texts.indexOf("API Base URL"));
    expect(statusLine).toBeLessThan(texts.indexOf("Model"));
    expect(texts.indexOf("Write rejected")).toBeGreaterThan(texts.indexOf("Restore default translation settings"));
    expect(texts.indexOf("Write rejected")).toBeLessThan(texts.indexOf("Manual only"));
    await updateState({ ...ready, status: "error", error: "Host offline" });
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]!.children.join("")).toContain("Host offline");
    const failedTexts = textValues(renderer!.root);
    expect(failedTexts.findIndex((text) => text.includes("Host offline"))).toBeLessThan(failedTexts.indexOf("Enable translation"));
  });

  it.each([[false, 280], [false, 320], [false, 440], [true, 320]])("fits the language menu and key row at a large text size (compact %s, width %i)", async (compact, width) => {
    mocks.settingsState = makeReadySettings({ enabled: true, endpoint: OK_ENDPOINT, endpointModel: "a-model-with-a-very-long-identifier" });
    await act(async () => {
      renderer = TestRenderer.create(<TimelineTranslationSettingsSection look={makeLook(compact as boolean)} />);
    });
    const root = renderer!.root.findByType(Section).findAll((node) => node.type === ("View" as React.ElementType))[0]!;
    const frames = measureHostTree(root, { width: width as number, wrapText: true, textScale: 1.4 });
    const frameOf = (label: string) => frames.get(root.find((node) =>
      typeof node.type === "string" && node.props.accessibilityLabel === label &&
      (node.props.accessibilityRole === "button" || (node.type as unknown) === "TextInput"),
    ))!;
    expect(frameOf("Target language").width).toBeGreaterThanOrEqual(168);
    for (const label of ["Target language", "API Base URL", "Model", "API key", "Show API key", "Test connection", "Save configuration"]) {
      const frame = frameOf(label);
      expect(frame.width, label).toBeGreaterThan(0);
      expect(frame.left + frame.width, label).toBeLessThanOrEqual((width as number) - 16);
    }
    const target = root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Target language");
    expect(frames.get(target.findByType("Icon" as never))?.width).toBe(14);
  });

  it("renders natively in Chinese and uses Modal for language picker on iOS", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    updateEnhancerPreferences({ language: "zh" });
    mocks.settingsState = makeReadySettings({ enabled: true });

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(TimelineTranslationSettingsSection, { look: makeLook(true, "zh") }),
      );
    });

    const texts = textValues(renderer!.root).join("\n");
    expect(renderer!.root.findByType(Section).props.title).toBe("翻译");
    expect(texts).toContain("跟随界面语言");

    const trigger = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "目标语言",
    );
    await act(async () => {
      trigger.props.onPress();
    });
    expect(renderer!.root.findAll((n) => (n.type as unknown) === "Modal")).toHaveLength(1);
  });

  it("syncs through useSettings without optimistic overwrite on conflict and surfaces invalid/error states", async () => {
    const reload = vi.fn(async () => {});
    mocks.settingsState = makeReadySettings({ enabled: true, targetLanguage: "interface" }, { saveResult: false, reload });

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(TimelineTranslationSettingsSection, { look: makeLook() }),
      );
    });

    expect(getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "rev-1", values: { enabled: true } });

    const masterSwitch = renderer!.root.find(
      (n) => n.props.accessibilityRole === "switch" && n.props.accessibilityLabel === "Enable translation",
    );
    await act(async () => {
      masterSwitch.props.onPress();
    });
    // Failed save must not leave store diverged from daemon; triggers reload instead.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(getTranslationSettingsState().values.enabled).toBe(true);

    // External host change updates revision cleanly.
    const rev2 = timelineTranslationSettingsSchema.parse({ enabled: true, targetLanguage: "ja" });
    await act(async () => {
      mocks.settingsState = { ...makeReadySettings(rev2), revision: "rev-2" };
      renderer!.update(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() }));
    });
    expect(getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "rev-2", values: { targetLanguage: "ja" } });

    // Stale/duplicate error & invalid states surface explicitly without swallowing.
    await act(async () => {
      reportTranslationSettings({ status: "invalid", error: "Corrupt JSON schema", revision: "rev-3" });
      mocks.settingsState = {
        status: "invalid",
        error: "Corrupt JSON schema",
        revision: "rev-3",
        saving: false,
        saveError: null,
        save: vi.fn(async () => false),
        reset: vi.fn(async () => true),
        reload: vi.fn(async () => {}),
      };
      renderer!.update(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() }));
    });
    expect(getTranslationSettingsState()).toMatchObject({ status: "invalid", error: "Corrupt JSON schema" });
    expect(textValues(renderer!.root).join("\n")).toContain("Corrupt JSON schema");
  });
});
