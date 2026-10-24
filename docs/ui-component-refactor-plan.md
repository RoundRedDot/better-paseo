# UI 组件复用与设计统一优化方案

日期：2026-10-24。分析基线：`9707fc06c69babcd866813e32412eaa937a3bece`。

适配复核检查点：`a8689afe2d91d3b66a267afdb5d64dc55c90c5ec`，包含 `62d443ed`、`786d69e6` 的原生工具栏、预览及上下文环变更，以及 `a8689afe` 的纯图标圆按钮与标签恢复测量调整。原始盘点仍属于旧基线；第 3.2 节记录本次增量核验，不表示已按新 HEAD 重审插件全部 UI。

状态：**仅 S0 子任务元数据已实施；S1–S5 均未实施**。2026-10-24 用户授权仅实施子 Agent 列表这一部分并更新相关文档；随后明确思考等级使用小写缩写、“待查看”在所有宽度下都不显示，并授权将完整缩写表用于卡片胶囊与详情 chip，hover 提示不变。实现验收阶段未提交、推送或部署；随后用户已明确授权提交、推送和部署这一版。其他切片仍须另行授权。

## 1. 目标与推荐顺序

面向插件全部 UI 表面建立清晰的组件归属，优先复用重复机制，用少量明确的设计变体统一外观，减少大型功能文件之间的依赖。既有尺寸或颜色不同，不自动构成保持重复的理由；领域行为不同，也不能仅因视觉相似就合并。

推荐顺序：**S0 子任务窄列文字 → S1a 动作归属纯搬迁 → 回归基线确认后单独批准 S1b 共享机制 → S3 基础能力 → 可选 S2 搜索与 S4 元数据标签 → S5 进一步设计统一**。编号表示工作项，不要求按编号执行。视觉变化与行为保持的提取分开交付；不引入新依赖、万能组件、兼容转发链或新的 fallback。

本文中源文件行号是分析基线的定位提示，实施时以符号与最新文件内容为准。当前 [design.md](design.md) 有用户未提交修改，是设计依据，不能用基线版本覆盖。

## 2. 已确认的子任务设计

### 2.1 实施前基线与必须保持的不变量

- [SubtaskRow / SubtaskMetadata](../client/tasks/cards/subtask-row.tsx) 是卡片展开、桌面侧栏、手机详情 sheet 的唯一共享行；容器负责数据适配和导航。
- [ChildMark](../client/tasks/cards/child-mark.tsx) 合并身份与状态。普通 agent 显示品牌；provider-native 子代理显示 TYPE 图标，不显示实时 Read/Bash/MCP 工具执行图标。
- [subagentTypeIcon](../client/tasks/subagent-type.ts) 映射保持：Explore → Search，Plan → ListChecks，general-purpose → Shapes，workflow → Workflow，fork → Split，unknown/claude → Bot。
- 标题保持单行尾部省略；模型、thinking、context 和既有元数据图标保留；触摸／指针度量、行点击与独立跳转行为保持。
- 当前窄列条件为元数据内容列 `0 < width <= 240 * Tasks font scale`。不是整屏宽度：平板宽屏也可能具有窄车道。
- 当前窄列仅隐藏 `Full Access` 文字、保留图标与无障碍名称，并可隐藏 running 开始时间／时长；宽度或字号改变后恢复。
- `786d69e6` 后上下文环使用 `ContextRing variant="subtask"`，固定 12pt 变体，颜色和百分比无障碍文案仍由 SubtaskMetadata 提供。S0 保持此调用，不恢复旧 `size/stroke` API，也不调整颜色阈值。

### 2.2 S0 已实施规则

- 卡片展开、侧栏和详情 sheet 继续共用 SubtaskRow / SubtaskMetadata；标题和元数据各占一行，元数据及内部时间组均不换行，剩余长文字尾部省略。
- 保留内容列 `0 < width <= 240 * Tasks font scale` 窄列规则；另外测量未收起元数据的自然宽度，实际放不下时即收起权限文字。只对精确的 `Full Access`、`Default Permissions` 隐藏文字，保留模式图标和完整无障碍名称；加宽到足以容纳完整内容或减小字号后恢复。`Bypass`、`Allow All`、`Plan Mode` 不在本次文字隐藏范围。
- `unread` 对应的“待查看”／`To review` 在所有宽度下省略，不随加宽恢复；状态仍由身份图标角标及行级无障碍名称表达。仅有 unread、没有其他元数据的子任务不挂载空元数据行。
- 结构化思考等级通过 `cards/format.ts` 的 `formatThinkingLevel` 统一：`none → n`、`minimal → min`、`low → l`、`medium → m`、`high → h`、`xhigh / extra high → xh`、`max → max`，大小写不敏感。应用到子任务行、卡片合并模型胶囊、独立思考胶囊和详情 chip，保留 Brain 图标与完整无障碍名称，hover 提示仍用原始完整等级。未知自定义等级、provider 原始 facts、数据和复制内容保持原样。
- 等待输入、失败提示、完成耗时与时间仍在元数据中；running 开始时间／时长仍只按原窄列条件隐藏。元数据的 240 阈值与详情分区标题的 `NARROW_SUBTASKS = 340` 独立。
- 无障碍名称由调用方拥有：task-card.tsx 已与详情调用方一致，传入“标题 + 本地化状态”；共享行直接使用，不重复追加。未修改 ChildMark 或导航行为，也未新增可聚焦控件。
- 图标、上下文环和缩写后的思考等级不被挤小；不可见测量行只包含文字与占位尺寸，排除辅助技术和触摸命中，不重复真实图标或计时订阅。字号／文案改变时旧测量失效；隐藏权限文字后仍保留完整文字测量，保证宽窄往返恢复。
- `ContextRing variant="subtask"`、12pt 变体与既有颜色阈值保持。只有 runtime 的行在隐藏时继续保留 onLayout 以便加宽恢复；unread-only 不再需要恢复测量。

## 3. 组件目录与 canonical owner

以下是合并盘点后的持久摘要。它覆盖主要注册入口、组件族、局部可见控件及其使用面，不等于每个条件分支都已运行验收。

