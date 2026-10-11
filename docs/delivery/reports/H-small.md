# H-small：三个 Paseo 宿主小改动（H5 / H0 / H1）

## Result
三项均已完成，本地各一个提交，位于 `bc/host-small`（worktree `/Users/luopeihuan/workspace/rrd/paseo/.worktrees/bc-host-small`，基于 origin/main `7f9b65d46`）。未 push、未建 fork/PR/issue，未触碰主 clone、Metro(8081)、serve-sim(3100)、`~/.paseo*`。

| 提交 | 内容 |
|---|---|
| `b78fa8121` fix(server): lower classes in plugin client bundles for Hermes | H5 |
| `3291fc51c` fix(app): stack plugin-projected tool rows like native tool rows | H0 |
| `c9dc6d447` feat(plugin): expose host typography on PluginTheme | H1 |

## Execution
claude-sonnet-5-5（medium）。2026-10-11 12:02 开始，约 12:15 结束（+08）。

## Findings（path:line — 改动）
**H5**
- `packages/server/src/server/plugins/compiler.ts`：新增 `lowerClassesForHermes()`（Babel，仅 class-static-block / class-properties / private-methods / private-property-in-object / classes，`comments:false`），Babel 首次编译 client 时才懒加载；`compileTarget` 在 `makeHermesInteropEager` 之后、`wrapCommonJsBundle` 之前，仅对 `target === "client"` 调用。server bundle 不变。
- `packages/server/package.json`：新增 dependencies `@babel/core` 与 5 个 class 插件（`^7.29.7`），devDependency `@types/babel__core`。`package-lock.json` 随之更新（约 +450 行；npm 同时去掉了一批无关的 `"peer": true` 标记，属 npm 版本差异，PR 前建议用 CI 同版本 npm 重生成 lock 以缩小 diff）。
- `packages/server/src/server/plugins/compiler.test.ts`：4 个新用例——client 用 class（字段/static/私有字段与方法/`#x in`/static block/extends）编译后用 Babel AST 数 `ClassDeclaration/ClassExpression` 为 0 且执行结果正确；node_modules 依赖中的 class 被降级；server bundle 保留 class；400 个 class 的大 bundle 编译 <10s 预算且可执行。
- `docs/plugins.md`：在编译器规则段后加一段说明。
- 未用 `@babel/preset-env`/RN preset，产物最小。

**H0**
- `packages/app/src/types/stream.ts`：`PluginTimelineStreamItem.sourceKind?`（`Exclude<StreamItem["kind"],"plugin">`，可选，因 replica-cache 等路径构造的插件项没有它）。
- `packages/app/src/plugins/timeline/projection.ts`：投影时写入 `sourceKind: item.kind`（plugin 源项直接原样返回）。
- `packages/app/src/agent-stream/spacing.ts`：导出 `isToolSequenceItem`，plugin 项按 `sourceKind` 判断是否 tool_call/thought/todo_list；`layout.ts` 复用同一函数（`getToolSequence`、`isLastInToolSequence` 一并生效），删除重复实现。
- 测试：`spacing.test.ts`（间距 0、与原生互排、与 user/assistant 的间距同原生、非工具类仍默认、无 sourceKind 不算）、`layout.test.ts`（原生+插件工具序列 first/last/gapBelow）、`projection.test.ts`（sourceKind 保留）。

**H1**
- `packages/plugin/src/contracts.ts`：`PluginTheme.typography?`（`fontFamily{ui,mono}`、`fontSize{ui,content,code}`、`lineHeight{code}`），带 TSDoc，可选。
- `packages/app/src/plugins/theme.ts`：从 `theme.fontFamily`、`fontSize.base/content/code`、`lineHeight.diff` 填充。该函数本来每次调用就返回新对象，未增加更多身份变化；无新订阅，随 Unistyles theme 更新自然下发。
- 测试：`plugins/theme.test.ts`（映射 + 自定义值）、`appearance/apply.test.ts`（真实 `applyAppearance` 更新器输出 → `toPluginTheme().typography`，证明外观设置流入插件）。
- `public-docs/plugins/reference.md`：Theme and layout 一节新增 typography 表与"旧 App 为 undefined，需回退"的说明。无需 daemon 特性位（值由 App 本地生成，不走协议）。

