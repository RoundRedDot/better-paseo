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
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { toolbarLabel } from "../../client/i18n/toolbar-strings";
import { PreviewPanelSample } from "../../client/ui/hover-preview";
import { HScroll } from "../../client/ui/h-scroll";
import { ToolbarButton } from "../../client/ui/toolbar-button";
import { toolCopyPlan } from "../../client/tools/copy";
import { toolHasDetail } from "../../client/tools/detail";

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
  it.each(["request_user_input", "request_user_input_async", "ask", "ask_user_question", "question", "custom-agent-form"])("reads provider-independent metadata for %s", (name) => {
    const data = classifyTool({ name, status: "completed", detail: { type: "plain_text", text: "Short" },
      questionData: { questions: [{ id: "scope", question: "Which platforms?", options: ["iOS", "Web"], multiSelect: true }],
        answers: { scope: { answers: ["iOS", "Web"] } } } });
    expect(readUserQuestions(data)).toMatchObject({ questions: [{ answer: "iOS, Web", selected: ["iOS", "Web"], multiSelect: true }] });
    expect(toolHasDetail(data, 72)).toBe(true);
    expect(toolCopyPlan(data, (p) => p).menu.some((action) => action.id === "args")).toBe(true);
  });
  it("reads OMP multi-select results and custom answers without splitting option commas", () => {
    const data = classifyTool({ name: "ask", status: "completed", questionData: {
      questions: [{ question: "Pick?", multi: true, options: [{ label: "Red, Blue" }, { label: "Green" }] }],
      result: { results: [{ question: "Pick?", selectedOptions: ["Red, Blue"], customInput: "A custom answer" }] },
    } });
    expect(readUserQuestions(data)!.questions[0]).toMatchObject({ answer: "Red, Blue, A custom answer", selected: ["Red, Blue"], multiSelect: true });
  });
  it("reads Pi results after the host turns them into a plain-text card", () => {
    const data = classifyTool({ name: "ask_user_question", status: "completed", detail: { type: "plain_text", text: "Selected" }, questionData: {
      questions, result: { answers: [{ question: questions[1]!.question, kind: "multi", selected: ["iOS", "Web"], answer: null }] },
    } });
    expect(readUserQuestions(data)!.questions[1]!.answer).toBe("iOS, Web");
  });
  it("maps a single answer-only result and preserves an unfamiliar provider response", () => {
    const data = classifyTool({ name: "ask_user", status: "completed", detail: { type: "plain_text", text: "Provider response" },
      questionData: { questions: [{ question: "Pick?", options: ["A", "B"] }], result: { answer: "B" } } });
    expect(readUserQuestions(data)!.questions[0]!.answer).toBe("B");
    expect(readUserQuestions({ ...data, questionData: { ...data.questionData, result: { unfamiliar: true } } })!.response).toBe("Provider response");
  });
  it("reads OpenCode positional metadata answers and its multiple flag", () => {
    const data = classifyTool({ name: "question", status: "completed", questionData: {
      questions: [{ question: "Pick?", multiple: true, options: [{ label: "Red, Blue" }, { label: "Green" }] }],
      answers: [["Red, Blue", "Green"]],
    } });
    expect(readUserQuestions(data)!.questions[0]).toMatchObject({ answer: "Red, Blue, Green", selected: ["Red, Blue", "Green"], multiSelect: true });
  });
  it("reads the OpenCode tool's documented text result when structured input is available", () => {
    const data = classifyTool({ name: "question", status: "completed", detail: { type: "unknown", input: { questions },
      output: `User has answered your questions: "${questions[0]!.question}"="Codex". You can now continue with the user's answers in mind.` } });
    expect(readUserQuestions(data)!.questions[0]!.answer).toBe("Codex");
  });
  it("keeps async questions pending despite their completed tool status and distinguishes dismissal", () => {
    const data = classifyTool({ name: "request_user_input_async", status: "completed", questionData: {
      questions: [{ id: "0", question: "Your feedback?" }], status: "pending",
    } });
    expect(readUserQuestions(data)).toMatchObject({ running: true, dismissed: false, questions: [{ question: "Your feedback?", options: [] }] });
    expect(readUserQuestions({ ...data, questionData: { ...data.questionData, status: "dismissed" } })).toMatchObject({ running: false, dismissed: true });
  });
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
  it.each(["统一规则：回 0 再开流 (Recommended)", "先记录日志，稍后再处理"])("maps the screenshot's answer to an option or custom content: %s", (answer) => {
    updateEnhancerPreferences({ language: "en" });
    const question = "未掉线时点「继续」、戒指回「不在暂停态」（StateConflict）怎么处理?";
    const label = "统一规则：回 0 再开流 (Recommended)";
    const output = `Your questions have been answered: "${question}"="${answer}". You can now continue with these answers in mind.`;
    const data = call({ questions: [{ header: "问题2", question, options: [{ label }, { label: "保持直接失败" }] }] }, { output });
    let view!: ReturnType<typeof TestRenderer.create>;
    act(() => { view = TestRenderer.create(React.createElement(ToolPreviewContent, { data, tokens, compact: false, resolvePath: (p) => p })); });
    try {
      expect(readUserQuestions(data)!.questions[0]!.answer).toBe(answer);
      const options = view.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "user-question-option");
      expect(options.map((node) => node.props.accessibilityState.selected)).toEqual([answer === label, false]);
      expect(text(view.root)).toContain(answer);
      expect(text(view.root)).not.toContain("No answer recorded");
      expect(text(view.root)).not.toContain("Your questions have been answered");
      act(() => button(view.root, "Show raw data").props.onPress());
      expect(text(view.root)).toContain(data.output!);
    } finally { act(() => view.unmount()); resetEnhancerPreferences(); }
  });
  it("keeps an unrecognized provider response in raw data only", () => {
    updateEnhancerPreferences({ language: "en" });
    const output = "Provider-specific raw response";
    let view!: ReturnType<typeof TestRenderer.create>;
    act(() => { view = TestRenderer.create(React.createElement(ToolPreviewContent, {
      data: call({ questions }, { output }), tokens, compact: false, resolvePath: (p) => p,
    })); });
    try {
      expect(text(view.root)).not.toContain(output);
      act(() => button(view.root, "Show raw data").props.onPress());
      expect(text(view.root)).toContain(output);
    } finally { act(() => view.unmount()); resetEnhancerPreferences(); }
  });
  it.each(["ask", "ask_user_question", "request_user_input_async", "question"])("keeps the question title in the body and the %s name in the toolbar", (name) => {
    updateEnhancerPreferences({ language: "en" });
    const question = "需要验证哪些平台？这是用于检查窄窗口自动折行的较长问题标题。";
    const data = classifyTool({ name, status: "completed", detail: { type: "plain_text", label: question, text: "iOS" },
      questionData: { questions: [{ question, options: ["iOS", "Web"] }, { question: "Any feedback?" }] } });
    let view!: ReturnType<typeof TestRenderer.create>;
    act(() => { view = TestRenderer.create(React.createElement(PreviewPanelSample, { tokens,
      children: React.createElement(ToolPreviewContent, { data, tokens, compact: false, resolvePath: (p) => p }),
    })); });
    try {
      const title = () => text(view.root.findByProps({ testID: "hover-preview-tool-name" }));
      expect(title()).toBe(name);
      expect(text(view.root.findByProps({ testID: "user-question" }))).toContain(question);
      act(() => button(view.root, "Next question").props.onPress());
      expect(title()).toBe(name);
      expect(text(view.root.findByProps({ testID: "user-question" }))).toContain("Any feedback?");
      act(() => button(view.root, "Show raw data").props.onPress());
      expect(title()).toBe(name);
      act(() => button(view.root, "Show questions").props.onPress());
      expect(title()).toBe(name);
    } finally {
      act(() => view.unmount());
      resetEnhancerPreferences();
    }
  });
  it("keeps highlighting multi-select answers stored as a comma-joined string", () => {
    const data = classifyTool({ name: "request_user_input", status: "completed", questionData: {
      questions: [questions[1]], answers: { Platforms: "iOS, Web" },
    } });
    let view!: ReturnType<typeof TestRenderer.create>;
    act(() => { view = TestRenderer.create(React.createElement(ToolCallout, { data, tokens, defaultExpanded: true })); });
    const options = view.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "user-question-option");
    expect(options.map((node) => node.props.accessibilityState.selected)).toEqual([true, true, false]);
    act(() => view.unmount());
  });
  it("uses the same pager, JSON toggle and free-text layout for Codex async questions", () => {
    updateEnhancerPreferences({ language: "en" });
    const data = classifyTool({ name: "request_user_input_async", callId: "async-1", status: "completed", detail: { type: "plain_text", text: "Short" },
      questionData: { questions: [{ id: "0", question: "Choose?", options: ["A", "B"] }, { id: "1", question: "Your feedback?" }], answers: { "0": ["B"], "1": ["Works well"] } } });
    let view!: ReturnType<typeof TestRenderer.create>;
    act(() => { view = TestRenderer.create(React.createElement(ToolCallout, { data, tokens, defaultExpanded: true })); });
    try {
      expect(text(view.root)).toContain("1 / 2");
      act(() => button(view.root, "Next question").props.onPress());
      expect(text(view.root)).toContain("Free text");
      expect(text(view.root)).toContain("Works well");
      act(() => button(view.root, "Show raw data").props.onPress());
      expect(view.root.findByType(SyntaxHighlightBlock).props.code).toBe(JSON.stringify(data.questionData, null, 2));
      act(() => button(view.root, "Show questions").props.onPress());
      expect(text(view.root)).toContain("2 / 2");
    } finally { act(() => view.unmount()); }
  });
  it.each(["ios", "web"])("always wraps questions and raw data without a wrap toggle on %s", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    updateEnhancerPreferences({ previewWrap: false });
    const long = "Long question and answer text. ".repeat(50);
    const data = call({ questions: [{ ...questions[0]!, header: long, question: long }], answers: { [long]: long } });
    const draw = (data: ReturnType<typeof call>) => React.createElement(PreviewPanelSample, { tokens,
      children: React.createElement(ToolPreviewContent, { data, tokens, compact: false, resolvePath: (p: string) => p }),
    });
    let view!: ReturnType<typeof TestRenderer.create>;
    act(() => { view = TestRenderer.create(draw(data)); });
    try {
      const assertWrapped = () => {
        expect(view.root.findAllByType(HScroll)).toHaveLength(0);
        expect(view.root.findAllByType(ToolbarButton).filter((node) =>
          ["Wrap lines", "Do not wrap lines"].includes(node.props.label))).toHaveLength(0);
        expect(view.root.findByProps({ testID: "hover-preview-tool-name" }).props.numberOfLines).toBeUndefined();
      };
      assertWrapped();
      expect(text(view.root)).toContain(long);
      expect(view.root.findAllByType(ToolbarButton).find((node) => node.props.label === "Show raw data")!.props.icon).toBe("FileJson");
      expect(view.root.findAllByType(ToolbarButton).find((node) => node.props.label === "Copy arguments")!.props.icon).toBe("Braces");
      act(() => button(view.root, "Show raw data").props.onPress());
      assertWrapped();
      act(() => button(view.root, "Show questions").props.onPress());
      assertWrapped();
      // Other tool previews still honor the reader's saved wrap preference.
      act(() => view.update(draw(classifyTool({ name: "Bash", status: "completed", detail: { type: "shell", command: "echo hi", output: "hi" } }))));
      expect(button(view.root, "Wrap lines")).toBeDefined();
      expect(view.root.findByProps({ testID: "hover-preview-tool-name" }).props.numberOfLines).toBe(1);
    } finally {
      act(() => view.unmount());
      resetEnhancerPreferences();
      delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
    }
  });

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
