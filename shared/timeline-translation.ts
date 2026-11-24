import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import {
  FOLLOW_INTERFACE_LANGUAGE_CODE,
  isTranslationLanguageCode,
  resolveTranslationTarget,
} from "./translation-languages";

export const TRANSLATION_HELPER_LABEL = "better-paseo.purpose";
export const TRANSLATION_HELPER_PURPOSE = "timeline-translation";

export const TRANSLATION_PROMPT_MAX_LENGTH = 8000;

// Settings saves write the full value object, so a stored prompt keeps the
// text it was saved with. When this changes, add the old text to
// PREVIOUS_DEFAULT_TRANSLATION_PROMPTS so untouched defaults follow along.
export const DEFAULT_TRANSLATION_PROMPT = [
  "Translate the text into the target language.",
  "Write natural, fluent prose for a native reader while keeping the original meaning, tone, and level of detail.",
  "Keep code, inline code, commands, file names and extensions, paths, URLs, APIs, identifiers, and product or library names exactly as written;",
  "use technical terms in the form developers commonly use in the target language, keeping the original term when that is the norm.",
  "Preserve the Markdown structure. Return only the translation, without explanations.",
].join(" ");

/**
 * Earlier default prompts, matched exactly after trimming. Reading settings
 * maps them to the current default without writing the file; the next normal
 * save persists the current text. Any other prompt is kept as written.
 */
export const PREVIOUS_DEFAULT_TRANSLATION_PROMPTS: readonly string[] = [
  "Translate the supplied text into the target language. Preserve Markdown, code blocks, inline code, commands, paths, links, and technical identifiers. Return only the translation, without explanations.",
];

function currentDefaultPrompt(prompt: string): string {
  return PREVIOUS_DEFAULT_TRANSLATION_PROMPTS.includes(prompt) ? DEFAULT_TRANSLATION_PROMPT : prompt;
}

export const TRANSLATION_ENDPOINT_MAX_LENGTH = 2048;
export const TRANSLATION_MODEL_MAX_LENGTH = 256;

/**
 * Who translates. `free`: a public machine translation service, called from
 * the client. `openai`: the OpenAI-compatible endpoint below, called from the
 * daemon. (An `agent` mode waits for host tool-free helper agents.)
 */
export const TRANSLATION_MODES = ["free", "openai"] as const;
export type TranslationMode = (typeof TRANSLATION_MODES)[number];

/** In the order `auto` tries them. */
export const FREE_TRANSLATION_SERVICES = ["microsoft", "google", "tencent"] as const;
export type FreeTranslationService = (typeof FREE_TRANSLATION_SERVICES)[number];
/**
 * `auto`: each client uses the first service it can reach. Settings are shared
 * by every client of a host, but which service is reachable depends on the
 * device's network, so the choice is made per client, never stored.
 */
export type FreeServiceChoice = FreeTranslationService | "auto";

const timelineTranslationFieldsSchema = z.object({
  enabled: z.boolean().catch(false),
  /** Missing in settings saved before modes existed; see the transform below. */
  mode: z.enum(TRANSLATION_MODES).optional().catch(undefined),
  freeService: z.enum(["auto", ...FREE_TRANSLATION_SERVICES]).catch("auto"),
  /**
   * The OpenAI-compatible base URL (or full `/chat/completions` URL) the
   * daemon sends translations to. Empty means nothing is ever sent. The server
   * checks it before every request; a stored value is never trusted as valid.
   */
  endpoint: z.string().trim().max(TRANSLATION_ENDPOINT_MAX_LENGTH).catch(""),
  /** The model id sent to `endpoint`; chosen by the user, never inferred. */
  endpointModel: z.string().trim().max(TRANSLATION_MODEL_MAX_LENGTH).catch(""),
  // Legacy fields from the helper-agent translator (Paseo provider, model and
  // thinking). Nothing reads them; they stay in the schema so a save keeps
  // what an earlier version stored instead of dropping it.
  customModel: z.boolean().catch(false),
  disableThinking: z.boolean().catch(true),
  provider: z.string().catch(""),
  model: z.string().catch(""),
  thinkingOptionId: z.string().catch(""),
  targetLanguage: z.string().refine(isTranslationLanguageCode).catch(FOLLOW_INTERFACE_LANGUAGE_CODE),
  prompt: z.string().trim().min(1).max(TRANSLATION_PROMPT_MAX_LENGTH).catch(DEFAULT_TRANSLATION_PROMPT).transform(currentDefaultPrompt),
});

// Settings saved before modes existed keep translating the way they did: an
// endpoint means the OpenAI-compatible mode. Everything else starts free.
export const timelineTranslationSettingsSchema = timelineTranslationFieldsSchema.transform((values) => ({
  ...values,
  mode: values.mode ?? (values.endpoint ? "openai" as const : "free" as const),
}));

export type TimelineTranslationSettings = z.output<typeof timelineTranslationSettingsSchema>;

export const TIMELINE_TRANSLATION_SETTINGS = defineSettings({
  id: "timeline-translation",
  scope: "host",
  version: 1,
  schema: timelineTranslationSettingsSchema,
});

