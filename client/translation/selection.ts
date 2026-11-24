import { createContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { usePaseo } from "@getpaseo/plugin/client";
import type { PaseoApi } from "@getpaseo/client";
import type {
  TimelineTranslationSettings,
  TranslateTimelineItemInput,
  TranslationJobState,
} from "../../shared/timeline-translation";
import { resolveTranslationTarget } from "../../shared/translation-languages";
import { getEnhancerPreferences } from "../preferences";
import { resolveLanguage } from "../i18n/settings-strings";
import { currentFreeService, freeServiceForOrigin, freeServiceInfo } from "../../shared/free-translation";
import { translationSettingsSync, type TranslationSettingsSnapshot } from "./settings-store";
import {
  hashTranslationText,
  translationStore,
  useTranslateCaller,
  type TranslationEntry,
  type TranslationSourceKind,
} from "./store";

/**
 * Translation of one explicit selection: the text a reader highlighted on web,
 * or the block they double-tapped on iOS and Android. Nothing here reads the
 * rest of the reply; the only text that leaves the client is `text`.
 *
 * A selection belongs to the conversation it was made in. Renderers that allow
 * it wrap their content in `SelectionTranslationScope`; content without a scope
 * (settings previews, a translation shown in a popup) offers no
 * Translate action.
 */
export interface SelectionTranslationScopeValue {
  agentId: string;
  kind: TranslationSourceKind;
  /** Whether the source is still streaming. */
  streaming: boolean;
  /**
   * Web only: the RPC caller and Paseo API of the React tree that drew this
   * prose, so the selection bar sends through the host the text came from.
   */
  lent?: LentTranslator;
}

export const SelectionTranslationContext = createContext<SelectionTranslationScopeValue | null>(null);

const hostSerials = new WeakMap<object, number>();
let hostSerial = 0;

/** A session-local name for a host's API object: two hosts never share a cache entry. */
function hostKey(host: object | undefined): string {
  if (!host) return "h0";
  let serial = hostSerials.get(host);
  if (serial === undefined) hostSerials.set(host, serial = ++hostSerial);
  return `h${serial}`;
}

/** One cache entry per host, conversation, kind and exact selected text. */
export function selectionSourceKey(host: object | undefined, agentId: string, kind: TranslationSourceKind, text: string): string {
  return `${hostKey(host)}:${agentId}:selection:${kind}:${hashTranslationText(text)}`;
}

/** The DOM attributes a scope's Markdown root carries on web (`dataSet` → `data-*`). */
export const SELECTION_SCOPE_ATTRIBUTES = {
  agent: "bctlagent",
  kind: "bctlkind",
  streaming: "bctlstreaming",
} as const;

export function selectionScopeDataSet(scope: SelectionTranslationScopeValue | null): Record<string, string> | null {
  if (!scope) return null;
  return {
    [SELECTION_SCOPE_ATTRIBUTES.agent]: scope.agentId,
    [SELECTION_SCOPE_ATTRIBUTES.kind]: scope.kind,
    [SELECTION_SCOPE_ATTRIBUTES.streaming]: scope.streaming ? "1" : "0",
  };
}

/** Reads a scope back from a `data-*` map; anything malformed is no scope. */
export function selectionScopeFromDataset(dataset: Record<string, string | undefined> | undefined): SelectionTranslationScopeValue | null {
  const agentId = dataset?.[SELECTION_SCOPE_ATTRIBUTES.agent];
  const kind = dataset?.[SELECTION_SCOPE_ATTRIBUTES.kind];
  if (!agentId || (kind !== "assistant_message" && kind !== "user_message" && kind !== "reasoning" && kind !== "tool_output")) return null;
  return { agentId, kind, streaming: dataset?.[SELECTION_SCOPE_ATTRIBUTES.streaming] === "1" };
}

export interface SelectionTranslator {
  call(input: TranslateTimelineItemInput): Promise<TranslationJobState>;
}

export interface LentTranslator {
  translator: SelectionTranslator;
  paseo: PaseoApi;
}

/**
 * The web selection bar is raw DOM, outside every React tree, so it cannot
 * call `useRpc` itself. Each scoped Markdown root binds its own DOM element to
 * its scope, translator included (`MarkdownView`). The bar reads the binding
 * of the element the selection sits in, never a global "latest" one: two panes
 * on different hosts can show the same agent id, and each element answers for
 * the pane that drew it. An element without a binding offers no translation.
 */
const scopedElements = new WeakMap<object, SelectionTranslationScopeValue>();

type ScopeListener = (element: object, scope: SelectionTranslationScopeValue | null) => void;
const scopeListeners = new Set<ScopeListener>();

export function bindSelectionScopeElement(element: object, scope: SelectionTranslationScopeValue | null): void {
  if (scope) scopedElements.set(element, scope);
  else scopedElements.delete(element);
  for (const listener of scopeListeners) listener(element, scope);
}

/**
 * Bindings change without a selection event (a reply settling rebinds its
 * element with `streaming: false`); the bar follows the element it translates.
 */
export function watchSelectionScopeElements(listener: ScopeListener): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

export function selectionScopeForElement(element: object): SelectionTranslationScopeValue | null {
  return scopedElements.get(element) ?? null;
}

export type ResultNoticeInput = Extract<TranslationJobState, { state: "done" }>;

export type SelectionTranslationView = (
  | { status: "settings-loading" }
  | { status: "settings-invalid"; error: string | null }
  | { status: "settings-error"; error: string | null }
  | { status: "disabled" }
  | { status: "streaming"; kind: TranslationSourceKind }
  | { status: "unavailable" }
  /** OpenAI-compatible mode without an endpoint or model: nothing is sent. */
  | { status: "unconfigured" }
  /** The result this selection started under no longer matches the settings. */
  | { status: "stale" }
  | { status: "running"; text?: string; targetCode: string }
  | { status: "done"; result: ResultNoticeInput }
  | { status: "error"; error: string; targetCode: string }) & { modelInfo?: ModelInfo };

/**
 * Who translates. `mark`: a greyscale logo shown before the name, for
 * services Better Paseo knows (the free services); an OpenAI-compatible
 * endpoint has none.
 */
export interface ModelInfo { provider: string; model: string; mark?: string }

function freeMark(service: string | null): { mark?: string } {
  return service ? { mark: `service-gray:${service}` } : {};
}

export interface SelectionTranslationOptions {
  agentId: string;
  kind: TranslationSourceKind;
  text: string;
  streaming: boolean;
  translator: SelectionTranslator | undefined;
  /** Whole-block translations wait for the source to finish. */
  waitForStreaming?: boolean;
  /** The host the text came from (its `PaseoApi`); part of the cache key. */
  host?: object;
  /** Distinguishes repeated text in separate blocks of the same selection. */
  blockIndex?: number;
  settings?: Pick<typeof translationSettingsSync, "snapshot" | "subscribe">;
  interfaceLanguage?: () => "en" | "zh";
}

export interface SelectionTranslation {
  readonly sourceKey: string;
  /** Pressing Translate, or Retry: the only paths that send the text. */
  start(): void;
  setStreaming(streaming: boolean): void;
  setTranslator(translator: SelectionTranslator | undefined): void;
  view(): SelectionTranslationView | null;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

function currentInterfaceLanguage(): "en" | "zh" {
  return resolveLanguage(getEnhancerPreferences().language ?? "system");
}

function sameView(a: SelectionTranslationView | null, b: SelectionTranslationView | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.status !== b.status) return false;
  if (a.modelInfo?.provider !== b.modelInfo?.provider || a.modelInfo?.model !== b.modelInfo?.model ||
    a.modelInfo?.mark !== b.modelInfo?.mark) return false;
  switch (a.status) {
    case "running": {
      const other = b as typeof a;
      return a.text === other.text && a.targetCode === other.targetCode;
    }
    case "done": {
      const other = b as typeof a;
      return a.result === other.result;
    }
    case "error": {
      const other = b as typeof a;
      return a.error === other.error && a.targetCode === other.targetCode;
    }
    case "settings-invalid":
    case "settings-error":
      return a.error === (b as typeof a).error;
    case "streaming":
      return a.kind === (b as typeof a).kind;
    default:
      return true;
  }
}

/**
 * One reader's Translate press for one selection. It does nothing until
 * `start()`; then it waits for the settings before sending. Without an
 * endpoint and model nothing is sent. A result is shown only while it still
 * matches the configuration it was made under: a later settings change turns
 * it stale rather than silently showing or re-sending.
 *
 * Disposing it (the menu closed or the selection moved) stops listening, and
 * a later `start()` picks up again. A job already in flight still lands in the
 * session cache under this selection's own key, where no other selection can
 * read it.
 */
export function createSelectionTranslation(options: SelectionTranslationOptions): SelectionTranslation {
  const settingsSource = options.settings ?? translationSettingsSync;
  const interfaceLanguage = options.interfaceLanguage ?? currentInterfaceLanguage;
  const sourceKey = selectionSourceKey(options.host, options.agentId, options.kind, options.text) +
    (options.blockIndex === undefined ? "" : `:block:${options.blockIndex}`);
  const listeners = new Set<() => void>();
  let streaming = options.streaming;
  let translator = options.translator;
  let requested = false;
  /** Retry asks for a new job even when a valid one is cached. */
  let force = false;
  let startedJob: string | null = null;
  /** Listening to settings and the cache; only between `start()` and `dispose()`. */
  let active = false;
  let releaseSettings: (() => void) | null = null;
  let releaseEntries: (() => void) | null = null;
  let current: SelectionTranslationView | null = null;

  const compute = (): SelectionTranslationView | null => {
    if (!requested) return null;
    const settingsState: TranslationSettingsSnapshot = settingsSource.snapshot();
    if (settingsState.status === "loading") return { status: "settings-loading" };
    if (settingsState.status === "invalid") return { status: "settings-invalid", error: settingsState.error };
    if (settingsState.status === "error") return { status: "settings-error", error: settingsState.error };
    const settings = settingsState.values;
    if (!settings.enabled) return { status: "disabled" };
    if (streaming && options.waitForStreaming) return { status: "streaming", kind: options.kind };
    if (!translator) return { status: "unavailable" };
    if (settings.mode === "openai" && (!settings.endpoint || !settings.endpointModel)) return { status: "unconfigured" };
    const lang = interfaceLanguage();
    const targetCode = resolveTranslationTarget(settings.targetLanguage, lang).code;
    const entry = translationStore.readValid(sourceKey, options.text, settings, lang);
    const reusable = entry && !force && (entry.state.state === "running" || entry.state.state === "done" ||
      (entry.state.state === "error" && entry.jobId === startedJob));
    if (!reusable) {
      if (startedJob !== null && !force) {
        // The job this press made is no longer valid for the current
        // settings; another job needs another press.
        return { status: "stale" };
      }
      force = false;
      translationStore.startTranslation(
        {
          sourceKey,
          sourceKind: options.kind,
          agentId: options.agentId,
          text: options.text,
          interfaceLanguage: lang,
          settings,
        },
        translator.call,
      );
      const started = translationStore.readValid(sourceKey, options.text, settings, lang);
      startedJob = started?.jobId ?? null;
      return viewOf(started, targetCode, settings);
    }
    startedJob ??= entry.jobId;
    return viewOf(entry, targetCode, settings);
  };

  // Starting a job notifies the cache, which calls back here; the outer pass
  // finishes the work, then runs once more for whatever changed meanwhile.
  let computing = false;
  let dirty = false;
  const update = () => {
    if (!active) return;
    if (computing) {
      dirty = true;
      return;
    }
    computing = true;
    let next: SelectionTranslationView | null;
    try {
      do {
        dirty = false;
        next = compute();
      } while (dirty && active);
    } finally {
      computing = false;
    }
    if (sameView(current, next)) return;
    current = next;
    for (const listener of listeners) listener();
  };

  return {
    sourceKey,
    start() {
      active = true;
      // A second press on a shown result, or Retry, makes a new job.
      force = requested && (current?.status === "error" || current?.status === "done" ||
        current?.status === "stale");
      if (current?.status === "stale") startedJob = null;
      requested = true;
      releaseSettings ??= settingsSource.subscribe(update);
      releaseEntries ??= translationStore.subscribe(update);
      update();
    },
    setStreaming(next) {
      if (streaming === next) return;
      streaming = next;
      update();
    },
    setTranslator(next) {
      if (translator === next) return;
      translator = next;
      update();
    },
    view: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      active = false;
      releaseSettings?.();
      releaseEntries?.();
      releaseSettings = releaseEntries = null;
    },
  };
}

