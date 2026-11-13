import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

vi.hoisted(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const modalRenders = vi.hoisted(() => ({ count: 0 }));
const keyboard = vi.hoisted(() => ({ hide: undefined as (() => void) | undefined, show: undefined as (() => void) | undefined, blur: vi.fn(), scrollToEnd: vi.fn() }));
vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { ...rn, Keyboard: { addListener: (event: string, callback: () => void) => {
    const key = event === "keyboardDidHide" ? "hide" : "show";
    keyboard[key] = callback;
    return { remove: () => { keyboard[key] = undefined; } };
  } } };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  const Input = React.forwardRef((_props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => ({ blur: keyboard.blur }));
    return React.createElement(rn.TextInput, _props);
  });
  const Scroll = React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToEnd: keyboard.scrollToEnd }));
    return React.createElement(rn.ScrollView, props);
  });
  return { TextInput: Input, ScrollView: Scroll, useToast: () => ({ show: vi.fn(), error: vi.fn() }), copyText: vi.fn(async () => {}),
    Icon: (props: object) => React.createElement("Icon", props),
    Modal: Object.assign((props: { children?: React.ReactNode }) => React.createElement("HostModal", props, props.children),
      { Content: (props: { children?: React.ReactNode }) => { modalRenders.count++; return React.createElement("ModalContent", props, props.children); } }) };
});
import { TaskInlineQuestions, TaskQuestionDialog } from "../../client/tasks/cards/question-dialog";
import { createQuestionDialogStore, questionDialogStore } from "../../client/tasks/actions/question-dialog";
import { parseTaskQuestions, questionAnswers, questionDraftSupported, questionFormSupported, EMPTY_QUESTION_DRAFT } from "../../client/tasks/question-form";
import { permissionButtons, respondToPermission } from "../../client/tasks/actions";
import { previewSampleCards } from "../../client/tasks/sample-cards";
import { createFakePaseo } from "./helpers/fake-paseo";
import type { TaskCard } from "../../client/tasks/model";

const theme = { colors: { surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111", foregroundMuted: "#666", accent: "#36c", accentForeground: "#fff", statusWarning: "#960", statusDanger: "#c33", statusSuccess: "#393" } };
const question = { header: "Original header", question: "Full question\nSecond line", options: [{ label: "Keep, unchanged", description: "Full explanation", preview: "Preview\nSecond line" }, { label: "Reject" }], multiSelect: false, isOther: true };
function card(input = { questions: [question] }): TaskCard {
  return { ...previewSampleCards(Date.now())[0]!, id: "asking", lane: "needs_input", provider: "claude", title: "Task context",
    permission: { requestId: "original-request", kind: "question", name: "AskUserQuestion", title: "Question", summary: question.question, actions: [], remaining: 0, questions: parseTaskQuestions(input) } };
}
let tree: ReactTestRenderer | undefined;
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });
const host = (id: string) => tree!.root.find((node) => typeof node.type === "string" && node.props.testID === id);