export function translationConfigSignature(
  settings: TimelineTranslationSettings,
  interfaceLanguage: "en" | "zh",
): string {
  const target = resolveTranslationTarget(settings.targetLanguage, interfaceLanguage);
  if (settings.mode === "free") {
    return JSON.stringify({
      enabled: settings.enabled,
      targetCode: target.code,
      mode: settings.mode,
      freeService: settings.freeService,
    });
  }
  return JSON.stringify({
    enabled: settings.enabled,
    targetCode: target.code,
    endpoint: settings.endpoint,
    endpointModel: settings.endpointModel,
    prompt: settings.prompt,
  });
}

export const translationJobStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idle") }),
  z.object({ state: z.literal("running"), text: z.string().optional() }),
  z.object({
    state: z.literal("done"),
    translation: z.string(),
    targetLanguageCode: z.string(),
    /** Where the text was sent: the endpoint's origin, e.g. `https://api.example.com`. */
    origin: z.string(),
    model: z.string(),
  }),
  z.object({ state: z.literal("error"), error: z.string() }),
]);
export type TranslationJobState = z.output<typeof translationJobStateSchema>;

export const translateTimelineItemRpc = defineRpc({
  name: "translation.translate",
  input: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("start"),
      jobId: z.string().min(1),
      agentId: z.string().min(1),
      text: z.string().trim().min(1).max(200_000),
      sourceKind: z.enum(["assistant_message", "user_message", "reasoning", "tool_output"]),
      interfaceLanguage: z.enum(["en", "zh"]).default("en"),
      configSignature: z.string().min(1),
    }),
    z.object({
      action: z.literal("status"),
      jobId: z.string().min(1),
    }),
  ]),
  output: translationJobStateSchema,
});

export type TranslateTimelineItemInput = z.output<typeof translateTimelineItemRpc.input>;

/** Why a configured endpoint is refused; the server decides, the client only shows it. */
export const translationEndpointProblemSchema = z.enum([
  /** Not an absolute URL. */
  "invalid_url",
  /** Neither `https:` nor `http:`. */
  "unsupported_protocol",
  /** `http:` to a host other than this machine's loopback. */
  "insecure_remote",
  /** A user name or password in the URL: it would sit in readable settings. */
  "embedded_credentials",
  /** A query string or fragment: keys and options belong elsewhere. */
  "query_or_fragment",
]);
export type TranslationEndpointProblem = z.output<typeof translationEndpointProblemSchema>;

export const translationEndpointCheckSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("empty") }),
  z.object({ status: z.literal("invalid"), problem: translationEndpointProblemSchema }),
  z.object({
    status: z.literal("ok"),
    /** The exact URL a translation is POSTed to. */
    requestUrl: z.string(),
    origin: z.string(),
    loopback: z.boolean(),
  }),
]);
export type TranslationEndpointCheck = z.output<typeof translationEndpointCheckSchema>;

/** Status includes only a masked representation of the saved key. */
export const translationKeyStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("none") }),
  /** `matches`: `origin` is the origin of the endpoint this status was asked for. */
  z.object({ status: z.literal("saved"), origin: z.string(), matches: z.boolean(), masked: z.string() }),
  z.object({ status: z.literal("error"), error: z.string() }),
]);
export type TranslationKeyState = z.output<typeof translationKeyStateSchema>;

export const translationEndpointStatusSchema = z.object({
  endpoint: translationEndpointCheckSchema,
  key: translationKeyStateSchema,
});
export type TranslationEndpointStatus = z.output<typeof translationEndpointStatusSchema>;

export const translationEndpointStatusRpc = defineRpc({
  name: "translation.endpoint-status",
  input: z.object({ endpoint: z.string().max(TRANSLATION_ENDPOINT_MAX_LENGTH) }),
  output: translationEndpointStatusSchema,
});

export const TRANSLATION_API_KEY_MAX_LENGTH = 4096;

/**
 * Write-only: saves the key bound to `endpoint`'s origin, or clears it. The
 * answer is the same status as `translation.endpoint-status`, never the key.
 */
export const translationApiKeyRpc = defineRpc({
  name: "translation.api-key",
  input: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("save"),
      endpoint: z.string().max(TRANSLATION_ENDPOINT_MAX_LENGTH),
      apiKey: z.string().max(TRANSLATION_API_KEY_MAX_LENGTH),
    }),
    z.object({
      action: z.literal("clear"),
      endpoint: z.string().max(TRANSLATION_ENDPOINT_MAX_LENGTH),
    }),
  ]),
  output: translationEndpointStatusSchema,
});

/** Read the saved key only when the user asks to reveal it. */
export const translationRevealKeyRpc = defineRpc({
  name: "translation.reveal-key",
  input: z.object({}),
  output: z.object({ origin: z.string(), apiKey: z.string() }).nullable(),
});

/** Verify the configured service with a short fixed prompt and no tools. */
export const translationTestRpc = defineRpc({
  name: "translation.test",
  input: z.object({
    endpoint: z.string().max(TRANSLATION_ENDPOINT_MAX_LENGTH),
    model: z.string().trim().min(1).max(TRANSLATION_MODEL_MAX_LENGTH),
    apiKey: z.string().max(TRANSLATION_API_KEY_MAX_LENGTH).optional(),
  }),
  output: z.object({ ok: z.literal(true) }),
});
