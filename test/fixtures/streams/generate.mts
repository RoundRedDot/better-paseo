/**
 * Generates the deterministic stream fixtures in this directory.
 *
 *   node test/fixtures/streams/generate.mts            # write every *.jsonl
 *   node test/fixtures/streams/generate.mts --check    # regenerate in memory, fail on drift
 *   node test/fixtures/streams/generate.mts markdown-long table-streaming
 *
 * Runs on Node >= 22.18 (native TypeScript type stripping) or with `tsx`. The file is
 * deliberately self-contained (no relative imports) so both runners and the repo's root
 * `tsc` accept it. Every fixture is seeded from its own name, so the output is byte-for-byte
 * reproducible. The line format is documented in README.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------------------
// Types. `Item` is structurally an `AgentTimelineItem` (@getpaseo/protocol/agent-types); it
// is declared locally so this script needs no dependency to run.
// ---------------------------------------------------------------------------------------

type ToolDetail = { type: string; [key: string]: unknown };

type Item =
  | { type: "user_message"; text: string; messageId?: string; clientMessageId?: string }
  | { type: "assistant_message"; text: string; messageId?: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool_call";
      callId: string;
      name: string;
      detail: ToolDetail;
      status: "running" | "completed" | "failed" | "canceled";
      error: unknown;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "todo";
      items: Array<{
        text: string;
        completed: boolean;
        id?: string;
        status?: "pending" | "in_progress" | "completed";
        activeForm?: string;
      }>;
    };

type Mode = "append" | "replace";
type StreamLine = { t: number; item: Item; mode: Mode };
type Meta = { kind: "meta"; name: string; description: string; scenario: string };
type Fixture = { meta: Meta; lines: StreamLine[] };

// ---------------------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------------------

type Rng = () => number;

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)] as T;
}

function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

// ---------------------------------------------------------------------------------------
// Stream builder: a cursor in stream time plus a list of timed events.
// ---------------------------------------------------------------------------------------

class Builder {
  readonly rng: Rng;
  private readonly events: Array<{ t: number; seq: number; item: Item; mode: Mode }> = [];
  private seq = 0;
  private nextCall = 1;
  readonly name: string;
  t = 0;

  constructor(name: string) {
    this.name = name;
    this.rng = mulberry32(hashSeed(name));
  }

  wait(ms: number): void {
    this.t += ms;
  }

  /** Records `item` at the given absolute stream time (defaults to the cursor). */
  emit(item: Item, mode: Mode = "append", at: number = this.t): void {
    this.events.push({ t: Math.max(0, Math.round(at)), seq: this.seq++, item, mode });
  }

  callId(prefix = "toolu"): string {
    return `${prefix}_${this.name.replace(/[^a-z0-9]/g, "").slice(0, 8)}${String(this.nextCall++).padStart(4, "0")}`;
  }

  user(text: string): void {
    this.emit({ type: "user_message", text });
  }

  /**
   * Streams `text` as consecutive `append` deltas. The daemon coalesces provider deltas into
   * ~60ms windows, so the default cadence is one delta per ~60ms with sizes varying from a few
   * words to a couple of sentences. `chars` streams 1-4 characters every ~14ms instead.
   */
  stream(type: "assistant_message" | "reasoning", text: string, style: StreamStyle = "window"): void {
    for (const chunk of chunkText(this.rng, text, style)) {
      this.t += chunk.delay;
      this.emit({ type, text: chunk.text });
    }
  }

  /** Emits a tool call that runs for `durationMs` and then completes (or fails). */
  tool(
    name: string,
    runningDetail: ToolDetail,
    doneDetail: ToolDetail,
    durationMs: number,
    outcome: { status: "completed" } | { status: "failed"; error: unknown } = { status: "completed" },
    callId: string = this.callId(),
  ): string {
    this.emit(
      { type: "tool_call", callId, name, detail: runningDetail, status: "running", error: null },
      "replace",
    );
    const end = this.t + durationMs;
    const done: Item =
      outcome.status === "completed"
        ? { type: "tool_call", callId, name, detail: doneDetail, status: "completed", error: null }
        : { type: "tool_call", callId, name, detail: doneDetail, status: "failed", error: outcome.error };
    this.emit(done, "replace", end);
    return callId;
  }

  finish(meta: Omit<Meta, "kind">): Fixture {
    const sorted = [...this.events].sort((a, b) => a.t - b.t || a.seq - b.seq);
    return {
      meta: { kind: "meta", ...meta },
      lines: sorted.map((e) => ({ t: e.t, item: e.item, mode: e.mode })),
    };
  }
}

type StreamStyle = "window" | "chars" | "words" | "burst";

