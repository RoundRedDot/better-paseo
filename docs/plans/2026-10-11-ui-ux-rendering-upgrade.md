# Beautiful Chat UI/UX 与渲染架构升级 — 设计方案

- 需求：`writing-block.md` v1.0（BC-01 ~ BC-14）
- 基线：本仓库 `main@42b61d8`（与 Paseo 实际安装的 checkout 同 HEAD）；插件 SDK devDep `@getpaseo/plugin@0.8.0`；本机 Paseo **0.11.2**（宿主源码核对于 `getpaseo/paseo@7868f5c`）
- 状态：已实施。交付记录见 [`docs/delivery/2026-10-11-delivery-report.md`](../delivery/2026-10-11-delivery-report.md)；相对官方插件的当前差异见 [`docs/fork-vs-upstream.md`](../fork-vs-upstream.md)。下文是实施前的设计，`file:line` 指向基线 `42b61d8`。

---

## 0. 结论摘要

| 编号 | 归属 | 方案一句话 | 详见 |
|---|---|---|---|
| BC-01 工具折叠 | 插件；间距需宿主 H0 | 全部默认折叠 + `summarizeTool` 摘要 + 以 `agentId:callId` 为键的展开状态仓库（修复移入历史区重新挂载导致的状态丢失）；折叠为无框单行；跨工具聚合留待 H3 | §3.3 |
| BC-02 思考精简 | 插件 | 不再按空行编号，只识别真实结构（Codex `**标题**` 分段、多级标题）；默认折叠，流式时 header 单行预览；折叠时不跑逐帧 reveal | §3.4 |
| BC-03 工具 header 吸顶 | 宿主 H2b + 插件 S6 | 宿主提供 `useTimelineStickyHeader`（native driver 限位），插件在展开的长卡片上接入 | §3.5 |
| BC-04 用户消息吸顶 | 宿主 H2a | 复用宿主已有的 prompt 索引与阅读位置，做成宿主自有的吸顶栏，原生端补齐；插件无改动 | §3.5 |
| BC-05/06 Markdown | 插件 | `marked@18` 分块 + `remend` 尾块修复 + 每消息增量缓存 + 块级 memo + 递归 RN 渲染器；开放 fence 不请求高亮；`MarkdownView` 接口保留 | §3.1 |
| BC-07 性能 | 插件；宿主 H4 根治重渲染 | 生产可用探针 + 回放 provider 建立可复现基线；修复"每个 chunk 让本轮所有卡片完整重算"等热点；预算化验收 | §3.2 |
| BC-08 扁平化 | 插件 | Token v2 对齐宿主刻度与颜色；去阴影、磨砂、光晕；统一 `DisclosureHeader`；一个块只用一种手段 | §3.6 |
| BC-09 动画 | 插件 | 只保留 `RunningDot` 和展开淡入；删除 Breathe/Glow/Pop/Rotate/轨道/shimmer；全面支持 Reduced Motion | §3.7 |
| BC-10 复制 | 插件 | `useCopy`/`CopyButton` 统一走 SDK `copyText`；`content.ts` 生成原始内容；悬停与长按双入口 | §3.8 |
| BC-11 等宽可配 | 插件 | `resolveTypography` 统一 tokens；修复原生端代码显示为比例字体；原生自定义字体用下拉 | §3.10 |
| BC-12 继承 Paseo 字体 | 宿主 H1 + 插件 | 宿主透传已有字体设置到 `PluginTheme.typography`；Web 端界面字体通过移除根节点 `data-pmono` 立即跟随 | §3.10 |
| BC-13 路径相对化 | 插件 | `formatPath` 按段匹配多级根（workspace → 项目根 → cwd，worktree 次级根带前缀）+ `PathText` | §3.9 |
| BC-14 跨端 | 插件 | 按真实能力（悬停、触控）而非 platform 分支；触控设备点击路径改为复制；七条约束 + 验证矩阵 | §3.11 |


---

## 1. 调研事实（方案依据）

### 1.1 宿主边界（Paseo 0.11.2）

- **插件客户端编译**：daemon 用 esbuild 打包，`bundle: true`、`platform: "neutral"`、CJS、**无 Babel/Metro**；external 仅 SDK 各入口、`react`、`react/jsx-runtime`、`react-native`、`zod`、`@tanstack/react-query`（`packages/server/src/server/plugins/compiler.ts:385-410`）。客户端以 `globalThis.eval` 执行，`runtimeRequire` 只解析上述模块（`packages/app/src/plugins/evaluate.ts:439-463`）。
  - 推论：**纯 JS 依赖会被内联进 bundle，可用**；需要原生模块、Worklets、Reanimated、Babel 插件、`react-dom` 的库**不可用**。README 第 12 条"闭合白名单"指的是 external，且基于 0.8.0 测得——实施第一步用冒烟构建复核。
- **Timeline**：原生端为 inverted `FlatList`（`agent-stream/strategy-native.tsx`），Web 端为自研 DOM 滚动器（`agent-stream/strategy-web.tsx`）；历史行包在 `React.memo` 的 `HistoryStreamRow` 内；正在生成区（`ListHeaderComponent`）每个 chunk 全部重渲染，且与历史区属于不同组件树，item 移入历史区时会重新挂载；插件项 key 为 `${pluginId}/${id}`（`plugins/timeline/projection.ts`）。宿主已有 `turn-boundary`、`chat-outline`、`reading-anchor`、`bottom-anchor-controller`，**没有面向插件的吸顶或视口 API**。
- **插件渲染粒度**：一个 timeline item 一个组件，props 只有 `{agentId, theme, host, layout, timestamp, item}`（SDK `client/contracts.d.ts`）。拿不到滚动容器、可视位置、所属 turn。
- **Transformer**：流式期间每个 chunk 都会重新调用，输出经 `JSON.parse(JSON.stringify())` 深拷贝，`item.data` 每次都是新引用（`plugins/timeline/model.ts`）。transformer 一进多出，但不能合并或隐藏相邻的其他 item。
- **字体**：宿主有用户外观设置 `uiFontFamily / monoFontFamily / uiBaseFontSize / contentFontSize / codeFontSize / contentMaxWidth / syntaxTheme`（`packages/app/src/appearance/apply.ts:14-22`），运行时写进 Unistyles theme；但 `PluginTheme` 在 0.11.2 仍**只有 colors**（`packages/plugin/src/contracts.ts:4-18`）。
- **Markdown**：宿主用 `react-native-markdown-display`（`components/markdown/renderer.tsx:23`），未暴露给插件，且是整篇重解析，不适合作为流式引擎。
- **可用能力**：`copyText`、`useToast`、`Icon`（Lucide）、`useRevealedText`、`useAgent`/`useWorkspace`（timeline 渲染器外层已有 `PluginClientStateProvider`，`plugins/timeline/view.tsx`）。`PluginWorkspaceSnapshot` 含 `projectRootPath`、`directory`、`kind`（worktree 等）；`PluginAgentSnapshot` 含 `cwd`。

### 1.2 插件现状（关键问题与证据）

| 领域 | 现状 | 证据 |
|---|---|---|
| Markdown | 每次 `text` 变化整篇 `parseMarkdown`；块 key 为位置索引；仓库内没有任何 `React.memo` | `markdown-view.tsx:199,208` |
| 未闭合语法 | 未闭合 fence 整块降级为 `plain`（显示源码，闭合瞬间切换为代码块 → 闪烁）；粗体、行内代码缺闭合符时按字面输出 | `parse.ts:172-174,617-618` |
| 高亮 | daemon Shiki RPC；两端各 200 条缓存，key 为整段代码哈希 → 流式中每个 chunk 都会 miss，重新 RPC | `client/highlight.ts:43-84`、`index.server.ts:395-437` |
| Reasoning | `revealed.split("\n\n")` 把每段都变成编号步骤；token/时长为伪造值；轨道动画 JS 驱动 + 每步 `onLayout` | `live-renderers.tsx:660-679`、`reasoning-trace.tsx:58-61,313` |
| 工具卡片 | running/failed 默认展开；展开状态是行内 `useState`，不随 props 同步；header 上 3 个 `Breathe` 常驻循环（含已完成卡片）；`PaseoToolCallout` 是嵌套的第三层卡片且默认展开 | `live-renderers.tsx:599-623`、`tool-callouts.tsx:62,453-518`、`paseo-tool-callouts.tsx:29-43` |
| 视觉 | 唯一的 `boxShadow` token 被 10+ 组件铺开；磨砂 `blur(14px)`；pointer glow；代码块在卡片内又用 `radius.card` 加阴影 | `theme-tokens.ts:190-233`、`syntax-highlight.tsx:523-531` |
| 复制 | 代码块走 `navigator.clipboard`（原生端无效且误报成功）；其他位置已用 SDK `copyText` | `syntax-highlight.tsx:478-481` |
| 字体 | Web 注入内嵌 Iosevka；原生端字体名未注册，代码显示为比例字体（S0-D 已在 iOS 模拟器确认）；根节点 `data-pmono` 使界面文字不跟随宿主 UI 字体；146 处 `fontSize` 字面量 | `embed-fonts.ts:28-53`、`theme-tokens.ts:21-29` |
| 路径 | 读写 header 显示绝对路径（且 `lineRange` 从未赋值）；diff 标题为绝对路径；没有任何相对化 | `tool-callouts.tsx:713,725` |
| 重渲染 | 宿主每次渲染都新建 theme 与 data 对象，正在生成区每个 chunk 全部重渲染，插件以引用为 memo 依赖 → 本轮所有卡片完整重算 | 宿主 `plugins/theme.ts`、`plugins/timeline/view.tsx`；见 §3.2 |
| 其他 | `ApprovalCard` 从未挂载；TodoList 只在挂载时把 props 复制进 state，之后不同步；仓库只有 `typecheck`，没有测试 | `approval-card.tsx:21`、`task-list.tsx:23` |
| 可复用 | `.showcase/`：基于 react-dom + RN-web shim 的离线渲染台，可扩展为性能回放台 | `.showcase/showcase.tsx` |

### 1.3 Markdown 库评估

| 方案 | 结论 | 决定性原因 |
|---|---|---|
| react-native-streamdown 0.3.0 | ✕ | 依赖 `react-native-worklets`（Babel 插件 + Metro Bundle Mode）和 `react-native-enriched-markdown`（Fabric 原生、RN ≥0.83）；插件无法加载；Web 端改为 DOM+WASM，且无法接入 Shiki、文件跳转和三种 variant |
| vercel/streamdown 2.7 | ✕（借鉴算法） | 渲染层依赖 `react-dom`/HTML；但其 `remend` 修复与 `parseMarkdownIntoBlocks` 分块策略值得采用 |
| Paseo 原生 Markdown | ✕ | 未暴露；`react-native-markdown-display` 整篇重解析，不是流式设计 |
| react-native-marked / @ronradtke markdown-display / nitro-markdown | ✕ | 分别依赖 svg、reanimated-table、矢量图标字体、Nitro 原生模块；流式只做"补一个闭合 fence + 整篇重解析" |
| **`marked@18`（MIT，纯 JS，gzip ≈14KB）+ `remend@1.4`（Apache-2.0，零依赖，gzip ≈6KB）** | ✓ | 成熟、维护活跃、CommonMark/GFM；`Lexer.blockTokens` 适合分块；未闭合 fence 按 CommonMark 当作代码直到文末；零原生依赖，iOS/Android/Web 一致 |

---

## 2. 总体架构

