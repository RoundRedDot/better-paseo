# UI 组件复用与设计统一优化方案

日期：2026-10-25。原始盘点基线 `9707fc06`，平板适配检查点 `a8689afe`，S0 与首轮重构候选基线 `45064c6b`。本次全局复核固定截止 `08f2bbb3a248a3ab629218dace7a0ebf56c2b287`；`7113c24f` 为前次检查点。新增单行平板工具栏、居中计数、首条消息搜索、Space预览、详情分栏／消息时间与父任务标记均属已提交功能共同基线。并行提示层另列，旧盘点及候选01证明不自动覆盖新版本。

**状态：S0 已提交；S1a、S3a/S3b/S3c 冻结为 candidate02（第7.1节），2026-10-25 Mac Studio 有限 A/B 验收完成，未发现 candidate 独有回归（第9.2节），尚未提交；S1b 本轮不实施，S2/S4 暂缓（第7.2节）。** 用户已授权推进重构，本轮只重新审视并更新本文，不重复请求已有实施授权。未提交的侧栏／提示层交互修改与重构候选分别管理；新增视觉或产品行为需单独说明，不能混入机械搬迁。

## 1. 目标与当前推荐

面向插件全部 UI 建立清晰的组件归属，复用重复机制，用少量明确变体统一设计。此次新增代码已完成有价值的领域收敛：`BoardEmptyState` 共享空态，`SubtaskPanel` 拥有卡片子任务展开，`SubtaskRow` 继续覆盖卡片／侧栏／sheet，`boardLaneLayout` 统一真实看板与预览几何。直接沿用这些 owner，不再创建同类组件。

推荐顺序调整为：**整合 S1a＋S3 已写实现与最新交互 → 在 Mac Studio 验收新的冻结候选 → 按证据决定有限的 S1b → 可选 S4／S2 → 独立的 S5 产品设计项**。不因为新增功能而新增一批重构任务；当前最有价值的是解除大型文件反向依赖并保护共享行、提示和输入生命周期。S1b 不是自动执行的万能按钮工程，S2 搜索去重的收益尚不足以优先承担输入法与焦点风险。

[design.md](design.md) 是设计规范 owner；本文负责组件目录、切片、证据与验收边界。以下旧行号仅作历史定位，新增检查点以文件和符号定位为准。此次只写本文，保留所有并行改动。

## 2. 已确认的子任务设计

### 2.1 共享边界

[SubtaskRow / SubtaskMetadata](../client/tasks/cards/subtask-row.tsx) 是三入口唯一行实现；容器拥有排序、展开、数据和导航。[ChildMark](../client/tasks/cards/child-mark.tsx) 合并普通 agent 品牌或 provider-native 子代理 TYPE 图标与状态角标。类型映射仍归 [subagentTypeIcon](../client/tasks/subagent-type.ts)：Explore→Search、Plan→ListChecks、general-purpose→Shapes、workflow→Workflow、fork→Split，其余→Bot；不替换为实时执行工具图标。

`34893418` 后独立 jump 位于内容列右上方，只给标题预留目标宽度＋8，元数据使用完整内容列宽；跳转目标的 **width 为 pointer 22／touch 32，height 为当前 line**，并非22／32正方形；行导航保持。不能恢复旧的“跳转单独占满高第三列”，否则重新挤压元数据。当前 `subtask-row.tsx:46` 是几何 owner。

### 2.2 当前已实施规则（后续重构不变量）

- 卡片展开、侧栏和详情 sheet 继续共用 SubtaskRow / SubtaskMetadata；标题和元数据各占一行，元数据及内部时间组均不换行，剩余长文字尾部省略。
- 保留内容列 `0 < width <= 240 * Tasks font scale` 窄列规则；另外测量未收起元数据的自然宽度，实际放不下时即收起权限文字。所有 permission/mode（包括 `Full Access`、`Default Permissions`、`Bypass`、`Allow All`、`Plan Mode` 及自定义模式）统一隐藏文字，保留模式图标和完整无障碍名称；加宽到足以容纳完整内容或减小字号后恢复。此条根据部署后的截图反馈修订，不再维护模式白名单。
- `unread` 对应的“待查看”／`To review` 在所有宽度下省略，不随加宽恢复；状态仍由身份图标角标及行级无障碍名称表达。仅有 unread、没有其他元数据的子任务不挂载空元数据行。
- 结构化思考等级通过 `cards/format.ts` 的 `formatThinkingLevel` 统一：`none → n`、`minimal → min`、`low → l`、`medium → m`、`high → h`、`xhigh / extra high → xh`、`max → max`，大小写不敏感。按最新反馈仅在子任务整行完整元数据的实测自然宽度超出内容列时缩写，宽度足够时显示并恢复原始完整等级；不能直接套用权限文案的 240 阈值。没有 modeLabel 的思考等级行也测量完整文本，缩写期间继续保留完整文本测量以避免往返振荡。卡片合并模型胶囊、独立思考胶囊和详情 chip 恢复原始完整等级。保留 Brain 图标与完整无障碍名称，hover 提示仍用原始完整等级。未知自定义等级、provider 原始 facts、数据和复制内容保持原样。
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
| Markdown 单块选择 | iOS BlockSelection／BlockCopyMenu；MdBlock决定eligible，IOSProse协调原生selectable与链接 | [block-selection](../client/components/markdown/render/block-selection.tsx)、[md-block](../client/components/markdown/render/md-block.tsx)、[prose](../client/components/markdown/render/prose.tsx)；复用useCopy／useScrollDismiss／FLOAT，保留表格与Web选区owner |
| 预览与选区 | HoverPreview 一族、PreviewLines、PathText、HScroll、行选择菜单、网页选区操作 | [ui](../client/ui/)；保留各自测量、选择和流式窗口契约 |
| 聊天详情 | DetailsHostSlot、DetailsShell、DetailsHeader、DetailsToolbar、CopyOverflowMenu、RowMenu | [details](../client/details/)；容器、导航、租约与复制溢出，不接管领域正文 |
| Tasks 卡片与详情 | TaskCardView、TaskDetailCards、DetailActionBar、详情 Section／SectionHeading、图表与时间线 | [task-card](../client/tasks/cards/task-card.tsx)、[detail-cards](../client/tasks/cards/detail-cards.tsx)、[detail-charts](../client/tasks/cards/detail-charts.tsx) |
| Tasks 行与元数据 | SubtaskRow／SubtaskMetadata、Pill／CopyPill／PillButton、详情 Chip、身份和状态标记 | [subtask-row](../client/tasks/cards/subtask-row.tsx) 为共享行 owner；标签 owner 整理为可选后续 |
| Tasks 动作 | CardButton、ReadControl、StopControl、RequestButton、OutlineButton、BarButton；ActionRow／useActionFit | [task-card](../client/tasks/cards/task-card.tsx)、[detail-cards](../client/tasks/cards/detail-cards.tsx)、[action-row](../client/tasks/cards/action-row.tsx)；工作区已迁移 CardButton 至 [action-buttons](../client/tasks/cards/action-buttons.tsx)、样式至 [action-style](../client/tasks/cards/action-style.ts)，待验收 |
| 车道宽度与工具栏适配 | LaneWidthMark 三种域内几何，Segments／菜单共享；useLabelFit 测量、nextBarLayout 决策 | [lane-width-mark](../client/tasks/board/lane-width-mark.tsx)、[label-fit](../client/tasks/board/label-fit.ts)、[filter-bar](../client/tasks/board/filter-bar.tsx)；已提交，不另造responsive框架 |
| Tasks滚动与详情顺序 | detailScrollProps、useLaneScrollbar供详情／看板／筛选sheet复用；detailSections决定分区顺序 | [detail-scrollbar](../client/tasks/cards/detail-scrollbar.ts)、[lane-scrollbar](../client/tasks/board/lane-scrollbar.ts)、[detail-model](../client/tasks/cards/detail-model.ts)；UI不复制排序或第二套滚动条 |
| 看板容器与侧栏 | DesktopBoard、PhoneBoard、DetailsSheetBody、DetailsSidebar、StatsCard／StatCell、分组行、车道头 | [board](../client/tasks/board/)；保留过滤、导航、手势和布局职责 |
| 筛选、搜索与菜单 | DesktopToolbar／DesktopFilterBar、[TabletToolbar](../client/tasks/board/tablet-toolbar.tsx)、跨手机／窄板／原生平板共用的 FilterSheetBody、Segments、RoundButton、HoverPressable、CascadeMenu／MenuRow／MenuSearch、筛选 chip | [filter-bar](../client/tasks/board/filter-bar.tsx)、[filter-sheet](../client/tasks/board/filter-sheet.tsx)、[board-parts](../client/tasks/board/board-parts.tsx)、[menu](../client/tasks/board/menu.tsx)；容器决定入口，BoardController 拥有状态 |
| 通用设置 UI | Section／SectionNote／SettingRow、Toggle、Segmented、PlainButton、字体／字号／配色输入、ResetButton、SettingsPreview | [settings-controls](../client/settings-controls.tsx)、[settings-page](../client/settings-page.tsx)、[settings-preview](../client/settings-preview.tsx) |
| 聊天设置预览 | SettingsPreview 直接组合 ToolCallout、ToolPreviewContent、ReasoningCard、TaskList、UserMessage、MarkdownView、AssistantFooter；关闭增强时用模拟宿主气泡／回复 | [settings-preview](../client/settings-preview.tsx)；不等于真实宿主时间线，也不等于 TasksBoardPreview |
| Tasks 设置 | TasksSettingsPanel、PreviewCard、FieldChip、ResetRows、TasksBoardPreview | [tasks-panel](../client/tasks/settings/tasks-panel.tsx)、[board-preview](../client/tasks/settings/board-preview.tsx)；保存经 useTasksForm，预览经 TasksTypography，并复用 [navigation](../client/tasks/board/navigation.ts) 的 boardLaneLayout/LANES |

搜索领域 owner 为 [search.ts](../client/tasks/data/search.ts) 的纯匹配、[search-first-prompts.ts](../client/tasks/data/search-first-prompts.ts) 的读取队列以及 first-prompt/subagent-timeline 共享缓存；use-board 组合数据，board-screen 展示覆盖提示。卡片焦点与预览选择归 DesktopBoard，DOM 能力归 [web.ts](../client/web.ts)，不由按钮叶子或搜索输入管理。

### 3.1 证据与覆盖限制

已完整阅读三份盘点报告、注册入口、当前设计文档，并对主要收敛候选阅读完整实现及相关依赖：Tasks 卡片／详情动作、子任务行、两处手机搜索、分段控件、设置重置及相关数据 API、图片字节文案、图标前缀、复制按钮、工具条和披露头。相关测试部分全文、部分按用例和关键断言核对，没有执行。

辅助原始盘点保存在本机临时目录，本文不依赖它们才能理解方案；它们不是可长期访问的仓库文档：

