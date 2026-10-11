# S0-D：iOS Simulator 开发构建 + bench daemon + beautiful-chat 插件

## Result
**通过（含一项重要发现）。** Paseo v0.11.2 Debug 构建（bundle id `sh.paseo`）运行在 iPhone 16 Pro 模拟器
（UDID `CE6149D8-A1AD-4BDC-A8DE-BD995927EB5C`），经 `lsof` 确认只连 `127.0.0.1:6868`（隔离 bench daemon，home `~/.paseo-bench`），
beautiful-chat 插件在应用内生效。字体假设**成立**：原生 iOS 上 `OMP Iosevka` 未注册，代码、diff、shell 输出全部回退到比例字体。

## Execution
- 模型：claude-sonnet-5-5（medium）。开始 2026-10-11 09:57，结束 10:27（+08），约 30 分钟。
- 未提交、未 push、未改任何被追踪的源码（`git status` 在 paseo 仓库为空）。未触碰 `~/.paseo` / 6767。

## Findings
1. **Xcode 27 下 `expo run:ios` 直接失败**：`Can't determine id of Simulator app`。Xcode 27 不再带 Simulator.app，Expo 无法打开它。
   绕过：`xcrun simctl boot` + 直接 `xcodebuild` + `simctl install/launch`，Metro 单独起。
2. **xcodebuild 报 `IPHONEOS_DEPLOYMENT_TARGET is set to 9.0/12.4/13.4, supported 15.0–27.0`**（SDWebImage、RNSVG、RNCAsyncStorage 的资源 bundle target）。
   修复：命令行追加 `IPHONEOS_DEPLOYMENT_TARGET=15.1`（命令行覆盖项目设置，无需改 Pods）。
3. **Metro 报 `@getpaseo/highlight` / `@getpaseo/plugin/client/host` / `@getpaseo/expo-two-way-audio` 无法解析**：只跑 `npm run build:client` 不够。
   需要 `npm run build:server-deps`（highlight/plugin/relay + client）以及 `npm run build`（在 `packages/expo-two-way-audio`，只是 `tsc`，<1s）。
4. **模拟器交互**：没有 Simulator.app，因此不能点按。可用 `node_modules/.bin/serve-sim`（仓库自带）发 tap/gesture，但它的二进制找不到 SimulatorKit（Xcode 27 把它放在 `SharedFrameworks`）。
   修复：`ln -s /Applications/Xcode.app/Contents/SharedFrameworks/SimulatorKit.framework node_modules/serve-sim/lib/SimulatorKit.framework`（位于 node_modules，未追踪）。
   我写了 `/tmp/bc-orchestrate/tools/ios-{tap,swipe,shot}.sh`，坐标为 0..1 归一化，**始终显式指定 UDID**。
5. **插件在 daemon 侧**：目录安装不会跑 manifest 的 `build`，首次 `failed`（`Could not resolve @shikijs/core`）。在 `beautiful-chat` 主 checkout 跑 `npm ci --include=dev`（2s）后 `paseo plugin reload beautiful-chat` → `running`。
   另需 `paseo daemon config set pluginsEnabled true` 并 reload（仅限 bench home）。
6. **应用内插件证据**：设置 → 插件列表显示 `beautiful-chat 运行中`（`a0-plugins-list-running.png`）；时间线里 `Checklist Progress / OMP TODO` 卡片、`edit/shell` 工具卡、`Reasoning summary` 都是插件绘制的（`b-timeline-*.png`）。
7. **插件设置页在 iOS 紧凑设置列表中没有入口**（列表只有应用 + 主机分组，`插件` 页只有安装/开关）。可用深链进入：
   `xcrun simctl openurl <UDID> "sh.paseo:///settings/hosts/srv_example/plugins/beautiful-chat/chat-presentation"`（无确认弹窗）。这本身是一个原生 UX 缺口，后续 slice 需知。
8. **字体假设：成立。** 证据：
   - `b-font-proportional-diff-and-shell.png`：展开的 Edit diff（行号、`+`、`===`）与失败的 shell 输出（`FAIL … / × treats a running tool as not done (4 ms) / expected false, received true`）字距为比例字体，缩进列不对齐，长行换行。
   - `b-codeblock-rust-proportional.png`：Rust 围栏代码块（`wait: Duration,` / `last: Option<Instant>,` / `pending: Option<T>,`）冒号与类型不成列，`i`/`l` 窄于 `m`/`w`。
   - 根因：插件在 `client/components/embed-fonts.ts` 只通过 web `@font-face` 注册 `OMP Iosevka`；原生无此字体，系统静默回退到 San Francisco。
   - 注意：围栏代码块是宿主 markdown 渲染的，不是插件 tool 卡；它也呈比例字体，说明宿主默认 mono 栈在 iOS 上也未命中（或被主题 token 覆盖），需 D3 单独核实是插件改写了 mono token 还是宿主本来就如此。我未区分这一点。
9. 其他：`bc-bench` 回放 provider 已由 S0-C 装在 bench daemon，`fixture:codeblock-streaming speed:max` 与 `fixture:mixed-turn speed:max` 均跑通，无付费模型调用。
10. **越界事件（已处理）**：早期我用了 `simctl install/launch/openurl booted`，当时有 8 台模拟器处于 Booted，应用被装到了别人的 `Paseo ios12-legacy-web 0ba6e5c9`（EDFF7722…）。核对其数据容器：唯一的 `sh.paseo` 数据容器创建于我启动的 10:08，之前没有该应用，所以未覆盖他人的状态；已 terminate + uninstall。此后全部用显式 UDID。
    另外我执行过一次 `pkill -f serve-sim-bin`，可能误杀了他人的 serve-sim helper（当时 `ps` 显示数量为 0，无法确认）；如有 worker 的 serve-sim 预览中断，原因在此。
    `npm ci` 触发 lefthook 在 paseo 仓库 `.git/hooks` 装了 pre-commit hook（本地、未追踪）。