| 层／领域 | 组件与职责 | 当前 owner／调用面 |
| --- | --- | --- |
| 注册与页面入口 | timeline transformer/renderer、设置、Tasks 屏幕、侧栏和 Command Center 入口 | [index.client.tsx](../index.client.tsx)、[Tasks contribute](../client/tasks/contribute.tsx)、[settings-screen](../client/settings-screen.ts) |
| 基础颜色与文字 | theme tokens、TYPE／UI_SCALE、正文／代码／块字号、Tasks 宿主字体适配 | [theme-tokens](../client/components/theme-tokens.ts)、[typography tokens](../client/ui/tokens/typography.ts)、[Tasks typography](../client/tasks/typography.tsx)、[type-ramp](../client/tasks/type-ramp.ts) |
| 平台与交互机制 | hover、输入能力、reduced motion、选择、容器按钮、细线、安全区 | [client/ui](../client/ui/)；跨领域基础能力，不依赖页面和 Tasks store |
| 动效与状态 | FadeIn、RunningDot、SwitchTrack、ProgressRing；Tasks StatusIcon／SpinnerRing／ContextRing | [ui](../client/ui/)、[status-icon](../client/tasks/cards/status-icon.tsx)、[context-ring](../client/tasks/cards/context-ring.tsx) |
| ContextRing 资源 | card/subtask 两种固定尺寸、101 帧 4x alpha sprite，运行时 tint 与裁剪 | [context-ring-bitmaps](../client/tasks/cards/context-ring-bitmaps.ts) 由 [build-context-rings](../scripts/build-context-rings.mjs) 生成；不手改编码数据，不纳入通用进度环 |
| 身份与标记 | 栅格 BrandMark、ProviderLogo、Tasks BrandMark／PiMark、TagMark、ProjectIcon、ChildMark | [glyph](../client/components/glyph.tsx)、[provider-logo](../client/components/provider-logo.tsx)、[cards](../client/tasks/cards/)；时间线、卡片、筛选和子任务 |
| 行、工具条与复制 | DisclosureHeader／RowIcon／RowText、ToolbarItem／ToolbarButton／ToolbarCopyButton、CopyButton、ToolPager、useCopy／copy-controller | [disclosure-header](../client/ui/disclosure-header.tsx)、[toolbar-button](../client/ui/toolbar-button.tsx)、[copy-button](../client/ui/copy-button.tsx)、[use-copy](../client/ui/use-copy.ts)；时间线、预览、详情 |
| 工具内容 | ToolCallout、ToolBody、ToolPreviewContent、GroupedToolDetails／GroupedPreview、ToolCopyButtons、ToolPreviewActions、CallError／PreviewError、代码路径头 | [tool-callouts](../client/components/tool-callouts.tsx)、[tool-output](../client/components/tool-output.tsx) |
| 代理与领域工具内容 | PaseoToolCallout、创建／发送／操作／状态代理视图、只读权限问答、SubAgentView、目录、HubCallout、GitHubBody | [paseo-tool-callouts](../client/components/paseo-tool-callouts.tsx)、[agent-operation-views](../client/components/agent-operation-views.tsx)、[hub-callout](../client/components/hub-callout.tsx)、[github-body](../client/components/github-body.tsx) |
| 其他时间线内容 | ReasoningCard／ReasoningSections／LongParagraph、TaskList／TaskActivityRow、UserMessage、AssistantFooter／FooterDetails、SystemCard、NoticeCallout | [live-renderers](../client/live-renderers.tsx) 组合 [components](../client/components/) 中的领域渲染器 |
| Markdown、代码与图片 | MarkdownView、CodeBlock、MarkdownCodePreview、SyntaxHighlightBlock、TerminalOutput、MdTable／TableCopyMenu、LocalImage、ImagePreview／ImageMeta、ImageViewer | [markdown](../client/components/markdown/)、[markdown-view](../client/components/markdown-view.tsx)、[syntax-highlight](../client/components/syntax-highlight.tsx)、[image-preview](../client/components/image-preview.tsx)、[image-viewer](../client/components/image-viewer.tsx) |
| 预览与选区 | HoverPreview 一族、PreviewLines、PathText、HScroll、行选择菜单、网页选区操作 | [ui](../client/ui/)；保留各自测量、选择和流式窗口契约 |
| 聊天详情 | DetailsHostSlot、DetailsShell、DetailsHeader、DetailsToolbar、CopyOverflowMenu、RowMenu | [details](../client/details/)；容器、导航、租约与复制溢出，不接管领域正文 |
| Tasks 卡片与详情 | TaskCardView、TaskDetailCards、DetailActionBar、详情 Section／SectionHeading、图表与时间线 | [task-card](../client/tasks/cards/task-card.tsx)、[detail-cards](../client/tasks/cards/detail-cards.tsx)、[detail-charts](../client/tasks/cards/detail-charts.tsx) |
| Tasks 行与元数据 | SubtaskRow／SubtaskMetadata、Pill／CopyPill／PillButton、详情 Chip、身份和状态标记 | [subtask-row](../client/tasks/cards/subtask-row.tsx) 为共享行 owner；元数据标签拟收敛到独立小文件 |
| Tasks 动作 | CardButton、ReadControl、StopControl、RequestButton、OutlineButton、BarButton；ActionRow／useActionFit | [task-card](../client/tasks/cards/task-card.tsx)、[detail-cards](../client/tasks/cards/detail-cards.tsx)、[action-row](../client/tasks/cards/action-row.tsx)；拟建立独立动作叶子 |
| 看板容器与侧栏 | DesktopBoard、PhoneBoard、DetailsSheetBody、DetailsSidebar、StatsCard／StatCell、分组行、车道头 | [board](../client/tasks/board/)；保留过滤、导航、手势和布局职责 |
| 筛选、搜索与菜单 | DesktopToolbar／DesktopFilterBar、跨手机／窄板／原生平板共用的 FilterSheetBody、Segments、RoundButton、HoverPressable、CascadeMenu／MenuRow／MenuSearch、筛选 chip | [filter-bar](../client/tasks/board/filter-bar.tsx)、[filter-sheet](../client/tasks/board/filter-sheet.tsx)、[board-parts](../client/tasks/board/board-parts.tsx)、[menu](../client/tasks/board/menu.tsx)；容器决定入口，BoardController 拥有状态 |
| 通用设置 UI | Section／SectionNote／SettingRow、Toggle、Segmented、PlainButton、字体／字号／配色输入、ResetButton、SettingsPreview | [settings-controls](../client/settings-controls.tsx)、[settings-page](../client/settings-page.tsx)、[settings-preview](../client/settings-preview.tsx) |
| Tasks 设置 | TasksEntrySection、TasksSettingsPanel、PreviewCard、FieldChip、ResetRows、TasksBoardPreview | [tasks-panel](../client/tasks/settings/tasks-panel.tsx)、[board-preview](../client/tasks/settings/board-preview.tsx)；保存经 useTasksForm，预览经 TasksTypography，并复用 [navigation](../client/tasks/board/navigation.ts) 的 laneLayout/LANES |

### 3.1 证据与覆盖限制

已完整阅读三份盘点报告、注册入口、当前设计文档，并对主要收敛候选阅读完整实现及相关依赖：Tasks 卡片／详情动作、子任务行、两处手机搜索、分段控件、设置重置及相关数据 API、图片字节文案、图标前缀、复制按钮、工具条和披露头。相关测试部分全文、部分按用例和关键断言核对，没有执行。

辅助原始盘点保存在本机临时目录，本文不依赖它们才能理解方案；它们不是可长期访问的仓库文档：

- `/tmp/better-paseo-ui-component-audit-k4gnVt/foundations.md`
- `/tmp/better-paseo-ui-component-audit-k4gnVt/timeline-content.md`
- `/tmp/better-paseo-ui-component-audit-k4gnVt/tasks-settings.md`

设置看板预览的当前几何实现已在适配复核中补读；预览拖动／嵌套滚动的实际表现、部分宿主适配、语法着色内部、hub 后续分支及部分详情壳仍未逐分支复核。没有浏览器、原生、视觉或全部运行条件的覆盖证明。若后续切片进入这些区域，应先补齐源码与直接依赖阅读，再确定精确 patch。

### 3.2 已落地适配及其对方案的约束

