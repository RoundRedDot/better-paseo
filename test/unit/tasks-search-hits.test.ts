import { describe, expect, it } from "vitest";
import {
  orderedSearchHits,
  searchBranch,
  searchBreadcrumb,
  searchLabels,
  searchRanges,
  searchSnippet,
  taskSearchHits,
  type SearchVisibility,
} from "../../client/tasks/data/search-hits";
import { sampleCards } from "../../client/tasks/sample-cards";
import type { TaskCard } from "../../client/tasks/model";

const base: TaskCard = {
  ...sampleCards()[0]!,
  title: "修复引导页宽度",
  provider: "codex",
  providerLabel: "Codex",
  model: "gpt-sol",
  modelLabel: "GPT Sol",
  labels: [],
  children: [],
  location: {
    ...sampleCards()[0]!.location,
    projectName: "ideashell-system",
    workspaceName: "duo",
    workspaceTitle: "duo",
    branch: "main",
    folder: "App",
    folderName: "App",
    cwd: "~/workspace/rrd/duo/ios/App",
    pullRequest: null,
  },
};
const visible: SearchVisibility = {
  title: true,
  project: true,
  workspace: true,
  branch: true,
  folder: true,
  path: false,
  modelPill: true,
  model: true,
  pullRequest: true,
  labels: 1,
  labelLimit: 2,
};
const hits = (card = base, query = "sche", prompt?: string, view = visible) => taskSearchHits(card, query, view, prompt);
const hidden = (card: TaskCard, query = "sche", prompt?: string, view = visible) =>
  hits(card, query, prompt, view).filter((hit) => !hit.visible);

