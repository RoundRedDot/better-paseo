# 卡片详情 v2 · Claude Design 原型

- 来源：[Claude Design 项目「Better Paseo 卡片详情 v2」](https://claude.ai/design/p/c430676e-55f3-4bc8-84e1-90e783815851)，主文件 `卡片详情 v2.dc.html`，组件 `DetailCard.dc.html`。
- 导出日期：2026-10-21（第 1 版；中途催过一次「请继续，完成全部画板」）。
- 原稿：[task-details-rich.html](task-details-rich.html)，Share → Project HTML → Standalone HTML，按字节原样保存（447 KB）。SHA-256：`0290ae131bdd1a2a00c727a20833c801e0f6e438275dc8ce0cb3885a55e0ba9f`。
- 画板截图：`task-details-rich-boards/`（board1–6，2800 宽无头 Chrome 渲染；不进 git，可从原稿重新渲染）。
- 提示词：[task-details-rich-prompt.md](task-details-rich-prompt.md)；附件 `task-details-rich-refs/`（不进 git）。
- 上一版：已上线的单卡分区（`c086d01`）。

用户的要求：以 Linear 风格为基础重排详情侧边栏，加入丰富的图表、图标、标签，优化桌面和移动端的 UI 与交互。

## 画板

1. 桌面 380 浅色：现状对比，加运行中、待输入、失败、已完成四种状态，各自注明首屏先看什么。
2. 深色四状态，加 520 宽两列布局和数据大量缺失的退化卡。
3. 桌面交互：图表 hover tooltip、行 hover 次级动作、复制反馈（「已复制」）、区块折叠、键盘焦点环。
4. 手机 390：sheet 半屏 / 全屏、吸底动作栏（运行中、待输入）、左右滑切换、点按图表显示数值。
5. 平板：iPad 1180 横屏内嵌，820 竖屏浮动 400 面板。
6. 移植规格：图表的字段与 View 拼法、各状态区块顺序与折叠、行语法、颜色公式、动画、需新增数据。

## 结构

- 头部：状态行（状态点 + 状态 + 计时）、标题 15/600、两行胶囊（模型 / 思考 / 模式；标签 + 版本号），胶囊高 22、圆角 999、hairline。动作按钮「打开 tab」（已开着时为「切换到 tab」）+ 运行中「停止」。
- 首屏主块按状态切换，不可折叠：
  - 运行中：本轮计时（每秒刷新，下方「上一轮」）+ 上下文环，两格并排。
  - 待输入：权限请求块（类型图标、命令等宽、允许 / 拒绝、等待时长、「还有 N 个请求」）。
  - 失败：错误原文块（danger 6% 底、28% 边），截断 3 行，可复制、可展开。
  - 待查看 / 已完成：结果摘要三格（上一轮耗时 / 费用 / Token）。
- 其余是可折叠区块（标题 12/500 + chevron + 右侧摘要），不用页签：首屏主块已经决定了先看什么，页签会把图表藏进第二屏。

| 状态 | 头部之后的顺序 | 默认折叠 |
| --- | --- | --- |
| 运行中 | 计时 + 上下文环 → 子任务 → 属性 → 用量 → 活动 | 无 |
| 待输入 | 权限请求 → 属性 → 子任务 → 用量 → 活动 | 用量 |
| 失败 / 手动停止 | 错误 → 属性 → 活动 → 用量 → 子任务 | 用量 |
| 待查看 / 已完成 | 摘要三格 → 子任务 → 属性 → 用量 → 活动 | 无 |

折叠状态按区块 key 全局记忆（`bp.detail.collapsed`），优先于状态默认值。空的子任务区块隐藏；用量和活动始终保留，用来显示退化文案。

## 图表（全部用 View 拼，无 SVG）

| 图表 | 字段 | 拼法与尺寸 | 规则 |
| --- | --- | --- | --- |
| 上下文环 | context | 44×44，线宽 4；两个 22×44 裁剪半框，右半 rotate(min(θ,180)+45°)，左半 rotate(max(θ,180)+45°)，平头单色弧；数值 22/600 | < 75% muted，75–89% warning，≥ 90% danger；缺失画 2px 虚线圆 +「未上报」 |
| 上下文条（非运行态，用量区） | context | 高 6，填充宽 = 百分比；75% 和 90% 处各一个 2px 卡片色切口 | 同上 |
| Token 构成 | cached / input / output | 一行，gap 2，每段 flexGrow = token 数、flexBasis 0、minWidth 3、圆角 2，高 8；下方 8×8 图例 | 顺序缓存 → 新输入 → 输出；缺的段与图例都不画 |
| 子任务分段条 | children[].status | 高 6，gap 2，flexGrow = 各状态计数；下方 6px 点图例 | 已完成 → 待查看 → 运行中 → 待输入 → 失败；> 5 行显示前 5 +「其余 N 个」 |
| 时间线（活动区） | createdAt、lastUserMessageAt、turnStartedAt / attentionAt、updatedAt / now | 高 66；2px 轨道 + 段，8px 空心点；段上方时长，点下方名称 / 相对时间 | 段宽 max(占比, 20%) 后归一化；进行中 / 等待 / 失败时末段用状态色 |
| Git 徽标 | ahead、behind、dirty | 胶囊高 20、padding 0 7、hairline；「↑a ↓b」；未提交 = 6px warning 点 | 都为 0 不显示；一行最多一个彩色元素 |
| 摘要三格 | lastTurnMs、cost、token 合计 | 外框 border 底、圆角 10，三格 gap 1 透出分隔线，格底 sunk；值 18/600 | 缺失「—」+「未上报」 |

## 行语法

| | 桌面 | 触屏 |
| --- | --- | --- |
| 属性行高 | 32 | 44 |
| 文字距卡边 | 12 | 16 |
| 图标 | lucide 16 / 1.5 | 18 |
| 标签列 / 值 | 64，13 | 76，15 |
| 区块标题 | 32，12/500 | 44，13/500 |
| 按钮 | 32，圆角 8 | 卡内 44；吸底 48，圆角 12，底部让出 34 |
| 子任务行 | 30 | 44 |

内容宽 ≥ 456（侧栏约 480 以上）时属性两列，PR、目录、父任务整行；手机始终单列。

## 颜色（mix 为 sRGB 混合；浅 / 深）

- sunk 内嵌块：mix(foreground 2.5%, card) `#f9f9f9` / `#242428`
- 行 hover：mix(foreground 5%, card) `#f3f3f3` / `#2a2a2e`
- 图表轨道：mix(foreground 9%, card) `#eaeaea` / `#323236`
- 时间线已过段：mix(foreground 16%, card) `#dadada` / `#414145`
- Token 缓存 mix(accent 32%, card) `#b9cdf9` / `#3c4967`；新输入 accent；输出 mix(foreground 45%, card) `#979798` / `#7e7e81`
- 错误块底 mix(danger 6%, card) `#fdf2f2` / `#2c2226`，边 mix(danger 28%, card) `#f4c4c1` / `#5a2e32`
- 项目头像底 mix(accent 14%, card)，字 accent
- tooltip：底 foreground、字 card、次文字 mix(card 65%, foreground)

## 交互与动画

- 桌面：tooltip hover 延迟 120ms，出现 120ms（translateY 2→0），消失 80ms；图表非选中段 opacity 0.4；复制后对勾停 1200ms；区块折叠高度 + opacity 180ms cubic-bezier(.2,0,0,1)；条宽和环 240ms ease-out；运行中状态点 opacity 1↔0.45、1.6s 循环（减弱动效时关闭）。
- 手机 sheet：spring damping 30 / stiffness 300；吸附半屏 470、全屏为屏高 − 54；下拉超过 25% 或速度 > 1200 关闭。
- 左右滑切换：跟手，|dx| > 64 或 |vx| > 600 切换，220ms；首尾橡皮筋 0.3；拖过 32 显示「松手切换」；切换后 haptic。
- 触屏没有 hover：点按图表显示数值，点别处或 3 秒后收起。
- 手机吸底栏：运行中「打开 tab」主按钮 +「停止」；待输入时「允许」为主按钮、「拒绝」次级，「打开 tab」收成 48 方形图标按钮。

## 需新增数据（主稿未用）

- PR 状态（open / draft / merged / closed）与 CI 结果。
- 每轮耗时历史 `turns[]`：活动区画最近 N 轮的柱条。
- 每轮费用。

## 移植前要核对

- 原稿已知问题：
  - 板 2 的 520 两列卡，项目值被截成「b.」。
  - 已完成卡时间线的「创建」「最后消息」标签重叠。
  - 板 5 的 iPad 820 竖屏画框底部被裁。
  - 规格表把 `flexGrow` 导出成了「sc-camel-flex-grow」。
  - 阈值色只写了 warning 一档。
- provider 标识在原稿里是色块占位，移植用现有 `BrandMark`。
- 桌面待输入卡没有「打开 tab」按钮，与现状不同（现在是「打开 tab 处理」），需要决定。
- 上下文环：现有 `client/ui/progress-ring.tsx` 已经是两个半环的拼法，直接复用，不要另写。
- 手机 sheet 的吸附与左右滑要在宿主手势体系里验证（见 memory：宿主手势会抢插件的拖动）。

## 移植状态（2026-10-21）

已移植：头部胶囊与标签、四种首屏主块、可折叠区块（全局记忆）、全部图表与 tooltip、属性行 hover 动作与复制反馈、≥ 456 两列、手机吸底动作栏。代码在 `client/tasks/cards/detail-{cards,charts,model,collapse}.ts(x)`。

与原稿不同：

- 桌面待输入卡保留「打开 tab 处理」按钮。
- 时间线：一分钟内相邻的时刻只留后一个；段宽下限按像素算（首尾段 84、中间段 68），修掉了原稿已完成卡的标签重叠。
- Codex 的 `inputTokens` 含缓存，Token 构成里先减去缓存再画；其他 provider 原样。

未做：

- sheet 两档吸附：详情 sheet 是宿主的 `Modal`，吸附点由宿主决定。
- 左右滑切换：沿用 sheet 顶部的上一张 / 下一张按钮，手势留待在宿主手势体系里验证。
- 区块折叠的高度动画、图表数值变化的过渡、运行中状态点的呼吸动画。
