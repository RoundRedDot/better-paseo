# Better Paseo 开发指南

[English](development.md) | **简体中文**

[← 返回 README](../README-zh.md)

<a id="开发"></a>

## 项目结构

```text
better-paseo/
  paseo-plugin.json          # 插件清单：id、Paseo 版本要求、构建步骤
  index.client.tsx           # 时间线转换器、渲染器、设置页面
  index.server.ts            # daemon 端 RPC：file.reveal、file.image、highlight.tokens、fonts.embedded、marks.bitmaps
  shared/
    contracts.ts             # 客户端和服务端共用的数据契约
    preferences-settings.ts  # 设置记录（defineSettings，主机作用域）及其迁移逻辑
    *-rpc.ts                 # 各 RPC 接口契约：文件、图片、高亮、字体、图标、性能等
  server/
    font-data.ts             # 生成的 Inter 子集 woff2 字体数据，由 fonts.embedded 提供
    mark-bitmaps.ts          # 生成的所有品牌图标 PNG 位图，由 marks.bitmaps 提供
  assets/tool-marks/         # 工具行图标矢量源（MCP 服务、Shell 程序）
  scripts/build-tool-marks.mjs # 将 assets/tool-marks 栅格化为 server/mark-bitmaps.ts
  client/
    live-renderers.tsx       # 时间线条目到组件的映射
    settings-page.tsx        # 设置页面；settings-preview.tsx 负责绘制示例轮次
    preferences.ts           # 客户端显示偏好
    i18n/                    # 设置页面与工具栏的英文和简体中文文案
    components/              # 卡片、语法块、Markdown、图片查看器、查找栏、主题 Token
      marks.ts               # 品牌图标 ID 及 marks.bitmaps 填充的客户端缓存
      lobe-marks.ts          # 厂商 SVG 源文件，仅供生成脚本读取
    tools/ reasoning/ state/ # 工具摘要、思考过程解析器、逐次调用的展开状态
  docs/perf/                 # 性能基准图表与对比页面
  docs/design.md             # 设计说明：图标家族、图标格式以及如何新增图标
  docs/plugin-registry-update.md # 提交至 getpaseo/plugins 的版本钉住 PR 说明
```

## 命令

```bash
npm install
npm run typecheck
npm test
npm run check:hermes
npm run build:client
paseo plugin reload better-paseo
```

Paseo 从 GitHub 安装插件，因此本地分支的修改在推送到远端并更新插件（`paseo plugin update better-paseo`）之前不会在客户端生效。

日常更新可以安装当前 `main` 的 SHA，但正式版本发布不同。版本提交、日常 daemon 以及插件市场的钉住版本必须是同一个 SHA。首先修改 `package.json` 中的版本号并提交，在 `versions.json` 中映射其完整 hash，然后安装该 SHA：

```bash
paseo plugin update better-paseo --yes --ref <version sha> --json --home ~/.paseo
```

切勿安装版本提交的父提交。父提交不在版本映射表中，会导致设置页面报告版本信息不完整且无法判断哪端更新。如果不带 `--ref`，更新将直接安装当时的 `main` 分支最新代码。

paseo.sh/plugins 上的公开列表安装的是 getpaseo/plugins 中钉住的提交。请按照 [plugin-registry-update.md](plugin-registry-update.md) 为同一版本 SHA 提交 PR。在提交 PR 之前，应在 RoundRedDot/better-paseo 上发布同名的 GitHub Release。标签与标题必须完全一致（即插件版本号，不带 `v` 前缀）。在该 Release 发布且日常 daemon 切换到该 SHA 之前，更新流程不算完成。

## 安装构建

每次应用重新连接时都会重新下载所有插件的客户端包（位于插件清单内，在 relay 后面由 JS 解密），在手机上这会体现为「This plugin surface is unavailable.」的短暂等待。插件清单的最后一步构建命令 `node scripts/build-client.mjs --install` 会在从 Git 或 npm 安装与更新时执行（本地目录源不会执行，重载时也不会执行），并向安装目录写入两个文件：

- `index.client.ts`：Paseo 优先加载此文件而非 `index.client.tsx`。它包含使用宿主选项压缩后的 bundle，存放在一个字符串中并通过 `new Function` 执行，避免宿主自身编译器重新输出。
- `server/tasks-chunk.ts`：Tasks 看板的代码（`client/tasks/chunk/entry.ts`），已从主 bundle 中剥离。当看板、侧栏入口或设置首次展示时由插件服务端下发（`tasksChunkRpc`），客户端按构建 ID 保存在全局作用域，重连时无需重新拉取直接执行（`client/tasks/chunk/remote-chunk.ts`）。

两部分共用的模块保留在主 bundle 中，并通过 ID（`bc-tasks-shared`）注入到 chunk 中，确保全局只有一份启用状态存储、一个看板会话和一套语言配置。在源码检出目录、测试环境以及本地目录安装中，`chunk/source.ts` 直接导入 chunk，不生成多余文件。运行 `node scripts/build-client.mjs` 会打印各文件大小；`--out <dir>` 可将文件输出至指定目录。`--install` 拒绝在 Paseo 的暂存目录（staging directory）之外运行：若在源码检出目录留下 `index.client.ts` 会遮蔽源码。若要在私有 daemon 上测试安装构建，请先提交，然后执行：
`paseo --home <home> plugin install git:file://<checkout> --ref <full sha>`。