- `/tmp/better-paseo-ui-component-audit-k4gnVt/foundations.md`
- `/tmp/better-paseo-ui-component-audit-k4gnVt/timeline-content.md`
- `/tmp/better-paseo-ui-component-audit-k4gnVt/tasks-settings.md`

设置看板预览的当前几何实现已在适配复核中补读；预览拖动／嵌套滚动的实际表现、部分宿主适配、语法着色内部、hub 后续分支及部分详情壳仍未逐分支复核。原始盘点没有运行证明；后续 candidate01 的有限浏览器／原生证据见第9.1节，仍无全部条件覆盖。若后续切片进入这些区域，应先补齐源码与直接依赖阅读，再确定精确 patch。

### 3.2 已落地适配及其对方案的约束

以下保留历史适配依据；工具栏当前布局以第3.3节为准，不恢复原生两行布局。`62d443ed` 的中间工具栏方案先经 `786d69e6` 调整，再由 `a8689afe` 统一纯图标按钮。代码变量 `tablet`／`touch` 在这些入口均为 `Platform.OS !== "web"`，不是 iPad 型号检测或输入能力检测；带触屏的 Web 仍走 Web 分支。实际手机布局由宿主 compact 决定，与窄 DesktopBoard 的 sheet 模式分开。

**圆按钮检查点（`a8689afe`）。** 先前并行修改现已提交：MenuButton 的 `iconOnly` 为 `!!props.compact`，所有平台 compact 均无 chevron、同宽高圆形（radius=size/2），图标为 `round(size/2)` 与 foreground；非 compact 保留圆角6矩形、图标13与 chevron。历史单按钮恢复标签时的测量增量为 `labelWidth + 2*MENU_PADDING + MENU_ICON + MENU_CHEVRON + 2*LABEL_GAP - toolbarButtonSize(scale)`，须包含恢复矩形的完整 chrome，不能只算文字与一个 gap；当前整条bar还计入三个分隔符的恢复占宽，见第3.3节。Web菜单保留该契约；原生当前44目标见3.3，Modal/controller、预览和环契约继续保持，不新增切片。

| 提交／owner／符号 | 已实现的不变量 | 影响的切片／回归入口 |
| --- | --- | --- |
| `62d443ed`、`786d69e6`；[filter-bar](../client/tasks/board/filter-bar.tsx) `DesktopFilterBar/MenuButton/toolbarButtonSize` | 历史原生四筛选图标行已被6bcfaac0的单行TabletToolbar替代；Web仍保留测量折叠的DesktopFilterBar。旧36/28度量不可套到新tablet的44目标 | S5 若涉及看板工具栏，先保持明确平台变体；`tasks-board-render.test.ts` |
| 两提交；[desktop-board](../client/tasks/board/desktop-board.tsx) `DesktopBoard`、[filter-sheet](../client/tasks/board/filter-sheet.tsx) `FilterSheetBody/ToggleRow` | 次级选项复用宿主 Modal 中同一 sheet；直接归档开关和 sheet 读写同一 controller；没有第二份平板筛选状态 | S2 的 SheetSearch 已有更多调用面，S3c 保持唯一 switch role；`tasks-board-render.test.ts` |
| `786d69e6`；[details-sidebar](../client/tasks/board/details-sidebar.tsx) `StatCell` | 状态标题不够宽时只隐藏文字，仍保留状态图标、计数和完整行名称；隐藏测量层支持恢复 | 子任务 S0 不复用这套不同测量阈值；`tasks-board-render.test.ts` |
| `786d69e6`；[board-preview](../client/tasks/settings/board-preview.tsx) `TasksBoardPreview`、[tasks-panel](../client/tasks/settings/tasks-panel.tsx) `PreviewCard` | 桌面／平板多车道共用真实 boardLaneLayout，溢出横滚；显式 phone 模式才单车道 tabs；当前仅 Tasks tab 的 PreviewCard 入口提供 TasksTypography（dbf1504a 已删除聊天页内联 Tasks 入口） | S0/S1 改卡片时覆盖设置预览；`tasks-settings-preview.test.ts`、`tasks-settings-page.test.ts` |
| `786d69e6`；[context-ring](../client/tasks/cards/context-ring.tsx) `ContextRing`、生成器及 bitmaps、`SubtaskMetadata` | 旧旋转／裁剪 View 弧线替换为固定 card/subtask 栅格变体；只替换几何实现，调用方继续拥有 tint／状态语义 | S0 不退回旧 API；`context-ring-bitmaps.test.ts`、`tasks-cards.test.ts` |

**工具栏与 sheet 契约。** 控件高度为 `taskControlHeight(web ? 28 : 36, scale)`，即 `round(h * max(1, scale))`；所有纯图标菜单同宽高、水平 padding 0、图标 `round(size/2)`、圆角 `size/2`、hairline边框。文字采用 `F.base`（14 authored）经 TaskText 缩放，不保留中间提交的原生 `F.sm`。Web compact 隐藏标签及 chevron；原生即使宽到1600也不恢复标签，且不挂载隐藏文字测量层。菜单 top 使用同一缩放后的按钮高度 `+ 6`，不能提取后固定为34。顶部搜索仍为28基准高度，顶栏48，不能误写成全工具栏36。

原生 chips 仍不排除 `sub`／`win`，即使子任务开关现已直接显示，也继续保留这些 chips；Web 由自身控件表达这两项，chips 排除它们。更多 badge 用 `activeFilterCount(params, defaults)`：workspace/provider/label 项数、隐藏子任务、非空搜索及非默认 doneWindow；归档、空组、车道宽度和排序不计入 badge。归档来自 `board.showArchived/setShowArchived`，经设备偏好保存，不从过滤参数或局部 sheet state 推导。清除筛选仍保持既有排序／设备偏好语义。

`sheetMode = sidebarMode(boardWidth, previousMode) === "sheet"` 时整条 DesktopFilterBar 隐藏，顶部提供归档和筛选入口；该模式按板宽及760/784滞回决定，**不等于手机 compact**。宿主 Modal 的打开条件为 `(touch || sheetMode) && filtersOpen`，`Modal.Content scrollable={false}`，滚动和底部按钮由 FilterSheetBody 自己负责，Modal 内重新提供 TasksTypography。

| FilterSheetBody 调用面 | showEmptyGroupsToggle | showArchivedToggle | laneWidth |
| --- | --- | --- | --- |
| PhoneBoard 筛选／排序 sheet | true | 省略；归档留在手机顶栏 | 省略，手机单车道无此选择 |
| Web DesktopBoard 窄板 sheet | true | false；归档留在顶栏 | controller 值／setter |
| 原生 DesktopBoard（普通／窄板） | true | true；与直接开关同步 | controller 值／setter |

MenuButton 保留完整 accessibilityLabel 与 expanded；BarSwitch、ToggleRow 保留 switch role、checked 和名称，SwitchTrack 仍只画轨道。S2 提取搜索不得改变上述 props、controller 状态、focus=sort 顺序或宿主 Modal 生命周期。

**侧栏计数与字号。** 本次改的是 `StatCell` 标题适配，不是重做分组计数算法。仅在测得 headingWidth、且 labelSize 的 key 与 `${label}|${scale}` 一致后，按 `labelWidth + 13 + 5 > headingWidth + 0.5` 隐藏标签；透明测量层持续挂载并从无障碍树隐藏，宽度／语言／字号变化后重测恢复。计数仍为 RollingCount（未 ready 为 dash），名称仍包含 label 与 count。状态格最小高度56/64、分组行36/44、分段28/36都继续经 taskControlHeight；分组行 checkbox、计数和点击过滤保持。不得把隐藏计数、缩小字号或子任务240阈值作为替代方案。

**预览布局归属。** `TasksBoardPreview` 与 DesktopBoard 使用 `boardLaneLayout`，内部复用 `laneLayout` 与 `LANES.edge/gap`；没有预览专属的840或每车道210宽度切换算法。非 phone 始终多车道，外层纵向 ScrollView 上限440、内层横向 ScrollView，车道与内容宽度来自同一 layout；归档开启加入第五车道。`PreviewCard` 的 phone 实际为 `look.compact || device === "mobile"`，是展示模式，不是硬件识别。两种 PreviewCard 入口均包 TasksTypography；标题用 laneTitle、header 高36及 phone tab 最小高40经缩放。预览仍是静态样本、冻结时钟与空操作，不引入真实数据订阅。真实看板的滚动容器／虚拟化不因此搬进预览。

**上下文环的有限变体。** API 为 `ratio/color/track/variant?: "card" | "subtask"`，默认 card；card 为14pt、stroke2，subtask 为12pt、stroke1.5。生成器产出0..100共101帧、每帧1逻辑像素 padding、4x PNG alpha mask；从12点顺时针、圆端帽，100为完整圆。运行时把有限 ratio clamp 到0..1后 round 百分比选帧；track 始终使用100帧、fill 在大于0时绘制，以 Image tintColor 分别着色，裁剪在 size×size 内。不要补新 fallback 或恢复任意 size/stroke。

环自身隐藏于辅助技术，百分比仍由父元数据／卡片读出；主题切换只改变 tint，不重生成位图。子任务调用方仍按 `>=0.75` warning、`>=0.9` danger；主环辅助函数 `contextRingTone` 为 `>=70%` warning、`>90%` danger，不能借图形共享顺手统一阈值。生成归属在 `scripts/build-context-rings.mjs`（resvg／ImageMagick 开发工具），编码资源不手改，也不新增运行时依赖。新 bitmaps 测试核验尺寸、方向、透明中心／边界与抗锯齿 alpha，不证明 iPad tint、DPR采样或裁剪的实际视觉质量。

### 3.3 截至08f2的工具栏、滚动与详情契约

以下均已提交，属于下一候选两侧的共同基线；不新增实施切片。平台判断仍是 `Platform.OS`，不是pointer能力：原生非compact走tablet栏，Web触屏仍走Web栏；Web窄板sheet隐藏二级栏；原生无论普通／窄板均不挂载DesktopFilterBar。

**车道宽度的有限变体。** `82818418/4f2045d4` 由 [LaneWidthMark](../client/tasks/board/lane-width-mark.tsx) 拥有narrow/default/wide的20-unit几何：内宽6/10/14加1.5描边，高15.5、描边1.5、圆角2.25，外框统一size；自身不接收事件、不重复AX。菜单图标16，Web工具栏图标round(16×max(1,scale))。宽时显示“Lane width／列宽”＋既有Segments三图标选项，窄时为当前值圆菜单；原生不显示Web inline控件，sheet保留文字Segments。三图标选项使用相同目标计算，外高taskControlHeight(28)，内高outer−6、minWidth=inner+8、paddingHorizontal6，选中surface2；radio当前表达selected，完整选项AX名称／tip保留，不在本轮偷偷改checked契约。菜单仍是checked menuitem，关闭后不额外创建焦点归还机制。