## Validation（命令 → 结果）
- `npm ci`（paseo）→ 37.6s，成功。
- `npm run build:client` → 7.8s；`npm run build:server-deps` → 1m52s；`packages/expo-two-way-audio: npm run build` → <1s。
- `npx expo run:ios --device "iPhone 16 Pro"`（含 pod install）→ 2m19s，在 Simulator.app 步骤报错（见 Finding 1）；pods 已安装完成。
- `xcodebuild … -derivedDataPath build/dd IPHONEOS_DEPLOYMENT_TARGET=15.1 build` → 首次因部署目标失败（8.9s），修复后 **BUILD SUCCEEDED**，2m20s（冷构建 16 核）。
- `paseo daemon start --home ~/.paseo-bench`（listen 127.0.0.1:6868）→ 运行，`serverId srv_example`，daemonVersion 0.11.2。
- `paseo plugin ls --home ~/.paseo-bench` → `bc-bench running`、`beautiful-chat running`。
- `lsof -p <Paseo pid>` → 仅 `->127.0.0.1:6868` 与 `:8081`（Metro），无 6767/6768。
- 截图（`/Users/luopeihuan/workspace/rrd/scratch/beautiful-chat-upgrade-evidence/ios/`）：
  - (a) `a-chat-presentation-settings.png`、`a0-plugins-list-running.png`
  - (b) `b-timeline-checklist.png`、`b-timeline-shell-tools.png`
  - 字体 `b-font-proportional-diff-and-shell.png`、`b-codeblock-rust-proportional.png`

## Remaining
- 未区分围栏代码块的 mono 字体回退是插件造成还是宿主默认；需用无插件的 bench（或停用插件）对照一次。
- 插件设置页在紧凑设置列表没有入口（只能深链），需确认是宿主限制还是插件注册方式。
- 未验证插件改动后的热更新到模拟器的耗时（流程见下，理论上 `plugin reload` 后需 App 重载）。
- 开发菜单/通知权限弹窗需手动处理（已记录坐标做法）；Metro 仍在后台运行于 8081，serve-sim 仍在 3100 运行。

---

# Runbook（从干净状态到连接 bench daemon 的模拟器）

前提：Xcode 27、CocoaPods 1.16、Node 24（`.tool-versions` 写 22.20，仍可用）。没有 Simulator.app，别用 `npm run ios`。

```bash
# 0. 依赖 + 产物（约 40s + 2min）
cd /Users/luopeihuan/workspace/rrd/paseo
npm ci
npm run build:server-deps                       # client/highlight/plugin/relay
(cd packages/expo-two-way-audio && npm run build)

# 1. bench daemon（若不存在；不要删除/重置 ~/.paseo-bench）
paseo daemon config set --home ~/.paseo-bench daemon.listen 127.0.0.1:6868 --string
paseo daemon start --home ~/.paseo-bench
paseo daemon config set --home ~/.paseo-bench pluginsEnabled true
(cd /Users/luopeihuan/workspace/rrd/beautiful-chat && npm ci --include=dev)   # 目录安装不会跑 build
paseo plugin install --home ~/.paseo-bench /Users/luopeihuan/workspace/rrd/beautiful-chat
paseo daemon reload --home ~/.paseo-bench ; paseo plugin ls --home ~/.paseo-bench   # 期望 running

# 2. 原生构建（首次约 5 分钟含 pod install；之后增量）
cd packages/app
EXPO_PUBLIC_LOCAL_DAEMON=localhost:6868 CI=1 npx expo prebuild --platform ios   # 生成 ios/ 并 pod install（run:ios 的前半段）
U=CE6149D8-A1AD-4BDC-A8DE-BD995927EB5C            # iPhone 16 Pro
xcrun simctl boot $U
(cd ios && xcodebuild -workspace Paseo.xcworkspace -scheme Paseo -configuration Debug \
   -destination "id=$U" -derivedDataPath build/dd IPHONEOS_DEPLOYMENT_TARGET=15.1 build)
xcrun simctl install $U ios/build/dd/Build/Products/Debug-iphonesimulator/Paseo.app

# 3. Metro（EXPO_PUBLIC_LOCAL_DAEMON 在 bundle 时被内联，必须与 Metro 同一 shell）
EXPO_PUBLIC_LOCAL_DAEMON=localhost:6868 npx expo start --dev-client --port 8081 &

# 4. 启动并连接 dev client（务必显式 UDID，不要用 `booted`；机器上常有多台 Booted）
xcrun simctl launch $U sh.paseo
xcrun simctl openurl $U "sh.paseo://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
# 5. 交互（无 Simulator.app）：serve-sim 补丁一次后可用
ln -s /Applications/Xcode.app/Contents/SharedFrameworks/SimulatorKit.framework \
      /Users/luopeihuan/workspace/rrd/paseo/node_modules/serve-sim/lib/SimulatorKit.framework
node_modules/.bin/serve-sim --detach --no-preview -q $U
/tmp/bc-orchestrate/tools/ios-tap.sh 0.666 0.5515    # 点“打开”；ios-swipe.sh x y1 y2；ios-shot.sh out.png
```
首次进入：点掉“在 Paseo 中打开？”（0.666,0.5515）、通知弹窗（不允许 0.33,0.57）、开发菜单 Continue（0.5,0.76）、X 关闭（0.915,0.474）。

跑 fixture（无付费调用）：
```bash
paseo run --home ~/.paseo-bench -d --provider bc-bench --cwd <git 目录> "fixture:codeblock-streaming speed:max"
paseo send --home ~/.paseo-bench <agentId> "fixture:mixed-turn speed:max"
```
应用内：侧栏（左上角）→ 工作区 `master`。插件设置页：
`xcrun simctl openurl $U "sh.paseo:///settings/hosts/srv_example/plugins/beautiful-chat/chat-presentation"`。

## 改插件后的重载循环
1. 在 beautiful-chat 里改代码。
2. `paseo plugin reload --home ~/.paseo-bench beautiful-chat`（服务端立即重编，约 1s）。
3. 客户端部分在应用连接时加载：在模拟器里开发菜单 Reload，或 `xcrun simctl terminate $U sh.paseo && xcrun simctl launch $U sh.paseo` 后重新打开 dev server。原生部分（宿主）不变，**无需重新 xcodebuild**。
4. 改宿主（`packages/app`）JS 走 Metro Fast Refresh；改原生模块才重新 xcodebuild（增量，通常 <1 分钟）。

## 耗时汇总
`npm ci` 38s · `build:server-deps` 1m52s · `expo prebuild`+pod install 约 2m20s · xcodebuild（冷）2m20s · Metro 首次 bundle 约 1.5 分钟 · 插件 `npm ci` 2s。

## 已知问题与对策
| 现象 | 对策 |
|---|---|
| `Can't determine id of Simulator app` | 不用 `expo run:ios`，改 xcodebuild + simctl |
| `deployment target is set to 9.0…` | `IPHONEOS_DEPLOYMENT_TARGET=15.1` |
| Metro 无法解析 `@getpaseo/{highlight,plugin,expo-two-way-audio}` | 见 Step 0 的构建 |
| `serve-sim: Library not loaded SimulatorKit` | 软链 SharedFrameworks 的 SimulatorKit |
| 插件 `Could not resolve @shikijs/core` | 先在插件目录 `npm ci --include=dev` 再 `plugin reload` |
| `simctl ... booted` 命中别人的模拟器 | 永远用 UDID；用完 `simctl uninstall` 自己误装的 |
| iOS 上代码/diff/shell 比例字体 | 见 Finding 8，需原生注册 mono 字体或改用平台 monospace 回退 |

