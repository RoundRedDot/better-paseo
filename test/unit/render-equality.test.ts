import { describe, expect, it } from "vitest";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import {
  assistantPropsEqual,
  noticePropsEqual,
  reasoningPropsEqual,
  todoPropsEqual,
  toolPropsEqual,
  userMessagePropsEqual,
} from "../../client/state/render-equality";
import { themeKey } from "../../client/ui/tokens/theme-key";

const COLORS = {
  surface0: "#0f0f11",
  surface1: "#17171a",
  surface2: "#1f1f23",
  border: "#2a2a30",
  foreground: "#f2f3f5",
  foregroundMuted: "#a3a6ad",
  accent: "#7aa2f7",
  accentForeground: "#0f0f11",
  statusSuccess: "#4cb782",
  statusWarning: "#d9a53f",
  statusDanger: "#f2555a",
};

/** Props as Paseo 0.11.2 builds them: a fresh theme, data and Date every render. */
function props<T>(data: T, at = 1000, overrides: Partial<PluginTimelineItemProps<T>> = {}) {
  return {
    agentId: "agent",
    theme: { colors: { ...COLORS } },
    host: { id: "local", label: "Local" },
    layout: { compact: false, platform: "web" as const },
    timestamp: new Date(at),
    item: { type: "plugin" as const, kind: "k", version: 1, data: structuredClone(data) },
    ...overrides,
  } as PluginTimelineItemProps<T>;
}

describe("themeKey", () => {
  it("is equal for equal colours in a fresh object and changes with any colour", () => {
    expect(themeKey({ colors: { ...COLORS } })).toBe(themeKey({ colors: { ...COLORS } }));
    expect(themeKey({ colors: { ...COLORS, accent: "#000" } })).not.toBe(themeKey({ colors: COLORS }));
  });

  it("includes host typography when present", () => {
    const withType = { colors: COLORS, typography: { fontSize: { code: 14 } } };
    expect(themeKey(withType)).not.toBe(themeKey({ colors: COLORS }));
  });
});

describe("toolPropsEqual", () => {
  const done = { name: "read", status: "completed", callId: "c1", detail: { out: "x" }, phase: "streaming" };
  it("renders a later async answer even while status and timestamp stay completed", () => {
    const pending = { ...done, name: "request_user_input_async", questionData: { questions: [{ question: "Q" }], status: "pending" } };
    expect(toolPropsEqual(props(pending), props(pending))).toBe(true);
    expect(toolPropsEqual(props(pending), props({ ...pending, questionData: { ...pending.questionData, status: "answered", answers: { "0": ["A"] } } }))).toBe(false);
    expect(toolPropsEqual(props(pending), props({ ...pending, questionData: { ...pending.questionData, status: "dismissed" } }))).toBe(false);
  });

  it("skips a completed card re-sent with fresh objects", () => {
    expect(toolPropsEqual(props(done), props(done))).toBe(true);
  });

  it("does not compare the detail of a settled card", () => {
    expect(toolPropsEqual(props(done), props({ ...done, detail: { out: "y" } }))).toBe(true);
  });

  it("renders a running card on every change", () => {
    const running = { ...done, status: "running" };
    expect(toolPropsEqual(props(running), props(running))).toBe(false);
  });

  it("renders on status, phase, error, call id, plan verdict, theme or layout change", () => {
    expect(toolPropsEqual(props(done), props({ ...done, status: "failed" }))).toBe(false);
    expect(toolPropsEqual(props(done), props({ ...done, phase: "complete" }))).toBe(false);
    expect(toolPropsEqual(props(done), props({ ...done, error: "boom" }))).toBe(false);
    expect(toolPropsEqual(props(done), props({ ...done, callId: "c2" }))).toBe(false);
    expect(toolPropsEqual(props(done), props({ ...done, approved: false }))).toBe(false);
    expect(
      toolPropsEqual(props(done), props(done, 1000, { theme: { colors: { ...COLORS, surface0: "#fff" } } })),
    ).toBe(false);
    expect(
      toolPropsEqual(props(done), props(done, 1000, { layout: { compact: true, platform: "web" } })),
    ).toBe(false);
    expect(toolPropsEqual(props(done), props(done, 2000))).toBe(false);
  });

  it("renders a card without a call id unless the data object is the same", () => {
    const anonymous = { name: "bash", status: "completed" };
    expect(toolPropsEqual(props(anonymous), props(anonymous))).toBe(false);
    const a = props(anonymous);
    expect(toolPropsEqual(a, { ...a, theme: { colors: { ...COLORS } } })).toBe(true);
  });
});

describe("text renderers", () => {
  it("reasoning compares text and phase and ignores the rewritten timestamp", () => {
    const thought = { text: "Thinking about it", phase: "streaming" };
    expect(reasoningPropsEqual(props(thought, 1), props(thought, 2))).toBe(true);
    expect(reasoningPropsEqual(props(thought), props({ ...thought, text: `${thought.text}.` }))).toBe(false);
    expect(reasoningPropsEqual(props(thought), props({ ...thought, phase: "complete" }))).toBe(false);
  });

  it("assistant compares text, phase and timestamp", () => {
    const reply = { text: "Hello" };
    expect(assistantPropsEqual(props(reply), props(reply))).toBe(true);
    expect(assistantPropsEqual(props(reply), props({ text: "Hello!" }))).toBe(false);
    // Same length, different text: still a change.
    expect(assistantPropsEqual(props(reply), props({ text: "Jello" }))).toBe(false);
    expect(assistantPropsEqual(props(reply), props(reply, 5))).toBe(false);
  });

  it("user message compares message id, text, images and timestamp", () => {
    const prompt = { text: "hi", messageId: "m1", images: ["a"] };
    expect(userMessagePropsEqual(props(prompt), props(prompt))).toBe(true);
    expect(userMessagePropsEqual(props(prompt), props({ ...prompt, messageId: "m2" }))).toBe(false);
    expect(userMessagePropsEqual(props(prompt), props({ ...prompt, images: ["b"] }))).toBe(false);
    expect(userMessagePropsEqual(props(prompt), props({ ...prompt, text: "ho" }))).toBe(false);
  });
});

describe("todo and notice", () => {
  it("todo compares the items by content", () => {
    const todo = { items: [{ text: "a", completed: false }], phase: "streaming" };
    expect(todoPropsEqual(props(todo), props(todo))).toBe(true);
    expect(todoPropsEqual(props(todo), props({ ...todo, items: [{ text: "a", completed: true }] }))).toBe(
      false,
    );
  });

  it("notice compares level, message and fatal", () => {
    const notice = { level: "error", message: "x", fatal: true };
    expect(noticePropsEqual(props(notice), props(notice))).toBe(true);
    expect(noticePropsEqual(props(notice), props({ ...notice, fatal: false }))).toBe(false);
  });
});