**测量归属与恢复成本。** `useLabelFit`负责onLayout／隐藏测量，`label-fit.nextBarLayout`只决定有限状态：先折叠inline车道选择，再折叠四筛选＋sort文字；扩宽先恢复文字，再恢复inline。bar可用宽度扣两侧16和组gap10，结合filters/end/controls实测；有bar宽度时不依赖可能过期的end.y，保留0.5溢出容差及12恢复余量。inline额外成本来自完整“标题＋10 gap＋三选项chrome”实测减当前控件宽；测量key为scale|laneWidthLabel，模式匹配后才决策，恢复inline时关闭旧laneWidth菜单。隐藏层是无事件、无AX的Text/View，不挂载第二套radio。compact恢复五段文字还必须加各菜单padding/icon/chevron/gap，以及 `3 * (HAIRLINE + 2 * DIVIDER_MARGIN + TOOLBAR_GAP)`，不能遗漏分隔符而来回震荡。主bar各盒并非全部以language/scale标记；语言／字号运行变化必须实际回归，不能把局部key保障泛化为全测量层都已防过期。

**工具栏是三个有限入口，不是统一mobile开关。** DesktopBoard以 `Platform.OS !== "web"` 选择 [TabletToolbar](../client/tasks/board/tablet-toolbar.tsx)，Web用DesktopToolbar；宿主compact仍用PhoneBoard。原生只留一条toolbar，不再展示四筛选＋sort第二行。筛选入口复用FilterSheetBody；Web宽板才显示agent→project→workspace→label及既有分组／label-fit／LaneWidthMark，sheetMode另由板宽滞回决定。触屏Web不因此走tablet。

TabletToolbar的target为taskControlHeight(44)、栏高taskControlHeight(56)；width按max(1,scale)比较：560开始inline search、680显示子任务／侧栏快捷按钮、440显示归档快捷按钮、1000恢复按钮label。左右flex:1/flexBasis:0/minWidth:0使完整任务数居中；隐藏计数测量保留至少三位宽，不重复AX。actionWidth为0或至少2×target+6才独立显示Filters，否则收入View，badge随入口迁移。View容纳排序、车道宽度、时间范围、子任务、空车道／空组、归档和侧栏；下钻保留同一面板，每项minHeight44再按字号缩放，锚点target+6。按钮role=button并用selected/expanded，菜单checked语义保留，不假称全是switch。View关闭／窄搜索浮层关闭不清query；所有入口读写同一controller。

Web顶栏也是左搜索、居中完整计数、右动作；搜索width220/maxWidth100%/minWidth0，不再计数后接spacer或minWidth140。可用actionWidth小于actionCount×buttonSize+(count−1)×10时收入View，筛选入口保持可达；快捷键仅Web且初始宽0或width≥1200×max(1,scale)。Web二级栏仍保留三divider只在!compact恢复及完整chrome测量；不把tablet阈值塞进nextBarLayout。

**菜单与命中按容器保留。** Web二级栏保留既有box-none包装和CascadeMenu的document pointerdown排除trigger／菜单、keepOpen及输入焦点规则。TabletToolbar以自己的page/trail、局部关闭遮罩和View下钻管理菜单，不恢复旧原生四菜单行的gap几何。实际验收空隙关闭、触发器切换、滚动、焦点转移与底层动作次数；源码不能证明原生点击穿透正确。时间范围／归档／子任务直接按钮与sheet／View菜单必须同步，不新增状态副本。

**短标题不缩减语义。** `f87a6d26` 仅把timeRange改为“Range／范围”；sheet仍为“Done time range／已完成时间范围”，WindowSegments仍通过windows提供各radio完整AX名称和tip，通过tips.doneWindow说明范围。WindowMark数字11、单位9、∞17 authored、weight500，经TaskText缩放；只缩可见glyph，不缩目标。不要将短标题替换进所有tooltip/AX；组本身是否有充分名称仍按现有Segments语义单独记录，不能宣称本次已补齐。

**筛选滚动条已经复用。** `9b825e74` 的 [FilterSheetBody](../client/tasks/board/filter-sheet.tsx) 调用useLaneScrollbar并给自身ScrollView传detailScrollProps("inset")。Web显示indicator且data-bcdetails=inset，稳定6px gutter，thumb在scroll期间显示，最后scroll后800ms撤标；100ms入／400ms退CSS沿用既有规则，只有带scrolling标记时hover/active才着色（f147后）；静止hover不使thumb出现。规则只匹配指定data属性；hook实际以DOM存在守卫、引用计数管理style和document capture scroll监听，不是全局隐藏滚动条。最后卸载移除监听/style；现有WeakMap定时器并未在卸载时批量清除，不宣称全部timer已取消。原生保留系统indicator与bottom8 inset，无Web dataSet。宿主Modal.Content仍scrollable=false，内ScrollView独占滚动，footer在外，keyboardShouldPersistTaps=handled、workspace focus异步scrollTo及holdTop保持；不引入另一套sheet滚动服务，也不顺带扩大S3c到scrollbar动效。

**详情顺序由模型统一。** `c351d8cd` 的 [detailSections](../client/tasks/cards/detail-model.ts:30) 固定properties在前，再按存在性prompt、message，再接原状态顺序；permission/error的usage默认closed不变，无children无subtasks，provider subagent仅properties及可用prompt/message。单列在hero之后按order渲染；双列现在左侧hero→properties→subtasks，右侧prompt→message→其余分区；两列独立ScrollView，短列也保持flex:1，单列由外容器滚动。分栏只是按section identity分配，不复制第二套顺序。TaskDetailCards继续key=section、sectionClosed读用户选择，滚动key按card.id；prompt/message复制、Properties文件夹RPC／行hover仍归原owner。不能在sidebar/sheet或设置预览手写第二份排序。

结论：LaneWidthMark、label-fit、detailScrollProps/useLaneScrollbar、detailSections已提供所需复用。保留本文件toolbarButtonSize/TOOLBAR_GAP/DIVIDER_MARGIN和现有Segments的有限度量；只有后续证明隐藏测量与真实chrome重复维护导致缺陷，才在board域内提取一个小型纯度量helper，不现在增加新模块或通用Search/Toolbar/Icon框架。S2搜索提取依然收益低于焦点风险，S1b/S4仍按既有门槛推进。

### 3.4 搜索、键盘与详情数据的新共同契约

| 提交／owner | 当前实现与必须保护的边界 | 整合影响 |
| --- | --- | --- |
| 55fa746e；data/search、search-first-prompts、use-board、board-screen | 搜索标题、位置／完整路径、标签、provider／model名称及ID、任务ID、PR编号／标题／URL和第一条用户消息；trim＋lowercase连续子串，不分词、不解释regex，不搜后续prompt或assistant。隐藏卡片字段仍可搜，其他筛选继续相交 | S2只可能处理输入骨架，不拥有数据算法；路径来自现有快照，不新增文件扫描或网络搜索 |
| b968/071/e3ab；DesktopBoard、web.ts、CardCell/TaskCardView | Space切换当前键盘卡片或selected卡片预览，Enter打开；导航focus、预览selection与业务highlight独立。DOM精确卡片属性与root虚拟focus可接管activation，nested按钮保持自身行为 | S1a只迁移CardButton，保留task-card新focusId/data属性、细ring和parent图标；ActionRow/schema不改 |
| ca099/e3ab；TaskCardView与pluginRoot focus规则 | Web虚拟焦点1px foregroundMuted outline＋offset2，native细边／shadow；selected背景与highlight accent仍独立。拖动副本不赋重复focusId | 不把pointer hover、可访问性focus-visible、选中背景合成一个selected布尔量 |
| f147/96d8；detail-cards、first-prompt、last-message、subagent-timeline、tasks RPC | 分栏见3.3；消息时间来自对应timeline entry，可见本地当天HH:mm、跨日M/D HH:mm，hover完整本地YYYY-MM-DD HH:mm:ss（formatFullStamp）；折叠时仍显示，缺失／非法时间省略，无createdAt回填 | S1a保留分区key、滚动、时间summaryTip及复制语义；新数据文件是基线，不增加15文件重构写入集 |
| 08f2；TaskCardView ParentTask | 父任务关联使用CornerLeftUp，与Open parent菜单／provider子任务跳转一致；普通Open仍ArrowUpRight | 不与ChildMark的provider TYPE或S3a品牌前缀路由合并 |

**首条消息的读取边界。** useSearchFirstPrompts只处理看板已加载的所有车道卡片，未加载历史须先加载更多。普通closed会话不主动读取；provider需父卡已加载且未closed；已ready缓存即使关闭仍参与搜索。首条消息store按API WeakMap共享，ready复用、pending合并，普通timeline每页8条向后找首个user_message，空首条即none，不能替换为后续prompt；无效／倒退cursor或中途reset为error。provider桥当前只返回有限head rows，没有普通timeline的分页cursor保证，不宣称无限全文扫描。最新回复另有version/ticket防陈旧结果覆盖，运行子代理详情15秒轮询，与搜索不合并。

队列激活／eligibility key变化后200ms启动，最多4个并发且替换队列计入旧inflight；依赖是active与卡片id/closed/parent/lastUserMessageAt，不是每次query文本变化都重新debounce。清空／卸载停止尚未开始的读取，普通分页前canRead复核；不取消已发运输请求，provider只在请求前检查资格。迟到结果进入缓存，当前query重新匹配；error可清空再搜重试。board-screen在非空查询时持续显示pending/unavailable/failed计数与polite提示，其他字段结果立即可见；不能把空结果当搜索完整证明，保留ready/loading及空车道防闪烁。后续实际验证应观察closed会话不会被搜索恢复、重连／更换API与队列清理，而非新增缓存服务。

**键盘事件的精确所有权。** root tabIndex=-1、role=group、aria-activedescendant；DOM焦点进入子控件或离开root清虚拟focus，pointer路径按现有focusTaskBoard交接。Space排除shift、composition、menu，repeat只阻止默认滚动不重复切换；全局先排除meta/ctrl/alt及typing，板外editable不接管。window capture仅为board root拥有的虚拟／selected目标或精确卡片DOM处理Enter/Space，即使宿主已preventDefault也可执行，消费后stopPropagation；document保留Escape捕获与导航bubble并清理监听。不能泛称所有dialog/sheet/contenteditable组合已经覆盖：真实host的快捷键竞争、嵌套按钮、编辑框／IME、菜单及Modal焦点必须深验。关闭预览清selected并恢复对应虚拟focus，不要求同时隐藏整个侧栏。旧Settings Toggle的Space故障是另一入口，仍未关闭。

## 4. 优先收敛矩阵

收益是架构判断，未测量净删行数、包体或性能；不以减少文件数作为成功指标。