describe("search hit design examples", () => {
  it("highlights literal substrings of the visible title with original case", () => {
    const result = hits({ ...base, title: "Schedule 发版工单 RRD-11930 创建并通知邹东旭" });
    expect(result).toMatchObject([{ field: "title", visible: true, ranges: [{ start: 0, end: 4 }] }]);
    expect(hidden({ ...base, title: "Schedule 发版工单" })).toEqual([]);
  });
  it("reveals the matching breadcrumb and shortens the other segment", () => {
    const workspace = "iPhone Duo Linear 工单并行修复 schedule 引导页";
    const shown = searchBreadcrumb("ideashell-system", workspace, "sche", 32);
    expect(shown).toContain("ideashel… › …");
    expect(shown).toContain("schedule 引导页");
    expect(hits({ ...base, location: { ...base.location, workspaceName: workspace, workspaceTitle: workspace } })).toMatchObject([
      { field: "workspace", visible: true },
    ]);
  });
  it("keeps branch prefix, six preceding characters, and the entire matching tail", () => {
    const branch = "fix/rrd-11847-duo-guide-bubble-scheduled-task";
    const shown = searchBranch(branch, "sche", 28);
    expect(shown).toMatch(/^fix\//);
    expect(shown).toContain("…");
    expect(shown).toContain(branch.slice(branch.indexOf("sche") - 6));
    expect(hits({ ...base, location: { ...base.location, branch } })).toMatchObject([{ field: "branch", visible: true }]);
  });
  it("summarizes a path and folds middle directories while preserving its match", () => {
    const card = { ...base, location: { ...base.location, cwd: "~/workspace/rrd/duo-r12-sched/ios/App" } };
    expect(hidden(card)).toMatchObject([{ field: "path", mono: true }]);
    expect(hidden(card)[0]!.snippet).toContain("/…/");
    expect(hidden(card)[0]!.snippet).toContain("duo-r12-sched/ios/App");
  });
  it("promotes a folded label without changing the visible count or +N", () => {
    const labels = ["发版", "iOS", "scheduler", "QA"].map((name) => ({ name, color: null }));
    expect(searchLabels(labels, 2, "sche").map((label) => label.name)).toEqual(["发版", "scheduler"]);
    expect(labels.length - searchLabels(labels, 2, "sche").length).toBe(2);
    expect(hidden({ ...base, labels })).toEqual([]);
    const many = [...labels, { name: "scheduling", color: null }, { name: "schedules", color: null }];
    expect(hidden({ ...base, labels: many })).toMatchObject([{ field: "label", text: "schedules" }]);
  });
  it("summarizes the full first message, independently of the title", () => {
    expect(hidden(base, "sche", "看一下 DuoSchedule 推荐气泡在 iPhone mini 上的文字裁切，顺便补一下返回的回归测试……")).toMatchObject([
      { field: "prompt", visible: false, snippet: "看一下 DuoSchedule 推荐气泡在 iPhone mini 上的文字裁切，顺便补一下返回的回归测试……" },
    ]);
  });
  it("merges matching PR title and URL into one hidden field despite the visible number", () => {
    const card = {
      ...base,
      location: {
        ...base.location,
        pullRequest: { number: 482, title: "Refactor scheduler queue", url: "https://example.com/scheduler/482" },
      },
    };
    expect(hidden(card)).toHaveLength(1);
    expect(hidden(card)[0]).toMatchObject({ field: "pr", snippet: "Refactor scheduler queue" });
    expect(hits(card, "#482")).toMatchObject([{ field: "pr", visible: true }]);
  });
  it("shows a raw model ID hidden behind a different model display name", () => {
    expect(hidden({ ...base, model: "gpt-6.1-sol-schema-0915", modelLabel: "GPT-6.1-Sol Preview" })).toMatchObject([
      { field: "model", mono: true },
    ]);
  });
  it("retains the first UUID group plus the matching and next groups", () => {
    expect(hidden({ ...base, id: "a91c03e7-5b2d-4f2a-9c61-0e8d7b3f12aa" }, "4f2a")).toMatchObject([
      { field: "id", snippet: "a91c03e7…4f2a-9c61…" },
    ]);
  });
  it("orders simultaneous matches, keeping visible fields out of the summary", () => {
    const card = {
      ...base,
      title: "修复 DuoSchedule",
      location: { ...base.location, branch: "fix/schedule", cwd: "~/workspace/duo-r12-sched/ios/App" },
    };
    const all = hits(card, "SCHE", "排查 Schedule 推送");
    expect(all.filter((hit) => !hit.visible).map((hit) => hit.field)).toEqual(["prompt", "path"]);
    expect(orderedSearchHits(all).map((hit) => hit.field)).toEqual(["title", "branch", "prompt", "path"]);
  });
});

describe("search model boundaries", () => {
  it("does not mutate cards or labels and adds no hits for whitespace-only search", () => {
    const before = JSON.stringify(base);
    expect(hits(base, "  ")).toEqual([]);
    hits(base);
    expect(JSON.stringify(base)).toBe(before);
    expect(searchRanges("Fix search", "fix.*search")).toEqual([]);
    expect(searchRanges("hello world", "world hello")).toEqual([{ start: 0, end: 5 }, { start: 6, end: 11 }]);
    expect(searchRanges("hello", "he hello he")).toEqual([{ start: 0, end: 5 }]);
    expect(searchRanges("SCHE sche", " sche ")).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
    ]);
  });
  it("tracks original UTF-16 positions after Unicode lowercasing", () => {
    expect(searchRanges("İ Schedule 😀", "sche")).toEqual([{ start: 2, end: 6 }]);
    expect(searchRanges("😀A", "😀a")).toEqual([{ start: 0, end: 3 }]);
  });
  it("aligns natural-language snippets within context budgets and collapses whitespace", () => {
    const text = "This is a very long sentence with Schedule\n\nnext steps";
    const snippet = searchSnippet(text, "sche", "prompt");
    expect(snippet).toBe("…sentence with Schedule next steps");
    expect(searchSnippet("一二三四五六七八九十甲乙丙丁Schedule 后续", "sche", "prompt")).toBe("…七八九十甲乙丙丁Schedule 后续");
    const preview = searchSnippet("a".repeat(40) + "Schedule" + "z".repeat(200), "sche", "prompt", true);
    expect(preview).toHaveLength(106);
  });
  it.each([
    ["path", "~/workspace/rrd/duo-r12-sched/ios/App", "sche"],
    ["id", "a91c03e7-5b2d-4f2a-9c61-0e8d7b3f12aa", "4f2a"],
    ["branch", "fix/rrd-11847-duo-guide-bubble-scheduled-task", "sche"],
    ["model", "gpt-6.1-sol-schema-0915", "sche"],
  ] as const)("keeps a short %s preview complete", (field, value, query) => {
    expect(searchSnippet(value, query, field, true)).toBe(value);
  });
  it.each(["path", "id", "branch", "model"] as const)("cuts long %s previews only at machine-value separators", (field) => {
    const value = `${"prefix-".repeat(8)}workspacelong/schedule/${"suffix-".repeat(16)}finalword`;
    const preview = searchSnippet(value, "sche", field, true);
    const content = preview.replace(/^…|…$/g, "");
    const start = value.indexOf(content);
    const end = start + content.length;
    expect(preview.startsWith("…")).toBe(true);
    expect(preview.endsWith("…")).toBe(true);
    expect(start).toBeGreaterThan(0);
    expect(value[start - 1]).toMatch(/[\/-]/);
    expect(value[end]).toMatch(/[\/-]/);
    expect(content).toContain("schedule");
    const token = `${"prefix".repeat(20)}schedule${"suffix".repeat(20)}`;
    expect(searchSnippet(token, "sche", field, true)).toBe(token);
  });
  it.each([false, true])("skips punctuation and whitespace at a natural-language cut (preview: %s)", (preview) => {
    for (const punctuation of ["，", "。", "；", "：", ",", " ", "\n\t"]) {
      const prefix = "前文".repeat(20);
      // Put the cut exactly at the punctuation for each context budget.
      const context = preview ? 20 : 8;
      const message = prefix + punctuation + "然".repeat(context - punctuation.length) + "Schedule 推送";
      const snippet = searchSnippet(message, "sche", "prompt", preview);
      expect(snippet).toMatch(/^…然/);
      expect(snippet).toContain("Schedule");
    }
  });
  it("starts the supplied first-message excerpt with words rather than a comma", () => {
    const message = "先跑一遍 UI 测试，然后顺便看下 Schedule 推送在冷启动时为什么没触发，日志在 /tmp/push.log";
    expect(searchSnippet(message, "sche", "prompt")).toMatch(/^…然后顺便看下 Schedule/);
  });

  it("summarizes hidden title matches without changing title truncation", () => {
    expect(hidden({ ...base, title: "Schedule" }, "sche", undefined, { ...visible, title: false })).toMatchObject([
      { field: "title", visible: false },
    ]);
  });
  it("deduplicates the full path when the hit is already in the visible folder", () => {
    const card = { ...base, location: { ...base.location, folder: "scheduler", folderName: "scheduler", cwd: "~/workspace/scheduler" } };
    expect(hidden(card)).toEqual([]);
    expect(hidden(card, "sche", undefined, { ...visible, folder: false }).map((hit) => hit.field)).toEqual(["folder", "path"]);
  });
  it("covers all hidden metadata in the specified priority order", () => {
    const card = {
      ...base,
      id: "sche-id",
      title: "Schedule",
      provider: "sche",
      model: "sche-model",
      labels: [{ name: "sche-tag", color: null }],
      location: {
        ...base.location,
        branch: "sche-branch",
        folder: "sche-folder",
        folderName: "sche-folder",
        projectName: "sche-project",
        workspaceName: "sche-workspace",
        workspaceTitle: "sche-workspace",
        cwd: "/sche-path",
        pullRequest: { number: 1, title: "sche-pr", url: "sche-url" },
      },
    };
    const view = Object.fromEntries(Object.keys(visible).map((key) => [key, false])) as unknown as SearchVisibility;
    expect(hidden(card, "sche", "sche-prompt", view).map((hit) => hit.field)).toEqual([
      "title",
      "prompt",
      "pr",
      "label",
      "branch",
      "folder",
      "project",
      "workspace",
      "path",
      "model",
      "id",
    ]);
  });
});