```
host item ──transformer──▶ plugin item (data + phase)
                              │
       Live*Renderer（语义化 React.memo；提供 PathContext）
                              │
   ┌──────────────── 共享原语（S1，client/ui/）────────────────┐
   │ DisclosureHeader  CopyButton/useCopy  ActionMenu  PathText │
   │ RunningDot  useInputCapabilities  useReducedMotion         │
   │ tokens: theme v2 / typography / motion   disclosure-store  │
   └────────────────────────────────────────────────────────────┘
        │                    │                     │
  MarkdownView          ToolCallout v2        Reasoning v2
  (marked + remend,     (classify/summarize,  (segment，折叠，
   分块缓存 + 块 memo)    折叠单行/展开加框)     complete 时不 reveal)
        │
  CodeBlock → SyntaxHighlightBlock（daemon Shiki，开放 fence 不请求）
```

新增模块（命名为建议，实施时按仓库习惯调整）：

| 目录 | 模块 |
|---|---|
| `client/ui/` | `disclosure-header.tsx`、`copy-button.tsx`、`use-copy.ts`、`action-menu.tsx`、`path-text.tsx`、`running-dot.tsx`、`use-input-capabilities.ts`、`tokens/typography.ts`、`tokens/motion.ts` |
| `client/state/` | `disclosure-store.ts` |
| `client/paths/` | `format-path.ts`、`truncate-middle.ts` |
| `client/copy/` | `content.ts` |
| `client/tools/` | `classify.ts`、`summarize.ts` |
| `client/reasoning/` | `segment.ts` |
| `client/components/markdown/` | `blocks.ts`、`repair.ts`、`lex.ts`、`render/*`；删除 `parse.ts` |
| `client/debug/` | `perf.ts` |
| 仓库根 | `tools/bench-provider/`（开发专用插件）、`test/fixtures/streams/`、`.showcase/replay.tsx` |

删除：`breathe.tsx`、`pulse-dot.tsx`、`motion.tsx`、`shimmer.ts`、`markdown/parse.ts`。

---

## 3. 分项设计

### 3.1 BC-05 / BC-06 Markdown 引擎（已确认）

**根因与事实**

| # | 事实 | 证据 | 影响 |
|---|---|---|---|
| 1 | 自研 `parse.ts`（687 行），注释称沙箱不允许 Markdown 库 | `parse.ts:1-13` | 0.11.2 编译器会内联纯 JS 依赖（宿主 `compiler.ts:385-410`），前提已不成立 |
| 2 | 每次 `text` 变化整篇解析；块 key 为位置索引；无块级 memo | `markdown-view.tsx:199,208` | 流式时每个 chunk 都重新解析并协调整条消息 |
| 3 | 未闭合 fence 降级为 `plain`，闭合瞬间切换为代码块 | `parse.ts:172-174` | 格式切换闪烁 |
| 4 | 未闭合粗体、行内代码按字面输出标记符 | `parse.ts:527-569,617` | 标记符先出现后消失 |
| 5 | 引用只支持纯文本段落；列表扁平化为 `depth`；无数学 | `parse.ts:44-53` | 嵌套结构渲染不正确 |
| 6 | 唯一调用点为 assistant 文本，且未透传 phase | `live-renderers.tsx:785`、`index.client.tsx:196-221` | 渲染层不知道是否在流式中 |
| 7 | 高亮缓存 key 为整段代码哈希，代码块边生成边请求 | `client/highlight.ts:43-84` | 每个 chunk 一次 RPC |
| 8 | streamdown 分块：块为原始字符串；"以 `\n\n` 结尾且后面已有完整块"才定稿；缓存为模块单例 | `streamdown/lib/parse-blocks.tsx:103-145` | 借鉴算法，不照搬单例 |
| 9 | `remend` 支持自定义 `handlers` | `remend/dist/index.d.ts` | 可补充自定义流式规则 |
| 10 | 宿主 `useRevealedText` 按积压量平滑节奏（daemon 60ms 合并，150ms 平滑放出） | 宿主 `agent-stream/text-reveal.ts:1-21` | assistant 可复用，节奏与原生一致 |

**架构**

```
text ──(流式)useRevealedText──▶ revealed
                                 │
       splitBlocks(revealed, cacheRef)     ← 每条消息独立缓存，借鉴 streamdown 定稿规则
                                 │ string[]
      ┌──────────────────────────┴──────────────────────────┐
定稿块: <MdBlock raw /> (memo，raw 不变即跳过)      尾块: <MdBlock raw={repair(tail)} open />
      │                                                     │ repair = remend + 自定义 handlers（仅流式）
lexBlock(raw)：marked.lexer，按 raw LRU 缓存 ──▶ token 树 ──▶ RN 递归渲染器
                                                     │
                       code → CodeBlock → SyntaxHighlightBlock（开放 fence 不发 RPC）
```

依赖 `marked@18`（MIT）+ `remend@1.4`（Apache-2.0），按 D5 作为 npm 依赖（S0 冒烟失败则 vendor）；分块逻辑移植自 streamdown `parse-blocks` 并保留 Apache-2.0 声明。不引入 streamdown 本体、remark/rehype、react-markdown。

**设计**

1. **接口**：`MarkdownView({ text, tokens, variant, streaming?, collapseCode?, onRevealPath? })`。`streaming` 来自 assistant transformer 透传的 `phase`（修复第 6 条）；`collapseCode` 供 Reasoning；`onRevealPath` 用于路径点击。调用点：assistant（三种 variant）、Reasoning 正文（compact）、工具输出中的 Markdown（compact）。
2. **分块与缓存** `markdown/blocks.ts`：`new Lexer({ gfm: true }).blockTokens()` + streamdown 合并规则（`space` 并回、`$$` 成对）；定稿规则：从倒数第 3 块向前找第一个以 `\n\n` 结尾的块，它及之前的块复用，只对其余部分重新分词；遇 footnote 或链接定义则整篇重新分词。缓存放在组件 `useRef`，每条消息一个；完整消息只分词一次并按 `text` memo。
3. **块渲染**：`MdBlock = React.memo`，比较 `raw`、`open`、`ctx` 引用；key `b${index}`（尾块增长不导致前块重新挂载）；块内 `marked.lexer(raw)` 按 `raw` 放入 LRU（500 条）；`ctx = { styles, tokens, metrics, variant, onRevealPath }` 按 `[tokens, variant]` memo，字体或主题变化只重建 ctx，不重新分词。
4. **流式修复**（仅尾块、仅 `streaming`）：

   | 情况 | 处理 |
   |---|---|
   | 未闭合粗体、斜体、删除线、行内代码 | `remend` 补闭合符 |
   | 未完成链接 | `linkMode: "text-only"`，完整后才可点 |
   | 未闭合 fence | marked 按 CommonMark 当作代码直到文末，从一开始就是代码块 |
   | 尾部单独的 `-`、`1.` | 自定义 handler：流式时暂不渲染该行 |
   | 尾部单独的 `#` | 同上 |
   | 表格只有表头 | 自定义 handler：尾块为单行 `\| a \| b \|` 时补一行分隔，直接按表格渲染 |
   | 表格末行写到一半 | marked 自动补齐单元格；列宽见第 6 条 |
   | 多行引用、嵌套列表 | marked 原生支持 |
   | setext 标题 | `remend` 的 `setextHeadings` |
   | 数学公式 | `katex`/`inlineKatex` 关闭（D6）；`$$…$$` 以 marked 块扩展渲染为等宽 TeX 原文块 |
   | `singleTilde`、`comparisonOperators` | 关闭，避免改写原文 |

   已完成的消息完全不经过修复。
5. **渲染器** `markdown/render/*.tsx`：递归渲染 marked token。块级：heading（最多 4 级）、paragraph、list（嵌套、task、`start`）、blockquote（可含列表或代码）、code、table、hr、`html`（按纯文本显示，不渲染 HTML）。行内：text、strong、em、del、codespan、link、image（按链接）、br、escape。样式完全复用 `VARIANT_METRICS` 与 `buildStyles`。**文件路径点击**：形如路径的 codespan 或链接文本渲染为 `PathText`（BC-13），点击走 `file.reveal`、长按复制。链接仍走 `openLink`（只允许 http/https/mailto）。保持 `Text selectable` 与 `selectionSurface`。
6. **表格**：横向 `ScrollView`，不超出消息容器；列宽按字符估算并限制在 `columnMin`–`columnMax`；流式期间每列宽度只增不减（块组件 ref 记录最大值），结束后重算一次。
7. **代码块** `CodeBlock`：头部显示语言标签和复制按钮（`copyText`，BC-10），横向滚动；开放 fence 只用本地正则着色，闭合或流式结束后发一次 RPC；缓存 key 改为 `theme + lang + length + fnv`；document variant 超过 30 行时显示前 20 行 +"展开（N 行）"，compact 配合 `collapseCode` 折叠为单行摘要；字体读 typography tokens（BC-11）。
8. **assistant 接入 `useRevealedText`**：节奏与原生一致，逐帧只影响尾块；若测量显示逐帧成本过高，由开关退回按 chunk 渲染。
9. **清理**：迁移完成后删除 `parse.ts` 和旧 `renderBlock`，showcase 中的引用一并迁移。

**测试**：vitest：`splitBlocks` 逐字符喂入时每一步都与整篇分词一致；§6.5 九类未完成语法的中间状态快照；用现有 showcase fixture 对照新旧渲染树，差异逐条确认。回放：长 Markdown、动态代码块、动态表格全程无原文/格式切换，列宽不回退。性能：首次渲染、每 chunk 耗时、定稿块重渲染次数（应为 0）、高亮 RPC 次数（每块 1 次）、bundle 体积增量。平台：桌面端 + iOS 模拟器，覆盖明暗主题、文本选择、代码复制、路径点击。

**写集**：`package.json`；`client/components/markdown/**`（新增 `blocks.ts`、`repair.ts`、`lex.ts`、`render/*`，删除 `parse.ts`）；`syntax-highlight.tsx`（代码块头部、开放 fence 不请求）；`client/highlight.ts`（缓存 key）；`index.client.tsx` 与 `live-renderers.tsx` 的 assistant 段。依赖 S0；`CopyButton`、`PathText`、typography tokens 来自 S1（未完成时先留接口）。模型：impl · gpt-6-luna Max，流式正确性有争议时升级 complex · Opus。

### 3.2 BC-07 渲染性能（已确认）

**新发现：每个 chunk 都会让当前轮所有插件卡片完整重算**

| # | 事实 | 证据 |
|---|---|---|
| 1 | 宿主每次渲染插件行都调用 `toPluginTheme(theme)`，每次新建 `colors` 对象 | 宿主 `plugins/theme.ts:4-19`、`plugins/timeline/view.tsx:18,101` |
| 2 | 宿主每次渲染都 `schema.safeParse(item.data)`，输出为新对象 | 宿主 `plugins/timeline/view.tsx:52,72` |
| 3 | `segments.liveHead` 每个 chunk 都是新数组，正在生成区的所有行都重渲染 | 宿主 `strategy-native.tsx:516-545` |
| 4 | 插件 tokens 依赖 `theme.colors` 引用，卡片数据依赖 `data` 引用，样式依赖 `tokens` | `live-renderers.tsx:397-402` 等 |

结论：流式期间本轮每张已完成的卡片都会重建 tokens、样式和数据并重渲染整棵子树；历史行受宿主 `React.memo` 保护。基线阶段用渲染计数器确认。

**S0 实测结论（`docs/bench/baseline-showcase.md`、`baseline-host.md`）**