| 优先级／对象 | 成对定位证据 | 目标与收益 | 差异、风险与审批边界 |
| --- | --- | --- | --- |
| P0 已实施 S0 的整合保护 | `subtask-row.tsx:119,148`；`child-mark.tsx:33` | 保护第2.2节已实施的全mode折叠／unread全宽省略／实测thinking规则，三入口一致；不是重新实施旧白名单 | 已要求的视觉变化；保留状态语义、完成信息及宽度恢复 |
| P1 动作组件归属 | 历史：detail-cards 导入 task-card；当前：两者直接导入 action-style/action-buttons | 工作区已新增 `cards/action-style.ts`、`cards/action-buttons.tsx`，待整合验收，解除详情对大型卡片文件的依赖 | 第一片只迁移，不改动作顺序、尺寸或状态机 |
| P1 动作共享机制（有门槛） | `task-card.tsx:1617,1708,1813`；`detail-cards.tsx:542,1355,1534` | 按第 4.3 节已证明的公共内容／状态提取，保留外层 Pressable | 矩阵和回归基线确认后单独评审 S1b，不自动升级为万能 ActionContent |
| P2 手机搜索（可选后续） | `phone-board.tsx:360`；当前 `filter-sheet.tsx` 的 SheetSearch | 新建 `board/search-field.tsx`，统一小型视觉骨架，收益主要是后续设计维护一致性 | 输入属性见第 4.4 节；重复量有限，键盘风险较高，因此晚于基础能力，不增加产品问题 |
| P1 图标前缀 | `disclosure-header.tsx:115`；`details-header.tsx:145` | 工作区已新增 `components/mark-icon.tsx`，待验收，统一 brand/provider 前缀渲染 | 普通行仍用宿主 Icon，磁贴仍用 Glyph；不得从披露头大文件分享 helper |
| P1 图片字节 | `image-preview.tsx:91`；`tool-callouts.tsx:623` | 工作区已新增纯 `components/image-format.ts`，待验收，共享 `formatImageBytes(bytes)` | `1536 → 2 KB` 保持；不采用摘要的 `1.5 KB`，不改变两处零字节显示条件 |
| P1 减弱动效 | `switch-track.tsx:30`；现有 `ui/tokens/motion.ts`、`use-reduced-motion.ts` | 工作区已接入 reduced-motion，待验收 | 明确的可访问性修正，独立于纯提取；处理中途设置变化与动画停止 |
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

下表记录本轮保留的源码行为（其余旧行号为迁移前定位，以符号为准），不判断差异是否理想。`h` 为传入／预设 authored 高度，`scale` 为 Tasks 字号缩放；fit 参数仍使用当前 authored 值，不能擅自替换为视觉缩放值。

| 表面／定位 | 静止底色、图标颜色、过渡 | 尺寸与交互 | busy／内容与 fit chrome |
| --- | --- | --- | --- |
| CardButton `action-buttons.tsx`（工作区） | transparent；plain 也用 hue.color；120ms webTransition | desktop 高 taskControlHeight(28)；compact minHeight **原值 32**，minWidth 缩放；圆角 6/7；hover 染色，无独立 pressed 填充 | busy 禁用、opacity .6、spinner、取消 hover；有 answer/arrow，folded busy 才隐藏尾箭头；fit iconWidth 28/32，chrome `2*p + (hasIcon ? size+5 : 0) + 1`，p=10/12，size=13/14 |
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

共享组件不为行为属性添加覆盖调用方的默认值。保持顶层稳定组件身份，不用 value 作 key，不在 render 内定义组件类型；输入首字或 query 改变不得导致重挂载、再次自动聚焦、丢失输入法组合或软键盘。桌面搜索和 MenuSearch 不应机械套用这个骨架；当前更建议暂缓该提取，先保留第8.2节五种明确输入契约。该项可后置；收益是维护共同视觉，成本是焦点／键盘回归验证，不以几十行去重作为强制理由。

适配后 SheetSearch 也用于原生平板“筛选”和 Web 窄板的 FilterSheetBody。S2 仍只提取输入骨架，不另造 TabletFilterSheet；验收须覆盖第3.2节各宿主入口，不能只测 PhoneBoard。

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

已落地的复用优先沿用：筛选内容 → FilterSheetBody，车道几何 → navigation.boardLaneLayout，Tasks 字号 → TasksTypography，环资源 → 专用生成器。工具栏 Web／native、预览 phone／非 phone 是有限且有源码依据的变体；不把平台、宿主 compact、板宽 sheetMode 和实际输入能力合并成一个含混的 `mobile` 开关。

## 6. 实施切片与文件所有权

下表保留切片的文件边界；S0已提交，S1a与S3a/b/c已写待验收，S2/S4可选未实施，S1b/S5仍有门槛，不应把“新增”理解为要求重新创建已有文件。所有权指每片的修改边界。开始每片前检查最新工作区及直接依赖，保留他人修改；重叠文件顺序推进。

| 切片 | 新增／修改文件 | 依赖与行为边界 | 验收与回滚 |
| --- | --- | --- | --- |
| S0 窄列文字与已批准思考缩写 | 修改 `client/tasks/cards/subtask-row.tsx`、`task-card.tsx`、`format.ts`、`detail-cards.tsx`、`detail-charts.tsx`；`test/unit/tasks-cards.test.ts`、`tasks-cards-web.test.ts` | 隐藏规则、行级无障碍和完整缩写表闭环；卡片／详情胶囊已恢复完整等级，Chip 不增加新参数，不做 S4 提取；ChildMark、store/schema 不变 | 已实施：三入口、所有权限模式的文字收起与实际宽度测量、unread 全宽度省略、行状态名称恰好一次、小写思考缩写；独立撤回 |
| S1a 动作归属 | 新增 `client/tasks/cards/action-style.ts`、`action-buttons.tsx`；修改 `task-card.tsx`、`detail-cards.tsx`；在 `test/unit/tasks-cards-web.test.ts` 补迁移过渡等缺失断言 | 迁移第 4.3 节完整符号、28/32 度量与120ms过渡；无循环／反向导入，不改行为 | 卡片／详情／Stop 回归；确认公共 helper 不再来自 task-card；连同导入迁移撤回 |
| S1b 动作机制（单独评审） | 修改上述动作文件、`task-card.tsx`、`detail-cards.tsx`、`test/unit/tasks-cards.test.ts`、`tasks-cards-web.test.ts`；Stop 专项测试仅有新增断言需求时修改 | 依赖 S1a 及第 4.3 节回归／视觉基线；仅提取已证明公共的内部内容／状态，外层 Pressable 保留 | 全矩阵对照；Request 无 busy、Bar 无 hover、Stop 双按钮／描边／菜单保持；在 S1a 上独立撤回 |
| S2 手机搜索（可选后续） | 新增 `client/tasks/board/search-field.tsx`；修改 `phone-board.tsx`、`filter-sheet.tsx`、`test/unit/tasks-board-render.test.ts` | 按第 4.4 节，稳定输入身份；不动搜索算法／手势状态机 | 输入首字不重聚焦、中文组合、清除不 refocus、sheet 滚动／键盘；组件与迁移一起撤回 |
| S3a 标记路由 | 新增 `client/components/mark-icon.tsx`、`test/unit/mark-icon.test.ts`；修改 `client/ui/disclosure-header.tsx`、`client/details/chrome/details-header.tsx` | RowIcon 负责归一化，叶子只渲染；普通 Icon/Glyph 不变 | 新用例及现有 details-chrome、quiet-tool-rows、tool-disclosure 测试；独立撤回 |
| S3b 图片格式 | 新增 `client/components/image-format.ts`、`test/unit/image-format.test.ts`；修改 `image-preview.tsx`、`tool-callouts.tsx` | 纯文案去重；不改零值条件 | 边界数值及两调用面元信息；独立撤回 |
| S3c 减弱动效 | 修改 `client/ui/switch-track.tsx`；新增 `test/unit/switch-track.test.ts` | `motionDuration(140, reduced)`，不是 duration.fast 的120；effect 响应 reduced，cleanup stop；不新增 switch role（仍在 Toggle/ToggleRow） | 普通140ms、减弱即时到位、中途更新、卸载停止、外层角色唯一；独立撤回 |
| S4 元数据标签 | 新增 `client/tasks/cards/metadata-chip.tsx`；修改 `task-card.tsx`、`detail-cards.tsx`、`detail-charts.tsx`、`test/unit/tasks-cards.test.ts` | S1 后推进；只是 owner 整理，详情仍为图表导入 detail-charts，不能宣称消除此依赖 | card/detail 变体尺寸、截断、复制／展开、主题／字号；独立撤回 |
| S5 进一步设计统一 | 分段：`settings-controls.tsx`、`board/board-parts.tsx` 及新增小型叶子；权限：`cards/task-card.tsx`、`detail-cards.tsx` 及域内映射；重置：`settings-page.tsx`、`tasks/settings/tasks-panel.tsx` 及确认 UI | 三项分别审批目标并细化文件／测试，不能以本计划授权直接批量改动 | 每项独立 patch、视觉基准和语义测试，分别可回滚 |

S0、S1、S4 共享卡片源码／测试，应串行。S2、S3 的生产文件互不重叠，可在独立边界下推进；文档统一收尾，不能多人覆盖 `design.md`。以上仅描述可拆分性，不启动并行 agent。

适配复核不新增切片或扩大首批写入集。S0 保留当前 `variant="subtask"`；S1a 迁移的是卡片动作，不能套用工具栏的28/44高度。既有 toolbar／preview／sprite 文件只作为回归依赖；回滚每片只撤回该片，不能回退 `62d443ed`／`786d69e6` 的适配实现。

## 7. 当前整合顺序、所有权与回滚

### 7.1 先完成已经写入的有限重构

当前候选01是 `45064c6b` 加以下15个文件，不是当前 HEAD：

- S1a：`client/tasks/cards/action-style.ts`、`action-buttons.tsx`、`task-card.tsx`、`detail-cards.tsx`、`test/unit/tasks-cards-web.test.ts`。
- S3a：`client/components/mark-icon.tsx`、`client/ui/disclosure-header.tsx`、`client/details/chrome/details-header.tsx`、`test/unit/mark-icon.test.ts`。
- S3b：`client/components/image-format.ts`、`image-preview.tsx`、`tool-callouts.tsx`、`test/unit/image-format.test.ts`。
- S3c：`client/ui/switch-track.tsx`、`test/unit/switch-track.test.ts`。

实施负责人应先用候选 manifest 对照当前这些文件的 diff：`task-card` 已接入 SubtaskPanel、focusId／细ring与父任务标记，`detail-cards` 保留新分栏、消息时间、detailSections排序、文件夹动作／hover和提示，cards-web 已有新增交互断言，均不能用候选01旧文件覆盖。另有 `details-sidebar.tsx`、`card-hints.tsx`、`subtask-row.tsx`、`tasks-card-hints.test.ts`、新 `tasks-sidebar-tips.test.tsx` 的并行提示修改，不能因它们在工作区就自动算入 S1a。只合并确认所属的 patch；不重写历史、不 reset 用户提交、不把整个脏目录当候选。

