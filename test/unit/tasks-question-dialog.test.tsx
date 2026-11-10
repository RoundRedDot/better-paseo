import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

vi.hoisted(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { TextInput: rn.TextInput, ScrollView: rn.ScrollView,
    Icon: (props: object) => React.createElement("Icon", props),
    Modal: Object.assign((props: { children?: React.ReactNode }) => React.createElement("HostModal", props, props.children),
      { Content: (props: { children?: React.ReactNode }) => React.createElement("ModalContent", props, props.children) }) };
});
import { TaskQuestionDialog } from "../../client/tasks/cards/question-dialog";
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
  it.each(["web", "ios", "android"])("renders full content and context with separately scrollable mobile actions on %s", async (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    await mount();
    const rendered = JSON.stringify(tree!.toJSON());
    for (const text of [question.question, question.options[0]!.description, question.options[0]!.preview, "Task context"]) expect(rendered).toContain(JSON.stringify(text).slice(1, -1));
    expect(host("task-question-submit").props.disabled).toBe(true);
    if (platform !== "web") {
      const scroll = tree!.root.findByType("ScrollView" as never);
      expect(scroll.findAll((node) => node === host("task-question-actions"))).toHaveLength(0);
      expect(scroll.props.keyboardShouldPersistTaps).toBe("handled");
    }
  });
  it("submits rejection as an allow answer through the SDK, and prevents resubmission before snapshots catch up", async () => {
    const { store, fake } = await mount();
    await act(async () => host("task-question-option-0-1").props.onPress());
    await act(async () => host("task-question-submit").props.onPress());
    expect(fake.permissionResponses).toEqual([{ agentId: "asking", requestId: "original-request", response: { behavior: "allow", updatedInput: { answers: { "Original header": "Reject" } } } }]);
    expect(store.get()?.submitted).toBe(true);
    await act(async () => { store.close(); store.open(card()); });
    expect(store.get()?.submitted).toBe(true);
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