function viewOf(
  entry: TranslationEntry | undefined,
  targetCode: string,
  settings: TimelineTranslationSettings,
): SelectionTranslationView {
  // `provider` picks the logo: the endpoint names its service (`api.openai.com`, ...).
  const modelInfo: ModelInfo = settings.mode === "free"
    ? { provider: freeServiceInfo(settings.freeService).origin, model: freeServiceInfo(settings.freeService).name, ...freeMark(currentFreeService(settings.freeService)) }
    : { provider: settings.endpoint, model: settings.endpointModel };
  if (!entry || entry.state.state === "idle") return { status: "running", targetCode, modelInfo };
  switch (entry.state.state) {
    case "running": return { status: "running", text: entry.state.text || undefined, targetCode, modelInfo };
    case "done": return { status: "done", result: entry.state, modelInfo: { provider: entry.state.origin, model: entry.state.model, ...freeMark(freeServiceForOrigin(entry.state.origin)) } };
    case "error": return { status: "error", error: entry.state.error, targetCode, modelInfo };
  }
}

/** Web only: this tree's translator, for the scope to lend to its prose. */
export function useLentTranslator(enabled: boolean): LentTranslator | undefined {
  const caller = useTranslateCaller();
  const paseo = usePaseo();
  return useMemo(
    () => enabled && Platform.OS === "web" && paseo ? { translator: caller, paseo } : undefined,
    [enabled, caller, paseo],
  );
}