---

# Control test：把比例字体归因到插件（追加，10:27–10:33）

## 结论（先说）
**比例字体是 beautiful-chat 插件造成的，不是宿主默认。** 停用插件后，宿主自己的围栏代码块、shell 详情、edit diff 在 iOS 上全部是等宽字体（列对齐）。宿主默认 `ui-monospace` 在 iOS 上有效。插件的 `fontMono = "OMP Iosevka"`（以及 `fontUi = "OMP Inter"`）在原生没有注册，回退成 San Francisco。**之前"宿主默认 mono 栈可能也没命中"的猜测是错的，已撤回。**

## 1. 停用插件后的对照（新 agent `S0-D control`，bc-bench 回放 `codeblock-streaming` + `mixed-turn`，`speed:max`）
步骤：`paseo plugin disable --home ~/.paseo-bench beautiful-chat` → 状态 `disabled` → 在 UDID `CE6149D8…` 上 terminate/launch 并重连 Metro → 新建 agent 回放两个 fixture。

| 截图（`/Users/luopeihuan/workspace/rrd/scratch/beautiful-chat-upgrade-evidence/ios/`） | 内容 | 是否等宽 | 渲染组件 |
|---|---|---|---|
| `control-codeblock-host-rust-monospace.png` | Rust 围栏代码块（`wait: Duration,` / `last: Option<Instant>,` / `pending: Option<T>,` 缩进与字宽一致） | 是（SF Mono 字形，列对齐，空格网格整齐） | 宿主 markdown（`styles/markdown-styles.ts` 的 code_block，`theme.fontFamily.mono`） |
| `control-codeblock-host-old-agent.png` | 同一代码块，旧 agent，停用插件后重载 | 是 | 宿主 markdown |
| `control-markdown-inline-host.png` | 行内 code（`turn-state.ts`、`running`、`assistant_message`）和 `npm test -- turn-state` | 是（行内 code 与正文字体明显不同且等宽） | 宿主 markdown |
| `control-shell-host-monospace.png` | Shell 详情页：`FAIL client/lib/turn-state.test.ts` / `× treats a running tool as not done (4 ms)` / `expected false, received true` | 是（缩进两列/四列精确对齐，`ms` 与 `(4` 等宽） | 宿主 tool-call 详情（`components/tool-call-details.tsx`，`theme.fontFamily.mono`） |
| `control-edit-diff-host-monospace.png` | Edit diff（`@@ -10,8 +10,10 @@`，`-`/`+` 行，`===`，行内缩进） | 是（`+`/`-` 标记列与代码列对齐，缩进一致） | 宿主 tool-call 详情（同上）+ `components/diff-viewer.tsx` |

对比之前（插件启用）：同一类内容在 `b-font-proportional-diff-and-shell.png` 与 `b-codeblock-rust-proportional.png` 里都是比例字体。

## 2. 宿主在 iOS 用的 fontFamily，以及 RN 能否解析
- 定义：`packages/app/src/styles/theme.ts:641-645`：`DEFAULT_MONO_FONT_STACK = Platform.select({ ios: "ui-monospace", default: "monospace", web: "SFMono-Regular, Menlo, …" })`；初始主题 `fontFamily: { ui, mono: DEFAULT_MONO_FONT_STACK }`（:670），`appearance/apply.ts:65` 在用户未配置时用同一默认值。
- 使用点（`theme.fontFamily.mono`）：`styles/markdown-styles.ts:184,194,207`（行内 code / code_block / fence）、`components/tool-call-details.tsx:941,956`、`components/diff-viewer.tsx:228`、`components/highlighted-content.tsx:84,93`、`composer/input/input.tsx:1983`、`file-explorer-pane.tsx:1821` 等。
- RN 0.81.5 的解析：旧的 `React/Views/RCTFont.mm` 里没有 `ui-monospace`（遇到未知 family 会走 `Unrecognized font family` → 系统字体）。但 **Fabric 的文本路径** `ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTFontUtils.mm:290-299`（`RCTGetFontDescriptorSystemDesign`）显式映射：`system-ui`/`ui-sans-serif` → Default，`ui-serif` → Serif，`ui-rounded` → Rounded，**`ui-monospace` → `UIFontDescriptorSystemDesignMonospaced`**，并在 `RCTFontWithFontProperties` 里用 `fontDescriptorWithDesign:` 生成 SF Mono。本应用是新架构（Fabric），所以走这条路径。
- **结论：宿主默认 mono 在 iOS 上有效**（控制测试的截图是实证）。对比：宿主终端渲染器另外自带 `ui-monospace → Menlo` 别名（`terminal/native-renderer/font.native.ts:10-15`），与此无关。
- 插件为何失败：`client/components/theme-tokens.ts:21-29,182` 把 `fontMono = "OMP Iosevka"`、`fontUi = "OMP Inter"` 直接塞进 `fontFamily`；`embed-fonts.ts` 只通过 web `@font-face` 注册（`font-data.ts`）。RN 原生里这些名字既不是系统 family，也不是 PostScript 名，`UIFont fontNamesForFamilyName:` 为空 → 回退系统字体。同理 **"Interface font: Inter" 在 iOS 上实际也是系统 SF**（设置页选了 Inter 并无实际效果）。这是 D3 需要修的根因：原生需要 `expo-font` 载入打包的 Iosevka/Inter，或在原生分支改用 `ui-monospace`/`System`。

## 3. 重新启用
`paseo plugin enable --home ~/.paseo-bench beautiful-chat` → `paseo plugin ls`：`bc-bench running`、`beautiful-chat running`（ENABLED yes）。模拟器应用保持连接 6868，下次重连会重新加载插件客户端。

## 4. 之前 `b-codeblock-rust-proportional.png` 是哪个渲染器画的
**插件的 MarkdownView（`assistantMarkdown` 开启）**，不是宿主 markdown。依据：
- `index.client.tsx:196-201` 注册了 `assistant_message` 的 timeline transformer，`client/preferences.ts:60` 默认 `assistantMarkdown: true`，`client/live-renderers.tsx:752` 说明它用插件自己的 markdown 渲染助手回复。
- 同一内容在插件开启时的外观不同：标题带分隔线（"Fixed"）、代码块用插件配色/换行方式、页脚是 `Copy  10:25` 文本按钮；停用后是宿主样式（页脚是图标行 + `工作了 0s`）。
- 因此它使用 `tokens.fontMono = "OMP Iosevka"`，iOS 无该字体 → 比例字体。这也解释了为什么宿主自己的围栏块是等宽、而插件接管后的围栏块不是。