以下为截至 `a8689afe` 的已提交实现，不是待实施提案。`62d443ed` 的中间工具栏方案先经 `786d69e6` 调整，再由 `a8689afe` 统一纯图标按钮。代码变量 `tablet`／`touch` 在这些入口均为 `Platform.OS !== "web"`，不是 iPad 型号检测或输入能力检测；带触屏的 Web 仍走 Web 分支。实际手机布局由宿主 compact 决定，与窄 DesktopBoard 的 sheet 模式分开。

**圆按钮检查点（`a8689afe`）。** 先前并行修改现已提交：MenuButton 的 `iconOnly` 为 `!!props.compact`，所有平台 compact 均无 chevron、同宽高圆形（radius=size/2），图标为 `round(size/2)` 与 foreground；非 compact 保留圆角6矩形、图标13与 chevron。Web 恢复标签时的测量增量为 `labelWidth + 2*MENU_PADDING + MENU_ICON + MENU_CHEVRON + 2*LABEL_GAP - toolbarButtonSize(scale)`，须包含恢复矩形的完整 chrome，不能只算文字与一个 gap。后续重构保持该已提交契约；平台分支、36/28高度、Modal/controller、预览和环契约不变，不新增切片。

| 提交／owner／符号 | 已实现的不变量 | 影响的切片／回归入口 |
| --- | --- | --- |
| `62d443ed`、`786d69e6`；[filter-bar](../client/tasks/board/filter-bar.tsx) `DesktopFilterBar/MenuButton/toolbarButtonSize` | 原生保留项目、工作区、agent、标签四个图标菜单；按钮不画文字和下拉 chevron，排序同样图标化；尾部排序／归档／更多。Web 保留自动测量折叠与次级控件 | S5 若涉及看板工具栏，先保持明确平台变体；`tasks-board-render.test.ts` |
| 两提交；[desktop-board](../client/tasks/board/desktop-board.tsx) `DesktopBoard`、[filter-sheet](../client/tasks/board/filter-sheet.tsx) `FilterSheetBody/ToggleRow` | 次级选项复用宿主 Modal 中同一 sheet；直接归档开关和 sheet 读写同一 controller；没有第二份平板筛选状态 | S2 的 SheetSearch 已有更多调用面，S3c 保持唯一 switch role；`tasks-board-render.test.ts` |
| `786d69e6`；[details-sidebar](../client/tasks/board/details-sidebar.tsx) `StatCell` | 状态标题不够宽时只隐藏文字，仍保留状态图标、计数和完整行名称；隐藏测量层支持恢复 | 子任务 S0 不复用这套不同测量阈值；`tasks-board-render.test.ts` |
| `786d69e6`；[board-preview](../client/tasks/settings/board-preview.tsx) `TasksBoardPreview`、[tasks-panel](../client/tasks/settings/tasks-panel.tsx) `PreviewCard` | 桌面／平板多车道共用真实 laneLayout，溢出横滚；显式 phone 模式才单车道 tabs；两个预览入口均有 TasksTypography | S0/S1 改卡片时覆盖设置预览；`tasks-settings-preview.test.ts`、`tasks-settings-page.test.ts` |
| `786d69e6`；[context-ring](../client/tasks/cards/context-ring.tsx) `ContextRing`、生成器及 bitmaps、`SubtaskMetadata` | 旧旋转／裁剪 View 弧线替换为固定 card/subtask 栅格变体；只替换几何实现，调用方继续拥有 tint／状态语义 | S0 不退回旧 API；`context-ring-bitmaps.test.ts`、`tasks-cards.test.ts` |

**工具栏与 sheet 契约。** 控件高度为 `taskControlHeight(web ? 28 : 36, scale)`，即 `round(h * max(1, scale))`；所有纯图标菜单同宽高、水平 padding 0、图标 `round(size/2)`、圆角 `size/2`、hairline边框。文字采用 `F.base`（14 authored）经 TaskText 缩放，不保留中间提交的原生 `F.sm`。Web compact 隐藏标签及 chevron；原生即使宽到1600也不恢复标签，且不挂载隐藏文字测量层。菜单 top 使用同一缩放后的按钮高度 `+ 6`，不能提取后固定为34。顶部搜索仍为28基准高度，顶栏48，不能误写成全工具栏36。

原生 chips 不排除 `sub`／`win`，使移入面板的选项仍有可见状态；Web 由自身控件表达这两项，chips 排除它们。更多 badge 用 `activeFilterCount(params, defaults)`：workspace/provider/label 项数、隐藏子任务、非空搜索及非默认 doneWindow；归档、空组、车道宽度和排序不计入 badge。归档来自 `board.showArchived/setShowArchived`，经设备偏好保存，不从过滤参数或局部 sheet state 推导。清除筛选仍保持既有排序／设备偏好语义。

`sheetMode = sidebarMode(boardWidth, previousMode) === "sheet"` 时整条 DesktopFilterBar 隐藏，顶部提供归档和筛选入口；该模式按板宽及760/784滞回决定，**不等于手机 compact**。宿主 Modal 的打开条件为 `(touch || sheetMode) && filtersOpen`，`Modal.Content scrollable={false}`，滚动和底部按钮由 FilterSheetBody 自己负责，Modal 内重新提供 TasksTypography。

| FilterSheetBody 调用面 | showEmptyGroupsToggle | showArchivedToggle | laneWidth |
| --- | --- | --- | --- |
| PhoneBoard 筛选／排序 sheet | true | 省略；归档留在手机顶栏 | 省略，手机单车道无此选择 |
| Web DesktopBoard 窄板 sheet | true | false；归档留在顶栏 | controller 值／setter |
| 原生 DesktopBoard（普通／窄板） | true | true；与直接开关同步 | controller 值／setter |

MenuButton 保留完整 accessibilityLabel 与 expanded；BarSwitch、ToggleRow 保留 switch role、checked 和名称，SwitchTrack 仍只画轨道。S2 提取搜索不得改变上述 props、controller 状态、focus=sort 顺序或宿主 Modal 生命周期。

**侧栏计数与字号。** 本次改的是 `StatCell` 标题适配，不是重做分组计数算法。仅在测得 headingWidth、且 labelSize 的 key 与 `${label}|${scale}` 一致后，按 `labelWidth + 13 + 5 > headingWidth + 0.5` 隐藏标签；透明测量层持续挂载并从无障碍树隐藏，宽度／语言／字号变化后重测恢复。计数仍为 RollingCount（未 ready 为 dash），名称仍包含 label 与 count。状态格最小高度56/64、分组行36/44、分段28/36都继续经 taskControlHeight；分组行 checkbox、计数和点击过滤保持。不得把隐藏计数、缩小字号或子任务240阈值作为替代方案。

**预览布局归属。** `TasksBoardPreview` 使用 `laneLayout(width, order.length, 0, values.board.laneWidth)` 与 `LANES.edge/gap`；没有预览专属的840或每车道210宽度切换算法。非 phone 始终多车道，外层纵向 ScrollView 上限440、内层横向 ScrollView，车道与内容宽度来自同一 layout；归档开启加入第五车道。`PreviewCard` 的 phone 实际为 `look.compact || device === "mobile"`，是展示模式，不是硬件识别。两种 PreviewCard 入口均包 TasksTypography；标题用 laneTitle、header 高36及 phone tab 最小高40经缩放。预览仍是静态样本、冻结时钟与空操作，不引入真实数据订阅。真实看板的滚动容器／虚拟化不因此搬进预览。