| 发现 | 离线回放（当前宿主 / 缓存后） | iOS 模拟器开发版（仅作相对比较） | 结论 |
|---|---|---|---|
| 非活跃卡片随 chunk 重渲染 | reads-20 999 / 0；用户消息 990 次 | 用户消息卡只渲染 4–8 次 | 离线模型过于悲观；**H4 优先级下调**，S1 的语义化 memo 已做（成本低） |
| 活跃卡片自身渲染开销 | reads-20 工具卡 p95 52.9 / 5.4ms | reads-20 工具卡 p50 152 / p95 447ms；markdown-long p95 69ms；diff-large p50 2.2s | **主要瓶颈**：BC-01 默认折叠、BC-05 增量渲染、大代码块分批渲染优先级上调 |
| 整篇重解析 | markdown-long 509 次，p95 8.2ms | — | S2 |
| 格式翻转 | codeblock 10、table 6 | — | S2 |
| 循环动画不释放 | reads-20 结束时 72 个 | reads-20 结束时 33 个 | S3/S4/S5 |
| H0 间距 | — | 插件工具行间隔 24pt，宿主原生 0，每行多 22pt | H0 必要 |

S1 合并后（离线 `current`）插件内部渲染总数：reads-20 1119→143，mixed-turn 635→76，markdown-long 1022→511（剩余为流式中的回复，归 S2）。

**测量体系（S0）**

生产构建下 `<Profiler onRender>` 不会被调用，因此以自带探针为主，开发构建里的 Profiler 为辅。

1. **插件探针** `client/debug/perf.ts`（隐藏偏好 `debugPerf` 开启，关闭时零开销；`globalThis.__bcPerf.snapshot()/reset()` 读取，并输出 console 表格）：

   | 探针 | 方法 |
   |---|---|
   | 渲染计数（按卡片种类和 item） | render 内 ref 计数 |
   | 提交耗时 | render 开头 `performance.now()` → `useLayoutEffect` |
   | Markdown 分词次数与耗时、定稿块重渲染 | `splitBlocks`、`lexBlock`、`MdBlock` 计数 |
   | 格式翻转（同一块类型变化） | `MdBlock` 记录每个 index 的类型变化 |
   | 高度回退（流式时卡片变矮） | 仅 debug 模式在卡片根节点加 `onLayout` |
   | 高亮 RPC 次数 | `useHighlightedLines` 计数 |
   | 帧率 | `requestAnimationFrame` 间隔采样（全平台） |
   | Web 补充 | `PerformanceObserver("longtask"/"layout-shift")` |

2. **回放 provider（开发专用插件）** `tools/bench-provider/`：基于插件 SDK 的 provider API（`server/provider.d.ts`）按录制时间节奏发出 assistant/reasoning/tool_call 事件，不随 beautiful-chat 发布，本地 `paseo plugin install`。同一场景可在 Paseo 桌面端、Web 开发版、iOS 模拟器、Android 模拟器复现。fixture 放在 `test/fixtures/streams/*.jsonl`，覆盖需求 §16.1 第 1–10 项；来源为真实会话转换脚本 + 规模类生成器（100+ 条历史、5000 行 diff）。
3. **组件级回放** `.showcase/replay.tsx`：同一批 fixture 直接驱动组件，开发版 React 下可用 Profiler 和 Chrome Performance 火焰图。
4. **内存**：Electron/Chrome 回放前后堆快照；iOS 用 Xcode 内存仪表手动记录并注明。
5. **规程**：同机同构建类型，每场景 3 次取中位数，冷启动后回放，报告注明设备、构建类型和宿主版本。

**热点 → 修复 → 指标**

| 热点 | 修复 | 归属 | 指标 |
|---|---|---|---|
| 宿主每次给新 theme/data 引用 | 语义化 `React.memo`：已完成卡片只比较 `status` 和 `callId`；reasoning/assistant 只比较 `text.length` 和 `phase`；tokens memo 改按颜色字符串 key | S1 | 非活跃卡片渲染次数为 0 |
| 同上（宿主根治） | 宿主按 `theme` 缓存 `toPluginTheme`，按 `item.data` 引用缓存 `safeParse` | H4 | 所有插件受益 |
| 整篇 Markdown 重解析 | 分块、定稿复用、块级 memo | BC-05 | 每 chunk 耗时；定稿块重渲染为 0 |
| 格式翻转 | 尾块修复，未闭合 fence 直接当代码 | BC-05 | 翻转次数为 0 |
| 开放 fence 每 chunk 请求高亮 | 闭合后请求 | BC-05 | 每块 1 次 RPC |
| 常驻动画 | 删除，仅保留运行中指示 | BC-01/02/09 | 空闲帧率；长任务数 |
| 思考逐帧 reveal | 折叠时传 `complete` | BC-02 | 折叠时渲染次数约等于 chunk 数 |
| 逐步 `onLayout` → setState | 删除 | BC-02 | 提交耗时 |
| `useState` 重新挂载后丢失 | disclosure-store | BC-01 | 高度回退次数 |
| 卡片内联 style 对象 | 移入 `StyleSheet` | BC-08 | 提交耗时 |
| 大代码块一次挂载所有行 | > 400 行先渲染 400 行 +"显示全部"，展开后分批追加 | BC-07 | 展开耗时 |
| 表格列宽来回变化 | 流式期间只增不减 | BC-05 | 高度回退、布局偏移 |
| 超长完整消息首次渲染 | 先测量；超预算时 > 80 块分批挂载（首屏 40 块） | BC-07（视数据） | 首次渲染耗时 |

历史虚拟化、滚动锚定、"向上阅读时不被拉回底部"由宿主负责（inverted FlatList、`maintainVisibleContentPosition`、`BottomAnchorController`）；插件保证流式期间行高只增不减、折叠/展开不触发整条 timeline 重排，以"高度回退次数"验证。

**预算（初定，基线后调整；桌面端生产构建回放）**

| 指标 | 目标 |
|---|---|
| 非活跃卡片每 chunk 重渲染 | 0 |
| 流式提交耗时 p95 | ≤ 4ms 且较基线降低 ≥ 50% |
| 定稿 Markdown 块重渲染 | 0 |
| 格式翻转 | 0 |
| 高度回退（不含用户折叠） | 0 |
| 每代码块高亮 RPC | ≤ 1 |
| 60 秒回放长任务（> 50ms） | 0 |
| 掉帧比例 | < 5% |

iOS/Android 数值另列，模拟器数据注明"仅作相对比较"。

**交付**：按场景给出前后对比表（覆盖上表与需求 §16.2 的首次渲染、内存、大代码块展开），附回放录屏；缺失项标注"未测"及原因。

### 3.3 BC-01 工具调用（已确认）

**根因与事实**

| # | 事实 | 证据 | 影响 |
|---|---|---|---|
| 1 | 展开由 `ToolCallout` 内 `useState(defaultExpanded)` 决定；running/failed 默认展开 | `tool-callouts.tsx:62`、`live-renderers.tsx:599` | 运行中日志撑满屏幕 |
| 2 | 宿主把正在生成区放在 `ListHeaderComponent`，历史区放在 FlatList 单元格，属于不同组件树 | 宿主 `strategy-native.tsx:516-572`、`view.tsx:226` | item 移入历史区时必然重新挂载，`useState` 丢失，即"完成时展开状态被重置"的根因 |
| 3 | 插件 item id 为 `${sourceId}/0`，同一工具调用稳定 | 宿主 `plugins/timeline/model.ts:90` | 可用 `agentId + callId` 作状态键 |
| 4 | 审批卡片由宿主在 timeline 外渲染（`PermissionRequestCard`） | 宿主 `view.tsx:138-148` | 折叠不会遮挡审批 |
| 5 | 协议的 `search/fetch/worktree_setup/sub_agent/plan/plain_text` 未分类，全部落入默认 `bash` | 协议 `agent-types.ts:215-312`、`live-renderers.tsx:427` | grep 等被画成终端，无法生成摘要 |
| 6 | 宿主只在连续原生 tool_call 之间把间距设为 0；插件 item kind 为 `plugin`，走默认 16px | 宿主 `agent-stream/spacing.ts:36-55`、`layout.ts:325` | 20 次 Read 多出约 320px 空白（源码推论，S0 截图测量确认）→ 宿主 H0 |
| 7 | header 有 3 个常驻 `Breathe` + `Rotate`；tool 名与标题重复 | `tool-callouts.tsx:453-518` | 视觉噪声 + 持续开销 |

**设计**

1. **展开状态仓库** `client/state/disclosure-store.ts`：模块级 `Map`，键 `${agentId}:${callId}`（协议规定 tool_call 必有 callId；兜底用 `${agentId}:${name}:${hash(input)}`，不用会随 chunk 变化的 `timestamp`），`useSyncExternalStore` 订阅。只记录用户的主动操作，未操作时取默认值；工具完成、重新 transform、行重新挂载都不改变用户选择。仅存内存，LRU 2000 条，刷新后恢复默认。
2. **默认规则**：普通工具在 running/completed/failed 下都折叠；failed 在 header 下额外显示一行危险色的错误首行；`ask` 等待回答时展开（作答控件由宿主提供），回答后折叠为 `Ask · <问题> → <答案>`。设置项"工具详情"：全部折叠（默认）/ 失败时展开。
3. **摘要** `client/tools/summarize.ts`：`summarizeTool(data) → { verb, target, meta[], tone }`，表驱动单测。

   | 类型 | 示例 | 数据 |
   |---|---|---|
   | read | `Read · src/a.ts · L10–80` | `offset/limit`（补上从未赋值的 `lineRange`） |
   | write | `Write · src/a.ts · 120 lines` | `content` |
   | edit | `Edit · src/a.ts · +12 −3` | 统计 `unifiedDiff` |
   | shell/bash | `Bash · npm test · exit 0 · 1.2s` | 命令首行截断；非 0 用危险色 |
   | git | `Git · commit · <首行>` / `Git · push → origin/main` | 解析子命令 |
   | search（新） | `Search · "useAgent" · 8 files · 23 matches` | `numFiles/numMatches` |
   | fetch（新） | `Fetch · github.com · 200 · 12 KB` | `code/bytes` |
   | mcp / paseo | `server / tool · <关键参数>` | 现有 build 函数 |
   | task / hub / eval / github | 沿用现有标题 | — |
   | plan / plain_text / worktree_setup / sub_agent / unknown | `label` 或类型名 | 补齐分类 |

   分类逻辑从 `live-renderers.tsx` 拆到 `client/tools/classify.ts` 以便单测。路径先显示文件名，BC-13 完成后统一走 `formatPath`。
4. **Header**：单行，高 28（compact）/ 32（桌面）：`[状态位] Verb  target（等宽，中间截断）……  meta  ›`。状态位：完成为灰色工具图标，运行中为低频脉冲（仅 running 挂载），失败为 ✕。删除 3 个 `Breathe`、`Rotate`、重复 tool 名和文件类型 logo；chevron 静态。**折叠 = 无边框单行，展开 = 有边框块**，连续工具天然呈紧凑列表，无需知道相邻 item。
5. **展开体**：沿用现有详情组件，原始参数、内容和日志不删减，仅展开时挂载。`PaseoToolCallout` 去掉自身卡片外框和默认展开。
6. **跨工具聚合**（"Read 12 files"）本轮不做（D8），依赖宿主 H3。

**写集**：新增 `client/state/disclosure-store.ts`、`client/tools/classify.ts`、`client/tools/summarize.ts`；修改 `tool-callouts.tsx`（header/外框）、`paseo-tool-callouts.tsx`、`live-renderers.tsx`（tool 段）、`preferences.ts`、`settings-page.tsx`。

**验收**：单测覆盖各类摘要与仓库语义（用户选择优先、重新挂载后保留）；场景：20+ 次 Read 每行 ≤ 32px，running 时手动展开、完成并移入历史区后仍展开，failed 显示错误行，宿主审批卡片可见，刷新后全部折叠；平台：Paseo 桌面端 + iOS 模拟器截图。

### 3.4 BC-02 思考过程（已确认）

**根因与事实**