## 后台进程（保留给后续验证）
| 进程 | PID | 端口 |
|---|---|---|
| Metro（`expo start --dev-client`，EXPO_PUBLIC_LOCAL_DAEMON=localhost:6868） | node **33922**（父 `npm exec` 33866） | 8081 |
| serve-sim 流（仅 UDID `CE6149D8…`） | **99028** | 3100 |
| bench daemon（`paseo daemon status` 报告的 pid；日志里的 worker pid 为 43171） | 43169 | 6868 |
均由本 slice 启动；未终止任何非本 slice 的进程。

---

# Hermes root cause（追加，11:19–11:37）

标注：**[V]** = 已验证（给出命令/截图/文件），**[H]** = 假设/未复现。

## 结论（先说）
**根因：RN 0.81.5 自带的 Hermes 不能编译 ES2015 `class`（声明和表达式）、私有成员、静态块，宿主编译插件客户端 bundle 时只用 esbuild（target es2020），esbuild 在 es2020 不会降级 `class`，Metro 的 Babel 本来会做这一步但插件 bundle 绕过了 Metro。** `eval` 本身不是根因。marked 18.1.0 的 ESM 包里有 `class` 和静态字段，所以加载就崩；`marked` 之外插件自己的 `class` 也一样。**[V]**

失败形态取决于 bundle 大小：源码 **< 约 64 KiB** 时 Hermes 急切编译，`eval` 直接抛 `SyntaxError: invalid statement/expression encountered`（响亮）；**> 约 64 KiB** 时 Hermes 惰性编译函数体，`class` 声明变成空操作、`class` 表达式的值是 `undefined`（**静默**），之后才在别处炸（`Property 'A3' doesn't exist`、`right operand of 'in' is not an object`、`Cannot read property … of undefined`）。插件 bundle 通常很大，所以用户看到的是后者。**[V]**（`hermes-data/tools/m6.js` 的尺寸扫描：64194 B 抛 SyntaxError，70194 B 起静默 `undefined`；见下）

## 1. 探针插件与环境
- 探针：`/tmp/bc-orchestrate/hermes-probe/`（`paseo-plugin.json` + `index.client.tsx` + `client/probe-features.ts` + `client/lib-marked.ts` + `client/lib-remend.ts`），设置页渲染"特性 → OK/FAIL + 信息"。源码副本：`/Users/luopeihuan/workspace/rrd/scratch/beautiful-chat-upgrade-evidence/ios/hermes-data/`。
- 通过 `paseo plugin install --home ~/.paseo-bench` 安装为 `hermes-probe`，经深链 `sh.paseo:///settings/hosts/srv_example/plugins/hermes-probe/probe` 在 UDID `CE6149D8…` 打开。结束后已 `plugin remove`（`hermes-probe`、`hermes-probe-vendored`），`~/.paseo-bench` 现只剩 `bc-bench` 与 `beautiful-chat`（其余插件项为其他 slice 管理，未触碰）。
- 注意：目录插件的模块必须放在 `client/`、`server/`、`shared/` 下，否则 `Plugin modules belong in client/, server/, or shared/`（第一次安装因此失败）。

## 2. 特性矩阵（模拟器实测；本地 Hermes CLI 逐项一致，差异单列）
截图：`hermes-baseline-top.png`、`hermes-baseline-eval-rows.png`、`hermes-baseline-bottom.png`；完整文字：`hermes-data/local-hermes-cli-baseline.txt`。

| 特性 | 结果（真机 Hermes eval，经 daemon 的 esbuild） | 说明 |
|---|---|---|
| `class` 声明 / `extends` / 内置 `extends Error` / getter-setter / static getter / 计算方法 `*[Symbol.iterator]` | **FAIL**：`Property 'A3' doesn't exist`（惰性编译下类声明是空操作） | [V]。esbuild 把名字改成 `A3`，所以报错里是 `A3` |
| class 公有字段 / static 字段 / 私有 `#field` / `#method` / `#x in obj` | **FAIL**（同上，被 esbuild 降级成 `__publicField` 等 helper，但外层 `class` 仍在） | [V] |
| class static block | **FAIL**：`Cannot set property 'v' of undefined` | [V] |
| `new.target`、generator、`async function`、async generator（经 esbuild 的 async 降级）、`for await`（仅编译后）、可选链/空值合并、逻辑赋值、对象展开/rest | OK | [V]。esbuild 把 `async-await` 降级（compiler.ts:402-410），并把 es2021 逻辑赋值降级 |
| `Array.at`、`Object.hasOwn`、`String.replaceAll/matchAll`、`Array.findLast`、`structuredClone`、`WeakRef`、`queueMicrotask`、`TextEncoder` | OK（后三者本地 CLI 没有，应用里由 RN/Expo polyfill 提供） | [V] |
| `Array.prototype.toSorted`、`Intl.Segmenter` | **缺失**（`undefined`） | [V]，不能直接用；`Intl.DateTimeFormat` 有 |
| 原始字符串 eval：正则 lookbehind、命名分组、`d` / `s` / `u` / `y` 标志、`\p{L}`、可选 catch 绑定、数字分隔符、BigInt、`**` | OK | [V] |
| 原始字符串 eval：正则 **`v` 标志** | **FAIL**：`Invalid RegExp: Invalid flags` | [V] |
| 原始字符串 eval：`class`（任何形式）、私有字段、`#x in`、static block | **FAIL**：`invalid statement encountered` / `private properties are not supported` / `class static blocks are not supported` | [V]（急切编译，直接 SyntaxError） |
| 原始字符串 eval：`for await`、async generator | **FAIL**：`for await..of loops are currently unsupported` / `async generators are unsupported` | [V]（但 esbuild 会先降级，所以在 bundle 里 OK） |
| `"x" in 5` / `"x" in undefined` | 抛 `TypeError`，消息 `right operand of 'in' is not an object` | [V]；这是**正常语义**，只是 Hermes 的措辞 |
| `import { Lexer, marked } from "marked"` | **LOAD FAIL**：`right operand of 'in' is not an object`（`hermes-baseline-top.png`） | [V] |
| `import remend from "remend"` | OK：`remend("**bold and \`co") -> **bold and \`co**\`` | [V]，`remend` 无 `class`，不需要处理 |

