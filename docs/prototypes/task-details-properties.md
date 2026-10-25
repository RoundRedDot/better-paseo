# 详情卡 · 属性分组 · Claude Design 第 4 轮

- 来源：[Claude Design 项目「Better Paseo · 看板详情侧边栏」](https://claude.ai/design/p/05e42385-eecf-4499-a261-ccb42d0f595d)，新增画板 9 和画板 6 第 8 节，组件文件 `PropsGroup.dc.html`。
- 导出日期：2026-10-21。原稿：[task-details-properties.html](task-details-properties.html)，Standalone HTML 按字节原样保存（8.4 MB，包含全部 9 块画板）。
- 原稿 SHA-256：`989e512e0e908224e8b0ed3a14aa287fc86a43777eec984e316cd3724f9a90fb`
- 提示词：[task-details-properties-prompt.md](task-details-properties-prompt.md)；附件：[task-details-properties-refs/narrow-stacked-now.png](task-details-properties-refs/narrow-stacked-now.png)。
- 画板截图：[task-details-properties-boards/](task-details-properties-boards/)。

## 规格（摘自画板 6 第 8 节）

- 行结构：`[标签 72（只在宽档）] · 图标 16 · 值 · 尾标 16`，列间距 10。图标、标签、尾标都和值的第一行对齐（行高 20）。去掉原来 76 宽的固定标签列，五个字段各用一个图标区分。
- 值：主行 14/20，项目名 500。分支用 ui-monospace 13/20，GitHub 分支蓝。路径用 ui-monospace 13/20，foreground 色。PR 是 muted tabular 编号，间距 6，再接标题。
- 说明行：12/18 muted，在主行下方 2。多段之间用「·」分隔，间距 6，可以换行。
  - 项目：workspace 名（和项目名相同时省略）· 类型
  - 分支：↑n ↓n · 未提交改动
  - 父任务已归档：已归档 · 无法跳转
- 徽标：取消描边小药丸，所有状态都写进说明行。只有「未提交改动」用 warning 色，前面加 6 的圆点。
- 行尺寸：padding 8（触屏 12 / 8）。单行高 36 / 44，圆角 8，行间距 2，卡片 padding 4。
- 分组标题：高 32 / 44。「属性」13/600 + 14 的 chevron，右侧不放摘要：分支已在分支行里。
- 最大行数：项目名 2、workspace 名 2、分支 3、路径 2、PR 标题 2、父任务 3。超出时末尾加 …。完整值可以从桌面的 tooltip、复制的内容或跳转后的详情里拿到。
- 断行：分支在 / 和 - 之后断，路径在 / 之后断；都没有时可以在任意字符处断（overflow-wrap: anywhere）。中文按字断，加 text-wrap: pretty。
- 长路径：超过 2 行时，保留 `~/` + 第一段 + 尽量多的末段，中间折成 `…/`（按「值区宽 / 7.8」估算字符数）。复制的始终是完整路径。
- 标签列：卡宽 ≥ 448 时出现，< 440 时消失（回差 8）。所以内嵌 520 和平板 sheet 580 有标签列；300 / 314 / 340 / 360 / 380 / 390 没有。没有标签列时，标签作为 tooltip 和无障碍名称。
- 桌面交互：可操作的行悬停时整行加 hov 底，右上角（top 6、right 6）浮出 24 的方形按钮，按钮左侧 12 宽渐隐到 hov 底色。
  - 分支、工作目录：复制。
  - PR：复制链接、打开。
  - 单击整行执行主操作。复制后按钮位置换成「✓ 已复制」（ok 色，1.5s）。
- 触屏交互：尾标常驻（复制 / ↗ / chevron），点按整行执行，按下时加 sel 底。复制后说明行换成「✓ 已复制…」（ok 色，1.5s）并加轻触觉反馈。PR 长按 450ms 弹出菜单（复制链接、在浏览器打开）。
- 父任务：chevron 常驻，悬停时主行加下划线（border 色，offset 3）。点击后看板滚到父任务（240ms），侧边栏显示它，顶部出现返回行。已归档时主行 muted，没有 chevron，点了没反应。
- 不可操作的行：项目行只展示，没有悬停底，也没有按钮；非 git 目录的分支行同样不可操作。

## 核对结果

- 导出后用 Chrome 无头模式渲染核对过：9 块画板都能出图，6 个宽度、8 个边界情况、悬停 / 已复制 / 按下 / 折叠状态、深色版本都在。
- 小问题：桌面「已复制 · 工作目录」那一格里，「✓ 已复制」盖住了路径第一行的末尾（`worktrees/a` 被截断）。移植时提示应该占用尾标位置，并让值区让出相应宽度，不要叠在文字上。
- Claude Design 自己说明的两处没做完：组件里只实现了 440 一个切换点，规格里的 448 回差没有做进组件；触屏点按 PR 行在原型里没有反应。这两处都以规格为准。