| # | 事实 | 证据 | 影响 |
|---|---|---|---|
| 1 | `split("\n\n")` 把每段变成编号步骤；无结构时伪造 "Thought Process" 步骤 | `live-renderers.tsx:660-689` | 无意义编号 |
| 2 | token = `length/4`，`durationMs = 0`，`agentModel = ""` | `live-renderers.tsx:675-679` | 显示伪数据 |
| 3 | 流式时默认展开，`useState` 不随 props 变化 | `live-renderers.tsx:701`、`reasoning-trace.tsx:23` | 生成时推挤正文；移入历史区重新挂载后又变成折叠 |
| 4 | JS 驱动的轨道动画（`useNativeDriver: false`）+ 每步 `onLayout`→setState + `Glow` 循环 | `reasoning-trace.tsx:33-69,313,320` | 每个 chunk 都触发测量和动画 |
| 5 | 正文为纯 `Text`；逐步点击只切换 live 数据从不设置的 `codeSnippet` | `reasoning-trace.tsx:307,348-360` | Markdown 不渲染；交互无效 |
| 6 | 宿主 `useRevealedText` 仅在 `streaming` 时运行 rAF | 宿主 `hooks/use-revealed-text.ts:39-45` | 折叠时传 `complete` 可避开逐帧渲染 |
| 7 | 宿主把连续思考片段累积为一个 `ThoughtItem`，且每个 chunk 都更新 `timestamp` | 宿主 `types/stream.ts:990-1000` | 拿不到开始时间，`timestamp` 不能作身份键 |
| 8 | transform 和渲染器都拿不到 item id | SDK `client/contracts.d.ts` | 思考过程需要另造稳定键 |
| 9 | Codex 推理摘要以单独一行 `**标题**` 分段；Claude thinking 为连续散文 | 本机 `~/.codex/archived_sessions/*.jsonl` 的 `summary_text` | 这是可识别的"真实步骤结构" |

**设计**

1. **结构识别** `client/reasoning/segment.ts`：`segmentReasoning(text) → { kind: "sections", sections: {title, body}[] } | { kind: "prose", body }`。sections 的条件：≥1 行单独成行的 `**标题**`（首段前的内容作为无标题引言），或 ≥2 个同级 Markdown 标题。其余一律 prose，不切分；有序列表交给 Markdown 渲染，不另编号。流式时只扫描新增部分加一行回溯。
2. **状态键**：`agentId + hash(文本前 80 字符)`（文本只追加，开头稳定），与 BC-01 共用 disclosure-store。
3. **默认折叠（流式时也折叠）**，单行 `DisclosureHeader`：

   | 状态 | header |
   |---|---|
   | 流式 · sections | `◌ Thinking · <当前段标题>` |
   | 流式 · prose | `◌ Thinking · <最后一个完整句子>` |
   | 完成 · sections | `Thought · 4 steps · 12s` |
   | 完成 · prose | `Thought · <首句> · 12s` |

   `◌` 只在流式时挂载；完成后为灰色 Brain 图标。时长只在本端实际看到流式过程时显示（store 记录首次渲染时间，完成时用宿主最后更新时间相减）；历史对话不显示，不伪造。删除伪造的 token 数。
4. **展开体**：sections 显示小标题（12.5 半粗，不编号，左侧细竖线）+ 正文；prose 直接渲染；正文统一用 `MarkdownView variant="compact"`。单段 > 约 600 字时显示前 6 行 +"展开"（字数阈值，不做布局测量）。fenced code 默认折叠为 `code · ts · 24 lines ›`（MarkdownView 的 `collapseCode` 选项，随 BC-05 实现）。每段可复制原文（BC-10）。
5. **性能**：折叠时 `useRevealedText(text, "complete")`，仅"展开且流式"时传 `streaming`；折叠不挂载展开体；删除轨道、逐步 `onLayout`、`Glow`、`Breathe`、`Rotate`；已完成段按 `body` 字符串 memo。
6. **保留**：`ReasoningTraceData` 与 showcase mock 的结构；`thinking` 工具卡片的展开体改用同一套段落渲染，避免两套思考样式。

**写集**：新增 `client/reasoning/segment.ts`；修改 `reasoning-trace.tsx`、`live-renderers.tsx`（reasoning 段）、`tool-callouts.tsx`（thinking 工具展开体）。依赖 BC-01 的 disclosure-store 与 `DisclosureHeader`；`collapseCode` 依赖 BC-05。

**验收**：单测覆盖 Codex 加粗标题、多级标题、纯散文、含有序列表的散文（不得识别为步骤）、标题行被 chunk 截断、引言段；场景：流式期间正文不被推动且 header 预览持续更新，展开后无轨道和编号动画，完成并移入历史区后展开状态保持，历史对话不显示时长，长段折叠，代码块默认折叠；性能：折叠时渲染次数约等于 chunk 数而非帧数，纳入前后对比；平台：桌面端 + iOS 模拟器。

### 3.5 BC-03 / BC-04 双层吸顶（已确认，依赖宿主）

**需求 §5.4 的四个问题**

| 问题 | 结论 | 证据 |
|---|---|---|
| 插件能否获取当前活动 Turn | 不能；宿主内部有 `turnId`，未透传 | SDK `client/contracts.d.ts`；宿主 `projection.ts:108` |
| 插件能否读取或监听可视位置 | 不能；宿主 Web 端有"阅读位置 → 当前 prompt"机制，原生端没有 | 宿主 `chat-outline/model.ts:34-48`、`strategy-web.tsx:690`、`view.tsx:1019-1024` |
| 插件有无滚动容器控制权 | 无；插件是 FlatList 单元格或 `ListHeaderComponent` 中的一行 | 宿主 `strategy-native.tsx:562-592` |
| 宿主有无原生 sticky 机制 | 无可用的；原生为 inverted FlatList，Web 为自研 DOM 滚动器 | 同上；`strategy-web.tsx:1200-1205` |

宿主已具备第一层所需的大部分数据：daemon `list_prompts` 索引（每条含 `seq/timestamp/preview`，`protocol/messages.ts:4681-4695`）、`resolveActivePromptSeq()`、可跳到未加载窗口的 `jumpToPrompt(seq)`（`use-chat-outline.ts:150-185`）；目前只服务 Web 端 outline，索引请求被 `isWeb` 拦截（`use-chat-outline.ts:85`），原生 rail 返回 `null`。

**H2a：当前轮 prompt 吸顶栏（宿主自有功能，插件无需新 API）**

| 部分 | 改动 | 文件 |
|---|---|---|
| 原生端阅读位置 | FlatList 加 `onViewableItemsChanged`；inverted 下 index 最大的可见行即视觉最顶行，交给现有 `handleReadingPositionChange` | `strategy-native.tsx` |
| 原生端拉取 prompt 索引 | 去掉 `isWeb` 拦截；无索引时兜底用已加载的 `user_message` 文本 | `chat-outline/use-chat-outline.ts:85` |
| 显隐判定 | 当前 prompt 自身那一行不在视口内时才显示；Web 用 reading-anchor 行几何，原生用可见行集合 | `view.tsx`、`reading-anchor.ts` |
| 吸顶栏组件 | stream 容器顶部绝对定位，单行 `你：<preview>…`，高 32（compact）/ 36；点击调用 `jumpToPrompt(seq)`；移动端长按展开至 3 行；120ms 渐变；不占布局，正文不跳动 | 新建 `agent-stream/sticky-prompt-bar.tsx`，挂载于 `view.tsx` |
| 对外暴露栏高 | `stickyInset: Animated.Value`（可见为栏高，隐藏为 0），供第二层使用 | `view.tsx` context |
| Safe Area | stream 容器已位于 app header 之下，吸顶栏贴容器顶部，不额外加；iOS 模拟器验证刘海与横屏 | — |

active prompt 经 `createActivePromptPublisher` 节流，不会每帧 setState。

**H2b：单元格吸顶 API（插件工具 header 用）**

SDK 新增（`@getpaseo/plugin/client/react-native`）：

```ts
/** 让单元格内的 header 在本单元格范围内吸顶；返回已限位的 translateY（视觉向下为正）。宿主不支持或 enabled=false 时返回 null。 */
useTimelineStickyHeader(options: { headerHeight: number; enabled: boolean }):
  Animated.AnimatedInterpolation<number> | null
```

宿主实现：每个插件行（历史区单元格**和正在生成区的行**，运行中的工具就在后者）外包一层 `onLayout`，记录内容坐标 `y` 与高度 `h`（仅布局变化时更新）；原生端换成 `Animated.FlatList`，`onScroll` 改为 `Animated.event(..., { useNativeDriver: true, listener: 现有 handleScroll })`；限位只在布局变化时于 JS 重建，滚动全程走 native driver：inverted 下 `hiddenTop = scrollY 线性变换 + (y + h − viewportHeight) + stickyInset`，`translateY = hiddenTop.interpolate({ inputRange: [0, h − headerHeight], outputRange: [0, h − headerHeight], extrapolate: "clamp" })`。Web 端在现有 DOM 滚动回调中按 reading-anchor 几何 `setValue`，接口一致。文件：宿主 `packages/plugin/src/client/react-native.ts`、`contracts.ts`、`app/src/plugins/timeline/view.tsx`、`agent-stream/strategy-native.tsx`、`strategy-web.tsx`、`app/src/plugins/evaluate.ts`。

**插件侧（S6）**：仅在"已展开且卡片高度 > 视口 60%"时 `enabled: true`；header 加 `transform: [{ translateY }]`，吸顶时用不透明 `surface0` 背景加底部细线；header 限制在本卡片内，卡片结束时被推走；偏移已扣除 `stickyInset`，始终位于 prompt 栏下方，两层不重叠；吸顶时仍可点击折叠。

**降级**：hook 返回 `null` 时不吸顶；超长展开体底部加"收起 ↑"；定位用户问题依赖宿主 outline 与 H2a（插件已通过 `promptRowAnchor` 接入）。

**不在插件内实现的原因**：CSS `position: sticky` 仅 Web 有效，违反需求 §13.3；插件拿不到滚动偏移；DOM 注入只覆盖 Web 且脆弱，需求明确禁止。

**归属**：BC-04 完全由 H2a 交付（插件无改动）；BC-03 由 H2b + S6 交付。

**验收**：宿主单测覆盖显隐判定与 inverted/非 inverted 下的 `hiddenTop` 和限位（纯函数）；宿主 Web e2e 参照 `e2e/browser/agent-stream-smoothness.spec.ts` 新增 sticky spec（出现、切换、点击跳转、两层不重叠）；真实平台：Paseo 桌面端 + iOS 模拟器（刘海、横屏）+ Android 模拟器，滚动不闪烁、流式时 header 不抖动；场景：需求 §16.1 第 9、11 项。

### 3.6 BC-08 视觉扁平化（已确认）

**现状**

| 项目 | 现状 | 证据 |
|---|---|---|
| 阴影 | `boxShadow` token 铺到 10 个组件（`tool-callouts.tsx` 8 处） | `theme-tokens.ts:227-233` |
| 磨砂、光晕 | 8 个组件挂 `frosted`/`glowing()`；偏好默认开启 | `preferences.ts:56-57` |
| 圆角 | `card 12 / block 8 / chip 5`，另有 `999/4/3/1/0.5` 字面量 | `theme-tokens.ts:12` |
| 嵌套 | 工具卡片 → 代码块（仍为 card 圆角 + 阴影 + 磨砂）→ `PaseoToolCallout` 第三层 | `tool-callouts.tsx:121-129`、`syntax-highlight.tsx:523-531` |
| Header | 5 套尺寸（tool 10/6、reasoning 14/10、code 12/6、task 16/14、paseo 12/8），底色各异 | 各组件 `header` 样式 |
| 底色 | `surface2` 16 处、`surface1` 12 处、`surfaceGlass` 11 处、`accentBg` 7 处 | — |
| 图标 | 12/13/14/15/16 混用 | — |
| 宿主颜色 | 插件忽略宿主 `surface1/surface2`，用前景色加透明度推导 | `theme-tokens.ts:184-185` |