## 3. `eval` 是不是问题（第 2 点）
- 否。**[V]** 本地 `hermes file.js`（非 eval）同样报 `invalid statement encountered`；差别只来自急切/惰性编译（见结论）。Hermes 解析器认得 `class` 语法，但**没有代码生成**。Metro 的 Babel（`@react-native/babel-preset`，`plugin-transform-classes` 在 `configs/main.js:90`，class-properties/private-methods/private-property-in-object 在 :235-239）会在 Metro 阶段把 class 降成函数，所以应用自身代码不受影响。
- Hermes 版本：`hermes-2025-07-07-RNv0.81.0-e0fc6714…`（`node_modules/react-native/sdks/.hermesversion`），Podfile.lock `hermes-engine (0.81.5)`；`hermes -version`：`Hermes release version: for RN 0.81.5`，HBC bytecode 96。**[V]**
- **本地有可用的 Hermes VM/编译器 [V]**：`node_modules/react-native/sdks/hermesc/osx-bin/{hermes,hermesc}`（linux64-bin、win64-bin 同目录），以及 `packages/app/ios/Pods/hermes-engine/destroot/bin/hermes`。两份 VM 对同一 bundle 输出逐字节一致（`diff` 无差异）。esbuild 0.27.3（仓库）与 0.25.12（打包的 Paseo.app，bench daemon 实际使用的版本）产出的 bundle 表现相同（失败数都是 28）。
- **本地复现 [V]**：`node hermes-data/tools/run-hermes.cjs <bundle.js> <hermes>` 用 `globalThis.eval` 加载 bundle、桩 `react`/`react-native`、渲染设置页，输出与模拟器一致（唯一差异：本地 CLI 没有 `structuredClone`/`WeakRef`/`TextEncoder`）。1 秒内出结果，可直接进 CI。

## 4. marked 里触发 `right operand of 'in' is not an object` 的确切位置（第 3 点）[V]
- 源：`node_modules/marked/lib/marked.esm.js`（压缩单行），Hooks 类：`var _=class{options;block;constructor(e){this.options=e||P}…static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set([…])}`。
- esbuild（es2020）把 static 字段降成 `_ = (_a2 = class {…}, __publicField(_a2, "passThroughHooks", new Set([…])), …, _a2)`（探针 bundle 第 1228 行）。Hermes 惰性编译时 `class {…}` 表达式的值是 `undefined`，于是 `__publicField(undefined, "passThroughHooks", …)` → `__defNormalProp` 里的 `key in obj`（bundle 第 14 行）抛 `right operand of 'in' is not an object`。
- 实证：给 `__defNormalProp` 加 `print` 追踪，输出 `[trace] __publicField(undefined, "passThroughHooks") … at node_modules/marked/lib/marked.esm.js (:1228:21)`（`hermes-probe-out/bundle-trace.js`）。
- 同一文件还有 7 个 class（Lexer、Parser、Tokenizer、Renderer、TextRenderer、Hooks、Marked）；`hermesc` 对它们各报一次。
- `Cannot read property 'prototype' of undefined`（S0-A 的另一个症状）：**[H]**。我用 `class extends` 的几种形态没有复现这条消息，只得到 `Property 'B3' doesn't exist`。合理推断是某个 `class X extends Y` 或随后的 `X.prototype.…` 在 `X`/`Y` 为 `undefined` 时抛出；beautiful-chat 自己的 `client/debug/store.ts`（`Series`、`PerfStore`）就是候选，需要在实际插件代码里再确认。

## 5. 当前 beautiful-chat 客户端 bundle 的体检（主 checkout `de7dca3`）[V]
- 按 compiler.ts 的选项编译：749 KB。`hermesc` 退出码 2，**9 个错误**：marked 7 个（`marked.esm.js`），**插件自己的 `client/debug/store.ts` 2 个**（`Series`、`PerfStore`）。
- 即：不动 marked，也需要处理插件自己的两个 class（改成函数/对象）或接入下面的降级。

