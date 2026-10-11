# Beautiful Chat UI/UX 与渲染架构升级 — 交付报告

- 需求：`writing-block.md` v1.0（BC-01 ~ BC-14），交付结构按需求 §18
- 方案：`docs/plans/2026-10-11-ui-ux-rendering-upgrade.md`
- 代码：本地 `main@640dd9b`（基线 `42b61d8`），**未 push**；宿主改动在 Paseo 本地分支 `bc/host-small`（基于上游 `origin/main@7f9b65d46`），**未 push、未开 PR**
- 验证环境：Apple M5 Pro / macOS 27；Paseo 0.11.2；Chrome 155（Web 生产构建，作为 Electron 桌面端的代理）；iOS 模拟器 iPhone 16 Pro（Paseo 开发版构建）

---

## 1. 实施总结（BC-01 ~ BC-14）

| 编号 | 状态 | 说明 |
|---|---|---|
| BC-01 工具调用折叠 | **完成**（跨工具聚合除外） | 全部默认折叠为无框单行（≤32px）；`summarizeTool` 按类型生成摘要；展开状态以 `agentId:callId` 存在模块级仓库，完成、移入历史区、重新挂载都不会重置；失败时显示一行错误；协议中 search/fetch 等 7 种类型补齐分类。"Read 12 files"式跨工具聚合需要宿主分组 API（H3，未做） |
| BC-02 思考过程 | **完成** | 不再按空行编号；只识别真实结构（Codex `**标题**` 分段、多级标题）；默认折叠，流式时 header 单行实时预览；时长只在本端实际看到流式过程时显示，不伪造 |
| BC-03 工具 header 吸顶 | **未完成：需要宿主** | 插件拿不到滚动容器；方案已设计宿主 API `useTimelineStickyHeader`（H2b），未实施 |
| BC-04 用户消息吸顶 | **未完成：需要宿主** | 方案为宿主自有的吸顶栏，复用已有 prompt 索引（H2a），未实施 |
| BC-05 Markdown 引擎替换 | **完成** | 自研 `parse.ts` 已删除；改为 vendor 的 `marked@18`（Babel 去 class，兼容 Hermes）+ `remend` |
| BC-06 流式 Markdown | **完成** | 每条消息独立的增量分块缓存、定稿块 memo、只修复尾块；需求 §6.5 的九类未完成语法均无格式翻转 |
| BC-07 性能 | **完成**（个别极端场景见 §4、§7） | 见 §4 |
| BC-08 扁平化 | **完成** | Token v2 对齐宿主刻度和颜色；去掉阴影、磨砂、光晕（磨砂和光晕保留为可选开关，默认关闭）；统一 `DisclosureHeader` |
| BC-09 动画 | **完成** | 只保留 `RunningDot` 和展开淡入；删除 Breathe/Glow/Pop/Rotate/shimmer/轨道动画；全面支持 Reduced Motion |
| BC-10 快捷复制 | **完成** | `useCopy`/`CopyButton` 统一走 SDK `copyText`；桌面悬停、触控长按、`⋯` 菜单；复制的是原始内容 |
| BC-11 等宽字体可配置 | **完成** | 字体族和字号（10–22）可配置，带实时预览；修复了原生端代码显示为比例字体的问题；设置存在 daemon，各平台都能持久化 |
| BC-12 继承 Paseo 字体 | **插件侧完成；需要宿主 H1** | 0.11.2 宿主上回退到默认值并在设置页提示；H1 已在设备上验证：修改宿主字体后插件实时更新 |
| BC-13 路径相对化 | **完成** | `formatPath` 按路径段匹配多级根（workspace → 项目根 → cwd）；`PathText` 中间截断但始终保留文件名；点击或复制使用绝对路径 |
| BC-14 跨端适配 | **完成**（Android、iPad 未验证） | 按真实能力（能否悬停、是否触控）分支，不按 platform；触控设备上点击路径改为复制（`file.reveal` 只在 daemon 机器上生效）；跨端约束清单 8 条 |