参照宿主原生工具行（`components/message.tsx:1103-1180`）：圆角 lg 8、内边距 8/4、图标位 22、标签 base 14、行距 4、组末 16。

**设计**

1. **Token v2**（`theme-tokens.ts`）

   | Token | 新值 |
   |---|---|
   | `radius` | `card 8 / block 6 / chip 4 / pill 999`（宿主 lg/md/base/full），不再有其他字面量 |
   | `space` | `4 / 8 / 12 / 16`（宿主 `SPACING`） |
   | `surface1/2` | 直接使用宿主 `theme.colors.surface1/surface2` |
   | `surfaceCode` | 沿用推导值 |
   | `border` / `borderSubtle` | 外框 / 内部分隔 |
   | `boxShadow` | 仅浮层使用，改名 `elevation.overlay` |
   | `surfaceGlass` | 删除，统一 `surface0` |

2. **磨砂、光晕默认关闭**：偏好 schema 升级 v2，迁移时一次性把 `frostedGlass`、`pointerGlow` 重置为 `false`（v1 无法区分主动开启与默认值）；设置页保留开关。
3. **一个块只用一种手段**：折叠的工具/思考为无边框无底色单行；展开时 1px `border` + 圆角 8 + `surface0`，header 与展开体之间一条 `borderSubtle`；卡片内的代码块/diff 用圆角 6 + `surfaceCode`、不加边框；成功不着色（图标 muted），运行中为 accent 小指示，失败/需操作用状态色文字加图标、不铺大面积底色；Web 悬停 `surface1`、按下 `surface2`。
4. **`DisclosureHeader`**（`client/ui/disclosure-header.tsx`）：高 30（桌面）/ 28（compact）；水平内边距 8；图标位 16、图标 14；间距 6；verb 14 medium `foreground`；target 13 等宽、中间截断；meta 12 `foregroundMuted`、等宽数字；chevron 14 muted 静态。字号先固定，H1 落地后跟随宿主 UI 刻度。
5. **组件统一**

   | 组件 | 改法 |
   |---|---|
   | Tool / Reasoning | `DisclosureHeader`，折叠单行、展开加框 |
   | Code Block | header 28 高、无底色带，左语言标签右复制；去阴影、磨砂、card 圆角 |
   | Diff | 同代码块；标题用 `PathText`；保留"相邻增删行连成一块" |
   | 文件列表 | 行高 24，`PathText`，悬停 `surface1` |
   | Task / Checklist | 头部 `Tasks · 3/7` + 2px 进度线（无动画）；条目行高 24；去玻璃、阴影、大内边距 |
   | 用户消息 | 保留右对齐气泡，去阴影和边框，仅 `userSurface` 底色；圆角对齐宿主原生用户消息 |
   | Notice / System | 行样式；错误为左侧 2px `statusDanger` 竖线 + 红色文字 |
   | Hub / Paseo callout | 只改外框和 header |
   | Approval | 不改（D7） |
   | Markdown | 无外框；引用 2px muted 竖线；行内代码 `surface2` 底、圆角 4、内边距 1/4；表格细线，表头加粗 + `surface1` |

6. **内容宽度**：宿主已用 `contentMaxWidth`（默认 820，可配置）约束 stream 栏，插件无需另做宽屏处理。

**验收**：showcase 每个组件前后对比截图（明暗各一套）；静态检查 `rg "boxShadow|frosted|glowing\(" client/components` 只出现在浮层组件，`rg "borderRadius: [0-9]"` 为 0；Paseo 桌面端 + iOS 模拟器截图中插件卡片与宿主原生元素（输入框、审批卡片）的圆角、字号、间距一致；内联样式移入 StyleSheet、去 blur 的收益计入 BC-07 报告。

**写集**：S1：`theme-tokens.ts`、`client/ui/disclosure-header.tsx`、`preferences.ts`（v2 迁移）、`frosted.ts`/`glow.ts`；S3/S4 套用到工具和思考卡片；S5：`syntax-highlight.tsx` 外框（S2 合并后）、`task-list.tsx`、`user-message.tsx`、`notice-callout.tsx`、`system-card.tsx`、markdown 渲染样式、`settings-page.tsx` 文案。

### 3.7 BC-09 动画（已确认）

**盘点**

| 动效 | 实现 | 调用点 | 问题 |
|---|---|---|---|
| `Breathe` 缩放呼吸 | `Animated.loop`，Web 不用 native driver | 6 处（工具 header ×3、思考图标、任务、hub） | 工具卡片的 3 个未传 `active`，完成后仍在呼吸 |
| `Glow` 光晕脉冲 | `Animated.loop` + 缩放 | 思考当前步骤、任务进行中 | 装饰性循环 |
| `PulseDot` | `Animated.loop` 透明度 | 工具运行中 ×2、思考中、任务进行中 | 合理但三处各自实现 |
| `Rotate` chevron | 180ms timing | 5 处 | 每行一个 Animated 节点 |
| `Pop` 弹跳 | 放大至 1.35 + spring | 代码复制、用户消息复制 | 需求禁止弹跳与明显缩放 |
| 思考轨道 | 高度 timing 420ms，`useNativeDriver: false` | 思考展开体 | JS 线程 + 布局测量 |
| 任务进度条 | 宽度 timing 320ms，`useNativeDriver: false` | 任务头部 | 动画布局属性 |
| Shimmer | CSS 4.8s 无限循环（仅 Web） | hub 运行中 | 装饰性循环 |
| 磨砂、指针光晕 | CSS | 8 个组件 | BC-08 已默认关闭 |
| 设置页开关 | 140ms timing | 设置页 | 交互反馈，保留 |

Reduced Motion：只有 shimmer、glow 两处 CSS 处理了；所有 `Animated` 动画和 frost 均未处理。宿主的 `useReducedMotion` 来自 reanimated，插件不可用。

**设计**

1. **token 与 hook**（`client/ui/tokens/motion.ts`）：`duration.fast = 120`，`easing = out-cubic`，不提供 spring 和缩放。`useReducedMotion()` 使用 `react-native` 的 `AccessibilityInfo.isReduceMotionEnabled()` 并订阅 `reduceMotionChanged`（RN-web 底层为 `matchMedia`，一套代码覆盖原生和 Web），模块级单次订阅，组件经 `useSyncExternalStore` 读取。开启后所有时长为 0，运行指示改为静态点。
2. **只保留两类动效**：
   - **`RunningDot`**：6px 圆点，透明度 1.0↔0.4，周期 1200ms，原生走 native driver；替代 3 处 `PulseDot` 与 hub shimmer；只在 running/thinking 时挂载。
   - **展开淡入**：展开体透明度 0→1，120ms，native driver；收起立即消失；不做高度动画。

   宿主吸顶栏进出由 H2a 负责；设置页开关过渡保留。
3. **删除和替换**：`Breathe`、`Glow` 删除；`Pop` 改为复制图标切换为勾 1.2s（与 BC-10 `CopyButton` 统一）；`Rotate` 删除，chevron 静态切换 `ChevronRight`/`ChevronDown`；思考轨道删除（BC-02）；任务进度条去掉动画；删除 `shimmer.ts` 及 `index.client.tsx` 中的注入；磨砂补 `prefers-reduced-motion` 规则。删除文件：`breathe.tsx`、`pulse-dot.tsx`、`motion.tsx`、`shimmer.ts`。

**验收**：`rg "Animated.loop" client` 只出现在 `RunningDot`，`rg "useNativeDriver: false" client` 为 0；无运行中项时插件动画数为 0（perf 探针统计 `RunningDot` 挂载数，Web Performance 面板确认空闲无插件动画帧）；每个运行项只有 1 个 `RunningDot`，完成即消失；在 macOS、iOS 模拟器"减弱动态效果"、Chrome 模拟下切换 Reduced Motion，动画实时停止；展开只有淡入、无布局抖动（与 BC-07 高度回退指标一起验证）。

**写集**：S1：`client/ui/tokens/motion.ts`、`client/ui/running-dot.tsx`、`useReducedMotion`；S3/S4：工具与思考卡片去掉旧动效；S5：`task-list.tsx`、`hub-callout.tsx`、`user-message.tsx`、`syntax-highlight.tsx` 复制反馈，删除四个旧文件，frost 补规则。

### 3.8 BC-10 快捷复制（已确认）

**现状**

| # | 事实 | 证据 | 问题 |
|---|---|---|---|
| 1 | 代码块复制用 `navigator.clipboard`，成功或失败都显示"已复制" | `syntax-highlight.tsx:476-482` | 原生端无效且误报 |
| 2 | 用户消息、回复 footer 用 `copyText`，各自维护状态和计时器 | `user-message.tsx:90-100`、`turn-footer.tsx:57-68` | 三套实现；计时器不清理 |
| 3 | Web 端 DOM 选区浮动工具条（Copy / Add to chat）已走 `copyText` | `selection-actions.ts:240-275` | 保留 |
| 4 | 工具输出、命令、路径、思考段落、diff 无复制入口 | — | 主要缺口 |
| 5 | SDK 提供 `copyText`（失败时 reject）与 `useToast` | SDK `client/react-native.d.ts` | 统一使用 |
| 6 | 移动端 `Text selectable` 由系统接管长按 | RN 行为 | 可选中文本上不能绑长按 |

**设计**

1. **基础设施**：`useCopy()` → `copy(text, { feedback: "icon" | "toast" })`，返回 `{ copied, copy }`；成功时图标变勾 1.2s 或 toast"已复制"；失败时 toast"复制失败"且不进入 copied；卸载时清理计时器。`CopyButton` 图标 14、触控区 ≥ 32、标签不可选中。替换代码块、用户消息、回复 footer 三处实现。
2. **复制内容**（`client/copy/content.ts`，表驱动单测）：只复制原始内容，不带编号、图标、行号；终端输出去 ANSI。

   | 来源 | 主复制 | 菜单其他项 |
   |---|---|---|
   | Bash / Shell / Git | 命令 | 输出（stdout+stderr）；命令+输出 |
   | Read / Write | 绝对路径 | 文件内容 |
   | Edit | 绝对路径 | patch；新内容（协议 `newString`，或从 diff 提取） |
   | Search | 查询词 | 结果文件列表（绝对路径） |
   | MCP / Paseo | 结果文本 | 参数 JSON |
   | 思考段落 / 整段 | 该段原文 / 全文 | — |
   | 代码块 | 代码原文 | — |
   | `PathText` | 绝对路径 | — |

   规则："主复制 = header 上显示的对象"。
3. **入口**

   | 位置 | 桌面 / Web | 移动端 |
   |---|---|---|
   | 工具 header（折叠） | 悬停时右侧浮现 `复制`、`⋯`，绝对定位覆盖 meta，无布局位移 | 无按钮；iOS/Android 长按 header 弹出与桌面 hover 相同的预览，居中于 header/tab 栏（100）与输入框（120）之间，与行同宽，最高为这段区域上下各留 16（与桌面最大化预览相同），正文长按出光标选择；`复制`、`⋯` 和自动换行开关（默认开，关闭后行保持原长、内容超宽时横向滚动并显示滚动条）在预览顶部；关闭预览设置或移动端 Web 时长按执行主复制 + toast |
   | 工具 header（展开） | 同上 | `复制`、`⋯` 常驻 |
   | `⋯` 菜单 | 卡片内向下展开的行内列表（无浮层/portal） | 同左 |
   | 代码块、diff header | 复制常驻 | 同左 |
   | 思考段落标题行 | 悬停显示复制 | 展开后常驻小号 muted 图标 |
   | `PathText` | 点击 = 在文件管理器中显示；悬停出现复制图标；`title` 显示完整路径 | 点击同左；长按 = 复制绝对路径 + toast |
   | 选中文本 | 保留浮动工具条；Cmd/Ctrl+C | 系统选择菜单 |

   可选中正文上一律不绑长按。

