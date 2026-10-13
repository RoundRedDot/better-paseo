# 表格复制菜单与选区栏 · Claude Design 原型

- 来源：[Claude Design 项目「Better Paseo 表格复制菜单」](https://claude.ai/design/p/4cd29556-0fd5-4b6a-902a-9935ee2d69ca?file=Table+Copy+Menu.dc.html)
- 导出日期：2026-10-13
- 原稿：[table-copy-menu.html](table-copy-menu.html)，由 Claude Design 的 Export HTML → Standalone HTML 导出，按字节原样保存，可离线打开。这是第二版；第一版在项目里另存为 `Table Copy Menu v1.dc.html`，未导出。
- 提示词：[table-copy-menu-prompt.md](table-copy-menu-prompt.md)，含首轮提示和第二轮追加消息。首轮附现状截图 `current-menu-light.png`、`current-menu-dark.png`（收起、展开、悬停图片、已复制四态）；第二轮附用户的选区栏截图和标了红框的预览弹窗工具栏截图。
- 原稿 SHA-256：`373970c309ddd477fb2faf3d3d0502b30cdf3052fe6ba71a416210ddfab9ac07`

用户的要求：以 Cloudflare 的设计语言为基础优化表格左上角的复制菜单；hover 时加阴影，外框不要描成深色；收起的圆形放大，展开后留白更从容；图标风格与 hover 预览弹窗的工具栏一致；选区栏（复制 / 添加到对话）一起改成同一家族。原稿含四块画板：状态全集（现状与新设计对照，浅色、深色）、真实上下文、可交互的动效演示、移植规格。

## 原稿规格

`mix(a, b, p)` 指在 sRGB 中逐通道计算 a×(1−p) + b×p。E = `cubic-bezier(0.33, 1, 0.68, 1)`，IN = `cubic-bezier(0.32, 0, 0.67, 0)`。

### 两个控件共用

| token | 值 | 复制菜单 | 选区栏 |
| --- | --- | --- | --- |
| 外框高 | 30（1 描边 + 2 内缩 + 24 项 + 2 + 1） | 收起圆直径 / 展开胶囊高 | 外框高 |
| 项高 | 24，与预览工具栏按钮相同 | 项 | 按钮 |
| 内缩 | 2 | 项距外框内缘 2 | padding 2，按钮间距 2 |
| 圆角 | 项圆角 = 外框圆角 − 3 | 15 → 12 | 7 → 4 |
| 外框 | 底 `surface0`，1px `border`，任何状态不换色 | 同 | 同，不再叠 `surface2` |
| 投影 | 浅 `0 1px 2px rgba(17,17,20,0.06), 0 4px 12px -2px rgba(17,17,20,0.12)`；深 `0 1px 2px rgba(0,0,0,0.40), 0 6px 16px -4px rgba(0,0,0,0.55)`；按 `surface0` 明度选组 | 展开时淡入 | 常驻 |
| 悬停底 | `surface2`（浅 `#ececee` / 深 `#27272a`） | 当前项 | 当前按钮 |
| 按下底 | `mix(surface2, foregroundMuted, 14%)`（`#dadadd` / `#37373b`） | 按下项 | 按下按钮 |
| 焦点环 | `0 0 0 2px accent`，填满项与外框之间的 2px | `:focus-visible` | `:focus-visible` |
| 图标 | Lucide 14、描边 2、`foregroundMuted`，所有状态不变色 | Copy / Image | Copy / MessageSquarePlus |
| 完成 | Lucide Check、`success`，与原图标同位交叉淡入 120ms | 1200ms | 700ms 后整条收起 |
| 文字 | 12/16、字重 500、`foreground`，图标与文字间距 6 | 两项相同 | 两项相同，「添加到对话」不再用 `accent` |

### 复制菜单

- 位置：控件左上角对齐表格容器左上角，表格向右、向下各让出 15，收起圆心正好落在表格外框角上。底垫与外框同形同尺寸，跟随宽度动画，遮住被压住的表格边框。
- 收起：30×30 圆。展开：宽 W = 94 + T₁ + T₂（两段文字宽，参考约 250），`overflow: hidden`。
- 项 A：高 24，左右 margin 2，padding 左 5 右 10，图标中心 x=15，与收起圆心重合。分隔线 1×12、`border` 色，左右 margin 4。项 B：padding 左 8 右 12。
- 状态：收起时文字、分隔线、项 B 为 `opacity 0, translateX(-4px)`；指针在外框内或 `:focus-within` 时展开；复制成功不收起；触屏始终是 30 圆，点按复制 Markdown。

| 属性 | 进入 | 延迟 | 缓动 | 退出 | 缓动 |
| --- | --- | --- | --- | --- | --- |
| 外框宽度 30→W | 180ms | 0 | E | 160ms | E |
| 投影 0→1 | 180ms | 0 | E | 120ms | E |
| 文字 / 分隔线 / 项 B 透明度与位移 −4→0 | 140ms | 40ms | E | 80ms | IN |
| 项底色 / 焦点环 | 100ms | 0 | E | 100ms | E |

按目标状态切换 transition 声明，浏览器从当前插值继续，可中途打断。原稿建议若担心 `box-shadow` 过渡的性能，用同形的绝对定位投影层只过渡 opacity。减少动态时所有时长与延迟为 0。

### 选区栏

- 位置：选区首行顶边上方 8，左缘对齐首行起点，左右夹紧 8；放不下时放到末行底边下方 8。
- 外框高 30，padding 2，按钮间距 2，圆角 7；按钮高 24，padding 左 8 右 10，圆角 4。
- 出现：`mouseup` 后选区非空才出现，拖动中不出现；opacity 0→1 与 translateY ±4→0，140ms E。选区改变时直接移到新位置，不做位移动画。
- 按下：`mousedown` 时 `preventDefault`，保住选区。
- 完成后：被点按钮的图标换成对勾，停 700ms，期间忽略再次点击；然后 opacity 1→0、translateY 0→±2，100ms IN，结束后卸载。从点击到消失共 800ms。选区清空、滚动或按 Esc 也收起。

## 实现

共用规格在 `client/ui/tokens/float.ts`（`FLOAT`、`FLOAT_EASE`、`floatShadow`、`floatHover`、`floatPressed`）。表格复制菜单在 `client/components/markdown/render/table-copy-menu.tsx`，选区栏在 `client/components/selection-actions.ts`，触屏表格按钮是 `ToolbarCopyButton` 的 `outlined` 样式。

与原稿的差异：

- 用户要求两个控件都用圆角矩形：复制菜单收起时是 30×30、圆角 7 的方块，展开后保持圆角 7，项圆角 4，不用胶囊和圆形。
- 键盘焦点环沿用宿主的 `:focus-visible` 描边（`focus-ring.ts`），复制菜单不另画 2px accent 环；选区栏在 shadow root 里，按原稿画 `0 0 0 2px accent`。
- 选区栏仍以选区首个矩形为中心水平放置，未改成原稿的左对齐。
- 触屏表格按钮是 30×30 圆角 7 的方块，复制成功的对勾沿用工具栏按钮的正文色。
- 手机行号选区的复制菜单（`client/ui/line-selection.tsx`）跟着换成同一家族的外框、圆角、图标色和按下底色，高度仍为 40 的触屏尺寸。
- 用户反馈原稿投影太淡，加深后又出现大范围灰晕和色带、描边被晕开。投影收成一层贴身阴影加一层小半径浅阴影：浅 `0 1px 2px rgba(17,17,20,0.08), 0 4px 10px -2px rgba(17,17,20,0.1)`；深 `0 1px 2px rgba(0,0,0,0.4), 0 4px 12px -2px rgba(0,0,0,0.45)`。
- 两项之间不再画分隔线，间距与选区栏相同（外框内缩 2、项间距 2）；项 B 右内边距为 10，与选区栏按钮一致。
- 复制菜单叠在表格横向滚动容器之外：放在滚动容器里时，展开后的左侧描边和投影被滚动容器裁掉。表格横向滚动后，菜单停在可见区域的左上角。
- 手机浏览器（没有 hover，但能写图片）里，长按复制按钮展开同样的菜单，动画与桌面一致；轻点仍直接复制 Markdown。展开后任何滚动（聊天列表或表格自身的横向滚动）或点到菜单之外都会收起。原生 App 没有 DOM，无法生成图片，保持单个复制按钮。
