# Tasks 泳道看板 · Claude Design 原型

- 来源：[Claude Design 项目「Paseo Tasks 泳道看板」](https://claude.ai/design/p/5f122bf6-c1af-43e3-9f28-eecb8d286e18?file=Paseo+Tasks+%E6%B3%B3%E9%81%93%E7%9C%8B%E6%9D%BF.dc.html)
- 导出日期：2026-10-20
- 原稿：`docs/prototypes/tasks-board.html`，由 Claude Design 的 Export HTML → Standalone HTML 导出，按字节原样保存，可离线打开，看板可交互。这是第四版（首轮 + 三轮追加修改）。文件 3.5 MB（内嵌 1.7 MB 的 SVG 和多套字体），**只留在本地、不进 Git**（见 `.gitignore`）；新 clone 里没有它，从上面的 Claude Design 项目再导出一份即可（重新导出的文件字节不一定与上面的 SHA-256 相同）。
- 提示词：[tasks-board-prompt.md](tasks-board-prompt.md)，含首轮提示和三轮追加消息。首轮附两张图：`paseo-sidebar.png`（Paseo 侧边栏现状，红框标出新入口的位置）、`cloudflare-style.png`（cloudflare.com 定价区截图，作为细线风格参考）。
- 原稿 SHA-256：`52c90de62e0dc9796b78229707c04e2ad1cd4e84ad911dbdffd66b2496257336`
- 需求方案：[../tasks-board.md](../tasks-board.md)

用户的要求：以 Linear 的泳道看板为结构模板，视觉用 Cloudflare 新版官网的简洁线条风格；每张卡片要有显式的「跳转到原 workspace 对应 tab」按钮；模型和思考等级不能被截断；移动端用 tab 切换泳道，一次只显示一个泳道。

## 画板

| 画板 | 内容 |
| --- | --- |
| 01 桌面端完整看板 | 1440 × 900，浅色（默认筛选）与深色（已开启「隐藏子任务」）；左侧 Paseo 侧边栏带新增的 Tasks 入口和计数；J/K/H/L 键盘导航 |
| 02 卡片状态全集 | 卡片宽 284，浅色与深色，16 个状态：待输入（工具权限、提问）、运行中（普通、父任务展开、悬停、确认停止）、子任务、待查看（未读、失败）、已完成、键盘焦点、详情浮层、跳转按钮悬停与焦点、子任务行悬停 |
| 03 侧边栏入口状态 | 无计数、有运行中、有待输入、选中 |
| 04 窄屏 · 手机 | 390 × 844，浅色与深色各 7 屏：待输入（默认）、运行中、已完成、过滤 sheet、长按详情 sheet、空泳道、切换动效分解 |
| 05 空状态与加载 | 全部为空、某列为空、已完成「加载更多」、首次加载骨架 |
| 06 移植规格 | 6.1 颜色 token 与派生公式、6.2 元素规格、6.3 归列与状态切换规则、6.4 动效参数、6.5 Lucide 图标、6.6 移动端 |

## 原稿规格摘要

完整规格见原稿画板 06，这里只摘移植时最常查的部分。`mix(A, B, p) = A × p + B × (1 − p)`，sRGB 逐通道线性混合，在 React Native 侧预计算成不透明色。

### 派生颜色

宿主 token 之外只新增下面这些派生色，全部由宿主 token 推出。

| token | 公式 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- | --- |
| dotGrid | mix(foregroundMuted, surface0, 22%) | `#dedee1` | `#353539` | 点阵 1px，间距 16 |
| borderStrong | mix(foregroundMuted, border, 35%) | `#b8b8be` | `#54545b` | 卡片悬停描边、未勾选框 |
| accentSoft | mix(accent, surface0, 12%) | `#e7eefb` | `#222836` | 开关开启底、允许按钮悬停 |
| accentRing | mix(accent, surface0, 28%) | `#c8d7f6` | `#2f3d5b` | 焦点外环 3px |
| highlight | mix(accent, surface0, 8%) | `#eff3fd` | `#1f232d` | 父子跳转高亮底（1s） |
| dangerSoft | mix(statusDanger, surface0, 10%) | `#fbecec` | `#2e1f21` | 确认停止按钮底 |
| popoverShadow | surface0 亮度 ≥ .5 ? 黑 12% / 6% : 黑 50% / 35% | | | `0 8 24 −6` + `0 2 6 −2`，仅菜单、详情、Toast |
| scrim | surface0 亮度 ≥ .5 ? `rgba(0,0,0,.32)` : `rgba(0,0,0,.56)` | | | 手机底部 sheet 遮罩 |

`statusSuccess` 保留未用。scrim 是原稿新增的固定色，宿主主题里没有对应 token。

### 卡片

| 元素 | 规格 |
| --- | --- |
| 卡片 | 宽 100%，内边距 9 10 10，行间 4，圆角 6，1px border；悬停 borderStrong + 底 surface1；焦点 accent + 3px accentRing |
| 行 1（高 22） | 标题 13/500/18 单行截断；右侧「停止」（运行中悬停）与跳转按钮，间距 6 |
| 行 2（高 16） | 品牌位图 16 × 16 + 模型（foreground）·思考等级（foregroundMuted），12/400/16；思考等级永不截断，极窄时只截断模型名 |
| 行 3（高 18） | 左 workspace chip（最大宽 60%），右计时或完成于，12/400 tabular-nums；待输入计时用 warning + clock 图标 12 |
| 跳转按钮 | ArrowUpRight，24 × 24（触屏 32 × 32），图标 14，圆角 4（触屏 16）；默认透明描边，悬停 1px border + 底 surface2 + 图标 foreground；tooltip「在 workspace 中打开 [Enter]」悬停 400ms 出现 |
| 子任务行跳转 | 22 × 22（触屏 32，行高 36），行悬停时出现，触屏常驻 |
| 截断顺序 | 先 workspace chip，再模型名 |

### 列与看板

- 列宽为看板宽的 1/4（桌面 298），列间 1px 竖线，列底为 surface0 叠点阵。
- 列头高 40，底部 1px 虚线（4/3），图标按列状态色；列名 13/500，数量 12/400 tabular-nums。
- 竖线与列头底线的交点处放 6 × 6 角标（1px border、填 surface0、圆角 1），即 Cloudflare 风格的网格交点。
- 列内容区内边距 10，卡片间距 8。

### 交互规则

- 停止：悬停显示（触屏常显）；点一次进入「确认停止」danger 态，3 秒内再点才执行，超时、移出或 Esc 复原。父任务下拉可选「仅停止此任务 / 连同子任务一起停止」。停止后卡片进入待查看，原因行「已手动停止」。
- 允许 / 拒绝：处理第一条请求；还有剩余就换下一条并重置等待计时，没有剩余则卡片回到运行中。
- 打开卡片：显式入口是标题行跳转按钮、子任务行按钮、详情浮层「打开 tab ↗」、提问卡「去回答 ↗」；点卡片主体或聚焦后 Enter 也打开。待查看的未读卡打开后标为已读，移入已完成；失败卡保留到重新运行。
- 详情浮层：悬停 450ms 显示在卡片右侧 8px；移出卡片 150ms 后关闭，期间移入浮层则保持。
- 键盘：J/K 或 ↑↓ 列内移动，H/L 或 ←→ 跨列（跳过空列），Enter 打开，Esc 取消确认，/ 聚焦搜索。

### 动效

所有过渡不超过 200ms，无回弹；循环动画只有运行中列图标（1600ms 旋转）和骨架（1200ms 呼吸），系统开启「减弱动态效果」时关闭。悬停、按钮、焦点、确认停止类过渡都是 120ms ease-out；菜单与详情出现 160ms `cubic-bezier(.2,0,0,1)`，消失 100ms ease-in。

### 移动端（宽 390）

- 顶栏高 52，「Tasks」17/600 + 总数；搜索、过滤按钮点击区 44 × 44，过滤角标显示生效条件数。
- 泳道 tab 栏高 44，四等分，吸顶；底部 1px border 通栏，选中项 2px accent 下划线（宽 25% − 24，单一元素横移）。未选 15/500 foregroundMuted，选中 15/600 foreground；待输入计数大于 0 时始终 warning。
- 一次只显示一个泳道，卡片宽 366，间距 8，底部留 34 的安全区。
- 左右滑动：水平位移 ≥ 56 且 |dx| ≥ 1.5 |dy|，首尾不循环；触发后 350ms 内吞掉卡片点击。长按 450ms 打开详情 sheet，移动超过 8px 取消。
- 切换动效 200ms `cubic-bezier(.2,0,0,1)`：下划线横移；旧内容淡出并位移 24（120ms），新内容反向进入（200ms）。
- 默认泳道：有待输入停在待输入，否则停在运行中；会话内记住上次选择。
- 底部 sheet：最大高 80%，顶圆角 16，把手 36 × 4；进入 200ms，退出 160ms；下滑或点遮罩关闭。主按钮高 44、全宽、圆角 22，只在 sheet 底部用实心按钮。

## 迭代记录

1. 首轮：六块画板，看板可交互。
2. 追加一：每张卡片标题行右侧加常驻跳转按钮；子任务行、详情浮层加同样的入口；计时移出标题行。
3. 追加二：计时移到第二行后模型名被截断，改为三行结构，模型与思考等级独占第二行。
4. 追加三：移动端改为细线 tab 切换泳道，一次一个泳道，加滑动手势、过滤 sheet、长按详情 sheet 和移动端规格。

## 移植时要注意

- 原稿用 HTML/CSS 演示，落地是 React Native 插件：`position: sticky`、`touch-action`、`box-shadow` 等要换成 RN 的对应写法，阴影在 Android 上要单独处理。
- 提示词里给的 warning 浅深参考色 `#c98a12` / `#e0a53a` 是出稿用的估计值，实现时一律读宿主的 `statusWarning`。
- scrim 是固定色，不随宿主主题变化。
- 原稿里的品牌标识是位图占位，实现时复用 `server/mark-bitmaps.ts`。