**验收**：单测覆盖 `content.ts` 全部行（去 ANSI、diff 提取新内容、思考无编号、路径为绝对路径）；showcase shim 中令 `copyText` reject，确认错误 toast 且不显示勾；桌面悬停无布局位移；iOS/Android 模拟器上长按 header 弹出的预览、长按路径、展开后按钮三种方式均可复制，粘贴到宿主输入框核对，正文长按仍为系统菜单；`rg "navigator.clipboard" client` 为 0。

**写集**：S1：`client/ui/copy-button.tsx`、`client/ui/use-copy.ts`、`client/copy/content.ts`、`client/ui/action-menu.tsx`；S2：代码块 header；S3：工具 header 悬停按钮、长按、`⋯` 菜单；S4：思考段落；S5：用户消息与回复 footer 改用 `useCopy`；`PathText` 长按复制随 BC-13。

### 3.9 BC-13 路径相对化（已确认）

**现状与事实**

| # | 事实 | 证据 |
|---|---|---|
| 1 | 读写代码块头部显示绝对路径 + 从未赋值的 `lineRange`（多一个空格） | `tool-callouts.tsx:713`、`shared/contracts.ts:397` |
| 2 | diff 标题、图片预览显示绝对路径；工具 header 只显示文件名 | `tool-callouts.tsx:725`、`image-preview.tsx:152-158`、`live-renderers.tsx:499-505` |
| 3 | 点击走 `file.reveal`，传原始路径；daemon 按 cwd 解析并去掉 `:行号`/`?`/`#` | `live-renderers.tsx:604-608`、`index.server.ts:87-94,450-458` |
| 4 | 渲染器已有 agent `cwd`；`useWorkspace` 提供 `directory`、`projectRootPath`、`projectDisplayName` | `live-renderers.tsx:395`、SDK `contracts.d.ts:18-35` |
| 5 | 宿主原生工具行用 `stripCwdPrefix(filePath, cwd)`：带结尾 `/` 的前缀匹配（按段边界），根目录显示 `.` | 宿主 `protocol/src/path-utils.ts`、`tool-call-display.ts:76-96` |
| 6 | 宿主只按 agent `cwd` 一个根计算 | 同上 |

**设计**

1. **纯函数** `client/paths/format-path.ts`：

   ```ts
   formatPath(raw: string, ctx: { roots: Root[]; cwd?: string; mode: "relative" | "absolute" })
     → { absolutePath: string; displayPath: string; projectRoot: string | null; suffix: string }
   type Root = { path: string; label?: string }   // label 仅次级根有
   ```
   步骤：拆出选择符（`:12`、`:12:3`、`#L10`、`?…`）放入 `suffix`，规则同 daemon `stripSelector`；规范化（`\`→`/`，折叠 `.`/`..`/重复 `/`，去末尾 `/`）；相对路径输入保持显示原样，`absolutePath = join(cwd, raw)`；绝对路径按优先级逐个匹配根，按段比较（前缀须为 `root + "/"` 或完全相等），命中主根显示相对路径（根目录本身为 `./`），命中次级根显示 `<label>/相对路径`（label muted），都不命中保留绝对路径，根未知保留原样；仅 Windows 路径（盘符/UNC）不区分大小写；不做 realpath，符号链接不匹配时显示绝对路径（已知限制）。
2. **根目录与 worktree**

   | 优先级 | 根 | 来源 | 显示 |
   |---|---|---|---|
   | 1（主根） | 当前 workspace 目录（worktree 即其路径） | `useWorkspace(…).directory` | `src/a.ts` |
   | 2（次级根，仅与主根不同时） | 项目根（worktree 场景为主仓库） | `projectRootPath` | `<项目名>/src/a.ts`，项目名 muted |
   | 3 | agent `cwd`（前两者都拿不到时） | `useAgent(…).cwd` | `src/a.ts` |

   与宿主的差异：agent 在子目录运行时本方案显示 workspace 相对路径（与 git、diff 一致），宿主显示 cwd 相对路径。次级根避免把主仓库文件误显示成 worktree 内文件。每个渲染器按自己的 `agentId` 取根。
3. **共享上下文**：每个 Live 渲染器根部提供 `PathContext { roots, cwd, mode }`；selector 只返回字符串，引用稳定；`PathText` 从 context 读取。
4. **`<PathText>`**（`client/ui/path-text.tsx`）

   | 能力 | 实现 |
   |---|---|
   | 显示 | `displayPath + suffix`，等宽，单行 |
   | 中间截断 | 纯函数 `truncateMiddle(path, budget)` 全平台统一，始终保留文件名（如 `src/…/components/ChatView.tsx`），预算按 `layout.compact`（约 40 / 72 字符）；不用 RN `ellipsizeMode="middle"`（RN-web 不支持） |
   | 完整路径 | 桌面悬停 400ms 后卡片内浮出完整绝对路径；移动端长按复制 |
   | 点击 | `file.reveal`，传 `absolutePath` |
   | 复制 | 桌面悬停复制图标；移动端长按复制 + toast（BC-10） |
   | `verbatim` 模式 | 显示原文不相对化，仅保留点击与复制；用于 Markdown 正文中的路径（BC-05） |

5. **应用范围**：工具 header 的 target（Read/Write/Edit，由文件名改为 `PathText`）；读写代码块头部（并把 `offset/limit` 转成行号后缀，修复第 1 条）；diff 标题；图片预览；search 结果列表；`worktree_setup.worktreePath`、shell `detail.cwd`（作为 meta）。不改 Shell 日志、命令参数、错误信息、Markdown 正文（后者只用 `verbatim`）。
6. **设置**：文件路径显示 = 相对项目（默认）/ 绝对路径，存于偏好 v2。

**验收**：`formatPath` 单测覆盖项目内、根目录 `./`、`/projects/app-backup/x` 不属于 `/projects/app`、项目外、相对输入、根未知、根带结尾 `/`、`..` 折叠、Windows 盘符/大小写/反斜杠、选择符保留、worktree 主根与次级根、符号链接回退；`truncateMiddle` 单测保留文件名、极小预算为 `…/文件名`；Paseo 桌面端（iOS 模拟器抽查）在普通项目、git worktree、多 workspace 多 agent 下路径相对各自的根，点击相对显示路径能正确显示、复制得到绝对路径，切换绝对路径立即生效，Shell 日志和 Markdown 正文不变。

**写集**：S1：`client/paths/format-path.ts`、`truncate-middle.ts`、`client/ui/path-text.tsx`、`PathContext`；S2：Markdown 路径 codespan 用 `verbatim`；S3：工具 header、读写代码块头部、diff 标题、search 列表、worktree/cwd 字段；S5：图片预览与设置项。

### 3.10 BC-11 / BC-12 字体（已确认）

**现状与事实**

| # | 事实 | 证据 | 影响 |
|---|---|---|---|
| 1 | 等宽字体名固定为 `"OMP Iosevka"`/`"OMP Iosevka Code"`，靠 `@font-face` 注入；无 `document`（iOS/Android）时跳过 | `theme-tokens.ts:21-29`、`embed-fonts.ts:28-29` | **S0-D 已实测确认**：iOS 模拟器上插件的代码块、diff、Shell 输出均为比例字体；停用插件后宿主渲染同样内容为等宽（宿主 `ui-monospace` 经 RN Fabric `RCTFontUtils.mm:296` 映射为 SF Mono）。问题完全在插件；设置项"Inter"在原生端同样无效。截图：`/Users/luopeihuan/workspace/rrd/scratch/beautiful-chat-upgrade-evidence/ios/b-*.png`、`control-*.png` |
| 2 | 每个插件 item 根节点都打了 `data-pmono` | `live-renderers.tsx` 各渲染器根 View、`host-font-escape.ts` | 宿主 Web 端把 UI 字体应用到全局但排除 `[data-pmono]`（宿主 `apply-root-font.web.ts:10-12`），插件界面文字因此不跟随宿主 UI 字体 |
| 3 | 宿主设置：`uiFontFamily`、`monoFontFamily`、`uiBaseFontSize`、`contentFontSize`、`codeFontSize`（默认 12，范围 9–22，行高 1.5 倍） | 宿主 `hooks/use-settings/storage.ts:68-89`、`appearance/apply.ts:64-66` | `PluginTheme` 未暴露 → H1 |
| 4 | 宿主原生默认等宽：iOS `ui-monospace`、Android `monospace` | 宿主 `styles/theme.ts:641-645` | 插件可采用相同默认值 |
| 5 | 代码字号写死 12；146 处 `fontSize` 字面量 | `syntax-highlight.tsx:616-621` 等 | 收敛为 token |
| 6 | `font-data.ts` 155KB，原生端也打包但用不上 | — | 体积问题，记录在案 |

**设计**

1. **Typography tokens**：纯函数 `resolveTypography(theme, prefs, platform)`（`client/ui/tokens/typography.ts`，带单测）：

   ```ts
   interface Typography {
     ui:      { family?: string; scale: { xs: 10; sm: 11; base: 12; md: 13; lg: 14; xl: 16 } };
     content: { size: number; lineHeight: number };
     mono:    { family: string; size: number; lineHeight: number; ligatures: boolean };
   }
   ```
   `ui.family` 为 `undefined` 表示继承宿主。
2. **等宽字体解析**

   | 设置 | Web / 桌面 | iOS / Android |
   |---|---|---|
   | 跟随 Paseo（默认） | 有 H1 用宿主值；无 H1 用宿主自己的默认等宽字体栈 `SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace`（D2，2026-10-11 修订）；代码块同样不用连字字体 | 有 H1 用宿主值；无 H1 用 `ui-monospace`/`monospace`（修复第 1 条） |
   | Iosevka / Iosevka Code | 内嵌字体（只有选了才注入 `@font-face`）；Iosevka Code 在代码块用连字字体 | 不显示此选项 |
   | 自定义 | 自由输入，生成 `"<输入>", <跟随值字体栈>`，不存在时 CSS 回退 | 从平台确定存在的等宽字体中选择（iOS：SF Mono/Menlo/Courier New；Android：monospace），不提供自由输入 |

   原生端无法检测字体是否存在，填错会变成比例字体，因此用下拉列表。中文回退：Web 字体栈末尾追加 `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC"`；原生由系统回退。
3. **字号**：跟随 Paseo（默认，H1 前为 12）；自定义 10–22（下限取需求建议，上限取宿主验证过的 22），步进器 + 重置 + 实时预览；行高 `round(size × 1.5)`；正文字号不受影响（H1 后跟随 `contentFontSize`）。
4. **界面字体跟随宿主**：去掉 item 根节点的 `data-pmono`，只在等宽区域打标（代码块、diff、终端、路径、命令、行内代码），与宿主 `CODE_SURFACE_DATASET` 约定一致，Web 端界面文字自动跟随宿主 UI 字体；原生端 H1 后用 `typography.fontFamily.ui`，之前用系统字体；保留"Inter"选项（仅 Web）；默认改为跟随 Paseo，随偏好 v2 迁移。
5. **应用范围**：代码块、行内代码、高亮、diff、终端输出、路径、命令、思考代码片段统一读 `typography.mono`；146 处字面量随 S3/S4/S5 收敛到 `ui.scale`。
6. **不重新解析**：字体只影响渲染 `ctx` 与样式表，分块和词法结果按 `text` 缓存。
7. **不影响宿主 Terminal**：插件只读宿主值、不写宿主设置。
8. **设置页"字体"分组**：等宽字体、代码字号、界面字体三项，加实时预览（代码、两行 diff、中英混排）；宿主未提供 typography 时提示"当前 Paseo 版本未提供字体设置，正在使用默认值"；存储沿用 `preferences.ts` v2。