## 6. 建议
### (a) Hermes-eval 下插件客户端代码的安全语法包络
**可以用**（经 esbuild 降级或 Hermes 原生支持）：`async/await`、generator、可选链、`??`、`??=`/`||=`/`&&=`、对象展开、可选 catch、数字分隔符、BigInt、`**`、`new.target`、正则 lookbehind/命名分组/`d s u y`/`\p{}`、`Array.at/findLast`、`Object.hasOwn`、`replaceAll/matchAll`、`structuredClone`、`WeakRef`、`TextEncoder`。
**不要用**：任何 `class`（声明、表达式、`extends`、字段、`static`、`#私有`、static block、`#x in o`）、直接写在源里的 async generator / `for await`（esbuild 当前会降级，但不保证）、正则 `v` 标志、`Array.toSorted`/`toSorted` 系列、`Intl.Segmenter`。**依赖也受同样限制**：任何带 `class` 的 npm 包（含 marked 18）都不能直接 bundle；`remend` 1.4.0 可以。
### (b) 插件内使用 marked / remend 最省事的办法 [V]
- **推荐：把 marked 用 Babel 预先降级后"vendor"进仓库**：`node vendor-babel.cjs node_modules/marked/lib/marked.esm.js client/vendor/marked.js`（`@react-native/babel-preset`，`hermes-stable` 配置，保留 ESM；46 KB → 112 KB）。**模拟器实测通过**：`hermes-vendored.png`（`typeof Lexer = function`、`Lexer.lex → ["heading","space","paragraph"]`、`marked.parse("**b**") → <p><strong>b</strong></p>`、remend 正常）。同一份 vendored 插件的 bundle 通过 `hermesc`（`check-hermes-bundle.mjs` 输出 `OK … 169208 bytes`）。代价：升级 marked 要重跑脚本并提交产物（可做成 `npm run vendor:marked`），体积约 2.4 倍。
- 备选：把 `marked` 换成不依赖 class 的分词器；或自己写所需子集。成本更高、风险更大，不推荐。
- `remend` 不需要处理。
### (c) 是否值得上游修（宿主）[H：建议；技术可行性 V]
- **值得。** 这是宿主与文档间的不一致：插件客户端 bundle 被描述为"像应用代码一样运行"，但它们绕过了 Metro 的 Hermes 降级，且失败是**静默**的（大 bundle），排查成本很高。`compiler.ts` 里已经有两处 Hermes 补丁（`supported: {"async-await": false}` 和 `makeHermesInteropEager`，说明维护者已经遇到过同类问题）。
- 最小宿主改动（`packages/server/src/server/plugins/compiler.ts`，仅 client target）：在 `wrapCommonJsBundle` 之前，对 esbuild 输出再过一遍 **class-only Babel**：`plugin-transform-class-static-block` + `class-properties` + `private-methods` + `private-property-in-object` + `classes`。**本地验证 [V]**：对探针 bundle（105 KB）→ 133 KB，耗时 2.5 s，之后 `hermesc` 退出 0，**所有 class/私有/static block 探针与 marked、remend 全部 OK**（`hermes-data/local-hermes-cli-class-lowered.txt`）；对真实 beautiful-chat bundle（749 KB）→ 769 KB，4.4 s，`hermesc` 0 个错误。完整 `@react-native/babel-preset`（`hermes-stable`）也可，但产物大一倍（105 KB → 203 KB），没必要。
- 新增依赖：`@babel/core` + 上述 5 个插件到 server 包（打包进桌面应用）。注意：**此处 esbuild 版本不是瓶颈**（esbuild 本身不支持 class → function，`--target=es5` 和 `--supported:class=false` 都报 `Transforming class syntax … is not supported yet` [V]）；TypeScript 的 `transpileModule(target: ES5)` 也能降 class（server 已依赖 `typescript`），但会连带降 let/const 与 generator，产物更大，不如 Babel 精准 **[V：能降；H：未对完整 bundle 试过]**。
- 另一个低成本改进：在编译后加一次 `hermesc`-类似的静态检查，把"class 静默变 undefined"变成明确的安装错误。需要把 hermesc 打包进应用，成本较高，不如 Babel 降级直接。
- 兼容性：这是实现细节，不改协议；老版本宿主仍需要插件自己避开 class（`requirements.paseo` 之类的版本约束可以标在插件 manifest 里）。
### (d) 加到插件仓库 CI 的检查脚本 [V]
`/Users/luopeihuan/workspace/rrd/scratch/beautiful-chat-upgrade-evidence/ios/hermes-data/tools/check-hermes-bundle.mjs`（可放到 beautiful-chat 的 `scripts/check-hermes-bundle.mjs`，在 `package.json` 里加 `"check:hermes": "node scripts/check-hermes-bundle.mjs"`）：用与 compiler.ts 相同的 esbuild 选项编译 `index.client.tsx`，交给 `react-native` devDependency 自带的 `hermesc` 编译，非 0 退出即失败并列出行号。需要 devDependency `react-native@0.81.5`（beautiful-chat 已有）和 `esbuild`。
- 实测：对当前 beautiful-chat 主 checkout → `FAIL: Hermes cannot compile index.client.tsx (9 error(s))`，退出码 1；对 vendored 探针 → `OK … 169208 bytes`，退出码 0。
- 局限：`hermesc` 只检出**语法**不支持，检不出 API 缺失（`Intl.Segmenter`、`toSorted`）；这部分需要再加一个 `hermes` VM 冒烟（`run-hermes.cjs` 的思路：`eval` 加载、调用设置入口、断言无异常），建议作为第二步加进 CI。要在 CI 里跑 Linux：`sdks/hermesc/linux64-bin/hermesc` 已随 `react-native` 包提供；`hermes`（VM）在 `osx-bin`/`linux64-bin` 都有。
- `--lower-classes` 开关只在装有 `@babel/core` 的环境里可用（plugin 仓库没有；在 paseo 仓库里验证过）。

## 7. 其他注意（已验证）
- 该 bundle 里 `makeHermesInteropEager`（compiler.ts:305-310）与 Hermes 在 `eval` 里对 `for (let key of …) { get: () => from[key] }` 闭包的错误共享同属一类 Hermes bug；说明 Hermes 对 eval 源码的编译有多种不一致，**优先让 bundle 保持"简单的 ES2020 子集"**。
- `Intl.Segmenter` 缺失会影响 BC-11 里任何文本切分设想；只能用 `Intl.DateTimeFormat`/手写。
- 截图：`/Users/luopeihuan/workspace/rrd/scratch/beautiful-chat-upgrade-evidence/ios/hermes-baseline-{top,eval-rows,bottom}.png`、`hermes-vendored.png`；数据与脚本：`/Users/luopeihuan/workspace/rrd/scratch/beautiful-chat-upgrade-evidence/ios/hermes-data/`；中间产物：`/tmp/bc-orchestrate/hermes-probe-out/`。

## 清理
- `hermes-probe`、`hermes-probe-vendored` 已从 `~/.paseo-bench` 移除（`plugin ls` 仅剩 `bc-bench`、`beautiful-chat`）。
- 未改 paseo 仓库任何被追踪文件；beautiful-chat 主 checkout 无改动（只读了源码并临时编译到 /tmp）。Metro（PID 33922）与 serve-sim（PID 99028）仍在运行，bench daemon 仍为 PID 43169。

---

# V2 host device verification（追加，2026-10-11 17:27–18:08）

被验证：`bc/host-small`（`/Users/luopeihuan/workspace/rrd/paseo/.worktrees/bc-host-small`，3 个提交：H5 `b78fa8121`、H0 `3291fc51c`、H1 `c9dc6d447`，基于 origin/main `7f9b65d46`）。模型 claude-sonnet-5-5（medium）。**结论：H5、H0、H1 在 iPhone Air 真机（模拟器）上全部验证通过；H5 桌面打包 smoke 通过（未签名 `--dir` 包 + 从 asar 运行的守护进程）。** 无提交、无 push；worktree `git status` 干净。

## 隔离（遵守的约束）
| 项 | 用 | 没碰 |
|---|---|---|
| 模拟器 | iPhone Air `EE10D115-83CD-4364-936C-2448ED5A9708`（我 boot，结束已 shutdown，并卸载了 app） | iPhone 16 Pro `CE6149D8…`（仍在运行）以及其他 Booted 设备 |
| Metro | worktree，端口 **8082**（另有一个临时 8083，见 H0；均已停止） | 8081（PID 33922 仍在） |
| 守护进程 | **worktree 源码** `packages/server/dist`（本次重新 `npm run build:server`），home `~/.paseo-bench-host`，端口 **6869**；桌面 smoke 阶段改用 asar 内的打包守护进程，同 home/端口 | `~/.paseo`、6767（PID 65512 未动，`~/.paseo/config.json` mtime 仍是 Oct 10）、6868（PID 40400 未动） |
| serve-sim | 仅对 Air，端口 3200（用 `-k <UDID>` 关闭，没有 `pkill`） | 3100（PID 50190 仍在） |
| 守护进程环境 | `PASEO_DICTATION_ENABLED=false`、`PASEO_VOICE_MODE_ENABLED=false`（避免它在 home 下下载语音模型）、`PASEO_LOCAL_MODELS_DIR` 指到自己的 home | 没有使用 `scripts/dev-daemon.sh`（它会从 `~/.paseo` 播种/用其 models 目录） |
- 一个需要说明的操作：`paseo daemon config set --home ~/.paseo-bench-host daemon.listen 127.0.0.1:6869`。新建的 home 默认写 `127.0.0.1:6767`；若不改，用 `--home` 的 CLI 命令会指向用户主守护进程。改完之后 `--home ~/.paseo-bench-host` 才是安全的。此后所有插件命令都用 `--host 127.0.0.1:6869`。
- 守护进程跑的确实是 worktree 代码：`lsof -d cwd` 显示 `…/.worktrees/bc-host-small`。已安装到 `~/.paseo-bench-host`：`bc-bench`（`tools/bench-provider`，先跑了 `npm run setup`）、`beautiful-chat`（main `ce3f1ad`）。结束时 `hermes-probe-v2` 已移除，`pluginsEnabled` 仍为 true（该 home 属于我，之后会被清理或留作测试）。