下一冻结 candidate02 的共同基线固定为 `08f2bbb3`，baseline 与 candidate 都包含4a动画、设置入口、响应式车道宽度、菜单命中、筛选滚动条、单行tablet toolbar、首条消息搜索、Space预览、焦点细ring、详情分栏／真实消息时间、父任务图标及截止点内全部功能；candidate 仅叠加上述15文件中属于 S1a/S3 的精确 patch。manifest02逐文件记录基线、patch归属、最终hash与生成包hash；不以工作区整文件复制混入并行提示改动。并行提示层及08f2之后修改若要纳入，先由编排负责人确定作者归属及独立测试范围，再显式升级两侧共同基线，不默认包含。candidate02 已于2026-10-25冻结：`/tmp/better-paseo-refactor-20261024-FPps3Q/candidate-02/`，baseline tar SHA256 `9505e50c…c1fab0ed`（git archive 08f2），candidate tar `24d03538…c1ad9649`（876文件），patch `90e797b3…75834843`（15文件），逐文件 hash 见 `candidate-02.manifest.json`。detail-cards 只带 S1a 两行 import；并行 tips 草稿（details-sidebar、card-hints、subtask-row、detail-cards 的 tip hunk 及 tasks-card-hints／tasks-sidebar-tips 测试）两侧均排除。只在 Mac Studio 对该精确候选与同基线未重构版本运行验证；机械提取与新交互分别比较，不拿45064截图要求新功能像素不变。前次6b检查点逐文件SHA256核对：上述15文件中12个与候选manifest一致，只有 task-card、detail-cards、tasks-cards-web 不同。现有候选01证据保留，新增候选须重新完成类型／集成测试／构建及受影响运行表面，未改变的叶子可引用历史专项证据但不能冒充新候选整体通过。

回滚按 S1a、S3a、S3b、S3c 的独立 patch 边界撤回，并连同调用点导入恢复；保留之后的全宽元数据、动画、文件夹、提示与工具栏提交。重叠 `task-card/detail-cards/cards-web` 串行处理，其他叶子无需再改写。此次文档复核不执行上述 Git 或实施操作。

### 7.2 后续最小波次

| 顺序 | 建议与文件边界 | 启动条件／验收 |
| --- | --- | --- |
| 当前波次 | 第7.1节精确15文件及明确列出的整合差异；提示补丁单独归属 | 保持 S1a 模块单向依赖及全部现有行为；S3c 是已明确的 reduced-motion 修正 |
| S1b 本轮不实施 | — | 2026-10-25 复核第4.3节矩阵：六个表面在底色、过渡、hover/pressed、busy、fit chrome 上几乎逐项不同，真正一致的只有 spinner 替换与 busy 的 .6／disabled，每处数行；提取必然引入多布尔参数，违背“不要过度设计”。仅当出现具体缺陷或设计统一需求时再立项 |
| S4 暂缓 | `cards/metadata-chip.tsx`、`detail-charts.tsx`、`detail-cards.tsx` | 仅是把 Chip 移出图表文件，详情仍需导入图表，收益只是文件归属；本轮不做，无维护痛点不再立项 |
| S2 暂缓 | 如仍有维护痛点，再限定 `board/search-field.tsx`、phone-board、filter-sheet 与相关测试 | 当前五种焦点契约不同；没有共同设计修改需求时不提取，不要求用户为内部优先级再次决策 |
| S5 独立产品项 | 分段语义、权限图标、重置确认，各自精确文件见第6节 | 可访问性修正与视觉设计分开；不自动改变 selected／hover／确认时序 |

新 empty state、侧栏 tabs、panel motion 和文件夹动作是已实现功能契约，不再各建“重构切片”。若运行验证发现具体缺陷，以最小修复进入其现有 owner，不扩展框架。

## 8. 本次全局交互复核

### 8.1 新增与既有 canonical owner

| 提交／当前文件与符号 | 已实现机制与边界 | 方案影响／验收入口 |
| --- | --- | --- |
| `34893418`；`cards/subtask-row.tsx:46` SubtaskRow | jump 右上定位，只有标题让位，metadata 全宽 | S0 保护规则；cards 单测＋三入口实际窄列 |
| `4a0201fe`；[SubtaskPanel](../client/tasks/cards/subtask-panel.tsx:17) | 已提交：Web CSS height/opacity＋退出计时；native LayoutAnimation＋native-driver opacity；180ms开／140ms关，关闭立即禁止命中并隐藏AX | 两侧共同基线，非草稿；`tasks-subtask-panel.test.tsx` 按平台验收，不套旧JS逐帧height证据 |
| `6fd542a2`；[BoardEmptyState](../client/tasks/board/empty-state.tsx:9)，DesktopLane/BoardEmpty、PhoneLane | 同一虚线框、图标、标题与提示；narrow 有限尺寸变体，容器选择全板／车道文案与操作 children | 已经收敛，不再新建 EmptyState；`tasks-empty-state.test.tsx` |
| `aa5ffb2c`；detail-cards PropertyRow/RowAction，ui/use-hover | Web 绑定父 DOM 的 hover，移动到子动作不清空；嵌套动作 stopPropagation，不触发行复制 | 沿用 useHover(ref)；cards-web 回归，键盘可达性另验 |
| `a330ec22`＋`b76c9614`；detail-cards Properties，shared/file-rpc revealPathRpc | 仅 `Platform.OS === "web" && !props.touch && !input.touch` 展示打开文件夹；RPC发送cwd/path均为任务cwd，失败本地化toast，复制仍可用 | 保留 domain RPC／路径／导航边界，不将远端主机路径当客户端路径；cards-web与cards专项 |
| 未提交交互；[card-hints](../client/tasks/cards/card-hints.tsx:133) HintLayer、BoardTips/CardHints；details-sidebar/detail-cards/subtask-row | 沿用同一400ms Web pointer 提示层；触摸忽略，滚动捕获关闭和底部向上放置属当前草稿；侧栏／行接入 tipProps | 与候选01分开验收；`tasks-card-hints.test.ts`、`tasks-sidebar-tips.test.tsx`；不新建全局Tooltip服务 |
| `b4f91dac/c1097e34`；filter-bar DesktopToolbar | Web输入自身outline:none；父框 focus用foregroundMuted，blur恢复border，尺寸不变 | S2不再只比较手机与sheet；保留键盘可见焦点，不能全局清除outline |
| `56e9fd13`及先前平板提交；filter-bar DesktopToolbar/DesktopFilterBar | 历史DesktopToolbar guard为 `props.filters || OSios || OSweb`；当前仅Web调用，原生改由TabletToolbar快捷按钮／View菜单与sheet共享board.showArchived | 原生≠iPad设备检测；测试精确guards、selected/checked语义与sheet同步 |
| `36d3b799/c12c3450`；desktop-board、sidebar-model、details-sidebar GroupCard/Segment | iOS floating非sheet宽340、320..480，与桌面380、340..520偏好分开；局部文字0.9；四tab等宽，任一标签不适合则全部隐藏 | 保留本地测量和生命周期，不提取万能ResponsiveLabel；sidebar-model/board-render |
| `4b30fa38/d74d1412`；navigation boardLaneLayout、DesktopBoard | 归档增减不压缩四个活动车道；空车道折叠仅处理ready且非loading的当前空车道，保留非空车道手动状态 | 真实板与预览复用几何；board/preview测试，不另建预览算法 |

SubtaskPanel 仍仅用于卡片展开，详情 Section 保留自己的卸载方式。Web 持续保留零高度 shell，按 onLayout 测量内容高度，以 CSS `height, opacity`（180/140ms）插值，收起140ms后移除子树；reduced／animated=false 使用0ms与自然高度，初始已展开不等待测量。退出计时在快速反向或卸载时清理。Native 仅 expanded 目标改变时配置 LayoutAnimation（easeOut），以 open 状态切换自然高度／0，opacity 使用 native driver；停止旧动画与 live 回调守卫阻止过期关闭，完成收起后释放子树订阅。reduced 中途更新立即同步 open/present/opacity；初始恢复与无关更新不启动动画。两平台均不能描述成永久保留子树或滚动位置，也不能声称原生逐帧写height。

验收需分别检查 Web 首次测量、CSS退出与空shell重开，native 布局事务是否影响同列／列表／滚动；共同覆盖快切、动态内容／字号、隐藏、reduced中途切换、裁剪与不可操作隐藏子树。SwitchTrack 仍独立拥有140ms滑块与cleanup，角色归外层Toggle；只共享 reduced-motion hook／tokens，不创建万能Collapse或动画状态机。

侧栏 floating guard 精确为 iOS＋floating＋非sheet，不是硬件型号。0.9乘宿主字号，`taskControlHeight` 仍 `max(1, scale)`，不缩小最小目标；正文用 adjustment 保持自己的ramp。拖拽横向超过4且大于纵向才接管，宽度clamp，release写floatingWidth；AX增减20。偏好是所有平台会话缓存＋Web localStorage，不能描述成iOS跨启动持久化。sheet/float/inline仍保留760/784、996/1020滞回；短列滚整列，宽sheet按现有640条件两列，不改滚动key与选择历史。

GroupCard四个tab的测量以label|scale为key，等宽且字重500，不随selected变化；全部当前测量适合才一起显示。StatCell仍独立隐藏标题，计数与AX不消失。两者与SubtaskMetadata的240阈值不是同一算法。复用语义tokens和TasksTypography，保留领域测量。

### 晚间已提交契约与最小回归范围

| 提交／owner | 当前契约及全局判断 | 整合时验证（不新增重构切片） |
| --- | --- | --- |
| `e1bd4c94`；[data/index](../client/tasks/data/index.ts) createStore/doneListLanded/getSnapshot、LaneModel、useBoard/keepSameLanes、DesktopLaneView/PhoneLane | 数据层区分initialLoading与分页loading：初次历史未落地／归档重载时才初载，成功或当前订阅失败均结束等待。搜索过滤至0项不把后续分页当首屏；两历史车道即使0项仍可显示加载更多；archivedSettling与memo比较同步使用initialLoading | `tasks-lane-loading.test.tsx`：延迟初载、请求／订阅失败、空搜索连续分页及失败重试、开启归档不重挂done列表、仅initialLoading改变使memo失效；保留BoardEmptyState和列表身份，不在搜索组件复制loading状态 |
| `6d18e5be/b2d0aa26/e329bfa8/c9bc19aa/8920ab3d`；DesktopToolbar/DesktopFilterBar、FilterSheetBody | 保留Network显示／List隐藏、不用slash；toolbar/sheet同读resolved.filters.hideSubtasks并写同一setParams。归档独立board.showArchived，Archive保留slash；Web时间窗Range／范围。原生二级栏和四筛选minWidth已被TabletToolbar取代，不再是当前布局 | `tasks-board-render.test.ts`：Web/iOS/Android及sheet区别；Web28与tablet44缩放、当前菜单label策略、子任务selected/checked按入口及图标同步、归档位置/状态、View/Filters badge、完整AX及pointer tip；内部其他gap不批量改10 |
| `7815e2ee`；DesktopToolbar/ClearButton | 非空任务query显示已有ClearButton，函数更新仅清query，其他筛选/排序不变；不主动聚焦，不重新挂载输入 | 该历史DesktopToolbar输入当前仅Web；原生由TabletToolbar替代，board-render分别覆盖；实际点击/触摸、纯空格、IME、Tab、`/`、Esc及软键盘另验。phone未新增clear；不扩大S2 |
| `9f619096/dbf1504a`；settings-screen、settings-page、tasks-panel、chunk/load/entry | 设置注册id仍chat-presentation，标题改Settings／设置；聊天tab仅聊天设置/预览，不再包含TasksEntrySection。Tasks tab拥有唯一启用开关、归档开关、PreviewCard与选项；ready时enabled true/false均有预览，loading/error无预览，invalid可重置；开启提示跨离开/重进Tasks tab保留 | `settings-screen.test.ts`、`details-settings.test.ts`、`tasks-settings-page.test.ts`、`tasks-settings-preview.test.ts`、`tasks-chunk.test.ts`及Hermes导出契约。真实宿主插件菜单→设置→两个tab→开启板→侧栏/Command Center，关闭后入口消失；删除的Section不重新提取 |
| `8247af6d`；board/cards/settings strings、toolbar-strings | 指定中文UI的workspace译为工作区；真实工作区名称、id/path、英文语言与Agent术语仍保留。不是全仓字符串替换 | board/cards-web及settings字符串用例；中英切换、窄栏/长名称、菜单与复制提示、AX名称；语言增宽应触发原owner测量恢复 |

