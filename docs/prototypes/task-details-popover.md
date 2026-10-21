# 任务详情弹窗 · Claude Design 原型

- 来源：[Claude Design 项目「Better Paseo · 任务详情弹窗」](https://claude.ai/design/p/639b28c1-2ea0-4e78-85ad-85e12058032e)
- 导出日期：2026-10-21
- 原稿：[task-details-popover.html](task-details-popover.html)，Share → Project HTML → Standalone HTML 导出，按字节原样保存，可离线打开。
- 提示词：[task-details-popover-prompt.md](task-details-popover-prompt.md)。附图：用户的现状截图 `current-details-popover.png`、看板排序菜单 `reference-sort-menu.png`、Agent 筛选菜单 `reference-agent-filter-menu.png`。
- 原稿 SHA-256：`ddbe47ffe459d958a10c38c28870bbe619cc1c6740b66c98fa97699fb0764fd8`

用户的要求：重新设计 Tasks 看板卡片的悬停详情弹窗（`client/tasks/cards/task-details.tsx`），风格对齐看板的菜单，排版重做。原稿五块画板：现状与新设计对照（浅、深，与排序菜单同屏）、状态变体浅色、状态变体深色、手机长按 sheet、移植规格。

## 结构

自上而下三段加固定动作区，段间满宽 hairline：

1. 头部（固定）：状态行（8px 状态点 + 状态文字 12/600 状态色 + 时长 12 muted；已开 tab 时右侧「Desktop」）；标题 14/600 lh 20 完整换行；元信息一行纯文字「Opus 5.5 · High · Bypass」13 muted，各带 14px 图标，不画 chip；失败时 circle-x + 错误原文；待输入时 surface1 提示块（shield-alert + 「请求运行命令」12/600 warning + 命令 13 等宽）。
2. 中部（可滚动）：
   - 位置组：项目 › workspace 合成一行（字母头像 14，右侧 worktree / local hint）；父任务（可点）；分支 + 右侧 ↑↓ 与「● 4 处改动」（warning）或「已同步」/「非 git 目录」；工作目录单行中间截断（可点复制）；PR（可点外链）；标签（色点 + 名字，不画胶囊）。「文件夹」行删除。
   - 子任务组：组标题「子任务」+「1 / 3 完成」，每行状态点 + 标题 + 状态 + chevron，最多 5 行。
   - 用量组：创建、更新（运行中或与创建相差 < 1 分钟时隐藏）、输入 token（缓存 hint）、输出 token、费用、上下文；值右对齐 tabular；上下文下画 4px 条。
3. 动作区（固定）：「打开 tab ↗」（已开着时为「切换到 tab」，待输入时为「打开 tab 处理」），运行中加「停止运行」（danger 字色）。

## 尺寸（括号内为手机 sheet）

| 区块 | 规格 |
| --- | --- |
| 面板 | 宽 320（sheet 390）；padding 6 0；圆角 12（sheet 顶 16）；1px border（sheet 无）；max-height 70vh；菜单阴影 |
| 头部 | padding 6 14 10（6 18 10）；状态点与下方行图标同列 |
| 可点行 | 高 32（44）；inset 6（8）；padding 0 8（10）；圆角 6；16 图标（18）→ 文字 8（12）；14/400（15）；右侧 hint 13 muted |
| 信息行 | 高 28（36）；同 inset/padding；无 hover；标签 13 muted，值 13 右对齐 |
| 组标题 | 高 28（32）；12/500 muted |
| 分隔线 | border 色，满宽，上下各 6 |
| 上下文条 | 高 4、圆角 2，左缘对齐文字起点；轨 surface2；< 75% muted，75–89% warning，≥ 90% danger |

颜色只用宿主 token：行 hover = `mix(surface0, foreground, 5.5% | 8%)`（浅 `#f2f2f3` / 深 `#212123`），状态色沿用看板 status 带，已完成用 foregroundMuted。

## 交互

- 可点：分支（复制）、工作目录（复制完整路径，hover 400ms 显示完整路径）、PR、父任务与子任务（滚到对应卡片并打开其弹窗）、打开 tab、停止。其余行无 hover。
- 路径截断：`$HOME` → `~`；放不下时「…/」+ 尾部整段，末段永远保留，末段本身放不下再在其内部中间截断；按实测宽度计算，复制图标槽始终占位。
- 高度：头部与动作区固定，中部滚动；最短约 330，最长约 610。

## 移植前要核对的数据缺口

- 「Desktop」这类开着 tab 的客户端名：`TaskCard.openTab` 只有布尔值。
- 「4 处改动」的数量：`location.git.dirty` 只有布尔值，只能显示「有改动」。
- 复制分支和路径需要剪贴板，`client/ui/use-copy.ts` 可复用。

## 实现与原稿的差异

按用户 2026-10-21 的反馈，实现（`client/tasks/cards/task-details.tsx`）与原稿有以下不同：

- 去掉底部「打开 tab」那一行，改为头部右上角的 ↗ 圆形按钮（28，sheet 36），悬停时填充菜单的 hover 色。没有「停止运行」行，停止仍在卡片上。
- 分支在干净且与 origin 持平时不显示任何提示；有改动只显示「未提交」，没有改动数量（数据里只有布尔值）。
- 保留「文件夹」行。分支、文件夹、工作目录、PR 都可点击复制（PR 复制链接），toast 显示「已复制分支名 / 文件夹名 / 路径 / URL」；项目 › workspace 行只展示。
- 分隔线为 1 个物理像素（`devicePixel()`）。
- 父任务与子任务只展示，不跳转。不显示开着 tab 的客户端名。
- 弹窗最高 420（`POPOVER_MAX_HEIGHT`），超出时头部固定、下方滚动。