## 构建与环境耗时
| 步骤 | 耗时 |
|---|---|
| `npm run build:server`（worktree） | 约 5 分钟（机器负载 180+） |
| `expo prebuild --platform ios`（含 pod install） | 1 分 23 秒 |
| `xcodebuild`（Debug，iPhone Air，`IPHONEOS_DEPLOYMENT_TARGET=15.1`，冷） | 12 分 28 秒 |
| 桌面：`install-electron` / `build:main` / `electron-builder --mac --dir` | 12 秒 / 数秒 / 32 秒 |

## 上游 main（`7f9b65d46`）在 iOS 上的一个与本次改动无关的启动 bug（已绕过，需另报）
- 现象：app 启动即红屏 `Cannot read property 'includes' of undefined`，栈在 `packages/app/src/terminal/native-renderer/headless-terminal-state.ts:1`（`import … from "@xterm/headless"`）。
- 根因 [V]：`@xterm/headless@6.1.0-beta.213` 在模块顶层读 `navigator.userAgent.includes(...)`；RN 的 `navigator.userAgent` 是 `undefined`。宿主有 `polyfillNavigator()`，但在 `src/app/_layout.tsx:141` 调用，而 `_layout.tsx` 的 import 链（`workspace → … → terminal-pane → headless-terminal-state`）在它之前已经求值（ES import 提升）。v0.11.2 没有这条依赖路径，所以第一轮 S0-D 没遇到。
- 我的绕过（不改被追踪文件）：在 worktree 的 `packages/app/node_modules/@xterm/headless/lib-headless/xterm-headless.{js,mjs}` 里把 `navigator.userAgent`/`navigator.platform` 改成带 `||""` 的形式，验证完已**还原**。建议单独报 issue：把 `polyfillNavigator()` 提到 `index.ts` 的最前面（与 `polyfillCrypto()` 并列）。
- 注意：这不是 H5/H0/H1 引起的；同一 worktree 的 iOS 开发构建在没有该绕过时无法启动。

## 1. H5：未修改的 `marked@18.1.0` + class 在 iOS 上加载并运行 [V]
- 探针插件 `/tmp/bc-orchestrate/hermes-probe-v2/`：`index.client.tsx` + `client/probe.ts`；`import { Lexer, marked } from "marked"`（`node_modules/marked@18.1.0` **未改动**，从 beautiful-chat 拷贝），并在源码里直接写 class：普通、`extends`+`super`、`extends Error`、公有字段、static 字段、私有 `#field`、`#method`、`#x in obj`、static block、getter/setter、`instanceof`。
- 通过 `paseo plugin install --host 127.0.0.1:6869`（worktree 守护进程用 Babel 降级后编译）。
- 结果（截图 `v2-h5-probe-top.png`）：`hermes-probe-v2 Hermes failures=0/14`。`Lexer.lex → ["heading","space","paragraph"]`，`marked.parse("**b** and `c`") → <p><strong>b</strong> and <code>c</code></p>`，所有 class 项 OK。
- 对照（第一轮 S0-D 在 stock 0.11.2 上的同类探针）：`hermes-baseline-top.png` 显示 `LOAD marked: right operand of 'in' is not an object` 和十多项 `Property 'A3' doesn't exist`。区别仅是 daemon 侧的 Babel 降级（H5）。
- 耗时/体积：探针 bundle 在 worktree 守护进程里安装即 `running`；打包版编译见 §4（82 KB）。

## 2. H0：插件工具行像原生工具行那样堆叠 [V]
方法：`reads-20`（`speed:max`）在同一 agent、同一设备、同一 daemon（6869）、同一插件（beautiful-chat `ce3f1ad`，该版本的 Read 行是无边框的扁平行：book 图标 + 路径 + `L1–156` + 箭头）上，分别用三种宿主渲染；用像素带检测量连续 Read 行的纵向间距（3x，`pt = px/3`）。
| 条件 | 行距（pitch） | 截图 |
|---|---:|---|
| **H0 构建，插件开启** | **90 px = 30 pt**（12 行中位数） | `v2-h0-patched-host-plugin-on.png` |
| H0 构建，插件**关闭**（宿主原生行） | 96 px = 32 pt（9 行中位数） | `v2-h0-patched-host-plugin-off-native.png` |
| **stock v0.11.2 JS**（同一原生二进制 + Metro 8083 指向主 checkout 的 0.11.2 JS），插件开启 | **138.5 px = 46.2 pt**（6 行中位数） | `v2-h0-stock-host-0.11.2-js.png` |
- 同一插件行在 stock 宿主上多出 **16 pt**（46 − 30），与宿主默认间距（`kind: "plugin"` 的 16）一致；H0 之后行距等于插件行自身高度（30 pt），**间距为 0**，与原生行同样紧凑（原生 32 pt，每行比插件行高 2 pt，与 `docs/bench/baseline-host.md` 里"原生行 32 pt 节距"一致）。
- 与 `baseline-host.md` 的对比：旧基线（旧版插件、有边框卡片，卡片高 30 pt）测得 gap 24 pt/pitch 54 pt；本次插件版本改成了扁平行，所以不是同一对象，无法逐个对比；但 stock 对照给出了同一插件版本的直接参照（gap 16 pt → 0）。20 次 Read 的额外滚动高度从约 320 pt（16 pt × 20）降到 0。
- 说明：stock 对照用的是 worktree 构建的原生二进制 + 0.11.2 的 JS（Metro 8083，从主 checkout 起，已停止；主 checkout 无文件被修改）。原生依赖在两个版本间足够兼容，应用正常运行并连接 6869。
- 还有一点：关闭插件后，已有的 agent 时间线**在不重载应用的情况下**立即回退到宿主原生行（实时），验证了 `plugin disable` 的客户端卸载路径。