**上下文环的有限变体。** API 为 `ratio/color/track/variant?: "card" | "subtask"`，默认 card；card 为14pt、stroke2，subtask 为12pt、stroke1.5。生成器产出0..100共101帧、每帧1逻辑像素 padding、4x PNG alpha mask；从12点顺时针、圆端帽，100为完整圆。运行时把有限 ratio clamp 到0..1后 round 百分比选帧；track 始终使用100帧、fill 在大于0时绘制，以 Image tintColor 分别着色，裁剪在 size×size 内。不要补新 fallback 或恢复任意 size/stroke。

环自身隐藏于辅助技术，百分比仍由父元数据／卡片读出；主题切换只改变 tint，不重生成位图。子任务调用方仍按 `>=0.75` warning、`>=0.9` danger；主环辅助函数 `contextRingTone` 为 `>=70%` warning、`>90%` danger，不能借图形共享顺手统一阈值。生成归属在 `scripts/build-context-rings.mjs`（resvg／ImageMagick 开发工具），编码资源不手改，也不新增运行时依赖。新 bitmaps 测试核验尺寸、方向、透明中心／边界与抗锯齿 alpha，不证明 iPad tint、DPR采样或裁剪的实际视觉质量。

## 4. 优先收敛矩阵

收益是架构判断，未测量净删行数、包体或性能；不以减少文件数作为成功指标。

| 优先级／对象 | 成对定位证据 | 目标与收益 | 差异、风险与审批边界 |
| --- | --- | --- | --- |
| P0 子任务窄列 | `subtask-row.tsx:119,148`；`child-mark.tsx:33` | 唯一共享行落实第 2.2 节，三处入口一致 | 已要求的视觉变化；保留状态语义、完成信息及宽度恢复 |
| P1 动作组件归属 | `detail-cards.tsx:44` 导入 `task-card.tsx:1576,1593,1617` 的 helper／按钮 | 新建 `cards/action-style.ts`、`cards/action-buttons.tsx`，解除详情对大型卡片文件的依赖 | 第一片只迁移，不改动作顺序、尺寸或状态机 |
| P1 动作共享机制（有门槛） | `task-card.tsx:1617,1708,1813`；`detail-cards.tsx:542,1355,1534` | 按第 4.3 节已证明的公共内容／状态提取，保留外层 Pressable | 矩阵和回归基线确认后单独批准 S1b，不自动升级为万能 ActionContent |
| P2 手机搜索（可选后续） | `phone-board.tsx:360`；当前 `filter-sheet.tsx` 的 SheetSearch | 新建 `board/search-field.tsx`，统一小型视觉骨架，收益主要是后续设计维护一致性 | 输入属性见第 4.4 节；重复量有限，键盘风险较高，因此晚于基础能力，不增加产品问题 |
| P1 图标前缀 | `disclosure-header.tsx:115`；`details-header.tsx:145` | 新建 `components/mark-icon.tsx`，统一 brand/provider 前缀渲染 | 普通行仍用宿主 Icon，磁贴仍用 Glyph；不得从披露头大文件分享 helper |
| P1 图片字节 | `image-preview.tsx:91`；`tool-callouts.tsx:623` | 新建纯 `components/image-format.ts`，共享 `formatImageBytes(bytes)` | `1536 → 2 KB` 保持；不采用摘要的 `1.5 KB`，不改变两处零字节显示条件 |
| P1 减弱动效 | `switch-track.tsx:30`；现有 `ui/tokens/motion.ts`、`use-reduced-motion.ts` | 轨道接入已有 reduced-motion 能力 | 明确的可访问性修正，独立于纯提取；处理中途设置变化与动画停止 |
| P2 元数据标签 | `task-card.tsx:1338,1357,1381`；`detail-charts.tsx:514` | 新建 `cards/metadata-chip.tsx`，统一 leading＋文本与命名度量；Chip 不再寄居图表文件 | CopyPill／PillButton 保留外层行为；card/detail 样式先保持，之后再统一设计数值 |
| P2 分段选择 | `settings-controls.tsx:65`；`board-parts.tsx:96` | 统一单选语义与渲染骨架，保留 settings/board 命名外观 | 看板缺少设置版 checked／组标签契约；修正为行为改进。颜色、等宽规则另审 |
| P2 权限图标 | `task-card.tsx:1289`；`detail-cards.tsx:489` | 同一 permission.kind 使用一份域内映射 | plan、mode 当前图标不同；需确认目标，不能当作纯重构 |
| P3 重置确认 | `settings-page.tsx:478`；`tasks/settings/tasks-panel.tsx:292` | 确认统一交互后共享确认 UI | 聊天四秒二次点击；Tasks 可取消、无倒计时。保存与恢复领域逻辑不合并 |
| P3 工具条／复制外观 | `copy-button.tsx:31`；`toolbar-button.tsx:391` | 先统一设计契约，再按需要提取轻量动作外观 | 已共享 useCopy；tooltip、溢出注册、文字标签、卸载后复制各有差异 |

### 4.1 提取中容易发生的隐性变化

- 着色归一化明确保留在 RowIcon 调用方：`currentColor` 对 brand 转为 `#94a3b8`，对 provider 传 `undefined`。叶子仅接收已决定的 brandColor/providerColor；TileIcon 两者都传入具体 color。普通 Icon／Glyph 分支及包装层保持，不把行的上下文语义移入叶子。
- ImageMeta 当前以 truthy 条件省略零字节，图片菜单以非 null 条件显示 `0 B`。只共享格式化函数，不顺手改调用条件、宽高或扩展名顺序。
- CardButton、ReadControl 的 compact 高度处理及外部间距不完全相同；先保持，不能借重构偷偷纠正。若确有视觉缺陷，应另附复现和设计变更。
- OutlineButton 含 hint 度量；BarButton 有底栏布局；StopControl 有分体描边、菜单层级和确认阶段。共享内容和状态接入，不能抹掉容器职责。
- ActionRow 已按顺序折叠完整标签，useActionFit 保留隐藏后的测量并响应文字／字体变化。继续复用，不重写第二份算法。

### 4.2 有实质理由保持分开的部分

- SubtaskRow 是实时 Tasks 导航行；工具正文 SubAgentView 是历史内容展示，不互相替换。
- ProgressRing、ContextRing、SpinnerRing 分别表达进度、上下文占用和忙态；几何、时钟及辅助技术含义不同。ContextRing 已有 card/subtask 有限栅格变体和生成资源契约（第3.2节），不再提出通用 size/stroke 环或与 spinner 合并。
- 推理的流式展开、代码留尾、hub 留头、Markdown 紧凑围栏摘要具有不同数据窗口与持久化规则；不引入万能 Collapse。
- 预览头负责内容操作，详情头负责条目导航和标题；共享叶子，保留容器及租约／手势生命周期。
- 被动元数据 chip、复选字段 chip、可清除筛选 chip 的语义不同；统一视觉词汇，不合成多布尔参数组件。
- 菜单关闭即卸载的复制与常驻按钮复制生命周期不同；网页选区复制还需保留 selection。可继续共用文案或纯机制，不强制套 useCopy 的生命周期。
- Tasks 字号跟随宿主 UI，聊天正文、块字号与代码字号有独立设置；不合并字体来源。

