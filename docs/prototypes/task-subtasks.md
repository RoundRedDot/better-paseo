# 详情子任务区块重设计

Claude Design 项目「Better Paseo · 详情子任务」（claude.ai/design/p/bae02a4c-80f4-47d9-a7db-624949affc00），2026-10-22 一轮生成。

- Prompt：`task-subtasks-prompt.md`；附件：`task-subtasks-refs/current-details-touch.png`。
- 原稿：`task-subtasks/`（Project archive zip 解出，zip SHA-256 `173159959d752fb5382edfffd0b898ee69d3a073179ed64708b30110e68bf405`）。`Subtasks Redesign.dc.html` 会 fetch 同目录的 `Subtasks.dc.html`，必须用 HTTP 打开（`python3 -m http.server`），file:// 下卡片只显示灰块。
- 画板截图：`task-subtasks-boards/`（board1 对比、board2 状态浅 / 深、board3 交互与宽度、board4 规格表）。

## 行结构

- 行首 16×18（触屏 16×20）的状态列，图标 14 居中，高度等于标题行高，所以和标题首行对齐。provider logo 不再放在行首。
- 状态列和文字之间 gap 10，文字起点距卡片边 38。
- 第一行：标题 13/400/18（触屏 14/400/20），最多 2 行。前缀（`[Handoff]`、`RRD-1234`）显示为 muted，去掉方括号，右距 4。右边是时间列，12 tabular nowrap，和标题 gap 12，固定在首行尾。
- 标题和 meta 之间 gap 2。meta 12/400/16（触屏 13/18），muted，用「 · 」分隔，可以折行。
- 行容器：margin 0 4，padding 7 8（触屏 10 8），radius 8，行间无 gap。单行标题时行高 50（触屏 60）。
- 桌面悬停：行底 rowHover，时间后出现 20×20 的 ↗（打开 tab）。按下：rowPress。键盘焦点：2px inset accent 环。

## 各状态的表达

| 状态 | 行首图标 | meta 首项 | 行尾 |
| --- | --- | --- | --- |
| 待输入 | circle · warning | 「等待输入」warning | 结束时间「2 分钟前」 |
| 失败 | circle-x · danger | 「失败」danger | 结束时间 |
| 运行中 | circle + 实心点 · accent | 「14:41 开始」 | 计时「14m 14s」，foreground，每秒更新 |
| 待查看 | 8 圆点 · success | 「待查看」muted | 结束时间 |
| 已完成 | circle-check · muted | — | 结束时间 |

- meta 后面依次是上一轮耗时、上下文百分比。
- 上下文 ≥75% 显示 warning 色，≥90% 显示 danger 色。
- 计时不到 1 小时写「m ss」，1 小时以上写「h mm」。

## 排序、摘要和取舍

- 排序：待输入 → 失败 → 运行中 → 待查看 → 已完成。运行中的组内按已运行时长降序，其余组保持创建顺序。不加组标题，状态变化时行不做移动动画。
- 混合状态时，已完成行的标题改为 muted；全部完成时不弱化。
- 超过 10 个时，排序后截取前 10 个。折叠行写「显示全部 14 个  其余 4 个已完成」，展开后变成「收起」。
- 标题行摘要：
  - 混合：「1 待输入 · 1 失败 · 2 运行中 · 4/8 完成」，数字用状态色，0 项省略；
  - 全部完成：「4 个全部完成」加 success circle-check；
  - 只有一个子任务：只写状态词；
  - 去掉进度环。
- 模型、思考强度、权限：以子任务里的众数为基准（只有一个子任务时以父任务为基准）。
  - 和基准相同就不写；
  - 不同时，在 meta 首项写 logo + 模型 · 强度；
  - 众数和父任务不同时，区块末尾写一次脚注「均为 / 其余为 Opus 5.5 · High · Bypass」，12/16，pt 6。
- 窄宽（≤340）：
  - 运行中不写开始时间；
  - 模型只写名称；
  - 上下文低于 75% 不写；
  - 摘要省掉运行中的计数。
- 触屏：没有悬停和 ↗，整行至少 44 高、可点，长按打开 tab。平板左栏按触屏尺寸，宽度规则看实际列宽。
- 末行到 hairline 留 8（触屏 10）。hairline 左右缩进 12，下一个区块的标题行自带 32/44 的高度。

## 颜色

rowHover：浅色 surface1，深色 mix(cardBg, foreground, 6%)。rowPress：浅色 surface2，深色 mix(cardBg, foreground, 10%)。其余颜色直接用 token，见原稿 board4。

## Claude Design 列出的待确认项

1. 行首用状态图标取代 provider logo。logo 只在子任务的模型和基准不同时，出现在 meta 里。
2. 「失败」排在「运行中」前面。
3. 已完成的行也画 muted circle-check，现状是不画。
4. 待输入的行不放「去处理」按钮，点整行跳到子任务详情。
5. 上下文只显示百分比，绝对值留在子任务自己的详情里。
6. `[Handoff]` 去掉方括号。
7. 原稿里的 provider logo 是示意图形，移植时用宿主现有的品牌 logo。