## 3. H1：`PluginTheme.typography` 使 Follow Paseo 实时跟随宿主外观 [V]
- 起始状态（`v2-h1-before-plugin-settings.png`）：beautiful-chat 设置页 Fonts 区：Monospace font = **Follow Paseo**，Code font size = **Follow Paseo / 12px**，预览代码块 12 px 默认 mono；**没有**"This Paseo version does not share its font settings with plugins…"提示（该提示由插件在宿主没有 `typography` 时显示，见 `client/settings-page.tsx:550`）。
- 修改宿主外观（App 设置 → 外观，`v2-h1-before-host-appearance.png` → `v2-h1-after-host-appearance.png`）：代码字号 12 → **18**，代码字体留空（`ui-monospace`）→ **Courier**。
- 立刻回到插件设置页（`v2-h1-after-plugin-settings.png`）：Code font size 显示 **18px**，预览代码块明显变大并使用 Courier 风格的衬线等宽字形（`const`、`return value ?? fallback;` 自动换行），仍是 Follow Paseo；**没有重载应用、没有重载插件**（期间只经过深链导航，JS bundle 未重新加载）。
- 时间线里的插件代码块同步变化：`v2-h1-after-timeline-codeblock-courier18.png`（`codeblock-streaming` 的 Rust 代码块，Courier 18 px，对比 `v2-h0-patched-host-plugin-on.png` 里同一应用上的 12 px 默认 mono 路径文字）。
- 提示条在所有状态下都不出现 → 宿主确实提供了 `typography`。
- 局限：没有在"同一屏幕不离开"的条件下同时展示改前改后（宿主外观与插件设置是不同路由），因此"实时"的证据是：中间没有任何重载，且回到的页面和时间线都立即用新值渲染。写入 Courier 时用 `serve-sim type`（在拼音输入法下这里可用）。我没有把外观改回默认（模拟器应用已卸载，状态随之清除）。

## 4. H5：桌面打包 smoke [V，范围有限]
文档化脚本：`packages/desktop` 的 `electron-builder --config electron-builder.yml`（`npm run build:desktop` 的最后一步；完整 `build:desktop` 会 `build:app-deps:clean` + `expo export --platform web` + 干净重建 server，在这台过载机器上太重，且与 H5 无关）。我的路径：
1. `install-electron`（`--ignore-scripts` 装依赖时跳过了 Electron 下载）；`npm run build:main`。
2. `mkdir packages/app/dist` + 占位 `index.html`（electron-builder 的 `extraResources` 需要 `../app/dist`；此桩只为通过打包，验证后已删除；**渲染器本身没有被测**）。
3. `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder … --mac --dir --publish never -c.mac.notarize=false -c.mac.hardenedRuntime=false -c.mac.identity=null` → 32 秒，`release/mac-arm64/Paseo.app`（511 MB，`app.asar` 128 MB）。
4. 验证 `app.asar` 内包含 `@babel/core` 与 5 个 class 插件（`node_modules/@babel/<plugin>/lib/index.js` 各 1 个）和 `@getpaseo/server/dist/server/server/plugins/compiler.js`。
5. 对 arm64 的未签名 `.app` 做本地 ad-hoc 签名（`codesign --force --deep -s -`），然后**用打包版 Electron 的 Node 模式**启动 asar 内的守护进程，镜像 `node-entrypoint-launcher.ts` 的打包调用：`ELECTRON_RUN_AS_NODE=1 PASEO_NODE_ENV=production Paseo --disable-warning=DEP0040 …/app.asar/dist/daemon/node-entrypoint-runner.js node-script …/app.asar/node_modules/@getpaseo/server/dist/scripts/supervisor-entrypoint.js`。守护进程正常监听 6869，并加载了 `beautiful-chat`（编译走 asar 里的 esbuild + Babel）。
6. 用 `paseo plugin install --host 127.0.0.1:6869 /tmp/bc-orchestrate/hermes-probe-v2` 安装带 class + 未改 marked 的探针 → `running`。
7. 再在**打包版 Node**里直接调用 asar 内的 `compilePlugin`（`hermes-data/tools/packaged-compile.cjs`）：`packaged compile OK: 82201 bytes; node v24.20.0; electron 44.2.0`。产物：`hermesc` 退出码 **0**（原生 class 语法 0 个，仅 Babel 辅助函数 43 处引用；我的粗糙正则报的 11 个"class"匹配全是测试名字字符串）；本地 Hermes VM 跑 `contribute()`：`failures=0/14`（含 marked）。
- 结论：Babel 随 `@getpaseo/server` 的依赖进入 `app.asar`，纯 JS，在 asar 内的 Electron-as-Node 下能加载并工作，不需要 unpack。
- 没覆盖：完整的 `PASEO_DESKTOP_SMOKE=1` 路径（`afterSign` 里的 `smokePackagedDesktopApp`，需要真实渲染器和 `app-dist`，即完整 `build:desktop` 的 web 导出，以及签名/沙盒环境）；Linux/Windows 打包；以及打包体积变化（本次 `app.asar` 128 MB，无基线对比，因为没有构建 stock 对照）。

## 清理（已完成）
- 已停止：我的 Metro 8082/8083、serve-sim 3200、worktree 守护进程与打包守护进程（6869 现已无监听）；Air 已 `shutdown`，`sh.paseo` 已卸载。
- 已移除插件：`hermes-probe-v2`（`~/.paseo-bench-host`）。
- 已删除：`packages/app/dist`（桩）、`packages/desktop/release`；已还原 `@xterm/headless` 补丁。`~/.paseo-bench-host` 目录保留（含我的守护进程状态，可由用户决定删除）。
- 未碰：`~/.paseo`、6767、6868、8081（PID 33922）、serve-sim 3100（PID 50190）、iPhone 16 Pro。worktree 无被追踪文件改动（`git status --short` 为空），HEAD 仍是 `c9dc6d447`。
- 产物位置：截图 `/Users/luopeihuan/workspace/rrd/scratch/beautiful-chat-upgrade-evidence/ios/v2-*.png`；日志 `ios/v2-logs/`；脚本 `/tmp/bc-orchestrate/hermes-probe-tools/`（`v2-daemon.sh`、`v2-packaged-daemon.sh`、`packaged-compile.cjs`、`check-hermes-bundle.mjs` 等）。