describe("task question form protocol", () => {
  it("reads OMP-shaped permissions without a tool name whitelist and preserves input constraints", () => {
    expect(parseTaskQuestions({ questions: [{ header: "Response", question: "Optional comment", options: [], allowEmpty: true, placeholder: "optional", isSecret: true }] })).toEqual([
      { header: "Response", question: "Optional comment", options: [], multiSelect: false, allowOther: false, allowEmpty: true, placeholder: "optional", isSecret: true },
    ]);
    expect(parseTaskQuestions({ questions: [{ ...question, options: [null] }] })).toBeUndefined();
  });
  it("uses original headers, option text and click order; single custom replaces and multi custom appends", () => {
    const questions = parseTaskQuestions({ questions: [question, { ...question, header: "Multi", multiSelect: true }] })!;
    expect(questionAnswers(questions, EMPTY_QUESTION_DRAFT)).toBeUndefined();
    expect(questionAnswers(questions, { selections: { 0: [0], 1: [1, 0] }, texts: { 0: " Custom ", 1: " Extra " } })).toEqual({ "Original header": "Custom", Multi: "Reject, Keep, unchanged, Extra" });
  });
  it("submits optional free text as an explicit empty answer and requires nonempty mandatory text", () => {
    const optional = parseTaskQuestions({ questions: [{ header: "Response", question: "Comment", options: [], allowEmpty: true }] })!;
    expect(questionAnswers(optional, EMPTY_QUESTION_DRAFT)).toEqual({ Response: "" });
    expect(questionAnswers([{ ...optional[0]!, allowEmpty: false }], EMPTY_QUESTION_DRAFT)).toBeUndefined();
  });
  it("rejects duplicate headers and ambiguous Codex sync multi-selects without restricting async or Claude", () => {
    const questions = parseTaskQuestions({ questions: [{ ...question, multiSelect: true }] })!;
    expect(questionFormSupported(questions, "codex", "request_user_input")).toBe(false);
    expect(questionFormSupported(questions, "codex", "request_user_input_async")).toBe(true);
    expect(questionFormSupported(questions, "claude")).toBe(true);
    expect(questionFormSupported([...questions, ...questions], "claude")).toBe(false);
    const supported = [{ ...questions[0]!, options: [{ label: "A" }, { label: "B" }] }];
    expect(questionFormSupported(supported, "codex", "request_user_input")).toBe(true);
    expect(questionDraftSupported(supported, { selections: {}, texts: { 0: "custom answer" } }, "codex", "request_user_input")).toBe(true);
    expect(questionDraftSupported(supported, { selections: {}, texts: { 0: "a,b" } }, "codex", "request_user_input")).toBe(false);
  });
  it("keeps direct two-option answers and adds a dialog entry even for requests without structured questions", () => {
    const simple = card({ questions: [{ ...question, options: [{ label: "允许" }, { label: "拒绝" }] }] });
    expect(permissionButtons(simple.permission!, "zh", true).map((b) => [b.label, b.kind])).toEqual([["允许", "respond"], ["拒绝", "respond"], ["查看问题", "question"]]);
    expect(permissionButtons({ ...simple.permission!, questions: undefined }, "en", true).map((b) => b.kind)).toEqual(["question"]);
  });
});

