# Paseo Tasks 看板需求方案

- 日期：2026-10-20（方案），2026-10-23 按代码校对
- 状态：已在 Better Paseo 中实现（`client/tasks/`、`server/tasks/`、`shared/tasks-*.ts`），本文按 2026-10-23 的代码校对。已实现的写成现状，没做的标为「未做」，和最初方案不同的地方按代码写。
- 在线版：[Claude Docs · Paseo Tasks 看板需求方案](https://claude.ai/code/artifact/37c3ac68-e95b-43b9-a638-9ea3c59cfcfb)（2026-10-20 的方案原稿，含线框与数据流示意图，评论在那里；没有随本次校对更新）
- 交互原型：[Claude Design 项目「Paseo Tasks 泳道看板」](https://claude.ai/design/p/5f122bf6-c1af-43e3-9f28-eecb8d286e18)，说明与规格摘要见 [prototypes/tasks-board.md](prototypes/tasks-board.md)；卡片详情的后续原型见 [prototypes/task-details-rich.md](prototypes/task-details-rich.md)、[prototypes/task-details-properties.md](prototypes/task-details-properties.md)、[prototypes/task-board-pad.md](prototypes/task-board-pad.md)。导出的离线 HTML 只留在本地，不进 Git。界面细节以代码为准，原型只作设计记录。

Better Paseo 的设置里开启看板后，侧边栏顶部（新建工作区、历史、搜索、计划那一组）多一个「Tasks」入口（中文界面为「任务」），用 Linear 式泳道看板把所有 agent 按状态铺开。用户不用逐个 workspace 翻找，就能知道哪些在跑、哪些在等自己、哪些已经跑完。

## 背景与目标

现在的侧边栏按 workspace 组织，任务状态散落在各个 workspace 行里，跨 workspace 的全局视图没有。2026-10-20 本机实测有 340 个未归档 agent，其中 11 个在运行，靠侧边栏逐个找已经不现实。

要解决的问题：

- 看不到全局：哪些任务在跑、哪些在等我输入，要逐个 workspace 点开看。
- 关系看不到：编排出去的子 agent 和父 agent 之间没有可见的关联。
- 操作路径长：停止一个任务或批准一个权限请求，要先找到并切进对应的 tab。

成功标准：

- 打开看板 1 秒内看到全部「运行中」和「待输入」任务。
- 任意卡片一次点击就到达对应 workspace 的对应 tab。
- 「待输入」任务的权限请求可以不跳转直接处理。
- 「运行中」任务可以从看板停止，3 秒内卡片移出运行列。

## 范围

第一版只做「看得见、跳得过去、停得下来、批得了权限」。泳道由 agent 状态推导而来，所以和 Linear 不同，**卡片不能在泳道之间拖动**。

用户故事：

1. 作为同时跑很多 agent 的人，我打开 Tasks，一眼看到所有待输入、运行中、待查看和已完成的任务。
2. 我可以按 workspace（项目）、provider 和标签过滤，也可以按标题搜索。卡片上能看到任务所在的项目、workspace、分支、文件夹和标签。
3. 我点卡片上的跳转按钮，就跳到它所在 workspace 的对应 tab。
4. 我在父任务卡片上看到它派出去的子任务及其状态，在子任务卡片上能回到父任务。
5. 我在卡片上直接停止一个跑偏的任务。
6. 我在卡片上直接批准或拒绝权限请求。
7. 我在卡片上看到它跑了多久、用的哪个 agent、什么模型和思考等级、上下文用了多少。
8. 不打开看板，我也能从侧边栏入口上的计数知道有几个在等我、几个在跑、几个待查看。

| 内容 | 第一版 | 后续 |
| --- | --- | --- |
| 侧边栏入口 + 计数 | 已做 | |
| 插件设置：总开关、卡片字段开关、信息密度预设、看板默认行为 | 已做（并入 Better Paseo 设置页） | |
| 四列泳道看板 + 过滤搜索 | 已做（另加排序） | |
| 卡片详情：桌面侧栏、窄屏底部 sheet | 已做（代替原型的悬停浮层） | |
| 跳转到 tab | 已做 | |
| Paseo 层父子 agent 关联 | 已做 | |
| 停止任务 | 已做（走 CLI） | 上游加 `cancel()` 后切换（上游 PR 未提） |
| 卡片上处理权限请求 | 已做 | |
| 统计：本轮时长、模型、思考等级、provider、上下文 | 已做 | |
| 精确的上一轮耗时 | 已做：插件服务端记录每一轮的开始和结束（`server/turn-usage.ts`），从插件装上那一刻开始 | |
| 累计耗时 | | 未做 |
| 标为已读、归档、取消归档 | 已做（标为已读走插件服务端的 daemon 连接，取消归档走 CLI，见「操作」） | |
| 追加一条指令 | | 未做 |
| 多 host 聚合 | | 未做 |
| provider 内部的 subagent（Claude Code 的 Agent 工具、Codex 和 Pi 自己的） | 已做：运行中和失败的画成只读虚线卡片，见「父子 agent 关联」 | |
| 在看板上改模型、模式、思考等级 | 不做 | 不做 |

## 泳道定义

看板分四列，归列规则沿用协议里的 `deriveAgentStateBucket`。这样看板和侧边栏 workspace 的状态色基本一致；唯一的例外是 `initializing`：协议的 bucket 把它归为 done，看板按下表第 3 条放进运行中。规则自上而下匹配，命中第一条就停。

| 顺序 | 条件 | 协议 bucket | 泳道 | 列内默认排序 |
| --- | --- | --- | --- | --- |
| 1 | `pendingPermissions` 非空，或 `attentionReason = permission`（只见于老 daemon 的记录） | needs_input | 待输入 | 等得最久的在上（`attentionTimestamp` 升序） |
| 2 | `status = error`，或 `attentionReason = error` | failed | 待查看（红色失败标） | 最近的在上 |
| 3 | `status = running` 或 `initializing` | running | 运行中 | 跑得最久的在上（`activeTurn.startedAt` 升序），方便发现卡住的 |
| 4 | `requiresAttention = true`（跑完但用户还没看） | attention | 待查看 | 最近的在上（`attentionTimestamp` 降序，缺省用 `updatedAt`） |
| 5 | 其余（idle、closed） | done | 已完成 | 最近的在上（`updatedAt` 降序） |

列的顺序是待输入、运行中、待查看、已完成：需要人处理的在最左边。

过滤栏可以另选一种排序，同时作用于四列：workspace、项目、分支、文件夹、标题、创建时间、更新时间、上下文占用、耗时，各有升降两个方向。没有该字段的卡片排在最后；不选时按上表。已完成列分页加载，按更新时间以外的键排序时只排已加载的部分，列底会注明。

已完成列必须限量，否则会铺出上百张卡片：

- 默认只显示最近 24 小时内更新过的，可切换为 7 天或全部。
- 每次加载 50 条，滚到底或点「加载更多」再取下一页。
- 已归档的 agent，以及所在工作区或项目已归档的 agent，不进前四列。设置 `board.showArchived`（默认开）打开时，它们进已完成之后的「已归档」列，见下节。

待输入、运行中、待查看三列不设时间窗口。它们本来就是「现在要管的事」，数量通常是个位数到十几。

### 已归档列（可选）

默认开启。开关的入口有三处，写的都是当前设备的同一个设置 `board.showArchived`，不与其他设备同步：桌面看板筛选栏右侧、已完成时间窗口旁边常驻的归档圆按钮；手机和窄屏看板头部、筛选按钮左侧的同款圆按钮。开关只体现在图标上：关闭时图标带一道斜线，打开时是普通的归档图标，外框不变；设置页任务看板标签页的总开关下方。打开后，已完成之后多出第五列「已归档」，手机的状态条也多一格：

- 收两类卡片：agent 本身已归档的；agent 没归档、但所在工作区或项目已归档的。Paseo 归档工作区时会留下它的 agent，列表接口照样返回，但界面上哪里都不显示。
- Paseo 的 `agents.list` 没有「只列已归档」的过滤，只有 `includeArchived`，返回已归档和未归档混在一起、按更新时间排序的列表。所以打开后，已完成列那条订阅改为带 `includeArchived`，两列共用这一条订阅，也共用分页和时间窗口。归档时 daemon 会把 `updatedAt` 设成归档时间，所以时间窗口按归档时间算。一页可能只带来几张已归档卡片，因此这一列为空时也显示「加载更多」。
- 卡片的状态图标是灰色的 `Archive` 方盒，没有标为已读。本身已归档的卡片没有「打开 tab」：插件的 `navigation.openAgent` 不能固定（pin）它打开的 tab，Paseo 0.12 整理 tab 时会立刻丢掉已归档 agent 的 tab，转而显示同一 workspace 的另一个 tab，看起来像这个任务还在跑。原来放「打开 tab」的位置换成「取消归档」：卡片上（桌面悬停时出现，触屏常驻）、详情头部第一个按钮、手机操作栏的主按钮；键盘 Enter 之类的其他打开方式只提示先取消归档。取消归档和父任务行的取消归档走同一个 RPC，取消后卡片回到已完成列，「打开 tab」随之恢复。上游草稿 PR [#6382](https://github.com/getpaseo/paseo/pull/6382) 给 `openAgent` 加 `workspaceId` 和 `pin`，合入后改为带 `pin: true` 打开，去掉这条限制。因工作区归档而进来的卡片没有取消归档，仍可打开。
- 未归档的父任务卡片不列出已归档的子任务，和关闭这一列时一样；子卡片的父任务行仍能跳到父卡片。
- 关闭时看板不向 daemon 要任何已归档的 agent，行为和加这一列之前完全一样。切换开关会重新读一次已完成列。

## 界面与交互

入口放在侧边栏顶部那一组，点开是一个整页看板。桌面上方是两行工具栏，下面四列泳道，右侧是详情侧栏。最初的视觉与交互见[原型说明](prototypes/tasks-board.md)，实现后有改动的以本文和代码为准。

### 侧边栏入口

- 标题「Tasks」（中文界面「任务」，跟随宿主语言），图标用 Lucide 的 `SquareKanban`。看板没开启时不出现。
- 右侧计数按泳道顺序显示「待输入 · 运行中 · 待查看」，每个数字前带该泳道的状态图标；数的是未筛选看板上各泳道的卡片，provider subagent 的虚线卡也算在它所在的泳道；为 0 的项不显示，全为 0 时不显示计数；待输入的数字用警示色。`sidebar.count` 可改为只显示待输入或不显示。
- 当前停在 Tasks 页时高亮该行（读 `currentScreen`）。
- 同时注册一个全局 Command Center 条目「打开任务」（Open Tasks），同样只在看板开启时存在。

### 过滤与搜索

- 第一行：任务总数、快捷键提示（窄看板上省略）、搜索。搜索匹配标题、项目、workspace 和分支。
- 第二行：项目多选（每行下面用灰字写项目的根目录；选一个项目等于选上它的全部 workspace）、Workspace 多选（下拉里按项目分组，同名 workspace 用文件夹名区分）、Agent（provider）多选、标签多选、已选条件的 chip、已完成列的时间窗口（24h、7d、∞）、「显示子任务」开关、排序。菜单是 Linear 式的级联菜单；项目和 Workspace 菜单顶部有搜索框，按词匹配名称、文件夹和分组标题，手机筛选 sheet 的 Workspace 一节也有同样的搜索。原来的「只看开着 tab 的」过滤已经去掉，见「待决问题」。某列有卡片被筛选隐藏时，列底空白处写明隐藏了几张、是哪些条件。「显示子任务」和已归档泳道一样是圆形开关，只用图标区分开关：关闭时图标加斜杠，不高亮。
- Web 上两行工具栏的每个控件都有悬停提示：指针停 400 ms 后在控件下方显示它的作用（开关类说明点下去会怎样，快捷键附在括号里），按下即消失；菜单打开时不显示该按钮的提示。按钮放不下文字、只剩图标时，提示先写出收起的文字（已选数量、当前排序、泳道宽度）。与卡片的悬停提示共用一套样式和延迟。
- 过滤条件写进 screen params，并按 host 在本次会话内记住；从侧边栏或 Command Center 重开时带上。「显示子任务」直接修改当前设备偏好；时间窗口默认跟随共享设置，在看板上改过才覆盖；「清除全部」清除临时筛选并回到当前设备的显示子任务偏好，不清排序。
- 数量为 0 的分组：设置 `board.showEmptyGroups`，默认开。开着时，筛选菜单（项目、Workspace、Agent、标签）、手机和窄屏的筛选 sheet、详情侧栏的分组都列出 Paseo 里能用的全部选项：所有未归档的 workspace 和它们的项目、所有已启用的 provider、`listLabels` 定义的和 workspace 上带的全部标签，没有进行中任务的计数为 0，排在有任务的后面。关掉后只列计数大于 0 的，已选中的始终保留，方便取消；项目按全部 workspace 计算，选一个项目仍会选上它没列出来的 workspace。切换入口写的是同一个设置：宽看板筛选栏右侧归档按钮旁的圆按钮、手机和小尺寸平板的筛选面板内的开关、设置页「看板」分组。手机和窄看板头部不显示该按钮。按钮用两个图标区分状态：显示时是 Lucide 的 `List`（完整列表），隐藏时是 `ListFilter`（逐行收窄的列表），描边不变色。

### 卡片

卡片仿 Linear 的 issue 卡片，自上而下：

1. 元信息行（灰色小字）：项目图标 +「项目 › workspace」，子任务再接「↳ 父任务标题」。workspace 与项目名、任务标题或分支名相同时不显示。行尾是上下文占用环。这一行只占一行，放不下时截断，父任务链接先让位。元信息行没有内容时，上下文环放到标题行。
2. 标题行：状态图标 + 标题，标题最多 2 行。
3. 属性行（Linear 式 pill，放不下就折行）：agent pill（品牌标识 + 模型名；模型关掉或未知时显示 agent 名）、思考等级、分支（等宽字体，可接 Git 状态）、文件夹或完整路径、标签（超出上限收成 +N）、关联 PR、子任务 pill。
4. 底部行：左边计时，右边是操作按钮。运行中显示本轮开始时刻和已运行时长，待输入显示等待时长，待查看和已完成显示「约 Xm · N 分钟前」（跨天显示完整日期）；自己这一轮已结束、但子任务还在跑的父卡片，按最早一个仍在运行或待输入的子任务的开始时刻计时。上下文环只在运行中卡片上画。操作按钮是 0.5pt 描边的按钮，最后一个总是「打开 tab」（结尾带 ArrowUpRight），左边按状态放停止、标为已读或归档；桌面上悬停才浮出，不挤动文字，待输入卡片悬停时只浮出「打开 tab」；平板上常驻，单独占计时下面一行；手机上排在卡片底部的一行。

最初方案里「位置组 + 行首图标」「信息完整显示、不截断」的排法已经改掉：卡片按 Linear 的 issue 卡片重排，项目和 workspace 并进顶部元信息行，分支、文件夹、标签等改成 pill。

桌面上各列平分看板宽度，单列宽度由 `board.laneWidth` 决定：紧凑 260 到 280，默认 300 到 340，宽松 340 到 400。默认档在窄看板上按实际可用宽度缩窄，预留两侧边距、列间距和折叠竖条，尽量同时放下两列展开泳道，默认档单列通常不小于 260，避免为放下两列压缩卡片；没有折叠列时，看板宽 540 或 480 都对应每列 260，下一列可部分露出。面板本身不足 284 时单列随面板缩窄，最低 220。紧凑档在小尺寸平板上同步缩窄，最低 220，与默认档保持至少 40 的滚动宽度差；宽 540 或 480 时，紧凑 / 默认 / 宽松分别为 220 / 260 / 300。看板不足 632 时宽松档固定 300；较宽面板的紧凑档仍为 260 到 280，宽松档保留 340 到 400；全部泳道放不下时横向滚动。列头可以折叠成 40px 竖条。

状态图标照搬 Paseo 侧边栏 workspace 行的官方指示器：运行中是转圈的环（中心圆点 + 90° 弧，900ms 一圈，所有环同步），跑完未看是绿点，失败是红点，已完成是 30% 透明的灰点。两处偏离：等待输入按用户要求画成空心的琥珀色圆环，不用宿主的实心 `CircleAlert`；从看板手动停止、还没再跑的卡片画成实心方块。已归档列的卡片用灰色的 `Archive` 方盒。列头、卡片标题、手机泳道切换条、侧边栏计数和子任务清单都用同一组图标。图标颜色是 Paseo 侧边栏 `statusDot` 色带浅色、深色两套值的副本（`client/tasks/cards/tokens.ts`），按 `surface0` 的明度选用。这是设计上的取舍：看板不需要从宿主读这组颜色，插件主题里没有它也不算缺口。

其余内容随泳道变化：

| 泳道 | 额外内容 |
| --- | --- |
| 待输入 | 权限请求摘要（标题 · 命令或文件）、允许或拒绝按钮（问题类为「去回答」）、「还有 N 条」、等待时长 |
| 运行中 | 本轮开始时刻与已运行时长、上下文占用环、子任务 pill、停止按钮 |
| 待查看 | 失败原因（红字）或「已手动停止」；未读靠绿点状态图标表示；「标为已读」按钮 |
| 已完成 | 上一轮耗时（约）、完成于多久前；手动停止的显示「已手动停止」；「归档」按钮 |
| 已归档（默认显示） | 上一轮耗时（约）、归档于多久前；本身已归档的有「取消归档」，没有「打开 tab」 |

属性行里的模型、分支、文件夹和路径 pill 点按即复制显示的内容（路径 pill 复制完整目录），宿主的 toast 写明复制了什么；点 pill 不会选中卡片，触屏上长按 pill 仍打开详情。Web 上右键卡片在指针处打开菜单：打开 tab，复制会话 ID、标题、workspace 名和项目名，再按卡片当前状态列出停止（父卡片可选仅此任务或连同子任务）、标为已读、取消归档、归档；卡片缺的值不列，已归档任务没有打开 tab。

### 详情

原型里的悬停浮层没有采用。详情是一张 Linear 式的卡片：头部（状态、标题、agent / 模型 / 思考等级 / 模式 chip、标签、操作按钮），下面是按状态挑选的主块（运行中的本轮计时、累计 token 与上下文、待输入的权限请求、失败原因或摘要），再往下是首条提示和最新消息（按 Markdown 渲染，各带复制，长的先折叠）、子任务、可折叠的属性（项目、父任务、分支、工作目录、PR、标签）、用量（token 与费用）和时间线。头部的操作按钮里，「打开 tab」在桌面上排第一个、触屏上排最后；本身已归档的任务换成「取消归档」，已完成的任务旁边多一个「归档」。

- 桌面：单击卡片在看板右侧的详情侧栏里显示。看板宽 1020 以上时侧栏内嵌在泳道右侧，宽度可拖动（340 到 520）；较窄时浮在泳道右侧；再窄（约 760 以下）从底部升起为非模态 sheet，半高或全高。没选卡片时，侧栏显示四列计数和按 Agent、项目、Workspace、标签的分组，点一行即加入过滤；计数为 0 的行是否列出跟随 `board.showEmptyGroups`。`I` 键显示或隐藏侧栏，侧栏的开关和宽度会被记住。
- 手机：点按或长按卡片打开详情 sheet，sheet 顶部可在同一泳道的卡片间切换上一个、下一个。

### 交互

- 每张卡片都有「打开 tab」按钮（文字后接 Lucide ArrowUpRight；桌面上悬停时出现，触屏常驻），点它跳到对应 workspace 的 tab。桌面上双击卡片，或用键盘聚焦后按 Enter，也会跳转；单击只是选中并显示详情。手机上点卡片打开详情，跳转只用「打开 tab」。其余按钮区域单独响应。子任务清单的每一行、详情卡片头部也有跳转入口。provider subagent 的卡片打开父任务的 tab；本身已归档的任务不能打开，见「已归档列」。
- 状态变化时卡片滑到新的列（`lane-motion.tsx`：留在原列的滑到新位置，换列的飞过去，离开的淡出），列的计数滚动到新值；筛选、时间窗口和「显示子任务」切换时也一样，搜索、排序和已归档列开关直接重排。系统开了「减少动态效果」时不做动画。
- 桌面键盘：J/K 或 ↑↓ 列内移动，H/L 或 ←→ 跨列（跳过空列和折叠列），Enter 打开 tab，/ 聚焦搜索，Esc 依次返回上一张、收起浮动侧栏、取消选中，并解除待确认的停止。
- 窄屏的卡片原则：手机上不必要的信息隐藏，挪到详情 sheet。必须显示的是状态、标题、agent · 模型 · 思考等级、计时、操作、权限请求摘要和失败原因，这些不受字段开关影响；项目、workspace、分支、第 1 个标签和子任务摘要跟随开关；文件夹、完整路径、Git 状态、关联 PR、项目图标不上卡片；上下文占用超过 80% 时才在卡片上提醒。
- 宿主是窄屏布局（`layout.compact`），或看板实测宽度放不下两列时，用手机布局：顶部是四格分段的状态条（状态图标 + 泳道名 + 数量）切换泳道，一次只显示一个泳道，左右滑动也能切换（iOS 和 Android 用原生分页）。有待输入任务时默认停在「待输入」，否则停在「运行中」；会话内记住上次选择。过滤收进底部 sheet，操作按钮排在卡片底部的一行里。
- 平板宽度能放下两列时画桌面看板，但没有悬停：停止按钮常驻，点按选中卡片。

## 插件设置

卡片上显示哪些信息由插件设置决定。入口是 Better Paseo 唯一的设置页（Settings → Plugins → Better Paseo，`addSettingsScreen` id `chat-presentation`），页里分「聊天显示」和「任务看板」两个标签页；聊天标签页顶部也有看板的开关（看板关闭时附带预览），以及链到任务看板标签页的「看板选项与预览」。最初方案里单独的 Tasks 设置页已经并入这里。设置用 `defineSettings`（id `tasks`）定义，由插件服务端 `registerSettings` 注册，按 host 保存（SDK 只支持 `scope: "host"`），显示子任务、显示归档泳道、显示数量为 0 的分组和泳道宽度使用设备本地存储：Web/Electron 用 localStorage，iOS/Android 用宿主 AsyncStorage。首次升级时沿用旧共享值一次，之后各设备独立保存；看板、筛选面板和设置页读取同一份本地值。其余选项仍按 host 同步。旧 schema 中的四个字段只保留作迁移种子，设备修改不会写回它们。

任务看板标签页顶部是看板的实时预览：用示例 agent 画出四列，打开「显示已归档泳道」时是五列（窄页面上是一列加泳道切换），改任何开关预览立即变化。宽页面上预览右上角有「桌面端 / 移动端」切换（与聊天标签页的效果预览一致）：移动端在 390pt 宽的手机框里按手机的样子画看板，即泳道切换加 `mobile.compactCards` 卡片；手机上预览本来就是手机样子，不显示这个切换。预览不读真实数据，也不发请求。

### 总开关

| 设置 | 设置键 | 选项 | 默认 |
| --- | --- | --- | --- |
| 启用任务看板 | `enabled` | 开 / 关 | 开 |

看板默认开启。关闭时没有侧边栏入口和 Command Center 条目，也不订阅任何 agent；直接打开看板页会提示未启用，并给出「打开设置」。

「显示已归档泳道」（`board.showArchived`）紧随总开关，位于实时预览上方，默认开启。

### 信息密度

「卡片信息密度」（设置键 `density`）提供四个选项：精简、标准（默认）、完整、自定义。选预设会一次性设置下面的开关，手动改过任何开关后自动变成「自定义」。

| 字段 | 设置键 | 精简 | 标准 | 完整 |
| --- | --- | --- | --- | --- |
| agent 品牌标识 | `card.provider` | 关 | 开 | 开 |
| 模型 | `card.model` | 开 | 开 | 开 |
| 思考等级 | `card.thinking` | 开 | 开 | 开 |
| 项目 | `card.project` | 关 | 开 | 开 |
| 项目图标 | `card.projectIcon` | 关 | 开 | 开 |
| workspace 名称 | `card.workspace` | 关 | 开 | 开 |
| 分支 | `card.branch` | 关 | 开 | 开 |
| Git 状态（未提交改动、领先 / 落后） | `card.gitStatus` | 关 | 关 | 开 |
| 文件夹 | `card.folder` | 关 | 开 | 开 |
| 完整路径（代替文件夹） | `card.path` | 关 | 关 | 开 |
| 标签 | `card.labels` + `card.labelLimit`（1 / 2 / 3 / 全部） | 关 | 开，2 | 开，全部 |
| 关联 PR | `card.pullRequest` | 关 | 关 | 开 |
| 计时 / 完成于 | `card.timer` | 开 | 开 | 开 |
| 上下文占用环 | `card.context` | 关 | 开 | 开 |
| 子任务摘要 | `card.subtasks` | 关 | 开 | 开 |

最初方案里精简密度的「项目」是开，和「精简只留标题和计时」的规则矛盾，代码按后者改为关。

标题和「打开 tab」始终显示，不提供开关（宿主没有 `navigation` 时不画「打开 tab」，本身已归档的任务换成「取消归档」）。字段被关掉或没有数据时不画对应的内容：元信息行没有项目、workspace 和父任务时整行收起，属性行一个 pill 都没有时整行收起，计时和上下文环都没有时底部行收起。精简密度只留标题、模型与思考等级和计时。

### 其他设置

| 设置 | 设置键 | 选项 | 默认 |
| --- | --- | --- | --- |
| 手机上使用精简卡片 | `mobile.compactCards` | 开 / 关 | 关（关时手机卡片按「窄屏的卡片原则」跟随上面的开关；开时一律用精简预设） |
| 已完成默认时间窗口 | `board.doneWindow` | 24 小时 / 7 天 / 全部 | 24 小时 |
| 泳道宽度 | `board.laneWidth` | 紧凑 / 默认 / 宽松 | 默认（桌面、Web 和平板；手机一次一列，不显示此项） |
| 显示子任务 | `board.hideSubtasks`（取反；原「默认隐藏子任务」） | 开 / 关 | 开 |
| 显示数量为 0 的分组 | `board.showEmptyGroups` | 开 / 关 | 开（见「过滤与搜索」；看板工具栏上也能切换） |
| 停止前二次确认 | `board.confirmStop` | 开 / 关 | 开（确认方式见「操作」的停止一行） |
| 侧边栏入口计数 | `sidebar.count` | 待输入 · 运行中 · 待查看（`all`）/ 只显示待输入（`input-only`）/ 不显示（`none`） | `all`（旧值 `running-and-input` 读作 `all`） |

页面底部有「恢复默认设置」，看板的开关状态不受影响。设置 schema 带 `version`（目前是 1），以后增删字段用 `migrate` 迁移旧值；每个字段的坏值单独回退到默认，不会让整条记录失效。

## 父子 agent 关联

父子关系只覆盖 Paseo 层的子 agent，数据来自每个 agent 的 label `paseo.parent-agent-id`。通过 Paseo 创建并指定了 `parent` 的 agent 有这个 label，比如 MCP `create_agent` 和 paseo-orchestrate 类编排。

展示规则：

- **子找父**：子卡片的元信息行末尾显示「↳ 父任务标题」。点它在看板上滚动到父卡片并高亮，不跳走；父卡片所在列折叠时先展开，手机上父任务在别的泳道时先切过去，被过滤隐藏时给出提示。
- **父找子**：客户端用全量列表建 `父 id → 子 id 列表` 的索引。父卡片的子任务 pill 显示 ListTree 图标和各状态的图标与数量，点开后是子任务列表（状态图标 + 标题），点一行在看板上定位该子任务，行尾的跳转按钮打开它的 tab。详情里的子任务按 Paseo 0.12 子 agent 行的样式显示 agent 标识、模型、思考等级、模式和上下文。
- **子卡片仍然出现在自己的泳道里**。过滤栏提供「显示子任务」开关，默认开；关闭后待查看和已完成的子任务只在父卡片里出现，运行中、待输入和失败的子任务仍留在泳道里，除非父卡片就在同一列。
- 自己这一轮已结束、但还有子任务在运行或待输入的父任务，留在运行中列，并沿父链向上传递；失败的父任务仍在待查看。
- 只展示直接子任务，孙任务在子任务自己的卡片里展开。
- 父 agent 已归档时，子卡片的父任务链接保留父任务标题（没有标题时写「父任务」），旁边带一个归档小标签：父任务本身已归档写「已归档」，所在工作区或项目已归档写「工作区已归档」；卡片的元信息行和详情的父任务行都有。不在看板上的父任务在带来子任务的那一批之后用 `agents.ref(id).refresh()` 补取一次。
- 子 agent 被 detach 后 label 清空，订阅推送到达后关联自动消失。

provider 内部的 subagent（Claude Code 的 Agent 工具、Codex 和 Pi 自己派出的）不是 Paseo agent：没有 tab，也没有 `paseo.parent-agent-id` label，`PaseoApi` 列不出来。插件服务端用自己的 daemon 连接（`connectHostDaemon`）先读一次各 agent 的 provider subagent，之后跟随 daemon 的更新，通过 RPC `tasks.subagents` 交给看板（`server/tasks/provider-subagents.ts`）。看板只显示运行中和失败的：

- 每个画成一张只读的虚线卡片，运行中的在运行中列，失败的在待查看列，按所在列的排序并入；侧边栏计数也算它们。卡片带父任务的 workspace、分支和标签、父任务链接、计时，模型的位置换成 provider 给的信息（类型图标、模型、思考等级）。没有停止、标为已读和归档。
- 点卡片打开详情；首条提示（交给它的任务）和最新回复由 RPC `tasks.subagent-timeline` 从 daemon 读（`agent.provider_subagents.timeline.get`），运行中每 15 秒重读一次。没有上下文、用量和时间线。「打开 tab」打开父任务的 tab，Paseo 在那里列出这个 subagent。
- 父卡片上它们也是子任务行：点一行定位到它的卡片（被隐藏或过滤掉时打开父任务的 tab），行尾的 ArrowUpRight 打开父任务的 tab。「显示子任务」关闭时按普通子任务处理。

## 操作

卡片上的操作只保留高频的几种，其余一律通过跳到 tab 完成。

| 操作 | 触发方式 | 实现 | 出现在 | 版本 |
| --- | --- | --- | --- | --- |
| 跳到 tab | 「打开 tab」；桌面上双击卡片或聚焦后按 Enter；子任务行、详情和右键菜单里的打开 | `navigation.openAgent({ agentId })`；provider subagent 打开父任务 | 本身已归档的以外的所有卡片 | 已做 |
| 停止 | 桌面悬停显示停止按钮（触屏常驻）。Web 上点一下变成「确认停止」，3 秒内再点才执行；iOS 和 Android 上弹系统对话框（标题「停止任务？」或「停止任务和 N 个子任务？」，正文是任务名），只有它的破坏性按钮才停止；Web 右键菜单里的停止走 Electron 的原生对话框，纯 Web 用浏览器的 `confirm`。`board.confirmStop` 关掉后一次即停 | 插件服务端 RPC `tasks.stop` 调 `paseo agent stop <id>`（见技术方案） | 运行中、待输入 | 已做 |
| 连同子任务一起停止 | 父卡片停止按钮的下拉项（仅停止此任务 / 连同子任务一起停止） | 一次 RPC 传入父和运行中、待输入的直接子任务，服务端逐个停止 | 有运行中或待输入子任务的父卡片 | 已做 |
| 批准或拒绝权限 | 卡片内嵌权限请求摘要 + 按钮 | `agents.ref(id).respondToPermission({ requestId, response })` | 待输入 | 已做 |
| 标为已读 | 卡片上停止的位置（桌面悬停时出现，触屏常驻，手机在卡片的操作行）、右键菜单 | 插件服务端 RPC `tasks.read`，经自己的 daemon 连接调 `DaemonClient.clearAgentAttention`，和在 Paseo 里打开 tab 的效果一样；`tasks.reads` 记下已读，agent 开始新一轮前卡片留在已完成列 | 待查看 | 已做 |
| 归档 | 桌面卡片的悬停按钮、手机卡片操作栏、右键菜单、详情头部、手机 sheet 操作栏 | `agents.ref(id).archive()`，和 Paseo 自己的归档一样，不经插件服务端 | 已完成 | 已做 |
| 取消归档 | 本身已归档的卡片上「打开 tab」的位置、详情头部、手机操作栏、右键菜单、子任务详情的父任务行 | 插件服务端 RPC `tasks.unarchive`：先 `paseo agent inspect` 确认已归档（reload 会打断运行中的 agent），再 `paseo agent reload <id>` | 已归档列 | 已做 |
| 复制 | 点按模型、分支、文件夹、路径 pill；右键菜单复制会话 ID、标题、workspace 名、项目名 | 宿主的 `copyText` | 所有卡片 | 已做 |
| 追加一条指令 | 卡片更多菜单里的输入框 | `agents.ref(id).send(text)` | 待查看、已完成 | 未做 |

停止、标为已读和取消归档在插件服务端做不到时隐藏（`tasks.capabilities`）：停止和取消归档要找得到 CLI，标为已读要插件进程能加载宿主自带的 daemon 客户端。

停止的含义是「中断当前这一轮」，和 CLI 说明一致：agent 回到空闲，会话保留，之后还能继续发消息。它不是删除或归档。

停止发出后，按钮保留「停止」字样，变暗并显示转圈，不再响应点按，直到 agent 离开运行中和待输入；RPC 失败、30 秒没有回应，或 10 秒内 agent 仍在运行，都会弹出错误提示。从看板停止的卡片在再次运行前画成实心方块，并显示「已手动停止」；daemon 停下 agent 时通常不要求关注，所以这类卡片多落在已完成列。服务端把这些记录存在插件数据目录的文件里，通过 RPC `tasks.stopped` 提供给看板；agent 开始新一轮、被归档或记录满 30 天时清除。换一个客户端或重启后，看板仍能显示「已手动停止」。

权限请求按 `kind` 分两类处理：

- `tool`、`plan`、`mode`：卡片上显示 `title` 和命令或文件摘要。请求自带 `actions` 时按它们的 `label` 和 `variant` 画按钮，否则画「允许」「拒绝」两个按钮。
- `question`、`other`：需要填写答案或内容太长，卡片只显示问题标题和「去回答」按钮，点了跳到 tab。
- 同一个 agent 有多条挂起请求时，只显示第一条，并标出「还有 N 条」。

## 统计字段

你提的统计大多能从 agent 快照里读到；上一轮耗时来自插件服务端自己的轮次记录，会话累计 token 来自 provider 的会话文件。模型名和思考等级的可读名称复用仓库里已有的 `client/state/footer-model.ts`，保证和输入框里的模型选择器一致。

| 字段 | 来源 | 展示 | 精度 |
| --- | --- | --- | --- |
| 用的哪个 agent | `provider` | agent pill 里的品牌标识（复用 `server/mark-bitmaps.ts` 的位图）；模型关掉时 pill 显示 agent 名 | 准确 |
| 模型 | `model` → `providers.listModels` 的 `label` | agent pill 里，如「Opus 5.5」 | 准确 |
| 思考等级 | `effectiveThinkingOptionId`，缺省用 `thinkingOptionId`，再缺省用模型的 `defaultThinkingOptionId` | 单独一个 pill，如「High」 | 准确 |
| 模式 | `currentModeId` → `availableModes` 的名称 | 只在详情和子任务行里显示，如「Plan」「Bypass」 | 准确 |
| 本轮已运行 | `now − activeTurn.startedAt`，每秒刷新 | 开始时刻 + 时长，如「12m 30s」 | 准确 |
| 等待输入多久 | `now − attentionTimestamp` | 如「等待 4m」 | 准确 |
| 上一轮耗时 | 插件服务端记录的这一轮开始和结束（`server/turn-usage.ts`，RPC `turns.last`）；没有记录的开始时退回最近一条提示的时间；没有记录时不显示 | 如「约 8m」，带「约」字，按分钟取整 | 从插件装上那一刻起准确；更早的轮次没有 |
| 创建时间 | `createdAt` | 详情的时间线 | 准确 |
| 上下文占用 | `lastUsage.contextWindowUsedTokens / contextWindowMaxTokens` | 宿主输入框同款的上下文环，70% 起变黄、超过 90% 变红；悬停看用量和费用 | 取决于 provider |
| token 与费用 | `lastUsage` 的 input、cached input、output、`totalCostUsd` | 详情的用量部分和上下文环的悬停卡片，不上卡片正面 | 取决于 provider |
| 会话累计 token | 插件服务端 RPC `tasks.session-tokens` 读 provider 的会话文件：Claude 的 `projects/<cwd>/<session>.jsonl`（含其 subagent 文件），Codex rollout 里最后一条 `token_count` | 详情里运行中这一轮的主块：累计 token 和其中的缓存命中部分 | 只支持 Claude Code 和 Codex |
| 错误信息 | `lastError` | 失败卡片上的一行红字 | 准确 |
| 项目 | workspace 的 `projectCustomName ?? projectDisplayName`；退回列表条目的 `project.projectName`；图标先用 `paseo.projects.icon(projectId)`，宿主没有这个方法时用插件服务端 RPC `tasks.project-icons` | 元信息行里的项目图标 + 名称；没有图标时画 Paseo 的生成图标（项目色方块 + 首字母） | 准确；`projects.icon` 来自上游 PR [#7482](https://github.com/getpaseo/paseo/pull/7482)，合入前走插件服务端，见「技术方案」 |
| workspace 名称 | workspace 的 `title ?? name`；退回列表条目的 `project.workspaceName` | 元信息行「项目 › workspace」 | 准确 |
| 分支 | workspace 的 `gitRuntime.currentBranch`；退回列表条目的 `project.checkout.currentBranch` | 分支 pill，可接领先 / 落后和是否有未提交改动（`gitRuntime.aheadBehind`、`isDirty`） | 准确 |
| 文件夹 | `cwd` 的最后一级；完整路径放详情 | 文件夹 pill；与项目名、workspace 名或分支名相同时不显示 | 准确 |
| 标签 | workspace 的 `labels`（`paseo.workspaces.list`）只有名字；颜色先用 `paseo.workspaces.listLabels({ subscribe: {} })` 的定义匹配，宿主没有这个方法时用插件服务端 RPC `tasks.labels`；Paseo 的颜色名按插件内置的色值表画 | 带实心标签图标的 pill | 准确；`listLabels` 来自上游 PR [#7482](https://github.com/getpaseo/paseo/pull/7482)，合入前走插件服务端；两条路都拿不到时按名字从 Linear 的标签色里分一个替代色 |
| 关联 PR | workspace 的 `githubRuntime.pullRequest` | 卡片上的「#编号」pill，详情里显示「#编号 标题」 | 有 GitHub 集成时准确 |

上一轮耗时由插件服务端自己记账：它监听轮次事件，把每个 agent 每一轮的开始、结束、错误和用量写进插件数据目录（`server/turn-usage.ts`，每个 agent 最多留 500 轮），所以只从插件装上那一刻开始有数。累计耗时还没做。

## 技术方案

看板读数据、处理权限和归档用插件 SDK（`@getpaseo/plugin` 0.12.0、`@getpaseo/client` 0.12.0）已有的接口。SDK 做不到的几件事交给插件服务端，它跑在 daemon 所在机器上：

- 停止和取消归档：调 CLI（`paseo agent stop`、`paseo agent inspect` 加 `paseo agent reload`），等上游补上 `cancel()` 再切过去。
- 标为已读、provider subagent、标签颜色和项目图标：用自己的 daemon 连接（`connectHostDaemon`，用宿主自带的 `@getpaseo/client` 内部 `DaemonClient`，地址和本地凭据按 `PASEO_HOME` 找，和 CLI 一样）。标签颜色和项目图标走这条路只是过渡：长期用上游 PR #7482 给 `PaseoApi` 加的 `workspaces.listLabels()` 和 `projects.icon()`。客户端已经先检测这两个方法，有就用，没有才问插件服务端，所以 #7482 合入后自动切过去，不用改代码。
- 手动停止和已读记录、轮次记录、会话累计 token：插件服务端自己的文件，或读 provider 的会话文件。
- Tasks 代码分包：安装时构建，经 RPC `tasks.chunk` 下发，见「风险与限制」。

```mermaid
flowchart LR
  subgraph client["客户端（Paseo App 内）"]
    sidebar["侧边栏入口<br/>addSidebarHeaderItem"]
    board["Tasks 看板页<br/>addScreen"]
    nav["宿主导航<br/>navigation.openAgent"]
  end
  subgraph host["daemon 所在机器"]
    daemon["Paseo daemon<br/>agents.list 订阅 · respondToPermission · archive · providers.listModels · providers.snapshot"]
    server["插件服务端进程<br/>RPC tasks.* · turns.last"]
    cli["paseo CLI<br/>agent stop · agent inspect · agent reload"]
  end
  sidebar -- 计数订阅 --> daemon
  board -- 订阅 · 权限 · 模型 · 归档 --> daemon
  board -- 停止 · 已读 · 取消归档 · subagent · 标签 · 图标 --> server
  board -- 点击跳转 --> nav
  server -- execCommand --> cli
  cli -- 中断 · 重新载入 --> daemon
  server -- 自己的 DaemonClient 连接 --> daemon
```

看板读数据、处理权限和归档直接走 daemon；停止和取消归档从插件服务端转到 CLI，标为已读、provider subagent、标签颜色和项目图标由插件服务端用自己的连接问 daemon。上游给 `PaseoAgentHandle` 加 `cancel()` 后，看板直接调 daemon，CLI 这条路只留给老版本宿主。

### 需求到接口的映射

| 能力 | 接口 | 位置 |
| --- | --- | --- |
| 侧边栏入口 + 计数 | `addSidebarHeaderItem`，用 `SidebarRow` 画，计数放 `trailing`；`currentScreen` 决定高亮；只在看板开启时注册 | 客户端 |
| 看板页 | `addScreen({ id: "tasks", title })`，始终注册（关闭时显示未启用提示）；过滤条件存在 screen params 里 | 客户端 |
| 快捷入口 | `addCommandCenterItem`（global）「打开任务」，只在看板开启时注册 | 客户端 |
| 插件设置 | `defineSettings({ id: "tasks", scope: "host", version: 1, schema })`，服务端 `registerSettings`；界面是 Better Paseo 设置页（`addSettingsScreen`）的任务看板标签页，用 `useSettings` 读写，控件是插件自己的 | 客户端 + 服务端 |
| 任务列表 + 实时更新 | `paseo.agents.list({ subscribe: {}, filter, sort, page })`，条目带 `project.workspaceName` | 客户端 |
| 单张卡片的实时状态 | 不用 `useAgent`，全部来自列表订阅的推送 | 客户端 |
| 跳转 | `props.navigation.openAgent({ agentId })`；本身已归档的任务不调用（不能 pin，见「已归档列」） | 客户端 |
| 权限处理 | `paseo.agents.ref(id).respondToPermission(...)` | 客户端 |
| 归档 | `paseo.agents.ref(id).archive()` | 客户端 |
| 模型与思考等级名称 | `paseo.providers.listModels(provider)` | 客户端 |
| Agent 筛选的选项 | `paseo.providers.snapshot()` 加 `providers.subscribe`：列出 Paseo 里所有已启用（`enabled !== false`）的 provider，没有卡片的计数为 0；停用了但还有卡片的 provider 也保留。宿主没有 snapshot 时退回到只列卡片上出现过的 provider | 客户端 |
| 停止 | 插件 RPC `tasks.stop` → `execCommand(PASEO_CLI, ["agent", "stop", id, "--json"])`；`tasks.capabilities` 报告能否停止、能否标为已读；`tasks.stopped` 返回手动停止记录 | 服务端 |
| 标为已读 | `tasks.read` → 自己的 daemon 连接调 `clearAgentAttention`；`tasks.reads` 返回已读记录 | 服务端 |
| 取消归档 | `tasks.unarchive` → `paseo agent inspect`，确认已归档后 `paseo agent reload` | 服务端 |
| provider subagent | `tasks.subagents`（daemon 的 provider subagent 列表和更新）、`tasks.subagent-timeline`（`agent.provider_subagents.timeline.get`） | 服务端 |
| 标签颜色、项目图标 | 客户端先用 `workspaces.listLabels()`、`projects.icon()`（#7482）；没有时 `tasks.labels`、`tasks.project-icons` → 自己的 daemon 连接调 `listWorkspaceLabels`、`getProjectIcon` | 客户端 + 服务端 |
| 会话累计 token | `tasks.session-tokens` → 读 Claude、Codex 的会话文件 | 服务端 |
| 上一轮耗时 | `server.on("agent.turn_started" / "agent.turn_ended")` 写入插件自己的文件，`turns.last` 返回各 agent 最近一轮 | 服务端 |
| Tasks 代码分包 | `tasks.chunk` 返回安装时构建的 Tasks chunk（`scripts/build-client.mjs`） | 服务端 |

### 数据订阅

agent 分几路请求，避免一次拉全 340 个 agent 的完整快照；workspace、项目和标签只在看板打开时订阅：

1. **状态订阅**（看板开启后，侧边栏显示计数或看板打开时常驻）：`filter.statuses = [running, initializing, error]`，带 `subscribe`。覆盖运行中、待输入（等权限的 agent 处在轮次中）和失败。
2. **待查看订阅**：`filter.requiresAttention = true`，带 `subscribe`。只在看板打开，或侧边栏计数为 `all`（要显示待查看数）时打开。
3. **已完成分页**（只在看板打开时）：`filter.statuses = [idle, closed]`，`sort = updated_at desc`，`page.limit = 50`，客户端再按时间窗口截断。
4. **workspace、项目与标签**（只在看板打开时）：`paseo.workspaces.list({ subscribe: {} })`，按 workspace id 建索引，给卡片补标签、`gitRuntime`（分支、领先落后、是否有改动）和 `githubRuntime.pullRequest`；`projects.list()` 加 `projects.subscribe()` 拿项目名；有 `workspaces.listLabels` 时订阅它拿标签颜色，没有时问一次 `tasks.labels`；项目图标按 `projectIconRevision` 缓存 `projects.icon()` 的结果（没有这个方法时同一轮里的请求合成一次 `tasks.project-icons`），只给看得见的卡片和打开的筛选菜单请求。
5. **已归档**（只在看板打开且 `board.showArchived` 开着时）：已完成分页改为带 `includeArchived`，见「已归档列」。
6. **provider subagent**：`tasks.subagents` 带上次的 `version` 轮询，列表没变时返回 `null`；看板打开时每 15 秒一次，只有侧边栏计数时每 60 秒一次，agent 有更新后 1.5 秒内再读一次。

各路 agent 结果按 agent id 合并去重，再用「泳道定义」里的规则归列。协议包不在插件客户端的模块白名单里，`deriveAgentStateBucket` 约 20 行，照抄一份，并用测试和协议版本对齐。

为了让看板一打开就有内容，指针在侧边栏入口上停留 80ms、入口获得焦点或被触摸时，就预先打开看板的订阅；Command Center 条目选中时也一样。看板关闭后这些订阅再保留 30 秒，方便快速重开。

### 停止任务的两步走

1. **现在**（已做）：插件服务端 RPC 调 CLI。已在本机确认插件进程环境里有 `PASEO_CLI=/Applications/Paseo.app/Contents/Resources/bin/paseo` 和 `PASEO_HOME=~/.paseo`。插件服务端跑在 daemon 所在机器上，所以连远程 host 时停的也是那台。`PASEO_CLI` 不可执行时退回 PATH 上的 `paseo`，都找不到时 `tasks.capabilities` 报告不可用，看板隐藏停止按钮。agent id 先校验再传给 CLI，每次调用 10 秒超时。
2. **之后**（未做，上游 PR 还没提）：给 getpaseo/paseo 提 PR，在 `PaseoAgentHandle` 上加 `cancel()`，内部转调已有的 `DaemonClient.cancelAgent`。合入后客户端直接调用，老版本宿主仍走 RPC。

不用 `send()` 打断当前轮次来冒充停止，那样会在对话里多出一条消息。

### 兼容性

- `navigation` 在老宿主上可能不存在，缺失时隐藏跳转。
- `paseo-plugin.json` 的 `requirements.paseo` 要按 `addSidebarHeaderItem` 和 `addScreen` 首次出现的版本设下限，待查；目前仍是 `>=0.8.0`。
- RPC 名必须满足 `^[a-z][a-z0-9._-]*$`。看板用到的有 `tasks.capabilities`、`tasks.stop`、`tasks.stopped`、`tasks.read`、`tasks.reads`、`tasks.unarchive`、`tasks.subagents`、`tasks.subagent-timeline`、`tasks.session-tokens`、`tasks.labels`、`tasks.project-icons`、`tasks.chunk`，以及时间线共用的 `turns.last`（`shared/tasks-rpc.ts`、`shared/turn-usage-rpc.ts`）。老的插件服务端缺某个 RPC 时，看板隐藏对应的功能或用替代值。
- `workspaces.listLabels()` 和 `projects.icon()` 按方法是否存在做特性检测：有就用宿主的，没有时问插件服务端；插件服务端也拿不到时，标签用替代色，项目用生成图标。

## 风险与限制

最大的两个风险是「停止」依赖 CLI，以及全量列表带来的重连和渲染成本。其余都有明确的缓解办法。

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 停止依赖 CLI：无头 daemon 或 Linux 上可能没有 `PASEO_CLI` | 停止按钮不可用 | 已做：退回 PATH，都找不到就隐藏按钮。上游 `cancel()` 还没提 |
| 列表数据量：每条快照带 `availableModes`、`features` 等，全量订阅很重 | 重连和中继解密变慢 | 看板可以关闭；开启时只常驻状态订阅，待查看订阅只在需要时打开，已完成列分页，workspace、项目和标签只在看板打开时请求 |
| 客户端包体积：宿主每次重连都重发整个插件包 | 重连变慢 | 最初打算独立成插件；实际放进了 Better Paseo。已做：安装时把看板、侧边栏入口和看板设置的代码拆成单独的 Tasks chunk（`scripts/build-client.mjs`），由插件服务端经 `tasks.chunk` 按需下发；看板关闭时不取。目录里的客户端包从 1,977 KB 降到约 730 KB（2026-10-23 主包 728 KB、Tasks chunk 346 KB） |
| Paseo 层以外的 subagent | 用户以为父子关系不全 | 已做：运行中和失败的 provider subagent 画成只读虚线卡片；跑完的不显示。这条路依赖插件服务端的 daemon 连接，连不上时看不到 |
| 上一轮耗时只从插件装上起有数 | 更早的轮次没有耗时 | 没有记录就不显示，不再用 `updatedAt` 估算 |
| `lastUsage` 在重启后是否保留未验证（时间线上的用量已知不持久化） | 上下文环可能为空 | 拿不到就不显示，不显示「0%」 |
| 「待查看」何时清除由宿主决定 | 卡片可能在用户看过后仍停留 | 已做：卡片上有「标为已读」，和在 Paseo 里打开 tab 一样清除 attention；失败的卡片清除后仍会被读成失败，所以看板另记已读，直到下一轮 |
| 已归档任务打不开：插件的 `openAgent` 不能 pin tab | Paseo 丢掉已归档 agent 的 tab，显示同一 workspace 的另一个 tab | 已做：已归档任务不提供打开，原位置换成「取消归档」。等上游草稿 PR [#6382](https://github.com/getpaseo/paseo/pull/6382) 合入后带 `pin: true` 打开 |
| 宿主会保留隐藏的页面不卸载 | 看板在后台仍在订阅和每秒计时 | 已做：页面不可见时停掉每秒时钟和骨架动画 |
| 窄屏放不下四列 | 手机上不可用 | 已做：宿主是窄屏布局或看板宽度放不下两列时，改为状态条切换，一次一个泳道 |
| 状态色用内置副本：Paseo 的 statusDot 色带不在插件主题里 | 宿主改了这组颜色，看板不会跟着变 | 设计决定，不当作缺口：状态图标按 surface0 明度用官方色带浅深两套值的副本（运行中 `#268ae0` / `#5caaf6` 等）；计时、错误等文字用宿主的 `statusWarning`、`statusDanger`、`statusSuccess` |
| 标签颜色、项目图标绕过 SDK：`listWorkspaceLabels`、`getProjectIcon` 只在底层 `DaemonClient` 上 | 插件服务端连不上 daemon 时，标签用替代色、项目用生成图标；绕过的是宿主内部模块，宿主改动时可能失效 | 过渡做法：插件服务端用自己的 daemon 连接读（`tasks.labels`、`tasks.project-icons`）。长期用上游 PR [#7482](https://github.com/getpaseo/paseo/pull/7482)（Discussion [#7481](https://github.com/getpaseo/paseo/discussions/7481)）给 `PaseoApi` 加的 `workspaces.listLabels()` 和 `projects.icon()`，目前仍未合入；客户端已先检测这两个方法，合入后自动改用 |

## 里程碑与验收标准

分四步交付，先只读、后操作。每一步都要在桌面端和至少一个窄屏客户端（iOS 模拟器或 Android 真机）上实测。M1、M2 的功能已经实现；下面的实测验收项没有留下记录的，保持未勾选。

1. **M0 原型与验证**：用真实数据做一次性看板原型，定下卡片信息密度，并验证前面标为「待查」的假设。
    - [x] 交互原型（[prototypes/tasks-board.md](prototypes/tasks-board.md)）
    - [ ] 打开 tab 后 `requiresAttention` 是否清零（看板已另有「标为已读」）
    - [ ] daemon 重启后 `lastUsage` 是否还在
    - [x] `useAgent` 能否读到不在当前视图里的 agent：不再需要，卡片状态全部来自列表订阅
    - [ ] `addSidebarHeaderItem` 和 `addScreen` 最低支持的 Paseo 版本
2. **M1 只读看板**（已实现）：侧边栏入口、四列泳道、过滤搜索、跳转、统计字段、父子关联。
    - [ ] 侧边栏计数和看板各列数量一致，状态变化 2 秒内同步
    - [ ] 任意卡片一次点击到达正确的 workspace 和 tab
    - [ ] 用编排派出 2 个子 agent，父卡片显示 2 个子任务，子卡片能定位回父卡片
    - [ ] 模型名和思考等级与输入框里的显示一致
    - [ ] 340 个 agent 的本机数据下，打开看板 1 秒内出现活跃任务，滚动不掉帧（报告帧数，而不是单行渲染时间）
3. **M2 操作**（已实现）：停止、连同子任务停止、卡片上处理权限。
    - [ ] 停止后 3 秒内卡片离开运行中列，会话仍可继续发消息
    - [x] 找不到 CLI 时停止按钮隐藏，不报错（`tasks.capabilities`，有单元测试）
    - [ ] `tool` 类权限在卡片上允许后，agent 继续执行；`question` 类跳到 tab
4. **M3 上游与增强**（部分完成）：归档、标为已读、取消归档、上一轮耗时记账、provider subagent 已做；上游 `cancel()` PR 合入后切换、追加指令、多 host 聚合、累计耗时未做。
    - [ ] 上游 PR 附 QA 证据并从 RoundRedDot/paseo 发出
    - [ ] 新宿主走 `cancel()`，老宿主仍走 RPC

## 待决问题

下面的问题已在实现中定下来。

- [x] 放在 Better Paseo 里，还是单独做成 `paseo-tasks` 插件？最初建议单独做（Better Paseo 的定位是重画聊天时间线，而且重连时会重发整个包）。最终放在 Better Paseo 里（`client/tasks/`），复用了品牌图标和主题工具；看板默认开启，可在设置里关闭，关闭时不注册入口、不订阅。包体积的代价已用 Tasks 分包缓解，见「风险与限制」。
- [x] 「按 tab 过滤」的含义：按「只看开着 tab 的 agent」实现，任一客户端的 label `paseo.open-agent-tab.<clientId>` 为 `true` 即算开着。Paseo 只给子 agent 打这个标记，所以对普通 agent 基本不起作用，过滤项上有提示。后来去掉了这个过滤：它对普通 agent 不起作用。这个标记现在只用在详情头部：tab 已开着时，按钮写「切换到 tab」并带「已打开」提示。
- [x] 「待查看」要不要单独成列：单独成列，跑完未看的和失败的都在这一列。
- [x] 已完成列默认的时间窗口：做成设置项 `board.doneWindow`，默认 24 小时。