需求 §14 要求保留的功能全部保留。唯一的行为变化：触控设备上点击路径由"在 daemon 机器的文件管理器中显示"改为复制绝对路径。

## 2. 代码修改清单

`42b61d8..640dd9b`：69 个非合并提交；插件源码（`client/`、`index.*`、`shared/`）88 个文件 +12,424 / −4,881。其余主要是测试、fixture、基准数据和文档。

| 区域 | 主要文件 | 修改原因 |
|---|---|---|
| 共享组件 | `client/ui/*`（disclosure-header、copy-button、use-copy、action-menu、path-text、running-dot、fade-in、use-reduced-motion、use-input-capabilities、tokens/*） | 统一视觉和交互（BC-08/09/10/13/14） |
| 状态与纯函数 | `client/state/*`（disclosure-store、latest-prompt）、`client/paths/*`、`client/copy/content.ts`、`client/tools/*`、`client/reasoning/segment.ts` | 展开状态持久、路径格式化、复制内容、工具分类与摘要、思考分段（都有单元测试） |
| Markdown | `client/components/markdown/{blocks,repair,lex}.ts`、`render/*`、`markdown-view.tsx`；`client/vendor/marked.js`；`tools/vendor-marked/` | BC-05/06 |
| 代码块 | `syntax-highlight.tsx`、`client/highlight.ts` | 开放 fence 不请求高亮；大代码块和终端输出先渲染 400 行再分批追加 |
| 卡片 | `tool-callouts.tsx`、`paseo-tool-callouts.tsx`、`hub-callout.tsx`、`reasoning-trace.tsx`、`task-list.tsx`、`user-message.tsx`、`notice-callout.tsx`、`system-card.tsx` | BC-01/02/08 |
| 渲染入口 | `client/live-renderers.tsx`、`index.client.tsx` | 语义化 memo；renderer 注册为普通函数；只有最新 prompt 跟随 agent 状态；传递 phase 和错误信息 |
| 设置 | `client/preferences.ts`、`shared/preferences-settings.ts`、`index.server.ts`、`settings-page.tsx` | 偏好 v2；用 SDK `defineSettings` 存在 daemon；新增设置项 |
| 调试与测量 | `client/debug/*`、`shared/perf-rpc.ts`、`/bc-perf` 命令 | 生产构建可用的性能探针（默认关闭，零开销） |
| 工具链 | `scripts/check-hermes.mjs`（`npm run check:hermes`）、`vitest`、`.showcase/replay*`、`tools/bench-provider/`、`test/fixtures/streams/` | Hermes 兼容门禁、单元测试、离线回放、真实宿主回放 |
| 已删除 | `markdown/parse.ts`、`breathe.tsx`、`pulse-dot.tsx`、`motion.tsx`、`shimmer.ts` | 旧引擎和装饰性动画 |

## 3. Markdown 方案说明

**最终选型：`marked@18`（块级分词 + 完整词法）+ `remend@1.4`（未闭合语法修复）+ 自研的增量分块和 React Native 递归渲染器；代码高亮继续用 daemon 端的 Shiki。**

| 候选 | 结论 | 原因 |
|---|---|---|
| react-native-streamdown | 不可用 | 依赖 Worklets 的 Babel/Metro 配置和 Fabric 原生模块（RN ≥ 0.83），插件既加载不了，也改不了宿主构建 |
| vercel/streamdown | 只借鉴算法 | 渲染层依赖 `react-dom`；借鉴了它的分块定稿规则（保留 Apache-2.0 声明） |
| Paseo 原生 Markdown | 不可用 | 没有开放给插件，而且每次整篇重解析 |
| 其他 RN Markdown 库 | 不可用 | 依赖 svg、reanimated、图标字体或 Nitro |

**兼容性**：宿主不经过 Babel 就直接执行插件代码，而 RN 0.81 的 Hermes 不支持 `class`（S0-D 实测）。所以 marked 经 Babel 预降级后 vendor 进仓库，生成可复现（`tools/vendor-marked/`）。仓库新增 `npm run check:hermes` 门禁：用 RN 自带的 `hermesc` 编译客户端 bundle，再在 Hermes VM 里跑一遍加载冒烟。

**性能优势（实测）**：定稿块重渲染 0；格式翻转在离线、Web、iOS 上都为 0（改造前 codeblock 10、table 6、history-100 25）；markdown-long 回复卡片 p95 从 7.7 降到 0.8ms（离线）；每个代码块只请求 1 次高亮。

**行为差异**：192 段 fixture 文本中，191 段的新旧渲染树完全一致；差异逐条记录在 `/tmp/bc-orchestrate/reports/S2.md`。setext 标题（`===` 下划线）在下划线到达时由段落变为标题，这是语法本身决定的。

## 4. 性能优化报告

详细数据见 `docs/bench/baseline-showcase.md`、`baseline-host.md`、`final-report.md`；原始快照在 `docs/bench/raw*`。

**测量方法**：插件内置探针（生产构建可用）；`tools/bench-provider` 回放 provider 在真实宿主上重放相同的 11 个场景流；离线回放每组跑 3 次取中位数；真实宿主每个 fixture 跑 1 次；iOS 跨会话的噪声约 2 倍，所以关键结论用同会话配对 A/B 确认。

**发现的问题与修复**

| 问题 | 修复 | 结果 |
|---|---|---|
| 活跃卡片自身渲染开销大（iOS reads-20 工具卡片 p50 152–290ms） | 默认折叠，折叠时不挂载展开体，去掉常驻动画 | iOS 降到 16.9ms；离线 p95 7.6 → 1.1ms |
| 流式时整篇 Markdown 重解析 | 增量分块和定稿块 memo | markdown-long p95 7.7 → 0.8ms（离线），iOS p50/p95 35.5/69.3 → 22.1/42.7ms |
| 大 diff 卡死 UI（iOS diff-large p50 2.2s） | 先渲染 400 行，分批追加 | iOS p50 2170 → 19.8ms；Web 堆内存 349 → 203MB |
| 循环动画不释放（history-100 结束时还有 414 个） | 只保留 `RunningDot`，且只在运行中挂载 | 0 |
| 每个 agent 状态变化都让所有用户卡片重渲染 | 只有最新 prompt 跟随 agent 状态 | Web history-100 用户卡片渲染 6156 → 110 |
| 设置同步组件挂在首张卡片上 | 单独 memo | iOS 用户卡片 p95 25.3 → 13.3ms（同会话配对 A/B，比改造前更快） |
| 宿主每次渲染都传新的 theme 和 data 引用 | 语义化 `React.memo`，tokens 按颜色字符串缓存 | 离线插件内部渲染 reads-20 1119 → 143 |
| 逐帧显示文字的 JS 开销 | 按平台决定：iOS 保留（开销增加 < 20%），Web 关闭（解析次数增加 262–321%） | — |
| 格式翻转、代码块闭合时高度回退 | 尾块修复规则（写到一半的闭合围栏、单独一行数字先不渲染） | 三个环境都为 0 |

**预算达成（方案 §3.2，以 Web 生产构建为准）**：非活跃卡片重渲染、定稿块重渲染、格式翻转、高度回退、每个代码块的高亮请求都达标。11 个 fixture 中 10 个的 commit p95 在 0.8–2.2ms（改造前 2–230ms），掉帧 0.1–0.5%（改造前最高 15%）。未达标的：`history-100` 场景（110 轮同时处在正在生成区，最大速度回放）p95 32.4ms；reads-20 在 Web 上有 1 个长任务。iOS 开发版的绝对数值不能和 4ms 预算直接比较，只看相对改进（各类卡片 2–6 倍）。

## 5. 宿主依赖说明

| 能力 | 归属 | 状态 |
|---|---|---|
| H5：插件客户端 bundle 降级 `class`（Hermes 兼容） | Paseo | **已实现并在设备上验证**（本地 `b78fa8121`）：原版 marked 和各种 class 写法在 iOS 上 14/14 通过；桌面打包冒烟通过 |
| H0：插件工具行与原生工具行的间距一致 | Paseo | **已实现并在设备上验证**（`3291fc51c`）：行距 46.2pt → 30pt（原生 32pt） |
| H1：`PluginTheme.typography` 透传宿主字体设置 | Paseo | **已实现并在设备上验证**（`c9dc6d447`）：修改宿主字体后插件实时更新 |
| H4：缓存 `toPluginTheme` 和 `safeParse` 结果 | Paseo | 未实现（实测收益小，插件侧语义化 memo 已覆盖） |
| H2a：当前轮 prompt 吸顶栏 | Paseo | 已设计，未实现（BC-04） |
| H2b：`useTimelineStickyHeader` 单元格吸顶 API | Paseo + 插件 S6 | 已设计，未实现（BC-03） |
| H3：跨 item 分组 API | Paseo | 后续项（BC-01 聚合） |
| 打开宿主内文件 tab 的导航能力 | Paseo | 后续项（远程和移动端的文件跳转） |
| 插件 bundle 压缩（H6 候选） | Paseo | 后续项 |

插件内部已实现的：§1 中除 BC-03/04 以外的全部内容。所有宿主新能力在插件侧都先做特性检测，旧宿主上自动降级。

另外发现一个与本次无关的上游缺陷：上游 main 的 iOS 开发版启动即红屏（`@xterm/headless` 在模块顶层读取 `navigator.userAgent`，早于宿主的 polyfill）。

## 6. 测试结果

| 层 | 结果 |
|---|---|
| 类型检查 `npm run typecheck` | 通过 |
| 单元测试 `npm test` | 30 个文件，585 个测试全过（基线 0 个） |
| Hermes 门禁 `npm run check:hermes` | 编译 OK（870,970 字节），加载冒烟 OK |
| 离线回放 | 11 个 fixture × 两种宿主模式 × 3 次，无页面或控制台错误 |
| Web 生产构建（桌面代理） | 11 个 fixture 各 1 次；设置在刷新后保留 |
| iOS 模拟器（开发版构建） | 插件能加载；11 个 fixture；文本选择、代码复制、路径复制、长按复制、横向滚动、Reduced Motion、设置在杀掉 app 重启后保留，均已验证 |
| 宿主改动（iPhone Air，从源码构建） | H5/H0/H1 通过；Paseo 相关包的单元测试通过（compiler 76、spacing/layout/projection 137、theme/apply 24） |
| 需求 §16.1 场景 | 1–7、9、10、14、15 通过；8 部分通过；11 需要 H2a/H2b；12 需要 H1（已在宿主分支上验证）；13 没能端到端验证（已有单元测试覆盖） |

## 7. 已知限制

1. **双层吸顶（BC-03/04）未实现**：需要宿主 H2a/H2b。
2. **跨工具聚合（"Read 12 files"）未实现**：需要宿主分组 API。目前用紧凑的单行代替。
3. **继承 Paseo 字体**需要宿主 H1 合入上游；当前 0.11.2 宿主上回退到默认值。
4. **未验证的平台**：Electron 桌面端本体（用 Web 生产构建代理）、Android、iPad 指针悬停、真机。
5. **设置按 daemon 共享**：SDK 只支持 host 级存储，所以同一个 daemon 下的所有客户端共享展示设置，并发修改时后写的生效。
6. **Bundle 体积**约 871KB（未压缩）。原生端用不上的字体数据（约 154KB）和品牌图标位图（约 137KB）可以改为按需从 daemon 获取；插件求值耗时约 15–20ms，对冷启动影响很小。
7. **极端场景**：110 轮同时处在正在生成区并按最大速度回放时，p95 仍为 32ms；Web 上长 Markdown 流式输出时贴底滚动带来的布局偏移约 0.59（改造前 0.64），这是流式聊天固有的。
8. **Web 端关闭了逐帧显示**：文字按 daemon 约 60ms 一批出现，换来约 3 倍的 JS 负载下降；可以通过一个开关改回来。
9. 在开发版模拟器上一次性展开 5000 行代码约需 30 秒；彻底解决需要宿主支持虚拟滚动。
10. 两条回复在同一毫秒到达且前 80 个字相同时，"最后一条"的判断可能出错；彻底解决需要宿主提供 item id。