状态和加载仍归controller/store，工具栏／sheet只渲染有限变体；设置入口删除已经减少重复，不重新引入通用Section来代替已消失代码。候选整合重点是保护这些共同基线，而非为每个新交互加抽象。

### 8.2 搜索、hover、提示与动作的收敛判断

| 输入面 | 当前焦点／属性契约 | 保留理由 |
| --- | --- | --- |
| DesktopToolbar | ref供 `/` 聚焦；focus父边框foregroundMuted；Web输入outline:none；query.length>0时复用本文件ClearButton（含纯空格），只清query，不显式refocus；autoFocus/纠错默认仍省略 | 搜索在左槽，width220/maxWidth100%/minWidth0，任务数居中；仅Web DesktopBoard；Esc捕获先取消Stop确认并blur板内输入，不清query。28基准高度／radius6 |
| TabletToolbar | 受控query/ref；inline不自动focus，浮层autoFocus=!inlineSearch；false/none；非空显示clear，仅清query，不显式refocus；focus父框foregroundMuted | 44目标／radius7、输入字号至少16，宽度切换会改变inline／浮层挂载位置，实际键盘／IME连续性待验，不假定跨断点永不重挂载 |
| PhoneBoard | autoFocus=`searchOpen && !board.params.query`；纠错／大小写省略，保留默认；无clear；不主动清outline | 手机搜索入口和软键盘生命周期；36基准／radius18 |
| SheetSearch | autoFocus省略；autoCorrect=false/caps=none；clear不refocus；Weboutline:none；focus触发工作区滚动 | 宿主Modal、searching高度联动，不等同顶栏 |
| MenuSearch | Web autoFocus；false/none；clear和Esc清空后focus；keepOpen选择后Web归还focus；Weboutline:none | 菜单临时查询、键盘捕获与submenu状态，不能复用sheet清除逻辑 |

在每种稳定布局中保持输入身份，禁止 `key=value`、render内定义组件导致首字重挂载、重复自动聚焦或破坏IME。焦点视觉是有限表面契约：不将桌面暗边框推广为统一新增设计，也不因菜单内部无outline就取消页面按钮键盘ring。桌面clear已经复用同文件chip的ClearButton；phone仍无clear，sheet与菜单的refocus语义不同。新增清除按钮不构成新搜索框架的理由，当前搜索共享骨架收益有限，先保留，不增加一套全局输入框架。

PropertyRow 的24pt RowAction、toast复制、行级点击／触摸长按与 CopyButton 的成功图标反馈、hitSlop和主题类型不同；ToolbarCopyButton还有溢出注册。已有 useCopy／useHover／buttonOutline 和 ActionRow 是可复用机制，不能为统一外观直接替换各行为外层。RowAction 暂留 detail-cards，未发现足够独立调用面支持新叶子。打开文件夹当前无新增busy／空路径禁用状态机；失败交由RPC与toast，不宣称已有能力探测。后续如有明确缺陷再在Properties修复，不扩张到通用文件操作层。

CardHints/BoardTips 已共用 HintLayer；tipProps提供提示不等于AX名称。当前主要是pointer生命周期，尚不能宣称键盘focus会自动显示提示，native依赖完整accessibilityLabel。应验收父hover跨子动作、提示关闭／节点detach／计时清理／滚动裁剪、copy与open事件只触发一次。无需为此合并时间线Toolbar、Tasks按钮、设置Button和所有tooltip。

### 8.3 Markdown 选择与复制：复用叶子，保留手势所有权

`6b86b458` 的四个生产文件已完整复核：`markdown/markdown-view.tsx`、`render/md-block.tsx`、`render/prose.tsx`、`render/block-selection.tsx`；并阅读直接的 inline/native-prose-source/renderBlocks/reuse、表格选择与复制、Web selection-actions、useCopy/controller、scroll-anchor及手势claim依赖。此项是已提交交互，不另建重构票。

- **选择单元归 Markdown。** `MdBlockBody` 只在 `Platform.OS === "ios" && selectableBlock(tokens)` 包裹 BlockSelection；必须恰好一个非space顶层token。段落／标题／text可选，list/blockquote递归判定，html/math保留源码语义；code/table及不满足守卫的块不包裹。段落等的直接inline本地图片由现有localImagePath检查排除，不应将该守卫夸大为任意嵌套图片的完整扫描。MarkdownView撤掉跨逻辑段落的iOS合批，仍复用已完成块元素与native style；不能为减少视图数重新合并相邻段落，亦不宣称拆分无性能成本。
- **短双击不是长按拖选。** [BlockSelection:60](../client/components/markdown/render/block-selection.tsx)观察touch而不申请responder：单指、每次按下至抬起不超过250ms、两次释放间隔不超过300ms、位移容差10；移动超界、多指、cancel或长按不触发块选中。模块级active使同bundle仅一块选中，触及其他Markdown、source改变或卸载会取消。选中时只有该块的IOSProse关闭native selectable，退出后恢复；普通原生长按选择仍需实际设备确认，不能由mock推断互不竞争。
- **链接先取消候选选择。** `IOSProse`与`IOSProseWithPaths`先调用context.cancel，再沿原URL/path路径处理；URL仍归openLink，路径仍按输入能力复制或reveal。选择复制走`blockSelectionText → inlineText`，保留可见文本、实体／换行，去除格式符与链接目标；列表不复制项目符号，html是显示的literal source，math是TeX。它不同于“整张表复制Markdown”，不能共享一个source serializer。
- **复制与滚动机制已经共享。** BlockCopyMenu复用useCopy的SDK clipboard、toast与失败结果，复用useScrollDismiss（仅选中时观察宿主列表）和FLOAT图标／间距／浮层色；成功且旧menu仍mounted才取消，失败保留重试，旧异步结果不得取消新选区。文案经toolbarLabel，AX名称当前为英文`Copy selected block`；不顺手改变本地化策略。40pt块菜单与30pt表格浮层是明确现有尺寸，不能批量统一。
- **表格和Web保留独立生命周期。** `table-touch-selection.ts`长按350ms、容差8并测单元格、锁列表／host gestures、claim详情内容触摸，拖动时不显示复制菜单；Web还有跨格拖拽及Cmd/Ctrl多区选择。`table-copy-menu.tsx`拥有菜单测量、退出保留、Copy selected/Add to chat和图像复制；`selection-actions.ts`拥有DOM Range、shadow/top-layer和mousedown保留选区。正文既不锁滚动也不拖选，不能只因300/250相同就合并tap状态机，更不套SubtaskPanel或通用Collapse。

结论：现有 clipboard、scroll-dismiss、tokens 是恰当复用边界，无需新selection service。Web选区条当前直接调用SDK并即时显示成功，与useCopy等待结果不同；这是现有行为差异，未来如统一失败反馈应单独验证，不能作为本轮机械提取顺带变更。全局布局／动效抽象必须尊重选区、剪贴板异步与原生文本生命周期。

整合影响：下一manifest02应包含截止08f2的已提交Markdown交互与平台动画作为共同基线，并明确列入其三个测试文件；它们不属于S1a/S3的15文件。继续整合S1a/S3而不修改此提交，图片格式叶子只改文案，不能改变LocalImage手势边界；披露头提取不能更换Markdown块key、选区容器或复制卸载时序。并行tips及截止点外交互修改按作者归属另审，不自动打包成已接受变更。

## 9. 验收矩阵与证据分层

**所有验证只在 Mac Studio 执行。** 重构验收的边界：candidate02 与同基线 baseline02 在受影响表面（卡片动作、标记、图片字节、SwitchTrack）的 A/B 行为／视觉等价，加上 candidate 上全部注册入口冒烟。08f2 已提交功能（搜索、工具栏、Space、滚动条、详情分栏等）两侧相同，属功能验收而非本次重构验收，只冒烟；A/B 出现差异才深验。下列矩阵中这些功能行据此解读。 源码断言存在、提交说明、单测mock不代表运行／视觉通过。

### 全局入口验收：所有入口冒烟，受影响路径深入

下面每行须由QA在Mac Studio记录候选manifest、宿主/包版本、操作路径、截图或AX/日志和结果；编排负责人核对清单完整性，实施切片负责人解释预期差异。平台W/I/A分别指真实宿主Web、iOS、Android；每个受支持入口三平台至少一个代表条件，主题／字号／横竖屏组合优先覆盖本轮受影响路径，不做无限笛卡尔积。所有新基线行目前均**待验**；候选01的离线fixture及有限native证据只能作为历史参考。无实际支持的交互写明不适用，不能记为通过。