### 4.3 S1 搬迁清单与动作差异基线

S1a 完整迁移符号：`CardButtonLook`、`buttonHue`、`requestLook`、`arrowInset`、`CONFIRM_STOP_ICON`、`CardButton`。同时把 CardButton 必需的私有按钮度量 28/32 和 Web `webTransition` 搬入动作小模块，保留 `background-color, border-color, box-shadow, color, opacity`、`120ms`、`ease-out`。现有卡片其他使用点改读同一动作常量，不搬整个 DESKTOP/PHONE 布局对象。

叶子仅依赖现有 `useHover`、`useActionFit`、`SpinnerRing`、Tasks typography、`buttonOutline`、React/React Native 和必要类型。`action-style.ts`／`action-buttons.tsx` 不得导入或经 barrel 反向导入 task-card/detail-cards，不形成循环；调用方直接导入叶子。该变化改善模块所有权，不承诺包体缩小：Tasks 仍由 `client/tasks/chunk/entry.ts` 作为整体功能 chunk 导出。

下表记录当前源码行为，不判断差异是否理想。`h` 为传入／预设 authored 高度，`scale` 为 Tasks 字号缩放；fit 参数仍使用当前 authored 值，不能擅自替换为视觉缩放值。

| 表面／定位 | 静止底色、图标颜色、过渡 | 尺寸与交互 | busy／内容与 fit chrome |
| --- | --- | --- | --- |
| CardButton `task-card.tsx:1617` | transparent；plain 也用 hue.color；120ms webTransition | desktop 高 taskControlHeight(28)；compact minHeight **原值 32**，minWidth 缩放；圆角 6/7；hover 染色，无独立 pressed 填充 | busy 禁用、opacity .6、spinner、取消 hover；有 answer/arrow，folded busy 才隐藏尾箭头；fit iconWidth 28/32，chrome `2*p + (hasIcon ? size+5 : 0) + 1`，p=10/12，size=13/14 |
| ReadControl `task-card.tsx:1708` | transparent；hue.color；同 webTransition | compact minHeight **taskControlHeight(32)**；desktop 居中 margin 与 line/scale 相关；圆角 6/7；hover 染色 | pending 同 busy；无尾箭头；fit iconWidth 28/32，chrome `2*p + iconSize + 6` |
| StopControl `task-card.tsx:1813` | transparent；danger hue；同 webTransition | compact 最小高度缩放；两个 Pressable 独立 hover；菜单展开也染色 chevron；保留菜单位置、确认图标、共享 .5pt 外描边／分隔线及不裁剪 | stopping 禁用两边，外描边和按钮均 .6；fit iconWidth 为 28/32 + chevronWidth，chrome `2*p + iconSize + 6 + chevronWidth`；compact 确认时 p=10，否则12，desktop p=10；chevron 26/36 |
| OutlineButton `detail-cards.tsx:1355` | card.background；plain leading/spinner 用 foregroundMuted，文字 hue.color；无 webTransition | 高 taskControlHeight(h)、圆角8；hover 染色，busy 取消 hover | busy 禁用／.6；hint 实测宽，尾图标14及弹性 spacer；folded 隐藏 hint，folded busy 隐藏尾图标；chrome=`2*p + leading*15 + hintWidth + trailing*14 + (pieces-1)*gap + 1`，p=10/12、gap=8/6 随 grow，pieces=`1+leading+hint+2*trailing` |
| RequestButton `detail-cards.tsx:542` | card.background；图标 hue.color（包括 plain）；无 webTransition | 高 taskControlHeight(28/36)、圆角6；hover 染色 | **没有 busy**；一个 leading 图标13；fit iconWidth=传入28/36，chrome 固定 `28+13+6+1`；不统一为其他按钮的计算 |
| BarButton `detail-cards.tsx:1534` | card.background；plain 图标/spinner/arrow 用 foregroundMuted；无 webTransition | 高 taskControlHeight(48)、圆角12；**仅 pressed** 染色，无 useHover | busy 禁用／.6，禁止 pressed 填充；folded busy 隐藏箭头；fit iconWidth=48，chrome `32 + ((icon或busy)?26:0) + (arrow?26:0) + 1` |

S1b 必须先把这些差异落实为有意义的回归断言并核对视觉基线，再决定公共内容的最小集合。优先提取已证明一致的 spinner 替换、busy 禁用／透明度和标签测量接入；Request 不获得新 busy 行为，Bar 不获得 hover。各表面继续拥有外层 Pressable、样式和 fit chrome；Stop 的分体／菜单／共享描边保持原组件。若公共内容需要大量布尔参数，缩小提取范围，不强推统一 ActionContent。任何数值或外观统一需另提设计变更。

### 4.4 S2 输入属性契约

| 属性 | 手机顶栏 | SheetSearch |
| --- | --- | --- |
| autoFocus | `searchOpen && !board.params.query` | 原来省略，继续省略 |
| autoCorrect / autoCapitalize | 原来省略，保留宿主默认 | false / none |
| clear | 无 | 非空时显示；只清空值，不额外 refocus；保留 testID/hitSlop |
| outline | 不设置 outlineStyle | Web outlineStyle: none |
| focus / blur | 不新增 sheet 回调 | 保留 searching 状态、异步 scrollTo(workspacesY)、工作区最小高度联动 |
| 共同视觉 | minHeight36、radius18、Search15、缩放字号、returnKeyType search | 同左；外部 marginBottom 等仍归容器 |

共享组件不为行为属性添加覆盖调用方的默认值。保持顶层稳定组件身份，不用 value 作 key，不在 render 内定义组件类型；输入首字或 query 改变不得导致重挂载、再次自动聚焦、丢失输入法组合或软键盘。桌面搜索和 MenuSearch 不在此切片。该项可后置；收益是维护共同视觉，成本是焦点／键盘回归验证，不以几十行去重作为强制理由。

适配后 SheetSearch 也用于原生平板“更多”和 Web 窄板的 FilterSheetBody。S2 仍只提取输入骨架，不另造 TabletFilterSheet；验收须覆盖第3.2节各宿主入口，不能只测 PhoneBoard。

## 5. 目标架构与 API 约束

```text
宿主 SDK ＋ tokens／平台能力
              ↓
client/ui 与小型 components 叶子
              ↓
Tasks／时间线／设置的领域组件
              ↓
卡片、侧栏、sheet、预览和页面容器
              ↓
注册入口
```

这里的箭头表示下层使用上方能力。基础叶子不得导入页面、大型卡片文件或领域 store。

| 新 owner | API 草案／边界 |
| --- | --- |
| `cards/action-style.ts` | 收容第 4.3 节完整样式／常量集合及必要度量；不访问 store，不反向导入卡片或详情 |
| `cards/action-buttons.tsx` | S1a 仅迁移 CardButton；S1b 经差异矩阵验收后提取已证明公共的内部内容／状态，保留有限命名变体和各外层 Pressable，不预设万能 ActionContent |
| `board/search-field.tsx` | 可选后续；受控值与基础视觉骨架，行为属性依第 4.4 节显式传入且不设覆盖默认值；不负责过滤／sheet 滚动 |
| `components/mark-icon.tsx` | 输入 name/size/已归一化 brandColor/providerColor；着色语义留 RowIcon，TileIcon 传具体色；普通图标留调用方，不额外增加 View |
| `components/image-format.ts` | 纯 `formatImageBytes(bytes: number): string`，不导入 React Native 或 ImagePreview |
| `cards/metadata-chip.tsx` | leading/text 与 card/detail 明确变体；复制、展开行为由外层组合 |