**H1 细化**：`PluginTheme` 新增可选 `typography?: { fontFamily: { ui; mono }; fontSize: { ui; content; code }; lineHeight: { code } }`，在 `toPluginTheme()` 中从 Unistyles theme 填充（`fontFamily`、`fontSize.base/content/code`、`lineHeight.diff`）。宿主 `applyAppearance` 通过 `updateTheme` 生成新 theme 对象，`withUnistyles` 随之重渲染插件，变更自动通知，无需新订阅接口；H4 按 theme 对象缓存同样有效。文件：宿主 `packages/plugin/src/contracts.ts`、`packages/app/src/plugins/theme.ts` 及测试，约 30 行。

**验收**：`resolveTypography` 单测覆盖 3 平台 × 3 设置 × 有无 H1，及自定义字体栈；iOS 模拟器改造前截图确认比例字体问题、改造后代码/diff/终端按列对齐；Web/桌面界面文字随宿主 UI 字体变化，H1 后修改宿主等宽字体或字号实时更新，不存在的自定义字体回退正确，中英混排无方框字；修改字体时 Markdown 分词次数为 0；宿主终端字体不受影响。

**写集**：S1：`client/ui/tokens/typography.ts`、`theme-tokens.ts`、`host-font-escape.ts`（改为等宽区域的 `codeSurface` 标记）；S2/S3/S4：各组件改读 typography；S5：设置页"字体"分组、偏好 v2、替换根节点 `hostFontEscape`；H1：宿主透传。

### 3.11 BC-14 跨端（已确认）

**平台判定**（`client/ui/use-input-capabilities.ts`）：宿主 `layout.platform` 只有 `ios/android/web`，桌面 Electron 与手机浏览器都是 `web`（宿主 `plugins/platform.ts`），不能据此判断能否悬停。

| 维度 | 判定 | 用途 |
|---|---|---|
| 版面密度 | `layout.compact` | header 28/30、截断预算、吸顶栏高度 |
| 能否悬停 | Web：`matchMedia("(hover: hover) and (pointer: fine)")` 并订阅；原生默认否，`Pressable.onHoverIn` 实际触发（iPad 指针）时开启 | 悬停按钮、完整路径提示 |
| 是否触控 | Web：`(pointer: coarse)`；原生：是 | 长按入口、触控区 ≥ 32 |
| 原生 / Web | `layout.platform` | 仅用于真实能力差异（字体注入、自定义字体输入方式） |

原则：只有真实能力差异才分支；所有悬停功能在触控设备上都有对应入口。

**平台差异对照**

| 功能 | 桌面（Electron）/ 桌面浏览器 | 手机浏览器 | iOS / Android |
|---|---|---|---|
| 工具折叠 | 悬停高亮 | 同原生 | 点击展开；header 28，触控区 ≥ 32 |
| 思考 | 段落悬停复制 | 同原生 | 展开后复制常驻 |
| 吸顶 | H2a/H2b Web strategy | 同左 | H2a/H2b 原生 strategy，Safe Area 由宿主处理 |
| Markdown 选择 | 跨块（DOM） | 单块 | 单个 `Text`（RN 限制，同现状） |
| 表格/代码横向滚动 | 触控板/滚轮 | 手势 | 手势；inverted 只翻转 Y 轴 |
| 性能测量 | 探针 + `longtask`/`layout-shift` | 探针 | 探针 + Xcode/Perf Monitor（手动） |
| 磨砂、光晕 | 可选开启 | 磨砂可选，光晕不可用 | 均不可用，设置页隐藏 |
| Reduced Motion | `prefers-reduced-motion` | 同左 | `AccessibilityInfo` |
| 复制 | 悬停按钮 + 选区工具条 + Cmd/Ctrl+C | 长按 header 弹预览（预览内复制）、长按路径 + 展开后按钮 | 同左 + 系统选择菜单 |
| 字体 | 内嵌 Iosevka 可选；自定义用输入框 | 同左 | 平台等宽字体；自定义用下拉 |
| 路径 | 悬停完整路径与复制 | 长按复制 | 长按复制 |
| 点击路径 | `file.reveal` 在本机文件管理器显示 | **改为复制绝对路径 + toast** | 同左 |

`file.reveal` 在 daemon 所在机器上执行，从手机连接时点击会在电脑上弹窗、手机上无反馈。本轮在触控设备上把点击改为复制；长期需要宿主开放"打开宿主文件 tab"的导航能力（README SDK 限制第 1 条），记入 §5 作为后续项。

**跨端约束检查清单**（每个切片验收时核对）：
1. 核心功能不用 Web 专属 DOM/CSS；CSS 注入只用于可选增强（磨砂、光晕、`@font-face`），原生有明确降级。
2. 每个悬停入口在触控设备上都有等价入口。
3. 可选中正文上不绑长按。
4. 原生端只使用平台确定存在的字体。
5. `navigator.*`/`window.*`/`document.*` 只出现在带 `typeof document` 保护的文件中。
6. 横向滚动容器不撑破消息栏。
7. 动画只用 RN `Animated`，原生走 native driver。
8. 遵守 D9 的 Hermes 语法边界，`npm run check:hermes` 通过，并在 iOS 模拟器上确认插件能加载。

**验证矩阵**

| 环境 | 构建 | 用途 | 状态 |
|---|---|---|---|
| Paseo.app（Electron） | 生产 | 主验收：视觉、交互、探针性能 | 本机可用 |
| Paseo Web 开发版（Chrome） | 开发 | Profiler、火焰图、宿主 e2e | 需从源码运行宿主 |
| Chrome 设备模拟（手机尺寸 + 触控） | 开发 | 手机浏览器形态：长按、无悬停 | 本机可用 |
| iOS 模拟器（iPhone 16 Pro） | 开发（`expo run:ios`） | 原生字体、复制、吸顶、Safe Area、Reduced Motion | S0 打通 |
| Android 模拟器 | 开发 | 复制、长按、吸顶、字体 | 需从源码构建 |
| 真机 | — | — | 不在本轮范围，报告注明 |

每个切片的验收表标明验证过的环境；未验证写"未验证"，不视为通过。

**写集**：S1：`use-input-capabilities.ts`；S3/S5：`PathText` 在触控设备上点击改为复制。

### 3.12 现有功能保留清单与已知缺口

需求 §14 要求保留的能力：Shell、Git、Read/Write/Edit、高亮、文件预览、Diff、MCP、Reasoning、Task、用户消息、AI 回复、Markdown、明暗主题、文件跳转、文本选择与复制。本方案都保留，只改变展示方式。唯一的行为变化：触控设备上点击路径由"在 daemon 机器的文件管理器中显示"改为复制绝对路径（§3.11），桌面不变。

已发现、但不属于本需求范围的问题（建议另开 ticket，不在本次静默修改）：

- `ApprovalCard` 未挂载：审批由宿主渲染，本方案只保证不遮挡宿主审批 UI。
- TodoList 的 props → state 只同步一次：Task 视觉统一时顺手修复，作为独立提交。

---

## 4. 实施切片（供后续分发；本次未实施）

| # | 切片 | 写集 | 依赖 | 角色 / 模型建议 | 验收 |
|---|---|---|---|---|---|
| S0 | Spike 与基建：`marked`/`remend` 打包冒烟；vitest；`client/debug/perf.ts` 探针；`tools/bench-provider/` 回放 provider；`test/fixtures/streams/**` 与生成器；`.showcase/replay.tsx`；iOS 模拟器开发版链路；记录**优化前**基线 | `package.json`、`client/debug/**`、`tools/bench-provider/**`、`test/**`、`.showcase/replay*` | — | impl · codex/gpt-6-luna | Paseo 0.11.2 加载成功；基线数据表（§3.2 全部指标）；`npm test` 可运行 |
| S1 | 共享原语与 tokens：Token v2、typography、motion、`DisclosureHeader`、`CopyButton`/`useCopy`、`ActionMenu`、`PathText`/`PathContext`、`RunningDot`、`useInputCapabilities`、`useReducedMotion`、disclosure-store、`formatPath`/`truncateMiddle`、`copy/content.ts`、语义化 `React.memo` 与按颜色 key 的 tokens memo、偏好 schema v2 与迁移、`host-font-escape` 改为等宽区域标记 | `client/ui/**`、`client/state/**`、`client/paths/**`、`client/copy/**`、`theme-tokens.ts`、`preferences.ts`、`host-font-escape.ts`、`frosted.ts`、`glow.ts` | S0 | ui · claude-opus-5-5 | 各纯函数单测（路径含 `app-backup`、worktree、`./`；typography 3×3×2；copy 内容）；showcase 截图 |
| S2 | Markdown 引擎替换与代码块（§3.1） | `package.json`（依赖）、`client/components/markdown/**`、`syntax-highlight.tsx`、`client/highlight.ts`、`index.client.tsx` 与 `live-renderers.tsx` 的 assistant 段 | S0、S1 | impl · codex/gpt-6-luna Max（流式正确性有争议时升级 complex · Opus） | 需求 §6.5 九类未完成语法回放无格式翻转；增量分块与整篇一致；定稿块重渲染为 0；每代码块 1 次 RPC；新旧渲染对照差异已确认 |
| S3 | 工具调用 v2（§3.3）：分类与摘要、默认折叠、无框单行、悬停/长按复制与 `⋯` 菜单、路径接入、去旧动效与嵌套卡片 | `tool-callouts.tsx`、`paseo-tool-callouts.tsx`、`hub-callout.tsx`（只改 header 和外框）、`live-renderers.tsx` 的 tool 段、`client/tools/**` | S1 | ui · claude-opus-5-5 | §3.3 验收全部场景；桌面 + iOS 模拟器截图 |
| S4 | 思考过程 v2（§3.4）：结构识别、默认折叠、单行预览、段落复制、`thinking` 工具展开体 | `reasoning-trace.tsx`、`live-renderers.tsx` 的 reasoning 段、`client/reasoning/**`、`tool-callouts.tsx`（仅 thinking 展开体，S3 合并后） | S1、S2、S3 | ui · claude-opus-5-5 | §3.4 验收；折叠时渲染次数约等于 chunk 数 |
| S5 | 收尾（§3.6–§3.11）：代码块外框、Task（含 props 同步 `fix:`）、用户消息与回复 footer 改用 `useCopy`、Notice/System 行样式、图片预览路径、触控设备点击路径改复制、设置页（工具详情、字体、路径显示、磨砂/光晕）、删除旧动效文件、frost 补 reduced-motion、替换根节点 `hostFontEscape` | `syntax-highlight.tsx`（外框，S2 合并后）、`task-list.tsx`、`user-message.tsx`、`turn-footer.tsx`、`notice-callout.tsx`、`system-card.tsx`、`image-preview.tsx`、`settings-page.tsx`、`live-renderers.tsx`（根节点）、`index.client.tsx`（去 shimmer）、删除 `breathe.tsx`/`pulse-dot.tsx`/`motion.tsx`/`shimmer.ts` | S2、S3、S4 | ui · claude-opus-5-5 | 明暗主题截图；静态检查（阴影/圆角字面量/`Animated.loop`/`navigator.clipboard`/`fontSize` 字面量）；Reduced Motion；跨端七条约束 |
| H0 | **Paseo**：插件 item 保留 `sourceKind` 并参与工具序列间距 | paseo `plugins/timeline/projection.ts`、`types/stream.ts`、`agent-stream/spacing.ts` 及测试 | — | small · codex/gpt-6-luna | 连续插件工具行间距为 0 |
| H1 | **Paseo**：`PluginTheme.typography`（fontFamily ui/mono、fontSize ui/content/code、lineHeight code） | paseo `packages/plugin/src/contracts.ts`、`packages/app/src/plugins/theme.ts` 及测试 | — | impl · codex/gpt-6-luna | 修改宿主字体设置后，插件 props 实时变化 |
| H4 | **Paseo**（**优先级下调**：iOS 实测未出现全量重渲染，见 §3.2 S0 实测）：按 `theme` 缓存 `toPluginTheme`，按 `item.data` 引用缓存 `safeParse` 结果 | paseo `plugins/theme.ts`、`plugins/timeline/view.tsx` 及测试 | — | small · codex/gpt-6-luna | 非流式插件行在 chunk 到来时不重渲染 |
| H5 | **Paseo**：插件客户端 bundle 追加 class 降级（D9） | paseo `packages/server/src/server/plugins/compiler.ts`、server 包依赖 `@babel/core` 及 class 相关插件 | — | impl · codex/gpt-6-luna | 带 class 的依赖在 iOS 上可加载 |
| H2a | **Paseo**：当前轮 prompt 吸顶栏（原生补阅读位置、原生拉取 prompt 索引、`sticky-prompt-bar.tsx`、`stickyInset`） | paseo `agent-stream/strategy-native.tsx`、`view.tsx`、`reading-anchor.ts`、`chat-outline/use-chat-outline.ts`、新建 `sticky-prompt-bar.tsx` | — | impl · codex/gpt-6-luna | 原生与 Web 均出现/切换/跳转正确；不遮挡正文；Safe Area 正确 |
| H2b | **Paseo**：`useTimelineStickyHeader` 单元格吸顶 API（`Animated.FlatList` + native driver；Web 同接口） | paseo `packages/plugin/src/client/*`、`plugins/timeline/view.tsx`、`plugins/evaluate.ts`、`strategy-native.tsx`、`strategy-web.tsx` | H2a（`stickyInset`） | complex · claude-opus-5-5 | 限位纯函数单测；Web e2e；原生滚动不闪烁 |
| S6 | 插件工具 header 吸顶接入与降级（BC-04 由 H2a 交付，插件无改动） | `tool-callouts.tsx`（header 吸顶）、`client/ui/disclosure-header.tsx` | S3、H2b | ui · claude-opus-5-5 | §16.1 第 11 项场景 |
| H3 | （后续）宿主分组 API，用于真正的"Read 12 files"聚合 | paseo timeline projection | — | 另行评估 | — |