/** A native menu's translation for the block it selected; idle until `start()`. */
export function useSelectionTranslation(scope: SelectionTranslationScopeValue, text: string | null, waitForStreaming = false) {
  const caller = useTranslateCaller();
  const paseo = usePaseo();
  const translation = useMemo(() => text === null ? null : createSelectionTranslation({
    agentId: scope.agentId,
    kind: scope.kind,
    text,
    streaming: scope.streaming,
    waitForStreaming,
    translator: caller,
    host: paseo ?? undefined,
  }), [scope.agentId, scope.kind, text, paseo, waitForStreaming]);
  useEffect(() => {
    translation?.setStreaming(scope.streaming);
  }, [translation, scope.streaming]);
  useEffect(() => {
    translation?.setTranslator(caller);
  }, [translation, caller]);
  useEffect(() => () => translation?.dispose(), [translation]);
  const read = translation?.view ?? idleView;
  const view = useSyncExternalStore(translation?.subscribe ?? subscribeIdle, read, read);
  return useMemo(() => ({ view, start: translation?.start ?? startIdle }), [view, translation]);
}

const startIdle = () => {};
const subscribeIdle = () => startIdle;
const idleView = () => null;

export function selectionViewLoading(view: SelectionTranslationView | null): boolean {
  return view?.status === "running" || view?.status === "settings-loading";
}

