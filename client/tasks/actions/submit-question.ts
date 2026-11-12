import type { PaseoApi } from "@getpaseo/client";
import type { TaskIssue } from "../../../shared/task-availability";
import type { TasksLanguage } from "../i18n";
import type { TaskCard } from "../model";
import { taskIssueText } from "../cards/availability-tag";
import { questionAnswers, questionDraftSupported, questionFormSupported } from "../question-form";
import { questionAnswerPending, respondToPermission } from "./index";
import { questionRequestKey, type QuestionDialogState } from "./question-dialog";

export async function submitQuestion(paseo: PaseoApi, state: QuestionDialogState, language: TasksLanguage, cardById: (id: string) => TaskCard | undefined, check: (id: string) => Promise<TaskIssue | undefined>) {
  const issue = await check(state.agentId);
  if (issue) throw new Error(taskIssueText(issue, language));
  const updated = cardById(state.agentId);
  if (!updated || questionRequestKey(updated) !== state.key) {
    throw new Error(language === "zh" ? "问题已变更或关闭，请重新查看。" : "The question changed or closed. Please view it again.");
  }
  const questions = state.permission.questions;
  if (!questionFormSupported(questions, updated.provider, state.permission.name)) throw new Error("This question cannot be represented by the host form protocol.");
  if (!questionDraftSupported(questions!, state.draft, updated.provider, state.permission.name)) throw new Error(language === "zh" ? "Codex 同步多选的自定义回答不能包含逗号：宿主会将其拆分。" : "Custom answers to Codex synchronous multi-select questions cannot contain commas: the host splits them.");
  const answers = questionAnswers(questions!, state.draft);
  if (!answers) throw new Error(language === "zh" ? "请完成所有问题。" : "Please answer every question.");
  if (questionAnswerPending(paseo, state.agentId, state.permission.requestId)) throw new Error(language === "zh" ? "此问题正在提交回答。" : "An answer to this question is already being submitted.");
  await respondToPermission(paseo, state.agentId, { key: "form", label: "", variant: "secondary", kind: "respond", action: { behavior: "allow", id: null }, answers }, state.permission.requestId);
}
