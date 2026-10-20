import { useEffect, useSyncExternalStore } from "react";

/**
 * Every brand mark the daemon can serve (server/mark-bitmaps.ts). The ids stay
 * in the client because they decide which mark a row asks for; the PNG data
 * does not, because the host sends the whole client bundle again on every
 * reconnect and only a handful of marks are ever drawn.
 */
export const MARK_IDS: ReadonlySet<string> = new Set([
  "devicon:typescript",
  "devicon:javascript",
  "devicon:python",
  "devicon:rust",
  "devicon:bash",
  "devicon:json",
  "devicon:markdown",
  "devicon:html",
  "devicon:css",
  "devicon:sql",
  "devicon:go",
  "devicon:react",
  "devicon:docker",
  "devicon:yaml",
  "lobe:claude",
  "lobe:codex",
  "lobe:gemini",
  "lobe:antigravity",
  "lobe:copilot",
  "lobe:opencode",
  "lobe:minimax",
  "lobe:deepseek",
  "lobe:grok",
  "lobe:ollama",
  "provider:paseo",
  "provider:omp",
  "provider:pi",
  "provider:cursor",
  "brand:git",
  "brand:github",
  "brand:paseo",
  "brand:linear",
  "brand:sentry",
  "brand:figma",
  "brand:notion",
  "brand:google-calendar",
  "brand:gmail",
  "brand:google-drive",
  "brand:slack",
  "brand:feishu",
  "brand:gitlab",
  "brand:aws",
  "brand:google-maps",
  "brand:python",
  "brand:nodejs",
  "brand:npm",
  "brand:pnpm",
  "brand:yarn",
  "brand:deno",
  "brand:go",
  "brand:rust",
  "brand:kotlin",
  "brand:swift",
  "brand:php",
  "brand:docker",
  "brand:terraform",
  "brand:google-cloud",
  "brand:mysql",
  "brand:mongodb",
  "brand:typescript",
  "brand:apple",
  "brand:cpp",
  "brand:csharp",
  "brand:vercel",
  "brand:cloudflare",
  "brand:supabase",
  "brand:prisma",
  "brand:flutter",
  "brand:android",
  "brand:openai",
  "brand:powershell",
  "brand:vscode",
  "brand:azure",
  "brand:jira",
  "brand:confluence",
  "brand:jenkins",
  "brand:gitee",
  "brand:bitbucket",
  "brand:circleci",
  "brand:ansible",
  "brand:sonarqube",
  "brand:grafana",
  "brand:prometheus",
  "brand:elastic",
  "brand:postman",
  "brand:redis",
  "brand:kafka",
  "brand:trello",
  "brand:asana",
  "brand:dingtalk",
  "brand:wecom",
  "brand:teams",
  "brand:discord",
  "brand:telegram",
  "brand:zapier",
  "brand:airtable",
  "brand:cypress",
  "brand:storybook",
  "brand:chrome",
  "brand:vite",
  "brand:nextjs",
  "brand:nuxt",
  "brand:react-native",
  "brand:angular",
  "brand:astro",
  "brand:svelte",
  "brand:vue",
  "brand:tailwind",
  "brand:firebase",
  "brand:stripe",
  "brand:django",
  "brand:laravel",
  "brand:youtube",
  "brand:eslint",
  "brand:vim",
  "brand:netlify",
  "brand:webpack",
  "brand:turborepo",
  "brand:jupyter",
  "brand:prettier",
  "brand:heroku",
  "brand:expo",
  "brand:vitest",
  "brand:bun",
  "brand:nginx",
  "brand:postgresql",
  "brand:brave",
  "brand:puppeteer",
  "brand:playwright",
  "brand:perplexity",
  "mark:file",
  "mark:folder",
]);