/** The English line a view shows besides the translation itself; `toolbarLabel` localizes it. */
export function selectionViewMessage(view: SelectionTranslationView): string | null {
  switch (view.status) {
    case "settings-loading": return "Loading translation settings...";
    case "settings-invalid": return "Translation settings are invalid";
    case "settings-error": return "Could not load translation settings";
    case "disabled": return "Translation is turned off in settings";
    case "streaming":
      return view.kind === "reasoning"
        ? "Wait until the thought finishes streaming"
        : "Wait until the reply finishes streaming";
    case "unavailable": return "Translation is unavailable for this conversation";
    case "unconfigured": return "Set a translation endpoint and model in settings";
    case "stale": return "Translation settings changed. Translate again.";
    case "running": return "Translating...";
    case "error": return "Translation failed";
    case "done": return null;
  }
}

/** Views a second press can act on: a new job. */
export function selectionViewRetryable(view: SelectionTranslationView): boolean {
  return view.status === "error" || view.status === "done" || view.status === "stale";
}

/** The translation text a view has so far, if any. */
export function selectionViewText(view: SelectionTranslationView): string | null {
  if (view.status === "done") return view.result.translation;
  if (view.status === "running") return view.text ?? null;
  return null;
}

/** The language a view is translating into, for its header. */
export function selectionViewTargetCode(view: SelectionTranslationView): string | null {
  if (view.status === "done") return view.result.targetLanguageCode;
  if (view.status === "running" || view.status === "error") return view.targetCode;
  return null;
}