| 注册入口／实际操作 | 关键状态与平台 | 代码owner／负责人角色 | 证据入口及待验范围 |
| --- | --- | --- | --- |
| 宿主插件菜单→Settings／设置→chat-presentation | W/I/A：中英重注册、打开页面状态、display/tasks切换、重复打开/卸载 | index.client、settings-screen/settings-tab；编排核对注册，QA操作 | settings-screen/details-settings测试＋真实宿主菜单/页面截图；标题和tab导航尚待新基线验收 |
| 聊天tab→SettingsPreview | W/I/A：Read/Edit/Bash成功失败、推理、todo、用户/助手增强开关；宽屏Desktop/Mobile预览与窄屏 | settings-page/settings-preview；QA，S3确认图标/图片影响 | settings-preview-host-state/nesting、details-settings-renderers测试；真实聊天组件组合须实测，关闭增强的模拟宿主回复不能证明真实host默认渲染 |
| Tasks设置tab→开关/预览/保存 | W/I/A：loading/error/invalid/ready，enabled开/关均ready预览；保存冲突/失败、重置取消、预览phone/多车道 | tasks-panel/useTasksForm/TasksBoardPreview；QA，S1确认真实卡片动作 | tasks-settings-page/preview/settings测试；无聊天页重复Tasks控件；设置保存与页面重进需实际host验证 |
| Tasks screen `tasks`、侧栏header `tasks`、Command Center `open-tasks` | W/I/A：启用时入口/计数、禁用后撤销；屏幕仍注册，关闭状态进入设置；lazy chunk加载、重连/卸载清理 | tasks/contribute、chunk、board-screen/sidebar-entry；编排检查注册，QA操作 | tasks-chunk及board测试＋真实入口导航证据；不能以直接mount Board代替Command Center/侧栏 |
| 时间线 tool_call／compaction→omp-tool-call | W/I/A：普通/brand/provider标记，运行/完成/失败，展开/复制/详情；Read/Bash/MCP/图片各选代表 | index.client、live-renderers、tool-callouts及领域正文；S3、QA | tool-disclosure/quiet-tool-rows/details-chrome与图片测试；真实事件→transformer→renderer全过程，fixture只覆盖内部组件 |
| reasoning→omp-reasoning；todo→omp-todo | W/I/A：流式追加/完成、收起展开、todo状态更新 | live-renderers、ReasoningCard/TaskList；QA | reasoning-segment/reasoning-preview/task-list/todo-timeline测试＋真实消息冒烟；不套卡片Collapse |
| user/assistant/error→各注册renderer | W/I/A：用户增强开/关及附件委托host；助手Markdown开/关、流式/完成/空内容；fatal error通知 | index.client/live-renderers、UserMessage/AssistantFooter/NoticeCallout；QA | assistant-transform/timeline-order等测试＋真实host消息；notification未注册独立transformer，不虚构插件拦截覆盖，host notice样式安装另核对 |
| Markdown/代码/表格/图片与选择复制 | W/I/A渲染；iOS单块双击、原生长按；W DOM选择；I/A表格手势与图片viewer | markdown、BlockSelection/table/selection-actions、image-preview；S3与QA | 第8.3节与下表用例；W/Android没有iOS BlockSelection wrapper，hover仅pointer适用；剪贴板失败/旧异步不越权关闭新选区 |
| 时间线→hover/press preview→details→返回 | W pointer hover/keyboard；I/A支持的press/详情sheet，非原生hover要求 | ui/hover-preview、details壳/toolbar、ToolPreviewContent；S3、QA | hover-preview/press-preview/preview-drag/details-settings-tool-pager测试；真实host租约、嵌套滚动、copy overflow、链接/返回；离线fixture不关闭该缺口 |
| Tasks卡片→子任务→sidebar/sheet；筛选/搜索/空态 | W宽/窄；I/A tablet与phone，UI14/21明暗；展开、Stop状态、fullwidth jump及返回 | board、SubtaskRow/SubtaskPanel、动作叶子；S1、QA | 下表深验；含初载/分页区别、平台动画、分组／车道测量、空隙关菜单、search位置／清除、filter scrollbar、详情排序、归档与子任务同步，提示草稿另标owner |

调试专用 `/bc-perf` 等入口仅在debug注册，不纳入正常用户界面冒烟，也不启动性能测试。全局通过还要求真实宿主浏览器集成证据；旧fixture27对像素相等无法替代。Settings Toggle的Web Space既有失败和VoiceOver/TalkBack未验继续开放，由编排负责人明确记录范围，不能因单测或Enter成功而关闭。

### 受影响路径深验

| 范围 | 相关实际测试文件（运行不等于要求修改） | 运行验收 |
| --- | --- | --- |
| 行／动作／文件夹 | `tasks-cards.test.ts`、`tasks-cards-web.test.ts`、`tasks-stop-control.test.tsx`、`tasks-subagent-type.test.ts` | 三入口长中英文、列宽0/240/241及字号缩放、全宽jump、所有mode折叠恢复、unread无空行、thinking按overflow缩写；状态AX恰好一次；Stop分体菜单、RPC失败、copy/open无冒泡 |
| 子任务展开 | `tasks-subtask-panel.test.tsx` | Web CSS/测量/退出timer/零高shell，native LayoutAnimation/native opacity/live cleanup；180/140、快切、中途reduce/hidden、初始恢复、动态子数／字号／高度、裁剪与scroll；收起后无可操作隐藏子树／订阅 |
| 看板／侧栏／预览 | `tasks-board-render.test.ts`、`tasks-board.test.ts`、`tasks-lane-loading.test.tsx`、`tasks-sidebar-model.test.ts`、`tasks-label-fit.test.ts`、`tasks-settings-preview.test.ts`、`tasks-settings-page.test.ts` | Web宽/窄、原生tablet、phone；主题/UI14/21、横竖屏／分屏；归档5车道不挤原4车道、空车道loading、横纵滚动、菜单height+6锚点、tabs标签一起恢复、floating resize与session恢复 |
| 工具栏分组／车道宽度／命中 | `tasks-board-render.test.ts`、`tasks-label-fit.test.ts` | Web full→车道菜单→icon-only往返；中英UI14/21、标签＋chrome＋三divider完整测量、临界宽度无振荡、选中状态/保存失败恢复；Web agent优先、左search／居中count／右actions；原生仅一个TabletToolbar；Range短标题与完整tip/AX。原生空隙关菜单不清筛选、不触发底层卡片；同trigger开关／换trigger／多选keepOpen／Android拖滚、菜单搜索focus；不是mock布局事件即运行通过 |
| 新搜索与覆盖 | `tasks-search.test.ts`、`tasks-search-first-prompts.test.tsx`、`tasks-first-prompt.test.ts`、`tasks-board.test.ts`、`tasks-board-render.test.ts` | 加载范围／四并发／关闭会话缓存／provider父资格、200ms与清空队列、分页无进展／错误重试、迟到结果使用当前query；metadata立即命中、pending不伪装完整空结果；真实RPC与重连单独记录 |
| Space与焦点／单行tablet | `tasks-board-render.test.ts`、`tasks-board-menu.test.ts`、`tasks-cards-web.test.ts` | Studio真实宿主W的Space开关/Enter/方向键/保持按下、Tab/嵌套动作/IME/板外input/contenteditable/Modal/menu/宿主capture；选择背景与细ring区分。I/A非compact在400/560/680/1000缩放阈值附近，UI14/21中英、横竖/分屏、完整居中count、View回退、44目标和menu锚点、搜索断点键盘／clear；phone独立入口不回归。mock不能证明真实viewport无溢出 |
| 筛选sheet滚动 | `tasks-filter-scrollbar.test.tsx`、`tasks-board-render.test.ts` | Web初始隐藏→滚动显示→连续scroll延长800ms→idle退场，仅scrolling期间hover着色、稳定gutter无文字跳动、主题变化／重复开关清理；I/A系统indicator与bottom8、软键盘与workspace focus滚动、footer始终在scroller外；实际拖滚和AX可达，不全局屏蔽滚动条 |
| 详情分区顺序 | `tasks-detail-model.test.ts`、`tasks-detail-columns.test.tsx`、`tasks-first-prompt.test.ts`、`tasks-last-message.test.ts`、`tasks-subagent-timeline.test.tsx`、`tasks-server.test.ts`、`tasks-cards.test.ts`、`tasks-cards-web.test.ts` | 真实消息timestamp、缺失/非法省略、本地跨日/时区与中英、完整hover、双列独立滚动；running/input/error/done、普通/provider child、prompt/message各存在组合；单列properties先、双列左hero/properties/subtasks、右prompt/message/其余；用户折叠选择、稳定section/card key、滚动／复制／文件夹动作／hover和无冒泡保留；不把model顺序等同双列屏幕几何 |
| 空态／提示 | `tasks-empty-state.test.tsx`、`tasks-card-hints.test.ts`、`tasks-sidebar-tips.test.tsx`（草稿） | 全板空／车道空／筛选无结果／历史加载有区别；文案和操作归容器；hover跨子动作、400ms、滚动/卸载关闭、底部向上、touch不弹 |
| 基础叶子 | `mark-icon.test.ts`、`image-format.test.ts`、`switch-track.test.ts`、`details-chrome.test.ts`、`quiet-tool-rows.test.ts`、`tool-disclosure.test.ts` | 前缀着色、普通Icon/Glyph不变；0/1023/1024/1536/1048576与两处零值条件；系统动效中途切换、唯一switch role |
| 上下文环 | `context-ring-bitmaps.test.ts`、cards测试 | 两变体、0/1/50/99/100，tint、mask、DPR、端帽与裁剪；生成资源证明不代替屏幕视觉 |
| Markdown 单块／表格／流式 | `markdown-block-selection.test.ts`、`native-markdown-prose.test.ts`、`markdown-table-copy.test.ts`，已有表格手势／selection相关用例 | Studio实际iOS双击仅一逻辑块、250/300ms和位移边界、拖滚／长按／多指不误选、链接/path只执行原动作、表格拖选／代码图片控件不被抢；source流式变化取消、已完成块复用、失败重试／旧copy完成不取消新选区；Web/Android无新增wrapper，长正文视图数变化不宣称性能通过 |
| 输入／辅助技术 | board-render及菜单相关现有测试；缺失交互断言按需补 | `/`、Esc、Tab、Enter/Space、IME组合、首字不refocus、清除契约、sheet软键盘；VoiceOver/TalkBack独立记录 |

每个最终候选在 Studio 运行匹配范围单测＋`npm run typecheck`，整合后完整单测、`npm run build:client`、`npm run check:hermes`；由测试负责人记录实际命令、源manifest、host版本、包hash及设备。既有 `tasks-stop-control.test.tsx` 必须纳入动作验证，只有补断言才列为写入文件。浏览器与native分别记证据；机械迁移预期不变，新交互按其指定差异验收。无设备或条件缺失明确保留，不以截图viewport替代原生。

### 9.1 已有证据的适用范围