## Validation（命令 → 结果）
- `npm ci --ignore-scripts`（worktree 内）→ 成功；手动 `PATH=node_modules/.bin node scripts/postinstall-patches.mjs` 应用 patch-package（`--ignore-scripts` 跳过了它，导致 app typecheck 误报 `dragGestureHostPresented`）。
- `npm run build:client` / `build:server-deps` / `build:server` / `build --workspace=@getpaseo/plugin` → 通过（解决 dist 声明过期的跨包类型错误）。
- `npx vitest run src/server/plugins/compiler.test.ts`（server）→ 76/76 通过。
- `npx vitest run src/agent-stream/spacing.test.ts src/agent-stream/layout.test.ts src/plugins/timeline src/types/stream.test.ts`（app）→ 137/137 通过；`src/appearance/apply.test.ts src/plugins/theme.test.ts` → 24/24 通过。
- 三次提交均经 lefthook pre-commit：`lint`、`format`、全仓 `typecheck` 全绿（含 server/app/plugin/cli/desktop）。
- **H5 端到端**（`npx tsx` 调用修改后的 `compilePlugin` → `node_modules/react-native/sdks/hermesc/osx-bin/hermesc` 与 `hermes` VM，脚本 `/tmp/h-small/run.mts`、`base.mts`）：
  - 未修改的 `marked@18.1.0` 导入（含 `Lexer`/`marked`）：基线（仅 esbuild）`hermesc` exit 2、7 个错误；修改后 exit 0、0 错误；`hermes` VM 运行 `contribute()` 得 `[["heading","space","paragraph"],"<p><strong>b</strong></p>\n"]`。体积 62,526 → 72,989 B（+10.5 KB，marked 单独的 bundle）。
  - beautiful-chat 当前 main（`/Users/luopeihuan/workspace/rrd/beautiful-chat`）真实 client：修改后 `hermesc` exit 0、0 错误，VM 加载 default 导出（react/react-native 等用 Proxy 桩）。注意：该 main 版本已不含 class（基线同样 0 错误；报告中提到的 9 个错误对应更早的 749 KB 版本），所以它证明"无回归"，marked 用例才是修复证明。体积 680,962 → 658,754 B（`comments:false` 去掉注释，反而变小）。
  - 耗时：beautiful-chat 降级阶段约 0.6 s（首次含 Babel 加载约 +0.3 s）；整个 `compilePlugin` 冷 0.9–1.4 s、热 0.6–0.85 s；marked 单独约 0.28 s。
  - 大小/耗时为本机单次测量，非基准。

## Remaining
- **设备验证已完成（V2，2026-10-11 17:27–18:08，iPhone Air 模拟器，worktree 守护进程 6869；详见 `S0-D.md` 的 "V2 host device verification"）**：H5 未改 marked@18.1.0 + class 在 iOS 加载运行（`failures=0/14`）；H0 同一插件同一 fixture 行距 stock 0.11.2 为 46.2 pt、H0 为 30 pt（差 16 pt）；H1 改宿主代码字号/字体后插件设置页与时间线代码块不重载即更新，且不再出现"不共享字体设置"提示。
- H5 桌面打包 smoke（受限范围）已做：`electron-builder --mac --dir` 未签名包的 `app.asar` 含 `@babel/core` 与 5 个 class 插件；从 asar 以 Electron-as-Node 启动守护进程，安装带 class + marked 的插件并编译成功（82 KB，`hermesc` 0 错误、Hermes VM 14/14）。未覆盖：完整 `PASEO_DESKTOP_SMOKE=1`（需要 web 导出的 `app-dist` 与渲染器）、Linux/Windows 包、打包体积基线对比。
- 额外发现（与三项改动无关，上游 main `7f9b65d46` 的问题）：iOS 启动红屏 `Cannot read property 'includes' of undefined`（`@xterm/headless` 在模块顶层读 `navigator.userAgent`，而 `polyfillNavigator()` 在 `src/app/_layout.tsx:141` 才被调用，晚于 import 链求值）；建议单独 issue，把 polyfill 移到 `index.ts` 最前。我在 worktree 的 node_modules 里临时补丁绕过，验证后已还原。
- H5：lock 文件 diff 噪声待清理；没跑完整 server 测试集（按仓库规则交 CI）。
- H0/H1：app 的 `src/plugins`、`src/agent-stream` 整目录因含 vitest browser 项目（本机无 Playwright 浏览器）无法一次性跑，仅跑了相关文件；其余交 CI。
- 上游流程未做：issue/PR 均待用户批准（D1：H5 计划先开 issue）。