**并行性**：S0 → S1 → {S2, S3} 并行（写集不相交：`syntax-highlight.tsx` 归 S2，S3 只通过组件 props 使用它）→ S4（依赖 S2 的 MarkdownView，且在 S3 合并后改 `tool-callouts.tsx` 的 thinking 展开体）→ S5。H0、H1、H2a、H4 在 Paseo 仓库独立推进，可与插件切片并行；H2b 依赖 H2a；S6 等 H2b 合并。

**隔离**：插件切片按 `.worktrees/<slice>` 建 worktree 并注册到 Paseo（需先在 `.gitignore` 加 `.worktrees/`）。H0–H4 按 D1 在 `RoundRedDot/paseo` fork 的本地 checkout 中进行，同样使用该仓库的 `.worktrees/`。

**验证层级**（按 D3，分别记录，不混记）：`tsc` → vitest 单测 → `.showcase/replay` 的 Web 性能数据与截图 → `Paseo.app` 桌面端真实验证 → iOS 模拟器（paseo `expo run:ios` 开发版）→ Android 模拟器（S3/S5/S6）。任何一层构建失败，都如实记为未验证。

**S0 追加**：打通 iOS 模拟器开发版链路（paseo app 构建 → 连接本机 daemon → 插件加载），作为后续原生验证的前提。

---

## 5. 宿主依赖说明（交付物 5 预填）

| 能力 | 归属 | 现状 | 需要的改动 |
|---|---|---|---|
| 插件 item 间距（BC-01） | Paseo | 插件 item kind 为 `plugin`，连续工具间多 16px | H0：`PluginTimelineStreamItem` 保留 `sourceKind`，`spacing.ts` 将源自 tool_call/reasoning/todo 的插件 item 视为工具序列（约 10 行） |
| 插件行重渲染（BC-07） | Paseo | 每次渲染新建 theme 与 data 对象 | H4：缓存 `toPluginTheme` 与 `safeParse` 结果（约 15 行） |
| 字体继承（BC-12） | Paseo | 设置已存在，但未透传 | H1：在 `PluginTheme` 增加只读 `typography`；变更随 theme prop 自然通知 |
| 双层吸顶（BC-03/04） | Paseo + 插件 | 宿主有 Web 端 prompt 索引与阅读位置，原生端没有；无吸顶能力 | H2a：吸顶栏（宿主功能）；H2b：`useTimelineStickyHeader` |
| 跨 item 聚合（BC-01 §3.3） | Paseo | transformer 不能合并相邻 item | H3（后续）：分组或装饰 API |
| 插件 bundle 的 Hermes 兼容（D9） | Paseo | 客户端 bundle 只经 esbuild（es2020），不降级 `class`，任何带 class 的依赖在原生端都会失败 | H5：在 `packages/server/src/server/plugins/compiler.ts` 客户端分支对 esbuild 输出追加一遍只处理 class 的 Babel（S0-D 本地验证：beautiful-chat 749KB bundle 经此后 `hermesc` 零错误，耗时约 2.5s）；先在上游开 issue |
| 打开宿主文件 tab（BC-13/14） | Paseo | 不暴露（README 第 1 条）；`file.reveal` 在 daemon 机器上执行，远程/移动端无效 | 后续项：开放 `openFile` 导航能力；本轮触控设备点击路径改为复制 |
| 其余各项 | 插件 | — | 本方案 §3 |

---

## 6. 关键决策（已定）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **宿主改动走 fork → 上游 PR**。在 `RoundRedDot/paseo`（与插件 fork 同组织）开发；H0、H1、H4 改动小，实现后直接向 `getpaseo/paseo` 提 PR；H2a、H2b 先在上游开 issue 对齐接口形状（§3.5），再从 fork 提 PR。插件发布**不依赖** fork 构建。 | H0/H1/H4 改动小、语义清晰，容易被接受；H2 涉及宿主滚动核心，先对齐 API 可以避免返工。插件全部做特性检测，所以上游合并节奏不阻塞插件。 |
| D2 | **字体默认值 = Follow Paseo。宿主未提供 `typography` 时用宿主自己的默认值**：Web/桌面用宿主的 `DEFAULT_MONO_FONT_STACK`（`SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace`，加中文回退），原生用平台等宽字体。内嵌 Iosevka / Iosevka Code 只在用户明确选择时使用。（2026-10-11 修订：原决定是"Web 保持内嵌 Iosevka"，用户在发布后反馈希望与 Paseo 官方等宽观感一致，因此推翻。）**已被 D10 取代**：D2 的默认字体栈现在是 D10 来源优先级的第三级。 | 默认值与宿主自己的代码渲染一致；内嵌字体变成可选项，不选就不注入。 |
| D3 | **验证平台**：桌面端用本机 `Paseo.app`（Electron）；iOS 用 paseo 源码 `packages/app` 的 `expo run:ios` 开发版，在 iPhone 16 Pro 模拟器上连接本机 daemon；Android 模拟器用于 S3/S5/S6 的复制、长按和吸顶验证。 | 本机已有 Xcode、iOS 模拟器、Android SDK，Paseo app 是 Expo 工程（`packages/app/package.json:16`）。原生构建失败时，该项如实记为"未验证"，不记为通过。 |
| D4 | **SDK devDep 升级到与本机宿主一致的 0.11.x**；`requirements.paseo` 保持 `>=0.8.0`；新增 API（`typography`、sticky、cell viewport）全部做运行时特性检测。 | 类型与实际运行的宿主一致，又不抬高安装门槛。 |
| D5 | **Markdown 依赖方式（S0 后修订）**：`remend@1.4` 照常作为 npm 依赖（无 `class`，已在 iOS 验证）；`marked@18` **用 Babel 预降级后 vendor 进 `client/vendor/marked.js`**（附许可证），生成脚本放在 `tools/vendor-marked/`（独立 package.json，不增加根依赖），根依赖中移除 `marked`。 | S0-D 实测：RN 0.81.5 的 Hermes 不支持任何形态的 `class`，插件 bundle 绕过 Metro/Babel，esbuild 无法把 class 降级；marked 的 `static passThroughHooks` 因此在 iOS 上报错。Babel 降级后的 marked 已在模拟器验证可用（46KB→112KB）。 |
| D6 | **数学公式和 Mermaid** 本次只做原文降级显示（代码样式），不阻塞引擎替换。 | 纯 JS 方案无法在 RN `Text` 中渲染 KaTeX；原生数学栈需要宿主二进制。 |
| D7 | **范围外问题**：TodoList 的 props → state 只同步一次，在 S5 统一 Task 视觉时作为独立 `fix:` 提交修复（不修会让 Task 显示错误）；`ApprovalCard` 未挂载不处理（审批归宿主，删掉或接入都属于无关改动）。 | 遵守"不做无关重构"，同时不让新视觉建立在已知错误数据上。 |
| D9 | **Hermes 语法边界**：客户端代码及其依赖不得使用任何形态的 `class`、正则 `v` 标志、`Array.prototype.toSorted`、`Intl.Segmenter`；timeline renderer 必须注册为普通函数（`React.memo` 对象会被宿主拒绝，宿主 `evaluate.ts:422`）。`npm run check:hermes` 用仓库自带的 `hermesc` 编译客户端 bundle，作为每个切片的必过检查。 | S0-D 特性矩阵与本地 Hermes 复现；S1 在 iOS 上发现 renderer 约束。 |
| D10 | **等宽字体来源优先级（用户 2026-10-11 指定，取代 D2）**：宿主 `theme.typography`（H1）→ Paseo 用户在外观设置中设定的字体（`monoFontFamily`、`codeFontSize`）→ Paseo 官方默认字体栈（Web/桌面 `SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace`；iOS `ui-monospace`；Android `monospace`）；Iosevka 仅在用户主动选择时使用。第二级在 0.11.2 上无正式接口，**Web/桌面端以只读临时兼容层读取 `localStorage["@paseo:app-settings"]`（旧键 `@paseo:settings`）**，结构不符或读不到即回退；宿主提供 H1 后自动不再使用。iOS/Android 读不到本地设置，H1 之前用官方默认。 | 用户要求跟随 Paseo 中设定的字体；偏离需求 §11.5“不读私有存储”，由用户明确授权，作为 H1 落地前的过渡。 |
| D8 | **跨工具聚合**：本次只做紧凑行（§3.3），H3 分组 API 不进入本轮。 | transformer 无法合并相邻 item；硬做会破坏顺序和状态同步，需求 §3.3 允许先做单工具摘要。 |

## 7. 剩余风险

1. H2a/H2b 上游可能要求不同的 API 形状：插件侧 S6 只依赖特性检测后的最小接口，改形状时只影响 S6。
2. `marked` 的 inline 输出与现有 `parseInline` 在边角语法上存在差异（例如 `_` 在词内是否算强调）。S2 用现有 fixture 做快照对比，差异逐条确认。
3. iOS 开发版构建依赖 paseo monorepo 的完整安装，耗时较长。S0 先单独打通这条链路，不要等到最终验收才发现构建不了。
4. 原生端比例字体问题已由 S0-D 实测确认。插件工具行多出 16px 间距（S0-D 截图中可见明显卡片间距，待精确测量）、"每个 chunk 让本轮所有卡片重算"（S0-A 冒烟回放中用户消息 109 次重渲染，待完整基线）仍需 S0 基线确认；若不成立，对应修复项降级或取消。
5. 触控设备点击路径改为复制，属于行为变化，在 changelog 中说明。
6. H0/H4 若上游不接受，插件侧的语义化 memo 仍能挡住大部分重渲染；间距问题则只能接受现状。