| 检查点 | 已有报告／边界 |
| --- | --- |
| 原始规划9707与适配a868 | 三份盘点及两份advisor评审支撑目录／设计判断；不是全runtime覆盖。采纳了调用方AX、S1传递依赖、有限动作矩阵、输入属性与motion清理规格 |
| S0 through45064 | 已提交窄列、全宽度unread省略、权限全模式折叠、按overflow思考缩写；旧文档曾记录局部单测／Chrome检查，只证明当时版本，不继承到后来提交 |
| 冻结candidate01 | base `45064c6b551c21c89ce26d803f4eb27595d1bb1e`＋15文件，archive SHA256 `4b4b75b28bfa1eca19147b6321d0d06504dd624268cacce2e1ac7e5b1f9d97c5`；861源文件manifest |
| Studio candidate01报告 | baseline205文件/3934tests、candidate208/3977，类型／client build／Hermes通过；27组离线真实组件浏览器配对像素一致，S3c reduced切换另有预期差异。以上为外部QA报告，本轮未重跑 |
| candidate01 native | 报告包含自有实际宿主包的iPhone/iPad模拟器与Android phone条件验证、系统reduce切换及采样帧；不是物理真机全面验收。Android Codex比对已按相同行为／时序各采3次实际截图＋fresh AX（约640ms间隔），双方连续稳定，bounds均为[0,1885,1080,2022]，0 changed RGBA、无移位裁剪（`logs/android-codex-stability.json`）。Android tablet已有横屏UI14/21明暗cards/right details、14dark marks/images、21light filter证据；旋转、其余marks/images、settings preview、stop/busy、reduce OS仍未完整覆盖。iOS七工具交叉条件／thumbnail AX baseline／preview条件、全native A/B与VoiceOver/TalkBack仍缺；四个自有设备已关闭，源861项hash均匹配旧candidate01 |
| 最新main与脏交互 | 截止08f2的新增提交及并行提示／后续交互修改不在candidate01内；不能宣称全局通过。预存Web Toggle Space不切换／页面滚动而Enter可用，在baseline和candidate均出现，单独跟踪，不能算本轮引入或键盘通过 |

实施报告与候选manifest位于 `/tmp/better-paseo-refactor-20261024-FPps3Q/`，QA细节在 `qa/report.md`；临时路径只是追溯索引，上表保留持久必要信息。后续新增证据必须附自己的版本，不覆盖旧结果。

### 9.2 candidate02 验收结果（2026-10-25）

报告 `/tmp/better-paseo-refactor-20261024-FPps3Q/qa-02/report.md`（SHA256 `9c48f989…5241b1`）与 `execution-manifest.json`（`ad43a3b6…c16885`，Studio 同份）。对象为第7.1节冻结的 baseline02（08f2，869文件）与 candidate02（876文件），源 hash 全程复核一致；live Tasks chunk baseline `d72a69b9…`、candidate `96c28597…`。

| 层 | 结果 |
| --- | --- |
| 静态／单测 | 两侧 typecheck、build:client、check:hermes 通过。加共同测试修复（`candidate-02/common-test-fix.patch`，仅 `tasks-board-render.test.ts` 过期收起断言，早于4a动画）后完整单测 baseline 4077/4077、candidate 4120/4120，恰 +43 |
| 离线浏览器 | 6宽×明暗×UI14/21，123对 PNG 逐像素一致；动作折叠／菜单／busy 探针两侧通过 |
| 真实宿主 Web | 设置两 tab 预览／保存重进／重置取消、Command Center／侧栏入口、时间线详情头11对、设置整屏8对一致；子任务链路、首条消息搜索、Space 预览冒烟 |
| Native | iPhone、iPad、Android phone／tablet 各4个有限字号×主题（平板分布横竖并实际旋转）共 88 对受影响区域 bounds＋RGBA 一致；各设备 Stop 确认→busy disabled、预览、筛选、系统减弱动效 |
| 辅助技术 | iOS／Android AX 名称／role／state 两侧一致（iOS 偶发 StaticText 枚举差异两向出现，属快照）；Android phone TalkBack 实际焦点＋录音自动转写，不声称人工听验 |
| S3c | 预期差异：系统减弱动效下 candidate 即时到位，baseline 仍动画；普通140ms不变 |

过程中的像素差异均经稳定帧复拍归为截图时机（sheet 未静止、时钟、滚动、设置状态），原始失败证据保留。验收边界：native 只覆盖上述有限条件，不声称全方向笛卡尔积或整页逐像素；VoiceOver 无模拟器支持未执行。

**验证中发现的共同基线缺陷及处理（非重构切片，按第7.2节“具体缺陷以最小修复进入现有 owner”）：**

| 编号 | 缺陷与根因 | 处理 |
| --- | --- | --- |
| F1 | Web 上 role=switch 的 Settings Toggle、FilterSheet ToggleRow、工具栏 BarSwitch 按 Space 不切换且页面滚动：宿主 RNW PressResponder 只对 button／role=button 把 Space 当按压 | 新增 `client/ui/use-switch-space.ts`，仅 Web：keydown 阻止滚动、keyup 切换一次，忽略 repeat／修饰键／IME／子元素，失焦取消；role、AX、视觉与 native 不变；看板 Space 预览已排除工具栏焦点，仅补回归测试 |
| F2 | Android 平板 TabletToolbar 非 inline 搜索浮层与 View 菜单绘制在 toolbar 边界外，AccessibilityNodeInfo 屏幕边界被父矩形截成倒置矩形，UIAutomator／TalkBack 不可达（触摸可用） | 两个浮层移为 toolbar 之后的兄弟节点，菜单锚点由 toolbar／操作区／View 包裹层 onLayout 等价计算；定位层 box-none、仅打开且测量完成后挂载；位置与视觉要求像素不变 |
| F3 | Android Tasks 设置 FieldChip “Agent brand mark” 自然宽207.49 被分配207px，随机折行到第二行并被36px高度裁切且无省略号（baseline 3/3、candidate 2/3） | 本轮不修：RN Android 亚像素取整，插件侧最小改法只能把裁切换成省略号，属视觉取舍，交用户决定 |

另：`tasks-board-render.test.ts` 过期收起断言的测试修复（早于4a动画）同属共享层。

### 9.3 candidate03（共同基线前移）

用户在 08f2 后继续提交 `e435e37d…c0498f2d`（手机子任务开关移入工具栏、手机搜索动画），改动了 filter-sheet 与 board-render 测试。为使“测试过的组合 = 将提交的组合”，candidate03 以 `c0498f2d` 为共同基线：baseline03 = HEAD＋测试修复＋F1＋F2（873文件），candidate03 = baseline03＋同一15文件重构（880文件）。目录 `/tmp/better-paseo-refactor-20261024-FPps3Q/candidate-03/`，baseline tar `a945178e…`、candidate tar `667dda5b…`、shared patch `10fc5167…`、refactor patch `6b2fad3a…`，逐文件 hash 见 manifest。重构15文件内容与 candidate02 相同且 08f2 后未被新提交改动。2026-10-25 Studio 复测完成（报告 `qa-03/report.md` SHA256 `8a7ea147…feb5faff`，manifest `2f0b327d…cbcd8e`），未发现 candidate03 或 F1/F2 引入的回归：

| 层 | 结果 |
| --- | --- |
| 静态／单测 | 两侧 typecheck、build:client、check:hermes 通过；完整单测 baseline03 215文件 4118/4118、candidate03 218文件 4161/4161，恰 +43，skip 0 |
| 离线浏览器 | 重构矩阵123对 bounds／像素全0差异 |
| F1 | 真实宿主 Web 三控件 Tab／Space（恰一次、repeat 不重复、Shift+Space 忽略）／Enter、role/checked、窗口及祖先滚动不变、选中卡片预览不受影响；candidate02 同路径复现旧失败 |
| F2 | Android tablet（UI21 暗色竖屏）与 iPad（UI21 亮色竖屏）搜索浮层、菜单、Sort drill-down、关闭四状态7区域在同一 All 时间窗下位置相同、像素0；Android UIAutomator 可达且 bounds 有效、TalkBack 焦点朗读经录音自动转写；清除／菜单／backdrop 触摸不变 |
| 重构 A/B 抽查 | iPhone UI14 亮、iPad UI21 亮竖、Android phone UI21 亮、Android tablet UI21 暗竖各22区域，共88区域像素0；44对交互 AX 相同 |
| 新共同基线 | 手机工具栏子任务开关与搜索展开／收起两侧冒烟通过 |

边界：每台设备只抽一个条件，不声称完整笛卡尔积、整页像素或当前 main 之后的变更；iOS 模拟器无 VoiceOver，以 XCTest AX 替代，Studio 为共享机不开 macOS VoiceOver；Web 未跑屏幕阅读器全流程；本轮手机未重复 TalkBack 语音。过程中的光标闪烁、24小时完成窗口跨越截止、首次录音错过窗口、文件名标签错误及 iPad XCTest 收尾超时（守卫下终止自有进程）均如实保留，不计通过。提交方案见 `release-prep/`：8个补丁按序应用于 HEAD 的临时 index 后与 candidate03 逐字节一致；提交／推送／部署待用户确认。

## 10. 文档维护、剩余决策与范围

[design.md](design.md) 保持canonical；本次不修改。它已经明确所有mode折叠、unread不显示、thinking按宽度和共享身份状态规则，不重复补写。后续规范同步应只修正缺口：原“固定第三跳转列”改为只占标题右端，并把约381行正方形jump目标改为width22/32、height=line；动作helper owner改为迁移后的叶子；补充4a平台分别拥有的SubtaskPanel卸载／动效契约、当前工具栏agent优先／分组divider／车道宽度有限变体、settings-only Tasks入口、左搜索／居中计数／右动作、单行TabletToolbar与Space焦点／预览分离、首条消息搜索范围和覆盖提示、真实消息时间、sheet滚动条及模型拥有的properties优先顺序与打开文件夹平台边界，以及工具栏／侧栏／预览的已提交有限变体。规范增补不得把草稿写成已验收标准，亦不覆盖别人的修改。

剩余产品决策仅是尚未确定的设计变化：重置是否统一显式确认取消、permission.kind图标采用哪套、分段／复制／工具栏外观是否进一步统一。S0规则、已提交文件夹平台限制、内部文件组织与S2优先级不需再次征求产品选择。当前重构授权不等于提交／推送／部署授权；本轮仅文档更新。

复核记录：模型 `gpt-6-astra`、thinking `medium` 为父级已核验设置；本轮以当前源码、提交差异、既有报告和manifest为依据；历史记忆仅用于提醒版本证据边界，不作为源码契约依据。原始分析时间12:50:39–12:56:36仅属初始盘点；本次为2026-10-25分支增量全局复核。最新评审的两项major（动画共同基线、入口验收矩阵）和一项minor（jump宽高）已落实到规格；本次增量继续保留全部入口冒烟并加深第3.3节路径，不新增实现波次；这只关闭文档缺口，运行验收仍开放。源码覆盖是主要变更组件与依赖，不是所有历史时间线／Markdown／宿主分支的重新审计，亦不承诺性能或包体收益。最终仅回读本文、检查文档空白及只读HEAD/status；检查结果以交付回复为准。

### 10.1 截止点与并行修改

固定共同基线 `08f2bbb3a248a3ab629218dace7a0ebf56c2b287`，本轮从7113检查点复核上述九次提交。只读HEAD记录同为08f2；以后变化不继续追查。S1a/S3的15文件仍属未验收候选；details-sidebar/card-hints/subtask-row及相关测试、detail-cards/task-card重叠提示修改须按作者区分。未跟踪output/不是本任务产物，不读取其无关内容、不清理。候选02仅将明确归属patch叠到新共同基线，不能覆盖最新整文件或默认吸收全部dirty改动。

本轮仅写本文；design.md、生产代码、测试、配置、所有暂存／未暂存／未跟踪文件与Git状态均由原作者保有。候选02已冻结（第7.1节），不继承候选01的通过结论。
