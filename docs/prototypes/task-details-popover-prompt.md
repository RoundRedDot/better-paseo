请为 Paseo 插件 Better Paseo 的「Tasks 泳道看板」重新设计「任务卡片悬停详情弹窗」，产出一份可直接查看、可精确移植的静态 HTML/CSS 设计稿。项目名称设为「Better Paseo · 任务详情弹窗」。

背景：Tasks 看板把每个 coding agent 画成一张卡片，按状态分泳道（待输入 / 运行中 / 待查看 / 已完成）。桌面端鼠标在卡片上停留后，卡片旁边弹出一个详情弹窗；手机上长按卡片，从底部弹出一个 sheet 显示同样的内容。卡片本身已经展示了：项目 › workspace › 父任务路径、标题、模型 chip、思考强度 chip、分支 chip、文件夹 chip、标签 chip、耗时 / 更新时间、上下文环。弹窗应该补充卡片上没有、或被截断的信息，而不是把卡片再抄一遍。

附件：
- current-details-popover.png：用户截图，红框是现在的详情弹窗（右侧泳道卡片上方浮起的那个面板）。
- reference-sort-menu.png：看板的排序菜单（含二级子菜单）。
- reference-agent-filter-menu.png：看板的 Agent 筛选下拉菜单。
用户要求：弹窗的风格对齐这两个菜单，排版重新设计一版。

现在弹窗的结构（从上到下）：
1. 标题，13px/500，最多两行。
2. 模型 / 思考强度 / 权限模式：图标 + 文字，flex-wrap 排成一行，但用了 84px 固定宽度的 label 样式，结果「Opus 5.5」「High」「Bypass」排成了奇怪的两列错位。
3. 分隔线。
4. 位置区：两列 key/value 表，key 列 84px 宽、muted。行：项目、Workspace（值 + 小字「worktree / local / 主 checkout」）、分支（值 + 小字「↑1587 ↓0 origin · 无未提交改动」，或「非 git 目录」muted）、文件夹、工作目录（完整路径，~ 缩写）、PR（#123 标题，可选）、标签（彩色点 + 名字的胶囊，可选）。
5. 分隔线。
6. 统计区：创建时间（12 小时前）、Input token（1.2M（缓存 980k））、Output token（45k）、费用（$3.42）、上下文（813k / 1.00M）。usage 只对部分 provider 有，经常只有创建时间和上下文两行。
7. 分隔线。
8. 右下角一个「打开 tab ↗」文字按钮，accent 色。

我看到的问题（请全部解决，也欢迎你指出更多）：
- 风格和菜单不像一家人：菜单是 14px 正文、16px 线性图标打头、32px 行高、6px 圆角的 hover 填充；弹窗是 12px 小字、无图标、key/value 表格，像一张表单。
- 标题区的模型 / 思考 / 模式错位，和卡片上的 chip 重复。
- 项目、Workspace、分支、文件夹四行和卡片顶部的面包屑、chip 高度重复；工作目录长路径在 84px key 列后面折成四行，是整个弹窗最高的一块，却最不重要。
- 「↑1587 ↓0 origin · 无未提交改动」这种 git 状态挤在小字里，没有层级。
- 三条分隔线把一个小弹窗切成四段，「打开 tab」单独占一整段。
- 统计数字没有对齐，没有可视化（上下文占用其实卡片上有个环）。

现有菜单的规格（新弹窗请沿用同一套 chrome）：
- 面板：背景 surface0；1px hairline border（theme border）；圆角 12；阴影 浅色 `0 4px 24px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.04)`，深色 `0 4px 24px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.3)`；上下内边距 6。
- 行：高 32，左右 inset 6（行的 hover 底色离面板边 6），行内左右 padding 8，行圆角 6；16px lucide 线性图标（stroke 1.5，foregroundMuted）+ 间距 8 + 14px 正文（foreground）；右侧可以有 13px muted 的 hint（数字、当前值）、14px accent 勾、12px chevron。
- hover 底色：mix(surface0, foreground, 浅色 5.5% / 深色 8%)。
- 分组：组之间一条 hairline，上下各留 6；组标题行高 28，12px/500 muted，可带一个小图标或字母头像。
- 字体：系统无衬线；数字用 tabular-nums；路径、哈希可用等宽。字号下限 11px，不新增字体。

可用数据（全部可选，除标题和 provider）：标题；provider（Claude / Codex / Cursor / Grok…，有品牌标志）、模型名、思考强度、权限模式（Bypass / Plan / Ask / Auto-edit，各有图标）；状态（运行中 / 待输入 / 待查看 / 已完成 / 失败，失败时有一句错误文本，或「已手动停止」）；项目名（字母头像色块）、workspace 名与类型（worktree / local checkout）、分支、git ahead/behind、是否有未提交改动、非 git 目录、cwd 完整路径、PR 编号与标题；标签（名字 + 颜色）；创建时间、最近更新时间、本轮运行耗时；input / cached / output tokens、费用 USD；上下文 used / max tokens；父任务标题；子任务数量与各自状态；是否已在某个客户端开着 tab；可「打开 tab」、可「停止」（运行中才有）。