describe("task question dialog", () => {
  async function mount(current = card(), store = createQuestionDialogStore(), send?: (state: NonNullable<ReturnType<typeof store.get>>) => Promise<void>) {
    const fake = createFakePaseo();
    const submit = send ?? (async (state) => {
      await respondToPermission(fake.paseo, current.id, { key: "form", label: "", variant: "secondary", kind: "respond", action: { behavior: "allow", id: null }, answers: questionAnswers(state.permission.questions!, state.draft) }, state.permission.requestId);
    });
    const render = () => <TaskQuestionDialog store={store} cardById={() => current} submit={submit} theme={theme} language="zh" />;
    await act(async () => { store.open(current); tree = TestRenderer.create(render()); });
    return { store, fake, update: async (next: TaskCard) => { current = next; await act(async () => tree!.update(render())); } };
  }
  it("shows a filled check for selected single choices and keeps multi choices square", async () => {
    await mount(card({ questions: [question, { ...question, header: "Multi", multiSelect: true }] }));
    expect(host("task-question-option-0-0").findAllByType("Icon" as never).map((node) => node.props.name)).toContain("Circle");
    await act(async () => host("task-question-option-0-0").props.onPress());
    const mark = host("task-question-option-0-0").findByProps({ testID: "question-selected-mark" });
    expect(mark.props.style.backgroundColor).toBe(theme.colors.accent);
    expect(mark.findByType("Icon" as never).props).toMatchObject({ name: "Check", color: theme.colors.accentForeground });
    await act(async () => host("task-question-tab-1").props.onPress());
    await act(async () => host("task-question-option-1-0").props.onPress());
    expect(host("task-question-option-1-0").findAllByType("Icon" as never).map((node) => node.props.name)).toContain("SquareCheck");
  });
  it("separates card navigation from question tabs and preserves each card draft", async () => {
    const first = card({ questions: [question, { ...question, header: "Second" }] });
    const second = { ...card(), id: "another", title: "Another task", permission: { ...card().permission!, requestId: "another-request" } };
    const cards = [first, second];
    const store = createQuestionDialogStore();
    const send = vi.fn(async () => {});
    await act(async () => { store.open(first); tree = TestRenderer.create(<TaskQuestionDialog store={store} cards={cards} cardById={(id) => cards.find((item) => item.id === id)} submit={send} theme={theme} language="zh" />); });
    expect(host("task-question-card-pager")).toBeDefined();
    expect(host("task-question-tab-1")).toBeDefined();
    await act(async () => host("task-question-option-0-0").props.onPress());
    await act(async () => host("task-question-next-card").props.onPress());
    expect(store.get()?.agentId).toBe("another");
    await act(async () => host("task-question-previous-card").props.onPress());
    expect(store.get()?.draft.selections[0]).toEqual([0]);
    await act(async () => host("task-question-tab-1").props.onPress());
    await act(async () => host("task-question-option-1-1").props.onPress());
    await act(async () => host("task-question-submit").props.onPress());
    expect(send).toHaveBeenCalledOnce();
    expect(store.get()?.agentId).toBe("another");
  });
  it("keeps the modal portal stable through consecutive text changes", async () => {
    const current = card({ questions: [{ ...question, options: [] }] });
    const { store, fake } = await mount(current);
    const renders = modalRenders.count;
    await act(async () => host("task-question-input-0").props.onChangeText("你"));
    expect(host("task-question-input-0").props.value).toBe("你");
    await act(async () => host("task-question-input-0").props.onChangeText("你好"));
    expect(host("task-question-input-0").props.value).toBe("你好");
    expect(modalRenders.count).toBe(renders);
    expect(store.get()?.draft.texts[0]).toBe("你好");
    await act(async () => host("task-question-submit").props.onPress());
    expect(fake.permissionResponses[0]?.response).toEqual({ behavior: "allow", updatedInput: { answers: { "Original header": "你好" } } });
  });
  it.each(["web", "ios", "android"])("highlights only the focused answer input on %s", async (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    await mount(card({ questions: [question, { ...question, header: "Second" }] }));
    const input = () => host("task-question-input-0");
    expect(input().props.style.at(-1).borderColor).toBe(theme.colors.border);
    const renders = modalRenders.count;
    await act(async () => input().props.onFocus());
    expect(input().props.style.at(-1).borderColor).toBe(theme.colors.accent);
    await act(async () => input().props.onChangeText("Hello"));
    expect(input().props.value).toBe("Hello");
    expect(input().props.style.at(-1).borderColor).toBe(theme.colors.accent);
    expect(modalRenders.count).toBe(renders);
    await act(async () => input().props.onBlur());
    expect(input().props.style.at(-1).borderColor).toBe(theme.colors.border);
    await act(async () => host("task-question-tab-1").props.onPress());
    expect(host("task-question-input-1").props.style.at(-1).borderColor).toBe(theme.colors.border);
  });
  it.each(["ios", "android"])("blurs the answer and clears its highlight when the keyboard hides on %s", async (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    keyboard.blur.mockClear();
    await mount();
    await act(async () => host("task-question-input-0").props.onFocus());
    await act(async () => host("task-question-input-0").props.onChangeText("Draft"));
    expect(keyboard.hide).toBeTypeOf("function");
    await act(async () => keyboard.hide!());
    expect(keyboard.blur).toHaveBeenCalledOnce();
    expect(keyboard.hide).toBeUndefined();
    expect(host("task-question-input-0").props.style.at(-1).borderColor).toBe(theme.colors.border);
    expect(host("task-question-input-0").props.value).toBe("Draft");
  });
  it.each(["ios", "android"])("reveals the focused answer after the keyboard and viewport change on %s", async (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    keyboard.scrollToEnd.mockClear();
    await mount(card({ questions: [question, { ...question, header: "Second" }] }));
    const scroller = () => tree!.root.findAllByType("ScrollView" as never).find((node) => node.props.keyboardShouldPersistTaps === "handled")!;
    await act(async () => scroller().props.onLayout());
    expect(keyboard.scrollToEnd).not.toHaveBeenCalled();
    await act(async () => host("task-question-input-0").props.onFocus());
    expect(keyboard.scrollToEnd).toHaveBeenCalledWith({ animated: true });
    keyboard.scrollToEnd.mockClear();
    await act(async () => scroller().props.onLayout());
    await act(async () => keyboard.show!());
    expect(keyboard.scrollToEnd).toHaveBeenCalledTimes(2);
    await act(async () => host("task-question-tab-1").props.onPress());
    keyboard.scrollToEnd.mockClear();
    await act(async () => scroller().props.onLayout());
    expect(keyboard.scrollToEnd).not.toHaveBeenCalled();
  });
  it.each(["web", "ios", "android"])("expands long previews without selecting the option on %s", async (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    const preview = "First\nSecond\nThird\nFourth\nFifth\nLast";
    const current = card({ questions: [{ ...question, options: [{ label: "Long", description: "", preview }, { label: "Short", description: "", preview: "Short preview" }] }] });
    const { store } = await mount(current);
    const stopPropagation = vi.fn();
    const previewText = () => tree!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-question-preview")[0]!;
    expect(tree!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-question-preview-toggle")).toHaveLength(1);
    expect(previewText().props.numberOfLines).toBe(4);
    await act(async () => host("task-question-preview-toggle").props.onPress({ stopPropagation }));
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(store.get()?.draft.selections).toEqual({});
    expect(previewText().props.numberOfLines).toBeUndefined();
    expect(JSON.stringify(tree!.toJSON())).toContain("Last");
    await act(async () => host("task-question-preview-toggle").props.onPress({ stopPropagation }));
    expect(previewText().props.numberOfLines).toBe(4);
    await act(async () => host("task-question-option-0-0").props.onPress());
    expect(store.get()?.draft.selections[0]).toEqual([0]);
  });
  it.each(["web", "ios", "android"])("renders full content and context with separately scrollable content and fixed actions on %s", async (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    await mount();
    const rendered = JSON.stringify(tree!.toJSON());
    for (const text of [question.question, question.options[0]!.description, question.options[0]!.preview, "Task context"]) expect(rendered).toContain(JSON.stringify(text).slice(1, -1));
    expect(host("task-question-submit").props.disabled).toBe(true);
    const modal = tree!.root.findByType("ModalContent" as never);
    expect(modal.props.scrollable).toBe(false);
    const scroll = tree!.root.findAllByType("ScrollView" as never).find((node) => node.props.keyboardShouldPersistTaps === "handled")!;
    expect(scroll.findAll((node) => node === host("task-question-actions"))).toHaveLength(0);
    expect(scroll.findAll((node) => node === host("task-question-field"))).toHaveLength(1);
  });
  it("places the answer count before the cancel and next buttons", async () => {
    await mount(card({ questions: [question, { ...question, header: "Second" }] }));
    const actions = host("task-question-actions");
    const children = actions.children.filter((child) => typeof child !== "string");
    expect(children.map((child) => child.props.testID)).toEqual(["task-question-answer-count", "task-question-close", "task-question-submit"]);
    expect(host("task-question-close").props.style).toMatchObject({ marginLeft: "auto", minWidth: 100 });
    expect(host("task-question-submit").props.style.flexGrow).toBeUndefined();
  });
  it.each(["web", "ios", "android"])("cycles through unanswered questions and submits only after all are answered on %s", async (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    const current = card({ questions: [question, { ...question, header: "Second", question: "Second question", options: [] }] });
    const { store, fake } = await mount(current);
    expect(JSON.stringify(tree!.toJSON())).toContain("下一个");
    await act(async () => host("task-question-submit").props.onPress());
    expect(host("task-question-input-1").props.value).toBe("");
    await act(async () => host("task-question-input-1").props.onChangeText("Second answer"));
    await act(async () => host("task-question-submit").props.onPress());
    expect(host("task-question-option-0-1")).toBeDefined();
    expect(store.get()?.draft.texts[1]).toBe("Second answer");
    await act(async () => host("task-question-option-0-1").props.onPress());
    expect(JSON.stringify(tree!.toJSON())).toContain("提交答案");
    await act(async () => host("task-question-submit").props.onPress());
    expect(fake.permissionResponses).toEqual([{ agentId: "asking", requestId: "original-request", response: { behavior: "allow", updatedInput: { answers: { "Original header": "Reject", Second: "Second answer" } } } }]);
  });
  it("shows the compact pager above the task card and keeps question drafts while paging", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    const current = card({ questions: [question, { ...question, header: "Second" }] });
    const store = createQuestionDialogStore();
    await act(async () => { store.open(current); tree = TestRenderer.create(<TaskQuestionDialog store={store} cardById={() => current} submit={async () => {}} theme={theme} language="zh" compact />); });
    expect(host("task-question-pager")).toBeDefined();
    await act(async () => host("task-question-input-0").props.onChangeText("First"));
    const next = tree!.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "下一个");
    await act(async () => next.props.onPress());
    expect(host("task-question-input-1")).toBeDefined();
    await act(async () => host("task-question-tab-0").props.onPress());
    expect(host("task-question-input-0").props.value).toBe("First");
  });
  it("opens the task from the context without showing the session ID", async () => {
    const current = card();
    const store = createQuestionDialogStore();
    const onOpen = vi.fn();
    await act(async () => { store.open(current); tree = TestRenderer.create(<TaskQuestionDialog store={store} cardById={() => current} submit={async () => {}} theme={theme} language="zh" onOpen={onOpen} />); });
    expect(JSON.stringify(tree!.toJSON())).not.toContain(current.id);
    await act(async () => host("task-question-open").props.onPress());
    expect(onOpen).toHaveBeenCalledWith(current.id);
  });
  it("closes after submitting an answer and prevents resubmission before snapshots catch up", async () => {
    const { store, fake } = await mount();
    await act(async () => host("task-question-option-0-1").props.onPress());
    await act(async () => host("task-question-submit").props.onPress());
    expect(fake.permissionResponses).toEqual([{ agentId: "asking", requestId: "original-request", response: { behavior: "allow", updatedInput: { answers: { "Original header": "Reject" } } } }]);
    expect(store.get()).toBeNull();
    expect(tree!.root.findAllByType("HostModal" as never)).toHaveLength(0);
    await act(async () => { store.open(card()); });
    expect(store.get()).toBeNull();
    expect(fake.permissionResponses).toHaveLength(1);
    const replacement = { ...card(), permission: { ...card().permission!, requestId: "new-request" } };
    await act(async () => { store.open(replacement); });
    expect(store.get()?.permission.requestId).toBe("new-request");
  });
  it("keeps custom drafts on close and remount, without dismissing the permission", async () => {
    const { store, fake } = await mount();
    await act(async () => host("task-question-input-0").props.onChangeText("Custom text"));
    await act(async () => host("task-question-close").props.onPress());
    expect(fake.permissionResponses).toEqual([]);
    await act(async () => { tree!.unmount(); });
    await mount(card(), store);
    expect(host("task-question-input-0").props.value).toBe("Custom text");
  });
  it("retains draft and error after failure, blocks double clicks, then permits retry", async () => {
    let reject!: (error: Error) => void;
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
    const { store } = await mount(card(), undefined, send);
    await act(async () => host("task-question-input-0").props.onChangeText("Retry me"));
    await act(async () => { host("task-question-submit").props.onPress(); host("task-question-submit").props.onPress(); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(host("task-question-input-0").props.editable).toBe(false);
    await act(async () => { reject(new Error("offline")); await Promise.resolve(); });
    expect(store.get()).not.toBeNull();
    expect(store.get()?.draft.texts[0]).toBe("Retry me");
    expect(JSON.stringify(tree!.toJSON())).toContain("offline");
    await act(async () => host("task-question-submit").props.onPress());
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("disables an old request and opens a replacement with a clean draft", async () => {
    const mounted = await mount();
    await act(async () => host("task-question-option-0-0").props.onPress());
    const replacement = { ...card(), permission: { ...card().permission!, requestId: "new-request" } };
    await mounted.update(replacement);
    expect(host("task-question-submit").props.disabled).toBe(true);
    await act(async () => { mounted.store.close(); mounted.store.open(replacement); });
    expect(mounted.store.get()?.draft).toEqual(EMPTY_QUESTION_DRAFT);
    expect(mounted.fake.permissionResponses).toEqual([]);
  });
  it("masks secret input, preserves optional empty answers, and scopes dialog stores to clients", async () => {
    const secret = card({ questions: [{ ...question, options: [], isSecret: true, allowEmpty: true } as typeof question] });
    await mount(secret);
    expect(host("task-question-input-0").props.secureTextEntry).toBe(true);
    expect(host("task-question-input-0").props.multiline).toBe(false);
    expect(host("task-question-submit").props.disabled).toBe(false);
    const first = createFakePaseo().paseo;
    expect(questionDialogStore(first)).toBe(questionDialogStore(first));
    expect(questionDialogStore(first)).not.toBe(questionDialogStore(createFakePaseo().paseo));
  });
});


describe("inline task questions", () => {
  it("shares drafts with the dialog and submits multi-select and text answers", async () => {
    const current = card({ questions: [{ ...question, multiSelect: true }, { ...question, header: "Second", options: [] }] });
    const store = createQuestionDialogStore();
    const send = vi.fn(async (_state: import("../../client/tasks/actions/question-dialog").QuestionDialogState) => {});
    const unsubscribe = store.subscribe(() => {});
    await act(async () => { tree = TestRenderer.create(<TaskInlineQuestions source={store} card={current} submit={send} theme={theme} language="zh" />); });
    expect(tree!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-question-context")).toHaveLength(0);
    await act(async () => host("task-question-option-0-0").props.onPress());
    await act(async () => host("task-question-option-0-1").props.onPress());
    await act(async () => host("task-question-input-0").props.onChangeText("Extra"));
    await act(async () => store.open(current));
    expect(store.get()?.draft.selections[0]).toEqual([0, 1]);
    expect(store.get()?.draft.texts[0]).toBe("Extra");
    await act(async () => host("task-question-tab-1").props.onPress());
    await act(async () => host("task-question-input-1").props.onChangeText("Hello"));
    expect(store.get()?.draft.texts[1]).toBe("Hello");
    await act(async () => host("task-question-submit").props.onPress());
    expect(questionAnswers(send.mock.calls[0]![0].permission.questions!, send.mock.calls[0]![0].draft)).toEqual({ "Original header": "Keep, unchanged, Reject, Extra", Second: "Hello" });
    expect(store.get()).toBeNull();
    unsubscribe();
  });
  it("blocks a second surface while an answer is being submitted", async () => {
    const current = card();
    const store = createQuestionDialogStore();
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => { finish = resolve; });
    await act(async () => { store.open(current); });
    const sending = store.submit(() => waiting);
    await act(async () => { tree = TestRenderer.create(<TaskInlineQuestions source={store} card={current} submit={async () => {}} theme={theme} language="zh" />); });
    expect(host("task-question-option-0-0").props.disabled).toBe(true);
    await act(async () => { finish(); await sending; });
    expect(tree!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-question-submit")).toHaveLength(0);
  });
  it("displays submission errors, resets drafts, and replaces a changed request", async () => {
    const first = card();
    const store = createQuestionDialogStore();
    const send = vi.fn(async () => { throw new Error("offline"); });
    const render = (current: TaskCard) => <TaskInlineQuestions source={store} card={current} submit={send} theme={theme} language="zh" />;
    await act(async () => { tree = TestRenderer.create(render(first)); });
    await act(async () => host("task-question-option-0-1").props.onPress());
    await act(async () => host("task-question-submit").props.onPress());
    expect(JSON.stringify(tree!.toJSON())).toContain("offline");
    await act(async () => host("task-question-close").props.onPress());
    expect(host("task-question-submit").props.disabled).toBe(true);
    const next = { ...first, permission: { ...first.permission!, requestId: "new-request" } };
    await act(async () => tree!.update(render(next)));
    expect(host("task-question-submit").props.disabled).toBe(true);
    expect(JSON.stringify(tree!.toJSON())).not.toContain("offline");
  });
});

describe("agent note above the question", () => {
  const plan = "需要处理两项：公共 DNS 的引导路径。\n\n建议按以下方案修改：\n- `clash.yaml`";
  const asked = (): TaskCard => ({ ...card(), provider: "codex",
    permission: { ...card().permission!, requestId: "permission-call_a1", name: "request_user_input_async", callId: "call_a1" } });
  const rows = [
    { timestamp: "2026-11-13T08:50:40Z", item: { type: "user_message", text: "优化下审查发现的问题" } },
    { timestamp: "2026-11-13T08:51:57Z", item: { type: "assistant_message", text: `\n\n---\n\n${plan}` } },
    { timestamp: "2026-11-13T08:51:59Z", item: { type: "tool_call", name: "request_user_input_async", callId: "call_a1" } },
    { timestamp: "2026-11-13T08:52:09Z", item: { type: "assistant_message", text: "等待方案确认。" } },
  ];
  function timeline(pages: unknown[]) {
    const refetch = vi.fn(async () => {
      const next = pages.shift();
      if (next instanceof Error) throw next;
      return next;
    });
    return { refetch, paseo: { agents: { ref: () => ({ timeline: { refetch } }) } } };
  }
  const shown = () => JSON.stringify(tree!.toJSON());
  async function open(paseo: unknown) {
    const store = createQuestionDialogStore();
    const current = asked();
    await act(async () => { store.open(current); tree = TestRenderer.create(<TaskQuestionDialog store={store} paseo={paseo as never} cardById={() => current} submit={vi.fn(async () => {})} theme={theme} language="zh" />); });
  }

  it("shows what the agent wrote before an async question, not the reply after it", async () => {
    const { refetch, paseo } = timeline([{ error: null, entries: rows }]);
    const store = createQuestionDialogStore();
    const current = asked();
    await act(async () => { store.open(current); tree = TestRenderer.create(<TaskQuestionDialog store={store} paseo={paseo as never} cardById={() => current} submit={vi.fn(async () => {})} theme={theme} language="zh" />); });
    await act(async () => { await vi.waitFor(() => expect(refetch).toHaveBeenCalledOnce()); });
    expect(host("task-question-note")).toBeDefined();
    expect(shown()).toContain("Agent 说明");
    expect(shown()).toContain("需要处理两项");
    expect(shown()).not.toContain("等待方案确认");
    expect(shown()).not.toContain("---");
    // The note sits between the task and the question.
    const order = ["task-question-context", "task-question-note", "task-question-field"].map((id) => shown().indexOf(`"testID":"${id}"`));
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("shows placeholder lines while reading, nothing when the agent wrote nothing, and a retry after a failure", async () => {
    let release!: (page: unknown) => void;
    const slow = timeline([]);
    slow.refetch.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }) as never);
    await open(slow.paseo);
    expect(host("task-question-note-loading")).toBeDefined();
    await act(async () => { release({ error: null, entries: rows.slice(0, 1).concat(rows.slice(2, 3)) }); });
    expect(tree!.root.findAll((node) => typeof node.type === "string" && String(node.props.testID ?? "").startsWith("task-question-note"))).toHaveLength(0);
    await act(async () => tree!.unmount());

    const failing = timeline([new Error("offline"), { error: null, entries: rows }]);
    await open(failing.paseo);
    expect(host("task-question-note-error")).toBeDefined();
    expect(shown()).toContain("没能读取 Agent 说明");
    await act(async () => { host("task-question-note-retry").props.onPress(); });
    expect(failing.refetch).toHaveBeenCalledTimes(2);
    expect(shown()).toContain("需要处理两项");
  });

  it("leaves the note out without a timeline, and in the details shows only the note it is given", async () => {
    await open(undefined);
    expect(tree!.root.findAll((node) => node.props.testID === "task-question-note")).toHaveLength(0);
    await act(async () => tree!.unmount());
    const source = createQuestionDialogStore();
    const current = asked();
    const read = { context: { state: "ready" as const, text: plan, timestamp: "2026-11-13T08:51:57Z" }, retry: vi.fn() };
    await act(async () => { tree = TestRenderer.create(<TaskInlineQuestions card={current} source={source} submit={vi.fn(async () => {})} theme={theme} language="zh" context={read} />); });
    expect(shown()).toContain("需要处理两项");
    await act(async () => tree!.update(<TaskInlineQuestions card={current} source={source} submit={vi.fn(async () => {})} theme={theme} language="zh" context={null} />));
    expect(tree!.root.findAll((node) => node.props.testID === "task-question-note")).toHaveLength(0);
  });
});
