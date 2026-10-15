import React from "react";
import { describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput,
    copyText: async () => {}, useToast: () => ({ show() {}, error() {} }) };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));

import { classifyTool } from "../../client/tools/classify";
import { readUserQuestions } from "../../client/tools/user-questions";
import { ToolCallout, ToolPreviewContent } from "../../client/components/tool-callouts";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { SyntaxHighlightBlock } from "../../client/components/syntax-highlight";
import { updateEnhancerPreferences } from "../../client/preferences";
import { toolbarLabel } from "../../client/i18n/toolbar-strings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
const questions = [
  { header: "Provider", question: 'Which "provider", today?', multiSelect: false,
    options: [{ label: "Claude (Recommended)", description: "Use Claude Code" }, { label: "Codex", description: "Use Codex" }] },
  { header: "Platforms", question: "Which platforms?", multiSelect: true,
    options: [{ label: "iOS", description: "Phone" }, { label: "Web", description: "Browser" }, { label: "Android" }] },
];
const summary = (answers: string[]) => "Your questions have been answered: " + questions.slice(0, answers.length)
  .map((q, i) => `"${q.question}"="${answers[i]}"`).join(", ") + ". You can now continue with the answers in mind.";
const call = (input: unknown = { questions }, output?: unknown, status = "completed") => classifyTool({
  name: "AskUserQuestion", callId: "ask-1", status, detail: { type: "unknown", input, output },
});
function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
}
function button(root: ReactTestInstance, label: string) {
  return root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
}

describe("AskUserQuestion transcript data", () => {
  it("reads the screenshot's JSON-wrapped summary and preserves quotes and commas", () => {
    const data = readUserQuestions(call({ questions }, { output: summary(['A "custom", answer', "iOS, Web"]) }))!;
    expect(data.questions.map((q) => q.answer)).toEqual(['A "custom", answer', "iOS, Web"]);
    expect(data.response).toBeUndefined();
  });
  it("reads plain summaries and matches answers by question rather than response order", () => {
    const output = 'Your questions have been answered: "Which platforms?"="Web", "Which "provider", today?"="Codex". You can now continue with the user\'s answers in mind.';
    expect(readUserQuestions(call({ questions }, output))!.questions.map((q) => q.answer)).toEqual(["Codex", "Web"]);
  });
  it("uses structured answers keyed by full question or header, including free text", () => {
    const answers = { [questions[0]!.question]: "A different provider", Platforms: "iOS, Web" };
    expect(readUserQuestions(call({ questions, answers }))!.questions.map((q) => q.answer))
      .toEqual(["A different provider", "iOS, Web"]);
    expect(readUserQuestions(call({ questions }, { answers }))!.questions[0]!.answer).toBe("A different provider");
  });
  it("preserves an unrecognized response and distinguishes pending from settled", () => {
    expect(readUserQuestions(call({ questions }, { output: "User declined to answer." }))!.response).toBe("User declined to answer.");
    expect(readUserQuestions(call({ questions }, undefined, "running"))!.running).toBe(true);
    expect(readUserQuestions(call())!.running).toBe(false);
  });
  it.each([undefined, { questions: [] }, { questions: [null] }, { questions: [{ question: "Q" }] },
    { questions: [{ question: "Q", options: [null] }] }])("keeps malformed input in the existing raw renderer: %j", (input) => {
    expect(readUserQuestions(call(input === undefined ? null : input))).toBeUndefined();
  });
  it("does not treat another tool with questions as AskUserQuestion", () => {
    expect(readUserQuestions({ ...call(), name: "OtherTool" })).toBeUndefined();
  });
});