分段控件后续可采用小型共享选项骨架，由 settings 与 board 包装提供外观；基础层不依赖 PageLook 或 Tasks tokens。此项需在视觉目标确定后细化 API，避免现在先造抽象框架。

token 以语义用途和表面变体记录。先集中现有值，再单独审议数值统一；相同数字不等于相同设计语义。不新增第二套 theme provider，不为所有历史半径和字号做批量替换。

已落地的复用优先沿用：筛选内容 → FilterSheetBody，车道几何 → navigation.laneLayout，Tasks 字号 → TasksTypography，环资源 → 专用生成器。工具栏 Web／native、预览 phone／非 phone 是有限且有源码依据的变体；不把平台、宿主 compact、板宽 sheetMode 和实际输入能力合并成一个含混的 `mobile` 开关。

## 6. 实施切片与文件所有权

所有权指每片的修改边界，不代表已分配实施 agent。开始每片前检查最新工作区及直接依赖，保留他人修改；重叠文件顺序推进。

| 切片 | 新增／修改文件 | 依赖与行为边界 | 验收与回滚 |
| --- | --- | --- | --- |
| S0 窄列文字与已批准思考缩写 | 修改 `client/tasks/cards/subtask-row.tsx`、`task-card.tsx`、`format.ts`、`detail-cards.tsx`、`detail-charts.tsx`；`test/unit/tasks-cards.test.ts`、`tasks-cards-web.test.ts` | 隐藏规则、行级无障碍和完整缩写表闭环；Chip 只增加可选完整无障碍标签，不做 S4 提取；ChildMark、store/schema 不变 | 已实施：三入口、权限精确模式与实际宽度测量、unread 全宽度省略、行状态名称恰好一次、小写思考缩写；独立撤回 |
| S1a 动作归属 | 新增 `client/tasks/cards/action-style.ts`、`action-buttons.tsx`；修改 `task-card.tsx`、`detail-cards.tsx`；在 `test/unit/tasks-cards-web.test.ts` 补迁移过渡等缺失断言 | 迁移第 4.3 节完整符号、28/32 度量与120ms过渡；无循环／反向导入，不改行为 | 卡片／详情／Stop 回归；确认公共 helper 不再来自 task-card；连同导入迁移撤回 |
| S1b 动作机制（单独批准） | 修改上述动作文件、`task-card.tsx`、`detail-cards.tsx`、`test/unit/tasks-cards.test.ts`、`tasks-cards-web.test.ts`；Stop 专项测试仅有新增断言需求时修改 | 依赖 S1a 及第 4.3 节回归／视觉基线；仅提取已证明公共的内部内容／状态，外层 Pressable 保留 | 全矩阵对照；Request 无 busy、Bar 无 hover、Stop 双按钮／描边／菜单保持；在 S1a 上独立撤回 |
| S2 手机搜索（可选后续） | 新增 `client/tasks/board/search-field.tsx`；修改 `phone-board.tsx`、`filter-sheet.tsx`、`test/unit/tasks-board-render.test.ts` | 按第 4.4 节，稳定输入身份；不动搜索算法／手势状态机 | 输入首字不重聚焦、中文组合、清除不 refocus、sheet 滚动／键盘；组件与迁移一起撤回 |
| S3a 标记路由 | 新增 `client/components/mark-icon.tsx`、`test/unit/mark-icon.test.ts`；修改 `client/ui/disclosure-header.tsx`、`client/details/chrome/details-header.tsx` | RowIcon 负责归一化，叶子只渲染；普通 Icon/Glyph 不变 | 新用例及现有 details-chrome、quiet-tool-rows、tool-disclosure 测试；独立撤回 |
| S3b 图片格式 | 新增 `client/components/image-format.ts`、`test/unit/image-format.test.ts`；修改 `image-preview.tsx`、`tool-callouts.tsx` | 纯文案去重；不改零值条件 | 边界数值及两调用面元信息；独立撤回 |
| S3c 减弱动效 | 修改 `client/ui/switch-track.tsx`；新增 `test/unit/switch-track.test.ts` | `motionDuration(140, reduced)`，不是 duration.fast 的120；effect 响应 reduced，cleanup stop；不新增 switch role（仍在 Toggle/ToggleRow） | 普通140ms、减弱即时到位、中途更新、卸载停止、外层角色唯一；独立撤回 |
| S4 元数据标签 | 新增 `client/tasks/cards/metadata-chip.tsx`；修改 `task-card.tsx`、`detail-cards.tsx`、`detail-charts.tsx`、`test/unit/tasks-cards.test.ts` | S1 后推进；只是 owner 整理，详情仍为图表导入 detail-charts，不能宣称消除此依赖 | card/detail 变体尺寸、截断、复制／展开、主题／字号；独立撤回 |
| S5 进一步设计统一 | 分段：`settings-controls.tsx`、`board/board-parts.tsx` 及新增小型叶子；权限：`cards/task-card.tsx`、`detail-cards.tsx` 及域内映射；重置：`settings-page.tsx`、`tasks/settings/tasks-panel.tsx` 及确认 UI | 三项分别审批目标并细化文件／测试，不能以本计划授权直接批量改动 | 每项独立 patch、视觉基准和语义测试，分别可回滚 |

S0、S1、S4 共享卡片源码／测试，应串行。S2、S3 的生产文件互不重叠，可在独立边界下推进；文档统一收尾，不能多人覆盖 `design.md`。以上仅描述可拆分性，不启动并行 agent。

适配复核不新增切片或扩大首批写入集。S0 保留当前 `variant="subtask"`；S1a 迁移的是卡片动作，不能套用新工具栏的36高度。既有 toolbar／preview／sprite 文件只作为回归依赖；回滚每片只撤回该片，不能回退 `62d443ed`／`786d69e6` 的适配实现。

## 7. 首批验收清单

原首批建议为 **S0 → S1a**；当前只授权并实施 S0，S1a 及以后均未开始。以下保留后续整体计划的文件集合，不代表本轮写入范围：

- 新增 `client/tasks/cards/action-style.ts`、`client/tasks/cards/action-buttons.tsx`。
- 修改 `client/tasks/cards/subtask-row.tsx`、`task-card.tsx`、`detail-cards.tsx`。
- 修改 `test/unit/tasks-cards.test.ts`、`test/unit/tasks-cards-web.test.ts`。
- 必跑已有 `test/unit/tasks-stop-control.test.tsx`；只有确需新增断言时才将其加入写入集，运行已有测试不等于修改该文件。
- 本轮只增量更新 `docs/design.md` 的共享子任务段及本文 S0 状态，保留已有未提交文档改动；S1 动作归属留待后续。

### 7.1 单测与静态检查