function chunkText(rng: Rng, text: string, style: StreamStyle): Array<{ text: string; delay: number }> {
  const out: Array<{ text: string; delay: number }> = [];
  let i = 0;
  while (i < text.length) {
    let size: number;
    let delay: number;
    if (style === "chars") {
      size = int(rng, 1, 4);
      delay = int(rng, 8, 22);
    } else if (style === "burst") {
      size = int(rng, 40, 400);
      delay = int(rng, 1, 3);
    } else if (style === "words") {
      size = int(rng, 3, 14);
      delay = int(rng, 20, 55);
    } else {
      // Roughly log-uniform 6..140 chars per ~60ms window, with the odd stall.
      size = Math.round(Math.exp(Math.log(6) + rng() * (Math.log(140) - Math.log(6))));
      delay = 60 + int(rng, -14, 18);
      if (chance(rng, 0.06)) delay += int(rng, 80, 420);
    }
    let end = Math.min(text.length, i + size);
    // Mostly cut on a word boundary; sometimes mid-token, as real model output does.
    if (style !== "chars" && end < text.length && !chance(rng, 0.15)) {
      const space = text.indexOf(" ", end);
      if (space !== -1 && space - end < 24) end = space + 1;
    }
    out.push({ text: text.slice(i, end), delay });
    i = end;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Prose and code corpora
// ---------------------------------------------------------------------------------------

const SUBJECTS = [
  "the stream buffer",
  "the markdown parser",
  "the timeline reducer",
  "the virtualized list",
  "the syntax highlighter",
  "the tool-call card",
  "the diff renderer",
  "the scroll anchor",
  "the reasoning block",
  "the message cache",
  "the websocket session",
  "the layout pass",
];
const VERBS = [
  "re-renders",
  "measures",
  "coalesces",
  "memoizes",
  "flushes",
  "defers",
  "batches",
  "invalidates",
  "recomputes",
  "truncates",
  "collapses",
  "reuses",
];
const OBJECTS = [
  "every incoming delta",
  "the pending text node",
  "the last visible row",
  "a stale selection range",
  "the fenced code block",
  "each table row",
  "the cached token list",
  "the offscreen items",
  "the unfinished paragraph",
  "the tool output string",
  "a frozen prefix of the message",
  "the pending tool state",
];
const QUALIFIERS = [
  "on every frame",
  "once the window closes",
  "while the message is still streaming",
  "after the first paint",
  "only when the text actually changed",
  "before the next commit",
  "during scroll",
  "when the viewport is pinned to the bottom",
  "under memory pressure",
  "without touching the DOM",
];

function sentence(rng: Rng): string {
  return `${cap(pick(rng, SUBJECTS))} ${pick(rng, VERBS)} ${pick(rng, OBJECTS)} ${pick(rng, QUALIFIERS)}.`;
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sentences(rng: Rng, count: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) parts.push(sentence(rng));
  return parts.join(" ");
}

const IDENTS = [
  "timeline",
  "message",
  "chunk",
  "token",
  "buffer",
  "cursor",
  "session",
  "request",
  "response",
  "snapshot",
  "entry",
  "frame",
  "window",
  "offset",
  "range",
  "cache",
  "queue",
  "handler",
  "payload",
  "context",
];
const TYPES = ["string", "number", "boolean", "Uint8Array", "Map<string, number>", "readonly string[]", "Date"];

function camel(rng: Rng): string {
  const a = pick(rng, IDENTS);
  const b = pick(rng, IDENTS);
  return a + b.charAt(0).toUpperCase() + b.slice(1);
}

function pascal(rng: Rng): string {
  return cap(camel(rng));
}

/** A synthetic but plausible TypeScript module, 90-260 lines. */
function synthModule(rng: Rng, label: string): string {
  const lines: string[] = [];
  const imports = int(rng, 2, 6);
  for (let i = 0; i < imports; i++) {
    lines.push(`import { ${camel(rng)}, ${camel(rng)} } from "${pick(rng, ["./", "../shared/", "../lib/", "@acme/core/"])}${pick(rng, IDENTS)}${pick(rng, ["", "-utils", "-store"])}";`);
  }
  lines.push("");
  lines.push(`/** ${cap(sentence(rng))} */`);
  const iface = pascal(rng);
  lines.push(`export interface ${iface} {`);
  for (let i = 0; i < int(rng, 4, 9); i++) {
    lines.push(`  ${chance(rng, 0.3) ? "readonly " : ""}${camel(rng)}${chance(rng, 0.3) ? "?" : ""}: ${pick(rng, TYPES)};`);
  }
  lines.push("}");
  lines.push("");
  for (let i = 0; i < int(rng, 2, 4); i++) {
    lines.push(`const ${camel(rng).replace(/^./, (c) => c.toUpperCase()).replace(/[a-z]/, (c) => c.toUpperCase())}_LIMIT = ${int(rng, 8, 4096)};`);
  }
  lines.push("");
  const fnCount = int(rng, 4, 9);
  for (let f = 0; f < fnCount; f++) {
    const name = camel(rng) + (f > 0 ? String(f) : "");
    const a = camel(rng);
    const b = camel(rng);
    lines.push(`/** ${cap(sentence(rng))} */`);
    lines.push(`export function ${name}(${a}: ${pick(rng, TYPES)}, ${b}: ${iface}): ${pick(rng, TYPES)} {`);
    const body = int(rng, 4, 14);
    for (let s = 0; s < body; s++) lines.push(statement(rng, a, b, 1));
    lines.push(`  return ${a};`);
    lines.push("}");
    lines.push("");
  }
  lines.push(`export const ${label.replace(/[^A-Za-z0-9]/g, "_")} = { ${Array.from({ length: 3 }, () => camel(rng)).join(", ")} };`);
  return lines.join("\n") + "\n";
}

function statement(rng: Rng, a: string, b: string, depth: number): string {
  const pad = "  ".repeat(depth);
  const v = camel(rng);
  switch (int(rng, 0, 11)) {
    case 0:
      return `${pad}const ${v} = ${b}.${camel(rng)} ?? ${int(rng, 0, 64)};`;
    case 1:
      return `${pad}if (${a} === undefined) {\n${pad}  throw new Error("${cap(sentence(rng)).slice(0, 48)}");\n${pad}}`;
    case 2:
      return `${pad}for (const ${v} of ${b}.${camel(rng)}) {\n${pad}  ${camel(rng)}(${v}, ${a});\n${pad}}`;
    case 3:
      return `${pad}const ${v} = await ${camel(rng)}(${a}, { signal: ${b}.signal, retries: ${int(rng, 1, 5)} });`;
    case 4:
      return `${pad}// ${sentence(rng)}`;
    case 5:
      return `${pad}${b}.${camel(rng)}.set(${JSON.stringify(pick(rng, IDENTS))}, ${int(rng, 0, 999)});`;
    case 6:
      return `${pad}const ${v} = ${a}.map((entry) => entry.${camel(rng)}).filter(Boolean);`;
    case 7:
      return `${pad}try {\n${pad}  ${camel(rng)}(${a});\n${pad}} catch (error) {\n${pad}  console.warn("${pick(rng, IDENTS)} failed", error);\n${pad}}`;
    case 8:
      return `${pad}const ${v} = Math.min(${a}.length, ${camel(rng).toUpperCase()}_LIMIT);`;
    case 9:
      return `${pad}if (${b}.${camel(rng)} && ${v.length > 0 ? "!" : ""}${b}.${camel(rng)}) {\n${pad}  return ${a};\n${pad}}`;
    case 10:
      return `${pad}${a} = ${camel(rng)}(${a}).slice(${int(rng, 0, 8)});`;
    default:
      return `${pad}const { ${camel(rng)}, ${camel(rng)} } = ${b};`;
  }
}

const PROJECT = "/Users/dev/workspace/acme-chat";

function moduleFiles(count: number, rng: Rng): Array<{ path: string; content: string }> {
  const dirs = ["client/components", "client/hooks", "client/lib", "shared", "server/handlers", "client/store"];
  const files: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();
  while (files.length < count) {
    const name = `${pick(rng, IDENTS)}-${pick(rng, IDENTS)}.ts${chance(rng, 0.3) ? "x" : ""}`;
    const path = `${PROJECT}/${pick(rng, dirs)}/${name}`;
    if (seen.has(path)) continue;
    seen.add(path);
    files.push({ path, content: synthModule(rng, name) });
  }
  return files;
}

// ---------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------

function readsTwenty(): Fixture {
  const b = new Builder("reads-20");
  b.user("Walk through the client code and tell me where streaming text gets re-rendered unnecessarily.");
  b.wait(120);
  b.stream(
    "reasoning",
    "I should start by reading every module that touches the message list, then follow the imports outward. A batch of reads in parallel will be quickest.",
  );
  b.wait(200);
  b.stream("assistant_message", "I'll read the rendering path file by file, starting with the list and store modules.\n\n");
  const files = moduleFiles(24, b.rng);
  let i = 0;
  while (i < files.length) {
    const group = Math.min(files.length - i, int(b.rng, 1, 4));
    b.wait(int(b.rng, 90, 260));
    const start = b.t;
    for (let g = 0; g < group; g++) {
      const file = files[i + g]!;
      const lineCount = file.content.split("\n").length - 1;
      const running = { type: "read", filePath: file.path, offset: 0, limit: lineCount };
      const callId = b.callId();
      b.emit({ type: "tool_call", callId, name: "Read", detail: running, status: "running", error: null }, "replace", start + g * 6);
      b.emit(
        { type: "tool_call", callId, name: "Read", detail: { ...running, content: file.content }, status: "completed", error: null },
        "replace",
        start + 70 + g * 40 + int(b.rng, 0, 160),
      );
    }
    b.t = start + 70 + group * 40 + 160;
    i += group;
  }
  b.wait(300);
  b.stream(
    "assistant_message",
    "I read 24 modules. Three things stand out:\n\n1. `timelineBuffer` re-creates the token list on every delta instead of appending to a frozen prefix.\n2. `messageCache` is keyed by the full text, so every delta is a cache miss.\n3. The list row measures itself on each commit rather than once per settled paragraph.\n\nThe next step is to confirm these with a profile before changing anything.",
  );
  return b.finish({
    name: "reads-20",
    description: "A user question followed by 24 Read tool calls (groups of 1-4 in parallel) with 90-260 line TypeScript contents, then a short summary.",
    scenario: "Many consecutive collapsed tool cards: list virtualisation and per-card mount cost when 20+ completed Read calls arrive back to back (requirement 16.1 item 1).",
  });
}

function shellLogLarge(): Fixture {
  const b = new Builder("shell-log-large");
  b.user("Run the full integration suite and show me everything it prints.");
  b.wait(150);
  b.stream("assistant_message", "Running the integration suite now; it prints a lot, so this will take a moment.\n\n");
  const command = "npm run test:integration -- --reporter tap";
  // The daemon keeps only the first 64 KiB of a shell tool's output (TOOL_CALL_CONTENT_MAX_LENGTH),
  // so the log is sized to land just under that cap with as many short lines as possible.
  const budget = 65000;
  const suites = ["ses", "tl", "perm", "att", "term", "rly", "ws", "idx"];
  const tests = ["open", "close", "flush", "retry", "cache", "diff", "paste", "send", "read", "scan", "seek", "sync"];
  const out: string[] = ["TAP version 14"];
  let size = out[0]!.length;
  for (let n = 1; size < budget; n++) {
    const status = chance(b.rng, 0.012) ? "skip" : "ok";
    const line = `${status} ${n} ${pick(b.rng, suites)}/${pick(b.rng, tests)} ${int(b.rng, 1, 480)}ms`;
    out.push(line);
    size += line.length + 1;
  }
  out.push("");
  out.push(`1..${out.length - 2}`);
  out.push(`# pass ${out.length - 3}`);
  out.push("# fail 0");
  const output = out.join("\n");
  b.tool(
    "Bash",
    { type: "shell", command, cwd: PROJECT, output: "", exitCode: null },
    { type: "shell", command, cwd: PROJECT, output, exitCode: 0 },
    9500,
  );
  b.t += 9800;
  b.stream("assistant_message", "All tests passed. The run printed " + out.length + " lines.");
  return b.finish({
    name: "shell-log-large",
    description: `One Bash tool call that is running with empty output, then completes with ${out.length} lines (~${Math.round(output.length / 1024)} KiB, just under the daemon 64 KiB shell-output cap) of TAP log output.`,
    scenario: "A very large single tool output: expanded-card render cost, scroll cost and memory when the result carries thousands of lines (requirement 16.1 item 2).",
  });
}

const REASON_TOPICS = [
  "the render path for streaming text",
  "how the daemon coalesces deltas",
  "the cache key for settled paragraphs",
  "where scroll anchoring can drift",
  "the cost of syntax highlighting",
  "the tool card collapse state",
  "memory held by long histories",
  "ordering of tool updates",
  "what the profiler actually measured",
  "the plan for a safe rollout",
];

function reasoningSections(): Fixture {
  const b = new Builder("reasoning-long-sections");
  b.user("Why does the chat stutter when a long answer streams in? Think it through before answering.");
  b.wait(180);
  const titles = [
    "Understanding the symptom",
    "Mapping the render path",
    "Checking the delta cadence",
    "Looking for repeated parsing",
    "Weighing a frozen-prefix approach",
    "Considering memoization limits",
    "Inspecting scroll anchoring",
    "Estimating highlighter cost",
    "Reviewing tool-card updates",
    "Looking at list virtualization",
    "Thinking about memory growth",
    "Ordering the candidate fixes",
    "Planning measurements first",
    "Choosing a rollout path",
    "Preparing the explanation",
    "Double-checking edge cases",
    "Considering mobile constraints",
    "Drafting the summary",
    "Final sanity pass",
  ];
  const paragraphs = titles.map((title) => {
    const body = sentences(b.rng, int(b.rng, 3, 6));
    const extra = chance(b.rng, 0.4) ? ` I want to be careful about ${pick(b.rng, REASON_TOPICS)} before committing to this.` : "";
    return `**${title}**\n\n${body}${extra}`;
  });
  b.stream("reasoning", paragraphs.join("\n\n"));
  b.wait(400);
  b.stream(
    "assistant_message",
    "The stutter comes from re-parsing and re-rendering the whole message on every delta. Appending to a frozen prefix and only re-parsing the open tail fixes the quadratic behaviour.",
  );
  return b.finish({
    name: "reasoning-long-sections",
    description: `Codex-style reasoning: ${titles.length} paragraphs, each introduced by a standalone **Title** line, streamed as one reasoning item, then a one-paragraph answer.`,
    scenario: "Long reasoning block with bold section titles: title extraction, collapsed/expanded reasoning cost and incremental markdown on structured reasoning (requirement 16.1 item 3).",
  });
}

function reasoningProse(): Fixture {
  const b = new Builder("reasoning-long-prose");
  b.user("The scrollbar jumps whenever a code block finishes streaming. Can you figure out why?");
  b.wait(160);
  const openers = [
    "Let me think about what changes when a fenced block closes.",
    "Okay, so the message is streaming and the user is pinned to the bottom.",
    "Hmm, wait. That doesn't quite explain the jump.",
    "Actually, let me reconsider the order of events.",
    "Right, and there's another thing to rule out.",
    "So the question becomes whether the height is known before paint.",
  ];
  const paras: string[] = [];
  for (let p = 0; p < 11; p++) {
    const opener = openers[p % openers.length]!;
    paras.push(`${opener} ${sentences(b.rng, int(b.rng, 4, 8))} ${chance(b.rng, 0.5) ? "I'm not sure that's the whole story, though. " : ""}${sentences(b.rng, int(b.rng, 2, 4))}`);
  }
  b.stream("reasoning", paras.join("\n\n"));
  b.wait(350);
  b.stream(
    "assistant_message",
    "The jump happens because the highlighted block is measured after it replaces the plain placeholder. Reserving the placeholder height (line count times line height) removes it.",
  );
  return b.finish({
    name: "reasoning-long-prose",
    description: "Claude-style reasoning: eleven free-flowing prose paragraphs with no titles in a single reasoning item, then a short answer.",
    scenario: "Long untitled reasoning prose: cost of rendering a large plain-text reasoning block while it grows (requirement 16.1 item 4).",
  });
}

function markdownSection(rng: Rng, n: number): string {
  const feature = pick(rng, ["Stream buffering", "Syntax highlighting", "Tool card layout", "Scroll anchoring", "History loading", "Image previews", "Permission prompts", "Link handling"]);
  const parts: string[] = [];
  parts.push(`## ${n}. ${feature}`);
  parts.push("");
  parts.push(`${sentences(rng, 3)} See the [design notes](https://example.com/docs/${feature.toLowerCase().replace(/\s+/g, "-")}) for the full background.`);
  parts.push("");
  parts.push(`### ${feature}: goals`);
  parts.push("");
  parts.push(`- Keep **time to first paint** under \`${int(rng, 40, 120)}ms\``);
  parts.push(`  - Measured with \`performance.mark("${pick(rng, IDENTS)}")\``);
  parts.push(`  - Reported per *settled* message, not per delta`);
  parts.push(`    - Deltas inside the open tail are ignored`);
  parts.push(`- Avoid layout thrash during \`scroll\``);
  parts.push(`- Preserve the user's selection across updates`);
  parts.push("");
  parts.push(`### ${feature}: steps`);
  parts.push("");
  parts.push(`1. Snapshot the current ${pick(rng, IDENTS)} state`);
  parts.push(`   1. Freeze everything before the last blank line`);
  parts.push(`   2. Keep the tail as plain text until it closes`);
  parts.push(`2. Re-parse only the tail with \`parseTail(${pick(rng, IDENTS)})\``);
  parts.push(`3. Commit once per animation frame`);
  parts.push("");
  parts.push(`> **Note:** ${sentence(rng)}`);
  parts.push(`> ${sentence(rng)}`);
  parts.push(">");
  parts.push(`> > Nested quote: ${sentence(rng)}`);
  parts.push("");
  parts.push(`#### Checklist`);
  parts.push("");
  parts.push(`- [x] Baseline captured on desktop`);
  parts.push(`- [x] Baseline captured on web`);
  parts.push(`- [ ] Baseline captured on iOS simulator`);
  parts.push(`- [ ] Baseline captured on Android emulator`);
  parts.push("");
  parts.push(`${sentences(rng, 2)} Related: [issue #${int(rng, 100, 900)}](https://example.com/issues/${int(rng, 100, 900)}), \`${camel(rng)}()\`, and _${pick(rng, SUBJECTS)}_.`);
  parts.push("");
  parts.push("---");
  parts.push("");
  return parts.join("\n");
}

function markdownLong(): Fixture {
  const b = new Builder("markdown-long");
  b.user("Write up the rendering performance plan for the chat, with details for each area.");
  b.wait(220);
  const doc: string[] = ["# Chat rendering performance plan", "", `${sentences(b.rng, 3)}`, ""];
  for (let n = 1; n <= 14; n++) doc.push(markdownSection(b.rng, n));
  doc.push("## Summary");
  doc.push("");
  doc.push("The order of work is: measure, freeze the stable prefix, then tune each area in isolation. Every change ships behind a flag until its baseline moves.");
  const text = doc.join("\n");
  b.stream("assistant_message", text);
  return b.finish({
    name: "markdown-long",
    description: `One long assistant reply (~${Math.round(text.length / 1024)} KiB) with headings, nested bullet and numbered lists, nested quotes, links, inline code, bold/italic, rules and task lists.`,
    scenario: "Incremental markdown on a long structured reply: reparse cost per delta and settled-prefix reuse (requirement 16.1 item 5).",
  });
}

function codeBlock(lang: string, body: string): string {
  return "```" + lang + "\n" + body.replace(/\n$/, "") + "\n```\n";
}

function codeblockStreaming(): Fixture {
  const b = new Builder("codeblock-streaming");
  b.user("Show me how to debounce a stream of updates in several languages.");
  b.wait(200);
  b.stream("assistant_message", "Here are a few approaches. Each snippet is complete and runnable.\n\n**TypeScript**\n\n", "window");
  const ts = codeBlock(
    "ts",
    `export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, waitMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, waitMs);
  };
}

const flush = debounce((text: string) => console.log("flush", text.length), 60);
for (const delta of ["Hel", "lo", " wor", "ld"]) flush(delta);
`,
  );
  b.stream("assistant_message", ts, "chars");
  b.stream("assistant_message", "\n**Python**\n\n", "window");
  b.stream(
    "assistant_message",
    codeBlock(
      "python",
      `import asyncio
from typing import Awaitable, Callable


def debounce(wait: float) -> Callable:
    def decorator(fn: Callable[..., Awaitable[None]]):
        task: asyncio.Task | None = None

        async def runner(*args, **kwargs):
            await asyncio.sleep(wait)
            await fn(*args, **kwargs)

        def wrapper(*args, **kwargs):
            nonlocal task
            if task and not task.done():
                task.cancel()
            task = asyncio.ensure_future(runner(*args, **kwargs))

        return wrapper

    return decorator
`,
    ),
    "chars",
  );
  b.stream("assistant_message", "\nA shell version that also exercises long lines:\n\n", "window");
  b.stream(
    "assistant_message",
    codeBlock(
      "bash",
      `#!/usr/bin/env bash
set -euo pipefail

last=0
while IFS= read -r line; do
  now=$(date +%s%3N)
  if (( now - last >= 60 )); then
    printf '%s\\n' "$line" | tee -a /tmp/stream.log | awk '{ print length($0) ": " substr($0, 1, 120) }'
    last=$now
  fi
done < <(tail -f "$1" --retry --follow=name)
`,
    ),
    "chars",
  );
  b.stream("assistant_message", "\nThe configuration, as JSON and as a diff against the old defaults:\n\n", "window");
  b.stream(
    "assistant_message",
    codeBlock(
      "json",
      `{
  "stream": {
    "windowMs": 60,
    "maxChunkBytes": 4096,
    "coalesce": true,
    "retry": { "attempts": 5, "backoffMs": [100, 250, 600, 1500, 4000] }
  },
  "render": { "frozenPrefix": true, "highlight": "lazy" }
}
`,
    ),
    "chars",
  );
  b.stream("assistant_message", "\n", "window");
  b.stream(
    "assistant_message",
    codeBlock(
      "diff",
      `--- a/config/stream.json
+++ b/config/stream.json
@@ -1,6 +1,7 @@
 {
   "stream": {
-    "windowMs": 120,
+    "windowMs": 60,
+    "coalesce": true,
     "maxChunkBytes": 4096
   }
 }
`,
    ),
    "chars",
  );
  b.stream("assistant_message", "\nFinally the same idea in Rust:\n\n", "window");
  b.stream(
    "assistant_message",
    codeBlock(
      "rust",
      `use std::time::{Duration, Instant};

pub struct Debounce<T> {
    wait: Duration,
    last: Option<Instant>,
    pending: Option<T>,
}

impl<T> Debounce<T> {
    pub fn new(wait_ms: u64) -> Self {
        Self { wait: Duration::from_millis(wait_ms), last: None, pending: None }
    }

    pub fn push(&mut self, value: T) -> Option<T> {
        let now = Instant::now();
        self.pending = Some(value);
        match self.last {
            Some(prev) if now.duration_since(prev) < self.wait => None,
            _ => {
                self.last = Some(now);
                self.pending.take()
            }
        }
    }
}
`,
    ),
    "chars",
  );
  b.stream("assistant_message", "\nAll five snippets coalesce at the same 60ms window the daemon uses.", "window");
  return b.finish({
    name: "codeblock-streaming",
    description: "Prose interleaved with six fenced code blocks (ts, python, bash, json, diff, rust); the code is streamed 1-4 characters at a time every ~8-22ms.",
    scenario: "Fenced code that is still open while streaming: unterminated-fence handling, per-character reparse and deferred highlighting (requirement 16.1 item 6).",
  });
}

function tableStreaming(): Fixture {
  const b = new Builder("table-streaming");
  b.user("Compare the platforms and the metrics we track, as tables.");
  b.wait(200);
  b.stream("assistant_message", "Here is the comparison. First, the platforms:\n\n");

  type Table = { head: string[]; align: string[]; rows: string[][] };
  const tables: Table[] = [
    {
      head: ["Platform", "Runtime", "Renderer", "Notes"],
      align: ["---", "---", ":---:", "---"],
      rows: [
        ["Desktop", "Electron 38", "Chromium", "Primary dev target, `Ctrl+F` handled by the app"],
        ["Web", "Vite dev server", "Browser", "Same bundle as desktop, no native bridge"],
        ["iOS", "Simulator", "Hermes + Fabric", "[Expo build](https://example.com/ios)"],
        ["Android", "Emulator", "Hermes + Fabric", "Software GL; timings are pessimistic"],
        ["Relay", "Cloud", "n/a", "Adds ~**40 ms** per hop"],
      ],
    },
    {
      head: ["Metric", "Unit", "Target", "Baseline", "Delta"],
      align: ["---", "---", "---:", "---:", "---:"],
      rows: [
        ["Time to first token paint", "ms", "50", "118", "+68"],
        ["Frame time while streaming (p95)", "ms", "16", "41", "+25"],
        ["Dropped frames per minute", "count", "5", "37", "+32"],
        ["JS heap after 100 turns", "MB", "120", "310", "+190"],
        ["Scroll jank (p99)", "ms", "24", "88", "+64"],
        ["Cold open of 100-turn history", "ms", "400", "1450", "+1050"],
        ["Table reparse per row", "µs", "200", "910", "+710"],
        ["Highlight cost per block", "ms", "8", "22", "+14"],
      ],
    },
    {
      head: ["Scenario", "Fixture", "What it stresses"],
      align: ["---", "---", "---"],
      rows: [
        ["Many reads", "`reads-20`", "Mounting 20+ collapsed cards"],
        ["Huge log", "`shell-log-large`", "One tool output with thousands of lines"],
        ["Long reasoning", "`reasoning-long-*`", "Structured and plain reasoning blocks"],
        ["Long reply", "`markdown-long`", "Incremental markdown parsing"],
        ["Code streaming", "`codeblock-streaming`", "Open fences, highlighting"],
        ["Tables", "`table-streaming`", "Header/delimiter flicker, wide rows"],
        ["Big diff", "`diff-large`", "5000-line unified diff"],
        ["Long history", "`history-100`", "100+ turns delivered fast"],
      ],
    },
  ];
  const intros = ["", "\nAnd the numbers we track:\n\n", "\nFinally, how each fixture maps to a scenario:\n\n"];
  tables.forEach((table, ti) => {
    if (ti > 0) b.stream("assistant_message", intros[ti]!);
    const headLine = `| ${table.head.join(" | ")} |`;
    const delim = `| ${table.align.join(" | ")} |`;
    // Header arrives first and sits alone: renderers see a "table" with no delimiter row yet.
    b.stream("assistant_message", headLine.slice(0, Math.ceil(headLine.length / 2)), "words");
    b.stream("assistant_message", headLine.slice(Math.ceil(headLine.length / 2)) + "\n", "words");
    b.wait(int(b.rng, 380, 700));
    b.stream("assistant_message", delim.slice(0, 6), "words");
    b.wait(int(b.rng, 40, 120));
    b.stream("assistant_message", delim.slice(6) + "\n", "words");
    for (const row of table.rows) {
      const line = `| ${row.join(" | ")} |`;
      const cut = int(b.rng, Math.floor(line.length / 3), Math.floor((line.length * 2) / 3));
      b.wait(int(b.rng, 60, 200));
      b.stream("assistant_message", line.slice(0, cut), "words");
      b.wait(int(b.rng, 30, 140));
      b.stream("assistant_message", line.slice(cut) + "\n", "words");
    }
  });
  b.stream("assistant_message", "\nEvery number above is a placeholder from the plan; the real baselines come from the replay harness.");
  return b.finish({
    name: "table-streaming",
    description: "Three GFM tables (4, 5 and 3 columns, with alignment markers, inline code, links and bold) streamed row by row; each header line lands alone for 380-700ms before its delimiter row.",
    scenario: "GFM tables arriving incrementally: header-before-delimiter flicker, partially received rows and reparse cost as rows are appended (requirement 16.1 item 7).",
  });
}

type EditOp = { at: number; remove: number; add: string[] };

function diffLarge(): Fixture {
  const b = new Builder("diff-large");
  const filePath = `${PROJECT}/client/components/timeline-list.tsx`;
  b.user("Refactor timeline-list.tsx to the new item model. It touches almost everything in the file.");
  b.wait(180);
  b.stream("assistant_message", "This is a wide refactor of the list component. I'll apply it in a single edit.\n\n");

  // Build an ~8000 line base file from synthetic modules, then edit it in many places.
  const base: string[] = [];
  for (let m = 0; base.length < 8000; m++) base.push(...synthModule(b.rng, `part${m}`).split("\n").slice(0, -1));
  const ops: EditOp[] = [];
  let cursor = 12;
  let diffLines = 0;
  const CONTEXT = 3;
  // Generate edit ops until the unified diff is large enough.
  while (cursor < base.length - 40 && diffLines < 5100) {
    const remove = int(b.rng, 0, 14);
    const add = Array.from({ length: int(b.rng, 0, 16) }, () => statement(b.rng, camel(b.rng), camel(b.rng), 1));
    const flat = add.join("\n").split("\n");
    if (remove === 0 && flat.length === 0) continue;
    ops.push({ at: cursor, remove, add: flat });
    diffLines += remove + flat.length + 2 * CONTEXT + 1;
    cursor += remove + int(b.rng, 2, 18) + 2 * CONTEXT;
  }
  // Merge ops whose context overlaps, then render hunks.
  let newDelta = 0;
  let i = 0;
  const renderedBody: string[] = [];
  while (i < ops.length) {
    const group: EditOp[] = [ops[i]!];
    while (i + group.length < ops.length) {
      const prev = group[group.length - 1]!;
      const next = ops[i + group.length]!;
      if (next.at - (prev.at + prev.remove) <= 2 * CONTEXT) group.push(next);
      else break;
    }
    i += group.length;
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const oldStart = Math.max(0, first.at - CONTEXT);
    const oldEnd = Math.min(base.length, last.at + last.remove + CONTEXT);
    const body: string[] = [];
    let pos = oldStart;
    let oldCount = 0;
    let newCount = 0;
    for (const op of group) {
      while (pos < op.at) {
        body.push(" " + base[pos]);
        pos++;
        oldCount++;
        newCount++;
      }
      for (let r = 0; r < op.remove; r++) {
        body.push("-" + base[pos]);
        pos++;
        oldCount++;
      }
      for (const a of op.add) {
        body.push("+" + a);
        newCount++;
      }
    }
    while (pos < oldEnd) {
      body.push(" " + base[pos]);
      pos++;
      oldCount++;
      newCount++;
    }
    const newStart = oldStart + 1 + newDelta;
    renderedBody.push(`@@ -${oldStart + 1},${oldCount} +${newStart},${newCount} @@`, ...body);
    newDelta += newCount - oldCount;
  }
  const unifiedDiff = [`--- a/${filePath.replace(PROJECT + "/", "")}`, `+++ b/${filePath.replace(PROJECT + "/", "")}`, ...renderedBody].join("\n") + "\n";
  const diffLineCount = unifiedDiff.split("\n").length - 1;

  const running = { type: "edit", filePath };
  b.tool("Edit", running, { type: "edit", filePath, unifiedDiff }, 1400);
  b.t += 1600;
  b.stream("assistant_message", `Applied. The edit changed ${ops.length} regions (${diffLineCount} diff lines). The file still compiles; run the typecheck to confirm.`);
  return b.finish({
    name: "diff-large",
    description: `One Edit tool call (running, then completed) carrying a ${diffLineCount}-line unified diff with ${renderedBody.filter((l) => l.startsWith("@@")).length} hunks and 3 lines of context.`,
    scenario: "A huge diff in an expanded edit card: diff parsing, line virtualisation and syntax highlighting of thousands of changed lines (requirement 16.1 item 8).",
  });
}

function shortAnswer(rng: Rng): string {
  const kind = int(rng, 0, 4);
  if (kind === 0) return `${sentences(rng, 2)}\n\n- ${sentence(rng)}\n- ${sentence(rng)}\n- ${sentence(rng)}`;
  if (kind === 1) return `${sentences(rng, 3)}\n\n${codeBlock("ts", synthModule(rng, "answer").split("\n").slice(0, 14).join("\n"))}\n${sentence(rng)}`;
  if (kind === 2) return `## Result\n\n${sentences(rng, 2)}\n\n1. ${sentence(rng)}\n2. ${sentence(rng)}\n\n> ${sentence(rng)}`;
  if (kind === 3) return sentences(rng, int(rng, 1, 3));
  return `| Item | Status |\n| --- | --- |\n| ${camel(rng)} | done |\n| ${camel(rng)} | pending |\n\n${sentence(rng)}`;
}

function history100(): Fixture {
  const b = new Builder("history-100");
  const turns = 110;
  const prompts = [
    "Why is the list re-rendering?",
    "Can you rename this helper?",
    "Add a test for the empty case.",
    "What does this error mean?",
    "Please summarize the last change.",
    "Check the config for typos.",
    "Make the table sortable.",
    "Explain the retry logic.",
  ];
  for (let n = 0; n < turns; n++) {
    b.user(`${pick(b.rng, prompts)} (turn ${n + 1})`);
    b.wait(int(b.rng, 3, 9));
    if (chance(b.rng, 0.45)) {
      b.stream("reasoning", sentences(b.rng, int(b.rng, 1, 4)), "burst");
    }
    const toolCount = int(b.rng, 0, 3);
    for (let k = 0; k < toolCount; k++) {
      b.wait(int(b.rng, 2, 8));
      const kind = int(b.rng, 0, 3);
      if (kind === 0) {
        const f = `${PROJECT}/client/${pick(b.rng, IDENTS)}-${pick(b.rng, IDENTS)}.ts`;
        const content = synthModule(b.rng, "hist").split("\n").slice(0, int(b.rng, 20, 60)).join("\n");
        b.tool("Read", { type: "read", filePath: f }, { type: "read", filePath: f, content }, 4);
      } else if (kind === 1) {
        const command = pick(b.rng, ["npm test", "git status --short", "ls -la client", "npm run typecheck"]);
        const output = Array.from({ length: int(b.rng, 3, 30) }, () => `${pick(b.rng, IDENTS)}: ${sentence(b.rng)}`).join("\n");
        const failed = chance(b.rng, 0.1);
        b.tool(
          "Bash",
          { type: "shell", command, cwd: PROJECT, output: "", exitCode: null },
          { type: "shell", command, cwd: PROJECT, output, exitCode: failed ? 1 : 0 },
          5,
          failed ? { status: "failed", error: { message: "Command exited with code 1" } } : { status: "completed" },
        );
      } else if (kind === 2) {
        const f = `${PROJECT}/client/${pick(b.rng, IDENTS)}-${pick(b.rng, IDENTS)}.ts`;
        const diff = `--- a/${f}\n+++ b/${f}\n@@ -10,4 +10,5 @@\n ${statement(b.rng, "a", "b", 0)}\n-${statement(b.rng, "a", "b", 0)}\n+${statement(b.rng, "a", "b", 0)}\n+${statement(b.rng, "a", "b", 0)}\n ${statement(b.rng, "a", "b", 0)}\n`;
        b.tool("Edit", { type: "edit", filePath: f }, { type: "edit", filePath: f, unifiedDiff: diff }, 5);
      } else {
        const query = pick(b.rng, IDENTS);
        b.tool(
          "Grep",
          { type: "search", query, toolName: "grep" },
          { type: "search", query, toolName: "grep", numMatches: int(b.rng, 1, 40), content: Array.from({ length: int(b.rng, 1, 8) }, () => `${PROJECT}/client/${pick(b.rng, IDENTS)}.ts:${int(b.rng, 1, 300)}:  ${statement(b.rng, "a", "b", 0).split("\n")[0]}`).join("\n") },
          4,
        );
      }
      b.t += 8;
    }
    b.wait(int(b.rng, 2, 6));
    b.stream("assistant_message", shortAnswer(b.rng), "burst");
    // Compress the delivery: the whole turn is squeezed so 100+ turns land within a few seconds.
    b.wait(int(b.rng, 8, 30));
  }
  return b.finish({
    name: "history-100",
    description: `${turns} completed turns (user prompt, optional reasoning, 0-3 tool calls, short markdown answer) delivered with only a few milliseconds between items.`,
    scenario: "Opening a long conversation: mount cost and memory for 100+ turns of mixed content, and scroll performance over a deep timeline (requirement 16.1 item 9).",
  });
}

function toolExpandedStreaming(): Fixture {
  const b = new Builder("tool-expanded-streaming");
  b.user("Run the soak test and let me watch the output as it goes.");
  b.wait(150);
  b.stream("assistant_message", "Starting the soak test. I'll keep the output open while it runs.\n\n");
  const command = "npm run soak -- --duration 60 --verbose";
  const callId = b.callId();
  const start = b.t;
  const totalMs = 60_000;
  b.emit(
    { type: "tool_call", callId, name: "Bash", detail: { type: "shell", command, cwd: PROJECT, output: "", exitCode: null }, status: "running", error: null },
    "replace",
    start,
  );
  let output = "";
  let elapsed = 0;
  let line = 0;
  while (elapsed < totalMs) {
    elapsed += int(b.rng, 250, 1100);
    const burst = int(b.rng, 1, 6);
    for (let k = 0; k < burst; k++) {
      line++;
      output += `[${String(Math.floor(elapsed / 1000)).padStart(3, " ")}s] iter=${String(line).padStart(5, "0")} ${pick(b.rng, ["ok", "ok", "ok", "slow", "retry"])} ${pick(b.rng, IDENTS)}=${int(b.rng, 1, 9999)} rss=${int(b.rng, 180, 420)}MB ${sentence(b.rng).slice(0, 60)}\n`;
    }
    b.emit(
      { type: "tool_call", callId, name: "Bash", detail: { type: "shell", command, cwd: PROJECT, output, exitCode: null }, status: "running", error: null },
      "replace",
      start + elapsed,
    );
  }
  output += `\nSoak finished: ${line} iterations, 0 failures.\n`;
  b.emit(
    { type: "tool_call", callId, name: "Bash", detail: { type: "shell", command, cwd: PROJECT, output, exitCode: 0 }, status: "completed", error: null },
    "replace",
    start + elapsed + 400,
  );
  b.t = start + elapsed + 700;
  b.stream("assistant_message", `The soak test completed ${line} iterations over 60 seconds with no failures.`);
  return b.finish({
    name: "tool-expanded-streaming",
    description: `One Bash tool call that stays running for ~60s; its replace-updates every 0.25-1.1s carry the full output so far (growing to ${line} lines), then it completes.`,
    scenario: "An expanded running tool card whose output keeps growing: re-render cost of a large, growing monospace log and stick-to-bottom behaviour (requirement 16.1 item 10).",
  });
}

function mixedTurn(): Fixture {
  const b = new Builder("mixed-turn");
  b.user("The reasoning block never collapses after the answer finishes. Find out why and fix it.");
  b.wait(200);
  b.stream(
    "reasoning",
    "**Locating the collapse logic**\n\nI should find where the reasoning block decides to collapse. A search for the collapse flag should land in the block component.\n\n**Checking turn completion**\n\nIt probably depends on the turn-completed signal, so I need to see how that reaches the timeline.",
  );
  b.wait(250);
  b.stream("assistant_message", "I'll start by searching for how the collapse state is set.\n\n");
  b.emit({
    type: "todo",
    items: [
      { text: "Find the collapse logic", completed: false, status: "in_progress", activeForm: "Finding the collapse logic" },
      { text: "Reproduce the stuck state", completed: false, status: "pending" },
      { text: "Fix and add a test", completed: false, status: "pending" },
    ],
  });
  b.wait(300);
  b.tool(
    "Grep",
    { type: "search", query: "collapsed", toolName: "grep" },
    {
      type: "search",
      query: "collapsed",
      toolName: "grep",
      numMatches: 6,
      numFiles: 3,
      content: `${PROJECT}/client/components/reasoning-block.tsx:21:  const [collapsed, setCollapsed] = useState(false);\n${PROJECT}/client/components/reasoning-block.tsx:44:  useEffect(() => { if (turnDone) setCollapsed(true); }, [turnDone]);\n${PROJECT}/client/lib/turn-state.ts:12:export function isTurnDone(items: Item[]) {`,
    },
    420,
  );
  b.wait(700);
  const blockPath = `${PROJECT}/client/components/reasoning-block.tsx`;
  const blockSrc = synthModule(b.rng, "reasoning-block").split("\n").slice(0, 70).join("\n");
  b.tool("Read", { type: "read", filePath: blockPath }, { type: "read", filePath: blockPath, content: blockSrc }, 140);
  const statePath = `${PROJECT}/client/lib/turn-state.ts`;
  b.tool("Read", { type: "read", filePath: statePath }, { type: "read", filePath: statePath, content: synthModule(b.rng, "turn-state").split("\n").slice(0, 45).join("\n") }, 190);
  b.wait(520);
  b.stream(
    "reasoning",
    "**Spotting the bug**\n\n`isTurnDone` only looks at the last item, but a trailing tool call keeps it false. The effect never sees `turnDone` flip.",
  );
  b.wait(200);
  b.stream("assistant_message", "Found it: `isTurnDone` ignores trailing tool calls. Let me fix that.\n\n");
  const diff = `--- a/client/lib/turn-state.ts
+++ b/client/lib/turn-state.ts
@@ -10,8 +10,10 @@
 export function isTurnDone(items: Item[]) {
-  const last = items[items.length - 1];
-  return last?.type === "assistant_message";
+  for (let i = items.length - 1; i >= 0; i--) {
+    const item = items[i];
+    if (item?.type === "tool_call" && item.status === "running") return false;
+    if (item?.type === "assistant_message") return true;
+  }
+  return false;
 }
`;
  b.tool("Edit", { type: "edit", filePath: statePath }, { type: "edit", filePath: statePath, unifiedDiff: diff }, 260);
  b.wait(560);
  const cmd = "npm test -- turn-state";
  b.tool(
    "Bash",
    { type: "shell", command: cmd, cwd: PROJECT, output: "", exitCode: null },
    { type: "shell", command: cmd, cwd: PROJECT, output: "FAIL client/lib/turn-state.test.ts\n  ✕ treats a running tool as not done (4 ms)\n\n    expected false, received true\n", exitCode: 1 },
    2200,
    { status: "failed", error: { message: "Command exited with code 1" } },
  );
  b.wait(2600);
  b.stream("reasoning", "**Reading the failure**\n\nThe test fixture builds the running tool with the wrong status string. That is a test bug, not a logic bug.", "window");
  b.wait(300);
  const testPath = `${PROJECT}/client/lib/turn-state.test.ts`;
  b.tool("Edit", { type: "edit", filePath: testPath }, { type: "edit", filePath: testPath, unifiedDiff: "--- a/client/lib/turn-state.test.ts\n+++ b/client/lib/turn-state.test.ts\n@@ -8,3 +8,3 @@\n   const items = [\n-    { type: \"tool_call\", status: \"pending\" },\n+    { type: \"tool_call\", status: \"running\" },\n   ];\n" }, 210);
  b.wait(500);
  b.tool(
    "Bash",
    { type: "shell", command: cmd, cwd: PROJECT, output: "", exitCode: null },
    { type: "shell", command: cmd, cwd: PROJECT, output: "PASS client/lib/turn-state.test.ts\n  ✓ treats a running tool as not done (3 ms)\n  ✓ is done after the final answer (1 ms)\n\nTests: 2 passed, 2 total\n", exitCode: 0 },
    1900,
  );
  b.wait(2300);
  b.emit({
    type: "todo",
    items: [
      { text: "Find the collapse logic", completed: true, status: "completed" },
      { text: "Reproduce the stuck state", completed: true, status: "completed" },
      { text: "Fix and add a test", completed: true, status: "completed" },
    ],
  });
  b.wait(250);
  b.stream(
    "assistant_message",
    `## Fixed\n\nThe reasoning block stayed open because \`isTurnDone\` only inspected the **last** timeline item, and a trailing tool call kept it \`false\`.\n\n### What changed\n\n- \`client/lib/turn-state.ts\`: scan backwards, return \`false\` while a tool is \`running\`, \`true\` once an \`assistant_message\` is found.\n- \`client/lib/turn-state.test.ts\`: the fixture used \`"pending"\`, which is not a real tool status.\n\n### Verification\n\n1. \`npm test -- turn-state\` first failed on the bad fixture.\n2. After correcting it, both cases pass.\n\n> The collapse effect itself is unchanged; it simply receives the right signal now.\n\nSee [the original report](https://example.com/issues/412) for the reproduction.`,
  );
  return b.finish({
    name: "mixed-turn",
    description: "A realistic single turn: sectioned reasoning, a todo list, grep + two reads, an edit, a failing then passing test run, a final todo update and a markdown summary.",
    scenario: "End-to-end representative turn for overall smoothness: interleaved reasoning, tool cards of every kind (including a failed one) and a structured final answer.",
  });
}

// ---------------------------------------------------------------------------------------
// Registry, validation, output
// ---------------------------------------------------------------------------------------

const FIXTURES: Array<[string, () => Fixture]> = [
  ["reads-20", readsTwenty],
  ["shell-log-large", shellLogLarge],
  ["reasoning-long-sections", reasoningSections],
  ["reasoning-long-prose", reasoningProse],
  ["markdown-long", markdownLong],
  ["codeblock-streaming", codeblockStreaming],
  ["table-streaming", tableStreaming],
  ["diff-large", diffLarge],
  ["history-100", history100],
  ["tool-expanded-streaming", toolExpandedStreaming],
  ["mixed-turn", mixedTurn],
];

function validate(name: string, fixture: Fixture): void {
  if (fixture.meta.name !== name) throw new Error(`${name}: meta.name mismatch`);
  let last = 0;
  const running = new Set<string>();
  for (const [index, line] of fixture.lines.entries()) {
    if (line.t < last) throw new Error(`${name}: line ${index + 2} goes back in time`);
    last = line.t;
    const { item } = line;
    if (item.type === "tool_call") {
      if (line.mode !== "replace") throw new Error(`${name}: tool_call must use replace`);
      if (item.status === "running") running.add(item.callId);
      else running.delete(item.callId);
    } else if (item.type === "assistant_message" || item.type === "reasoning") {
      if (line.mode !== "append" || item.text.length === 0) throw new Error(`${name}: bad text delta at line ${index + 2}`);
    }
  }
  if (running.size > 0) throw new Error(`${name}: tool calls never finished: ${[...running].join(", ")}`);
  if (fixture.lines[0]?.item.type !== "user_message") throw new Error(`${name}: must start with a user_message`);
}

function serialize(fixture: Fixture): string {
  return [JSON.stringify(fixture.meta), ...fixture.lines.map((l) => JSON.stringify({ t: l.t, item: l.item, mode: l.mode }))].join("\n") + "\n";
}

function main(): void {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const names = args.filter((a) => !a.startsWith("--"));
  const dir = dirname(fileURLToPath(import.meta.url));
  const selected = FIXTURES.filter(([name]) => names.length === 0 || names.includes(name));
  for (const name of names) if (!FIXTURES.some(([n]) => n === name)) throw new Error(`Unknown fixture: ${name}`);
  let drift = 0;
  for (const [name, build] of selected) {
    const fixture = build();
    validate(name, fixture);
    const text = serialize(fixture);
    const file = join(dir, `${name}.jsonl`);
    const last = fixture.lines[fixture.lines.length - 1]?.t ?? 0;
    if (check) {
      let current = "";
      try {
        current = readFileSync(file, "utf8");
      } catch {
        // missing file counts as drift
      }
      if (current !== text) {
        drift++;
        console.error(`DRIFT ${name}.jsonl`);
      } else console.log(`ok    ${name}.jsonl`);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, text);
    console.log(`wrote ${name}.jsonl  lines=${fixture.lines.length}  duration=${(last / 1000).toFixed(1)}s  size=${(text.length / 1024).toFixed(0)} KiB`);
  }
  if (drift > 0) process.exit(1);
}

main();