设计目标：
1. 视觉上就是看板菜单家族的一员：同样的面板 chrome、同样的「16px 图标 + 14px 文字」行语法、同样的 hover 行、同样的分组 hairline 和组标题。
2. 重新设计信息排版：头部给出身份（标题 + 状态 + provider/模型/思考/模式的一行紧凑表达，不和卡片 chip 重复样式）；中部是位置（项目 › workspace、分支 + git 状态、目录），长路径单行中间截断（…/ideashell-android/.worktrees/align-206-integration），悬停或点击可复制完整路径；底部是用量（时间、token、费用、上下文），数字右对齐 tabular，上下文给一条细进度条或复用环，接近满时用 warning / danger。
3. 可操作的行要像菜单项：例如「打开 tab」「复制工作目录」「复制分支名」「在 PR 中查看」做成 32px 菜单行（图标 + 文字 + 右侧快捷键或 ↗），而不是孤零零的右下角文字链接；纯信息行不要有 hover。请你决定哪些行可点、可点的给出 hover 态。
4. 删掉冗余：卡片上已经完整显示的信息只在弹窗里保留最有用的那一份；被截断的（标题、面包屑、路径）在弹窗里完整显示。请说明每个字段放哪里、为什么。
5. 状态变体都要成立：运行中（有停止）、待输入（权限请求，醒目但克制）、失败（错误文本）、已完成、无 git、无 usage 只剩两行统计、有 PR、有标签、有子任务、子任务卡（有父任务）。最长和最短的弹窗高度差别要合理，最短不显空。
6. 宽度建议 300–320px（现在 288），最高不超过视口 70%，超出时中部滚动、头部和动作行固定。
7. 手机长按 sheet 版本：同一套结构，字号放大一档（正文 15、行高 44 的可点行），无面板边框（sheet 自带），宽 390。

实现约束：最终在 React Native（含 Web）里实现，宿主主题任意，插件只拿到这些颜色 token：surface0、surface1、surface2、border、foreground、foregroundMuted、accent、success、warning、danger。新颜色写成 token 推导公式（例如 mix(surface0, foreground, 5.5%)），并给出浅/深两套参考值。浅色：surface0 #ffffff、surface1 #f6f6f7、surface2 #ededef、border #e2e2e6、foreground #18181b、foregroundMuted #62626b、accent #2563eb、success #1f8a5b、warning #a36a00、danger #d92d20。深色：surface0 #0f0f11、surface1 #17171a、surface2 #1f1f23、border #2a2a30、foreground #f2f3f5、foregroundMuted #a3a6ad、accent #7aa2f7、success #4cb782、warning #e0a84a、danger #f2555a。状态色（看板的状态点）：浅色 running #268ae0 / warning #b37824 / success #299f51 / danger #f12e2f，深色 #5caaf6 / #db932e / #35c264 / #f7796d。除阴影外不要装饰（不要渐变、不要彩色整块底），图标只用 lucide（stroke 1.5）。

数据样例（来自截图，可照抄或虚构同类数据，中英混排）：标题「2.0.6 真机验收批次 1：fav/sidebar/export/voice」；Claude · Opus 5.5 · High · Bypass；运行中 4h 42m；项目 ideashell-android；workspace「Android 对齐 2.0.6：integration」(worktree)；分支 feat/align-ios-2.0.6，↑1587 ↓0，无未提交改动；目录 ~/workspace/rrd/ideashell-system/ideashell-android/.worktrees/align-206-integration；创建 12 小时前；上下文 813k / 1.00M。再配一个 Codex · GPT-6-Luna · max 的失败卡、一个 Claude Sonnet 5.5 的待输入卡（权限请求：Run: pnpm test --filter board）、一个非 git 目录的已完成卡（有 input 1.2M / cached 980k / output 45k / $3.42）。

交付：
- 画板 1：现状 vs 新设计并排对比（用截图里那张卡片的数据），浅色和深色各一组，弹窗浮在一小块看板背景（泳道 + 卡片）上，和排序菜单同屏摆放，证明是同一家族。
- 画板 2：新设计的全部状态变体（运行中、待输入、失败、已完成无 git 有 usage、有 PR + 标签、子任务卡 + 有子任务），浅色，每个都含 hover 一行的样子。
- 画板 3：深色下的同一组变体。
- 画板 4：手机长按 sheet（390 宽）浅色和深色各一个。
- 画板 5：移植规格表：每个区块的尺寸 / 间距 / 字号字重 / 图标、字段取舍表（字段 → 放哪里 / 何时隐藏 / 文案 中英）、颜色公式与浅深取值、可点行列表及其动作、上下文进度条阈值、路径中间截断规则、最大高度与滚动规则。
请直接给出完成度高的最终稿，不要提问，不要做页面外壳或工具栏。完成后在聊天里简短列出关键规格。