- S0 参数化覆盖 card/sidebar/sheet；列宽 240、241 及按字号缩放的对应边界；宽度为 0 时不提前隐藏。
- 精确覆盖 Full Access、Default Permissions 的隐藏与 Bypass、Allow All、Plan Mode 的保留；unread、running、needs_input、failed、done 的状态／时间保留规则分别断言，不用分区340阈值替代元数据列测量。
- “待查看”／`To review` 在所有宽度下不可见；三处行名称分别精确等于“标题 待查看”／`标题 to review`，状态部分恰好一次。共享行不得二次拼接，卡片调用方不再 title-only。
- 验证没有新 layout 事件时字号变化更新阈值；runtime-only 隐藏时保留测量并能加宽恢复。unread-only 不挂载空行；思考等级缩写为 `n`／`min`／`l`／`m`／`h`／`xh`／`max`，保留完整无障碍名称和完整 hover 提示。另测宽度高于阈值但内容放不下时收起权限文字。
- S1a 验证28/32、compact 未缩放32与其他缩放值、Web120ms过渡完整搬迁且无反向依赖。S1b 门槛测试逐项覆盖第4.3节底色、plain图标、hover/press、busy、hint/arrow、fit chrome；不把仅测工具栏的 tasks-label-fit 当作 useActionFit 证明。
- Stop 专项 `tasks-stop-control.test.tsx` 维持共享外描边、独立 hover、菜单不裁剪、stopping 两边禁用及描边变淡。
- 图片格式至少覆盖 `0`、`1023`、`1024`、`1536`、`1048576`，并在调用面确认零值条件未变化。
- 对每片运行相关用例与 `npm run typecheck`；集成阶段再运行与最终改动范围匹配的测试。构建／Hermes 检查在后续实施阶段按项目要求执行，不属于此次文档任务。

建议首批命令（S0 本轮执行结果见第 11 节；后续切片仍须重新验证）：

```bash
npm run test -- test/unit/tasks-cards.test.ts test/unit/tasks-cards-web.test.ts test/unit/tasks-stop-control.test.tsx
npm run typecheck
```

当前适配的集成回归入口（后续实施阶段按影响执行；已有测试无需为“纳入验证”而修改）：

```bash
npm run test -- test/unit/tasks-board-render.test.ts test/unit/tasks-settings-preview.test.ts test/unit/tasks-settings-page.test.ts test/unit/context-ring-bitmaps.test.ts test/unit/tasks-cards.test.ts
```

这些测试在两次适配提交中已有新增或调整，本次仅审阅，未执行；不能沿用提交信息或断言存在来宣称通过。

### 7.2 浏览器／桌面验收

检查明暗主题、长中文与英文、正常及放大宿主字号、宽窄切换、hover、键盘焦点、动作折叠与停止菜单。子任务三个入口均应保持标题省略、状态角标和导航行为。确认未增加嵌套交互元素或普通行额外包装。

### 7.3 原生与视觉验收

至少包含截图类似的平板窄车道，而非只用手机全屏；检查触摸目标、长按、手机详情 sheet、系统字号。S0 在 VoiceOver／TalkBack 核验行名称与状态实际播报，单测属性断言不能替代。S2 另验搜索首字／中文输入法组合、软键盘、清除及滚动联动。S3c 在真实系统设置中途开关减弱动效，核验停止／即时到位。

同一数据、主题、字号、宽度下做前后截图比较。S0 允许指定文字变化，S1 机械提取不允许无说明的尺寸／间距／颜色变化。若缺设备，原生项记为“未验证”，不由 mock 或网页结果代替。

各层分别记录 revision、命令、结果与缺口；单测、类型检查、浏览器、原生、视觉不可合并成一个 pass。

### 7.4 适配后的回归矩阵

以下是现有契约的保护范围，不是新增 UI 功能或新切片。单测用于验证分支／状态／几何，浏览器与设备验收用于验证实际交互和渲染。

| 维度 | 应保持的结果／关键边界 | 证据入口与尚需验收 |
| --- | --- | --- |
| Web 桌面／窄板 | 四菜单测量折叠与恢复；compact 无chevron圆形，非compact恢复矩形标签及chevron；次级控件可见；760/784附近进出 sheet 的滞回，顶部归档仍可用 | `tasks-board-render.test.ts`；浏览器宽窄切换、完整chrome恢复测量、菜单遮挡与锚点 |
| 原生非 compact 看板 | iOS/Android、板宽800/1200/1600：四图标不带标签／chevron，尾部排序归档更多；高度按36缩放，菜单 top 同高度+6 | `tasks-board-render.test.ts`；iPad分屏／侧栏开合／横竖屏、触摸目标、更多面板实际打开与关闭 |
| 筛选一致性 | provider/label/workspace 菜单可选择；sub/win chip 可见；badge 按 activeFilterCount；归档从直接入口到 sheet／设置页同步，空组和laneWidth不创建第二状态源 | `tasks-board-render.test.ts`、`tasks-settings-page.test.ts`；真实宿主 Modal、sheet滚动、关闭重开 |
| 语言／主题／字号 | en/zh、明暗、UI字号14/21及运行时修改；TaskText和控件尺寸各按其规则缩放；StatCell藏标签后计数／a11y名称仍在，再变宽恢复 | `tasks-board-render.test.ts`；真实字体测量、VoiceOver/TalkBack和放大字号布局 |
| 设置预览 | 非phone在600/800窄容器仍多车道；narrow/default/wide改变真实laneLayout，归档第五车道；phone展示模式才tabs；内联和独立预览都响应字号 | `tasks-settings-preview.test.ts`、`tasks-settings-page.test.ts`；横向＋纵向嵌套滚动、旋转、归档切换后最后车道可达 |
| ContextRing | card/subtask，0/1/50/99/100与clamp/round边界；空帧无fill、track完整，主题tint分别生效；圆端帽、透明中心、padding防串帧 | `context-ring-bitmaps.test.ts`、`tasks-cards.test.ts`；iPad/Android/Web不同DPR实际采样、遮罩／裁剪／边缘，不以PNG解码单测替代 |
| 子任务与动作 | S0指定窄列文字变化，其余标题／角标／上下文环／等待失败／完成时间保持；缩放和车道改宽后恢复；S1a动作外观不变 | `tasks-cards.test.ts`、`tasks-cards-web.test.ts`、`tasks-stop-control.test.tsx`；卡片／侧栏／sheet及设置样本前后截图 |

规划阶段尚无浏览器、iPad、Android或辅助技术运行证据；S0 本轮离线浏览器结果见第 11 节，真机与辅助技术仍未验证。需要记录具体宿主版本、构建revision、设备／DPR、窗口宽度、主题与字号；没有设备的项目保留“未验证”。

## 8. 后续产品决策

以下不阻塞首批：

1. 重置是否统一为显式“确认＋取消”，替代聊天设置的四秒二次点击。领域恢复逻辑保持各自所有权：Tasks 保留 enabled 状态及设备／共享设置边界，聊天偏好保留自己的恢复入口。
2. 同一种 permission.kind 在卡片和详情采用哪套图标。
3. 分段控件与复制／工具条按钮是否进一步统一 selected、hover、反馈颜色及文字提示外观。