describe("AskUserQuestion presentation", () => {
  it.each(["ios", "web"])("defaults to questions, pages and keeps the page across raw toggles on %s", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const data = call({ questions }, { output: summary(["Codex", "iOS, Web"]) });
    let view!: ReturnType<typeof TestRenderer.create>;
    act(() => { view = TestRenderer.create(React.createElement(ToolPreviewContent, { data, tokens, compact: false, resolvePath: (p) => p })); });
    try {
      const start = view.root.findByProps({ testID: "hover-preview-start" });
      expect(button(start, "Show raw data")).toBeDefined();
      expect(button(start, "Previous question").props.disabled).toBe(true);
      expect(text(view.root)).toContain(questions[0]!.question);
      expect(text(view.root)).not.toContain(questions[1]!.question);
      expect(view.root.findAllByType(SyntaxHighlightBlock)).toHaveLength(0);
      act(() => button(start, "Next question").props.onPress());
      expect(text(view.root)).toContain("2 / 2");
      expect(text(view.root)).toContain(questions[1]!.question);
      expect(button(start, "Next question").props.disabled).toBe(true);
      const options = view.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "user-question-option");
      expect(options.map((node) => node.findAll((child) => child.props.name === "SquareCheck").length > 0))
        .toEqual([true, true, false]);
      // Transcript options never submit answers.
      expect(options.every((node) => node.props.onPress === undefined)).toBe(true);
      act(() => button(start, "Show raw data").props.onPress());
      expect(view.root.findAllByProps({ testID: "user-question" })).toHaveLength(0);
      expect(view.root.findByType(SyntaxHighlightBlock).props.code).toBe(JSON.stringify(data.input, null, 2));
      expect(text(view.root)).toContain(data.output!);
      act(() => button(start, "Show questions").props.onPress());
      expect(text(view.root)).toContain("2 / 2");
      expect(text(view.root)).toContain(questions[1]!.question);
      act(() => button(start, "Previous question").props.onPress());
      expect(text(view.root)).toContain(questions[0]!.question);
    } finally {
      act(() => view.unmount());
      delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
    }
  });
  it("supports an expanded single-question card, long text and a later answer", () => {
    updateEnhancerPreferences({ language: "en" });
    const question = { ...questions[0]!, question: "A long question? ".repeat(100) };
    let view!: ReturnType<typeof TestRenderer.create>;
    const draw = (data: ReturnType<typeof call>) => React.createElement(ToolCallout, { data, tokens, defaultExpanded: true });
    act(() => { view = TestRenderer.create(draw(call({ questions: [question] }, undefined, "running"))); });
    try {
      expect(text(view.root)).toContain("Waiting for answer…");
      expect(text(view.root)).toContain(question.question);
      expect(view.root.findAll((node) => node.props.accessibilityLabel === "Next question")).toHaveLength(0);
      act(() => view.update(draw(call({ questions: [question], answers: { [question.question]: "Other, with detail" } }))));
      expect(text(view.root)).toContain("Other, with detail");
      expect(text(view.root)).not.toContain("Waiting for answer…");
      act(() => button(view.root, "Show raw data").props.onPress());
      expect(view.root.findByType(SyntaxHighlightBlock)).toBeDefined();
    } finally { act(() => view.unmount()); }
  });
  it("clamps the page when questions shrink and keeps errors visible", () => {
    let view!: ReturnType<typeof TestRenderer.create>;
    const draw = (data: ReturnType<typeof call>) => React.createElement(ToolPreviewContent, { data, tokens, compact: false, resolvePath: (p: string) => p });
    act(() => { view = TestRenderer.create(draw(call())); });
    act(() => button(view.root, "Next question").props.onPress());
    act(() => view.update(draw({ ...call({ questions: questions.slice(0, 1) }), error: "Permission denied", status: "failed" })));
    expect(text(view.root)).toContain(questions[0]!.question);
    expect(text(view.root)).toContain("No answer recorded");
    expect(text(view.root)).toContain("Permission denied");
    act(() => view.unmount());
  });
  it("localizes question controls", () => {
    for (const value of ["Show raw data", "Show questions", "Previous question", "Next question", "Select one", "Select multiple", "Answer"]) {
      expect(toolbarLabel(value, "zh")).not.toBe(value);
    }
  });
});