/** Marks rasterised white, so the caller supplies the colour through tint. */
export const MONO_MARKS: ReadonlySet<string> = new Set([
  "lobe:codex",
  "lobe:copilot",
  "lobe:opencode",
  "lobe:grok",
  "lobe:ollama",
  "provider:paseo",
  "provider:omp",
  "provider:pi",
  "provider:cursor",
  "brand:git",
  "brand:github",
  "brand:paseo",
  "brand:linear",
  "brand:sentry",
  "brand:figma",
  "brand:notion",
  "brand:google-calendar",
  "brand:gmail",
  "brand:google-drive",
  "brand:slack",
  "brand:feishu",
  "brand:gitlab",
  "brand:aws",
  "brand:google-maps",
  "brand:python",
  "brand:nodejs",
  "brand:npm",
  "brand:pnpm",
  "brand:yarn",
  "brand:deno",
  "brand:go",
  "brand:rust",
  "brand:kotlin",
  "brand:swift",
  "brand:php",
  "brand:docker",
  "brand:terraform",
  "brand:google-cloud",
  "brand:mysql",
  "brand:mongodb",
  "brand:typescript",
  "brand:apple",
  "brand:cpp",
  "brand:csharp",
  "brand:vercel",
  "brand:cloudflare",
  "brand:supabase",
  "brand:prisma",
  "brand:flutter",
  "brand:android",
  "brand:openai",
  "brand:powershell",
  "brand:vscode",
  "brand:azure",
  "brand:jira",
  "brand:confluence",
  "brand:jenkins",
  "brand:gitee",
  "brand:bitbucket",
  "brand:circleci",
  "brand:ansible",
  "brand:sonarqube",
  "brand:grafana",
  "brand:prometheus",
  "brand:elastic",
  "brand:postman",
  "brand:redis",
  "brand:kafka",
  "brand:trello",
  "brand:asana",
  "brand:dingtalk",
  "brand:wecom",
  "brand:teams",
  "brand:discord",
  "brand:telegram",
  "brand:zapier",
  "brand:airtable",
  "brand:cypress",
  "brand:storybook",
  "brand:chrome",
  "brand:vite",
  "brand:nextjs",
  "brand:nuxt",
  "brand:react-native",
  "brand:angular",
  "brand:astro",
  "brand:svelte",
  "brand:vue",
  "brand:tailwind",
  "brand:firebase",
  "brand:stripe",
  "brand:django",
  "brand:laravel",
  "brand:youtube",
  "brand:eslint",
  "brand:vim",
  "brand:netlify",
  "brand:webpack",
  "brand:turborepo",
  "brand:jupyter",
  "brand:prettier",
  "brand:heroku",
  "brand:expo",
  "brand:vitest",
  "brand:bun",
  "brand:nginx",
  "brand:postgresql",
  "brand:brave",
  "brand:puppeteer",
  "brand:playwright",
  "brand:perplexity",
  "mark:file",
  "mark:folder",
]);

export type MarkLoader = (ids: string[]) => Promise<Record<string, string>>;

/**
 * The host disposes and re-evaluates the bundle on every reconnect, which
 * drops module state. Keeping fetched marks on the global object lets the new
 * evaluation draw them at once instead of asking the daemon again.
 */
const BITMAPS_KEY = "__beautifulChatMarkBitmaps";
type BitmapsHolder = { [BITMAPS_KEY]?: Record<string, string> };

function bitmaps(): Record<string, string> {
  const holder = globalThis as BitmapsHolder;
  return (holder[BITMAPS_KEY] ??= {});
}

let loader: MarkLoader | null = null;
/** Ids the daemon could not answer; they draw as unavailable until a new loader. */
let failed = new Set<string>();
const inFlight = new Set<string>();
let queued = new Set<string>();
let flushScheduled = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** `contribute` sets the loader, since only the plugin context can call RPCs outside a component. */
export function setMarkLoader(next: MarkLoader | null): void {
  loader = next;
  failed = new Set();
  inFlight.clear();
  queued = new Set();
  notify();
}

/** Puts marks in the cache directly, for the offline harness that has no daemon. */
export function seedMarkBitmaps(entries: Record<string, string>): void {
  Object.assign(bitmaps(), entries);
  notify();
}

/** One request per tick: the marks a freshly painted timeline needs travel together. */
function flush() {
  flushScheduled = false;
  const from = loader;
  const ids = [...queued];
  queued = new Set();
  if (!from || ids.length === 0) return;
  for (const id of ids) inFlight.add(id);
  Promise.resolve()
    .then(() => from(ids))
    .then(
      (answer) => {
        if (from !== loader) return;
        const cache = bitmaps();
        for (const id of ids) {
          const uri = answer?.[id];
          if (uri) cache[id] = uri;
          else failed.add(id);
        }
      },
      () => {
        if (from !== loader) return;
        for (const id of ids) failed.add(id);
      },
    )
    .finally(() => {
      if (from !== loader) return;
      for (const id of ids) inFlight.delete(id);
      notify();
    });
}

function request(id: string) {
  if (!loader || bitmaps()[id] || failed.has(id) || inFlight.has(id) || queued.has(id)) return;
  queued.add(id);
  if (flushScheduled) return;
  flushScheduled = true;
  Promise.resolve().then(flush);
}

/**
 * A mark's `data:` URI: a string once it is here, `undefined` while it is on
 * its way, and `null` when there is none to draw (unknown id, or the daemon
 * could not answer). A caller holds the mark's space while it is `undefined`.
 */
export function readMark(id: string | undefined): string | null | undefined {
  if (!id || !MARK_IDS.has(id)) return null;
  const uri = bitmaps()[id];
  if (uri) return uri;
  return failed.has(id) ? null : undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMarkBitmap(id: string | undefined): string | null | undefined {
  const mark = useSyncExternalStore(
    subscribe,
    () => readMark(id),
    () => readMark(id),
  );
  useEffect(() => {
    if (id && mark === undefined) request(id);
  }, [id, mark]);
  return mark;
}