## Hermes 检查

在 iOS 和 Android 上，客户端 bundle 在不使用 Metro 或 Babel 的情况下直接运行在 Hermes 上：daemon 使用 esbuild（目标为 `es2020`，仅转译 async 函数，无其他降级）打包 `index.client.tsx`，应用直接将结果作为源码求值。在 Web 上能正常运行的代码，在 Hermes 上仍可能加载失败；一旦失败，整个插件就会被丢弃，而 Web 测试无法捕获该问题。

`npm run check:hermes`（`scripts/check-hermes.mjs`）使用宿主编译选项打包客户端并编译两次：一次使用 `react-native` devDependency（0.86，即 Paseo 0.13 所用）的 Hermes V1 `hermesc`，另一次使用 React Native 0.81.5 的旧版 Hermes（Paseo 0.12 仍在运行，且会拒绝 V1 接受的诸如 `class` 等语法）。旧版编译器与 `hermes` VM 在首次运行时从 `npm pack react-native@0.81.5` 下载并缓存在 `~/.cache/better-paseo/` 中。任何错误都会精确映射回源码文件与行号。Hermes V1 不发布独立 VM，因此脚本随后在旧版 `hermes` VM 中使用桩模块执行 bundle，调用 `contribute` 并校验宿主的注册规范。传入 `--no-run` 仅进行编译。随后 `npm run check:hermes` 会带上 `--built` 参数对安装构建再次校验：压缩后的 bundle 与 Tasks chunk 各自独立编译，且 VM 也会执行该 chunk。esbuild 作为根 devDependency 固定在 vitest 解析的同一版本，防止传递安装挂起。

客户端代码（包括客户端依赖）中严禁出现以下内容：

- **严禁以任何形式使用 `class`**：包括类声明、类表达式、类字段、私有成员或静态块。一律使用闭包与纯对象。这也是客户端不能直接导入 `marked` 的原因。
- **严禁使用正则表达式 `v` 标志**（编译期报错，检查脚本可直接捕获）。
- **严禁使用 `Array.prototype.toSorted` 与 `Intl.Segmenter`**。两者是在运行时缺失而非编译期缺失，因此检查脚本仅能在插件加载运行期间捕获；在渲染阶段才会执行到的代码不在检查覆盖范围内。
- **严禁在 bundle 中包含非 ASCII 字符**。任何一个多余的 `–` 或 `✓` 都会导致 Hermes 将整个约 950 KB 的源码以双字节字符串存放；检查脚本会直接拒绝非 ASCII 字符。
- **时间线渲染器必须注册为纯函数**。Paseo 会校验 `typeof Component === "function"`，因此 `React.memo` 返回的对象会被拒绝。若需 memo 优化，请将其包裹在函数组件内部。

`import()` 虽然能编译和加载，但无法缩短启动时间。宿主在没有代码拆分的情况下打包单个文件，esbuild 会将导入的代码保留在 bundle 内，并将几乎所有模块（实测 246 个中的 207 个）包裹在惰性初始化器中。在 Mac 上的 `hermes` VM 中（带桩模块），将设置页面、Tasks 看板和查找栏置于 `import()` 之后，执行 bundle 模块代码中位数耗时约为 76 ms，而静态导入约为 62 ms；若完全将这三者移出主 bundle，耗时降至约 42 ms。代码只有彻底脱离主 bundle，才能真正移出启动路径。

## 媒体与性能基准产物

视频脚本、截图工具链与媒体制作资源在私有的 [better-paseo-media 仓库](https://github.com/RoundRedDot/better-paseo-media) 中维护。
公开的 README 和展示页面使用的是托管在本仓库 GitHub Releases 上的最终图片素材。媒体资源与基准测试原始样本不存入 Git，也不包含在插件检出与安装包中；基准测试原始数据保存在本地被 git 忽略的目录中。
单元测试 fixture 与纯测试辅助函数保存在 `test/` 下，因此运行插件测试无需访问私有媒体仓库。

## 插件市场版本与发布信息

「版本」选项卡以插件市场审核过的 Git 提交为基准。它从 `RoundRedDot/better-paseo-assets` 读取 `versions.json`，获取完整的 Git hash、版本号及 12 位构建号映射。版本更新日志保存在各 `changelogs/v<version>.json` 文件中，每个文件包含按构建号索引的双语 `versionNotes` 快照。当为同一版本新增构建时，保留先前的 hash 映射与快照，并将面向用户的新变动追加到该版本的现有说明中。新版本号则从新条目开始。设置页面会选择不晚于市场构建号的最新快照，并最多显示 3 个版本。在提交市场注册表 PR 之前，插件更新还需发布同名的 GitHub Release。

每次发布前，在版本提交前将 `package.json` 中的 `build` 设置为新加坡时间（格式为 `YYYYMMDDHHmm`）。提交后，将该精确的 commit hash 映射到 `versions.json` 中的同一版本与构建号，并在部署插件提交之前发布该 JSON。部署并钉住该完全相同的 hash。切勿部署其父提交，也不得用父提交替代其写入映射表。版本比对优先按三段式版本号判断，仅在版本号相同时才比较构建号。一分钟内发布的相同版本号构建号相同，在此机制下无法分出先后。若已安装的 hash 未在 `versions.json` 中登记，则视作缺失版本信息，设置页面将无法判断市场提交是否更新。