## 上游 PR 描述草稿
### H5 — fix(server): lower classes in plugin client bundles for Hermes
- **Problem**：插件 client bundle 由 esbuild(es2020) 编译后直接交给 Hermes eval，不经 Metro/Babel。esbuild 不能降级 class，Hermes 能解析但无法生成 class 代码：小 bundle 报 SyntaxError，大 bundle（>~64 KiB）惰性编译后 class 静默变 `undefined`（marked@18：`right operand of 'in' is not an object`）。任何带 class 的依赖在原生端都会坏。
- **Change**：client 分支在包装前对 esbuild 输出跑只含 class 相关插件的 Babel；Babel 懒加载；server bundle 不变；新增 `@babel/core` 及 5 个插件依赖。
- **Evidence**：单测（降级后 AST 无 class 且行为一致；依赖内 class；server 保留；400 class 预算）；marked@18 经 hermesc 7 错 → 0 错，Hermes VM 实际解析 markdown；降级阶段约 0.3–0.6 s。**设备**：iOS 模拟器（Hermes eval）上未改 marked@18.1.0 + 公有/静态/私有字段、extends、static block 的探针插件 `failures=0/14`（`ios/v2-h5-probe-top.png`），stock 0.11.2 上同类探针 marked 加载即抛 `right operand of 'in' is not an object`（`ios/hermes-baseline-top.png`）。**桌面**：未签名 `--dir` 包的 asar 内含 Babel 及 5 个插件，asar 内守护进程编译同一探针成功（82 KB，`hermesc` 0 错误，Hermes VM 14/14）。
- **Risk**：新增 server 依赖（体积）；client 编译增加数百毫秒；Babel 对极端语法可能抛错（会作为编译错误上报）；Hermes 其他不支持的语法（正则 v 标志、`Intl.Segmenter` 等）不在范围内。

### H0 — fix(app): stack plugin-projected tool rows like native tool rows
- **Problem**：替换工具调用的插件项 kind 为 `plugin`，走默认 16px 间距，20 次 Read 多约 320px 空白。
- **Change**：投影项带 `sourceKind`；spacing/layout 将源自 tool_call/thought/todo_list 的 plugin 项视为工具序列（与原生相同的间距和 first/last 位置）。
- **Evidence**：spacing、layout、projection 单测。**设备**（iPhone Air 模拟器，`reads-20`，同一插件同一 daemon）：连续 Read 行的行距，stock v0.11.2 JS = 46.2 pt，H0 = 30 pt（差 16 pt，即默认间距），宿主原生行 = 32 pt（`ios/v2-h0-stock-host-0.11.2-js.png`、`v2-h0-patched-host-plugin-on.png`、`v2-h0-patched-host-plugin-off-native.png`）。
- **Risk**：很小；`sourceKind` 可选，缓存里的旧插件项不受影响；只改变 plugin 投影行的间距。

### H1 — feat(plugin): expose host typography on PluginTheme
- **Problem**：插件拿不到宿主字体设置，原生端自带 web 字体不存在，代码/diff/shell 回退成比例字体。
- **Change**：`PluginTheme.typography?`（字体栈、三种字号、code 行高）由 `toPluginTheme` 从 Unistyles theme 填充；文档更新。
- **Evidence**：theme 与 apply 单测证明外观设置变更流入插件 theme；`toPluginTheme` 本就每次返回新对象，身份变化频率不变。**设备**（iPhone Air）：在 App 外观设置里把代码字号 12→18、代码字体 `ui-monospace`→Courier，不重载应用，beautiful-chat 的 Follow Paseo 设置页预览与时间线代码块随即变为 18 px / Courier，且不再出现"此 Paseo 版本不共享字体设置"提示（`ios/v2-h1-before-plugin-settings.png`、`v2-h1-after-plugin-settings.png`、`v2-h1-after-timeline-codeblock-courier18.png`）。
- **Risk**：纯增量可选字段，协议不变；旧 App 为 `undefined`，插件需特性检测。