窄列文字规则已明确，无须再次决定；代码组织、有限 API 和纯 helper 提取属于实施选择，不额外制造产品审批问题。

## 9. 文档维护与实施批准边界

[design.md](design.md) 继续拥有设计规范；本文拥有重构顺序、证据与验收边界。后续在用户现有修改上追加窄列规则、动作变体和字号边界，逐段审阅，不从 HEAD 还原或整篇重写。

当前未提交的 design.md 已有设备端四项偏好、车道宽度算法和分组行36/44规则，无需重复创建。后续规范整理只补缺失契约：工具栏 Web28／native36与原生图标菜单／共享筛选面板（现有 pills 表28须限定Web）、StatCell标题测量恢复、预览复用真实车道及TasksTypography、ContextRing有限栅格变体与生成归属。子任务已有75/90颜色规则保持。S0 本轮已将单行布局、权限折叠、unread 全宽省略和完整思考缩写表同步至 design.md；其余规范整理未实施。

组件目录当前内联于本文，已提供仓库相对链接。如长期维护需要，可另提取为 `docs/component-catalog.md` 并由设计文档引用；不为完成此次规划额外创建第二份目录。新增组件应记录 owner、使用面、允许变体、不可变行为和验收入口，避免逐行复制实现。

后续切片批准实施前仍须核对精确文件集合、视觉变化及其余行为保持承诺。当前授权仅覆盖 S0 与追加的思考胶囊缩写，不包含提交、推送、安装或部署。

## 10. 评审处理与分析记录（规划阶段历史）

本次完整阅读两份独立评审并核对当前相关定义。采纳的规格补充包括：S0 调用方无障碍所有权与写入集、S1a 传递依赖搬迁、S1b 源码差异矩阵及独立门槛、Stop 专项回归、S2 输入属性表、S3 着色／动效边界。原已要求的 unread-only 测量存活与恢复进一步细化，并非新增需求。S2 的优先级分歧按收益／键盘风险判断为可选后续，不新增产品决策；设备和运行时缺口继续保留。

- 规划模型：`gpt-6-astra`，thinking `medium`，由父级运行时查询确认。
- 原始只读分析时段：2026-10-24 12:50:39–12:56:36，Asia/Singapore；后续保存将已确认要求整理为本文。
- 源码分析使用文件阅读、定向检索、只读 Git 状态／HEAD 查询；没有运行构建、测试、安装、格式化或设备操作。
- 初次保存前仅有 `docs/design.md` 修改；先前评审修订时还存在工具栏等未提交修改。其后相关适配已进入 `62d443ed`／`786d69e6`，不能继续把这些文件描述为当前脏文件。
- 适配补充开始时 HEAD 为 `786d69e6b5bd5f4f9945e85f8974ffa064b61d53`；当前另有 `docs/design.md` 与 `client/components/provider-logo.tsx` 修改，本文未跟踪。provider-logo 的差异仅为 Antigravity 品牌色 `#00B95C` → `#3186FF`，与此次平板布局／环资源无直接关系，明确排除；不修改、不暂存、不还原。
- 交付回读时出现的 `client/tasks/board/filter-bar.tsx`、`test/unit/tasks-board-render.test.ts` 并行差异随后已提交为 `a8689afe`；已只读核对该提交并同步第3.2节的圆按钮和标签恢复契约，没有编辑这些文件。首批 S0→S1a 不写它们，后续涉及工具栏时仍须核对最新版本。
- 本次检查两提交全部文件差异及相关完整生产源码，含 filter-bar、desktop-board、filter-sheet、details-sidebar、board-preview、tasks-panel、context-ring、subtask-row、生成脚本及几何／字号／controller依赖；生成文件核对结构和元数据，base64载荷未作解码或视觉验证。相关新增／调整测试仅阅读差异；不是全测试文件的重新审计。
- 当前 SheetSearch 输入契约仍符合第4.4节；表中原始行号仍属历史定位，以当前符号和第3.2节检查点为准。不把适配作者的代码纳入此次文档写入；后续动工前再次核对最新定义与占用。
- 文档交付只进行内容回读、`git diff --check` 和只读状态检查。执行结果在交付回复中记录；本文不预先声明任何检查通过。
- 未验证：实现正确性、运行时覆盖、视觉结果、设备行为、性能与包体收益。所有方案收益均为待实施验证的判断。

## 11. S0 实施与验收记录（2026-10-24）

本轮基线为 `4b30fa38`，实施验收基于其上的工作区改动，最终交付 SHA 以 Git 提交记录为准。只实施第 2.2 节以及用户追加批准的完整思考缩写与卡片／详情胶囊显示；S1–S5 均未开始。

- 生产文件：`cards/subtask-row.tsx`、`task-card.tsx`、`format.ts`、`detail-cards.tsx`、`detail-charts.tsx`。共享 formatter 只处理可见思考等级；Chip 仅新增可选无障碍名称参数。未新增依赖，没有 store/schema、动作组件迁移或导航变更。
- 文档：增量更新 `docs/design.md` 的完整缩写表和共享子任务规则，以及本文的状态、范围和验收结果；保留原有未提交的设计内容。本文第 10 节保留规划阶段历史记录，不代表本轮实施状态。
- 单测：以下 6 个文件共 **383 tests passed**。覆盖卡片／侧栏／sheet、中英文、0/180/240/241/300/400 宽度、字号切换、权限精确匹配与实际内容超宽、宽窄恢复、计时 tick 不闪回权限文字、unread 全宽省略与 unread-only 无空行、完整缩写表、未知等级、原始无障碍名称和合并／独立胶囊 hover 原文。测试运行出现 React `act(...)` 提示；没有失败用例。

```bash
npm run test -- test/unit/tasks-cards.test.ts test/unit/tasks-cards-web.test.ts test/unit/tasks-stop-control.test.tsx test/unit/tasks-subagent-type.test.ts test/unit/tasks-board-render.test.ts test/unit/tasks-settings-preview.test.ts
npm run typecheck
npm run build:client
npm run check:hermes
```

`typecheck`、client build、Hermes 源码／已构建 bundle 与 Tasks chunk 编译和 stock/sticky host 加载检查均通过。最终构建 Tasks chunk 为 `1e721c3cff8e4d4d`；这些检查不等于原生视觉或设备交互验收。

离线浏览器验证：Google Chrome `156.0.8078.48`，viewport `900×1100`，DPR 2；使用真实 SubtaskRow 和 MARK_BITMAPS，浅／深主题、UI 字号 14/21、内容列约 178/238/239/298/398px，共 20 组。逐组验证高度为一行、无横向溢出、`m` 完整显示、“待查看”不可见；每种主题再实际加宽／缩窄，确认权限文字恢复／收起。页面无运行异常，已查看两张实际截图。临时预览脚本、结果与截图位于 `/tmp/better-paseo-subtask-check.mjs`、`/tmp/better-paseo-subtask-layout.json`、`/tmp/better-paseo-subtasks-{light,dark}.png`，不是提交产物。

未验证：真实 iPad／Android 渲染、VoiceOver／TalkBack 实际播报、已安装宿主中的交互与部署效果、性能收益。上述验证阶段没有提交、推送、安装、reload 或部署；后续按用户明确授权执行提交、推送和锁定 SHA 的插件部署，结果以交付回读为准。
