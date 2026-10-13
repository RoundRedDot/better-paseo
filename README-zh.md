# Better Paseo

[English](README.md) | **简体中文**

一个 [Paseo](https://paseo.sh) 插件，重新绘制 Oh My Pi（OMP）的聊天时间线：工具调用、思考、回复、提问、审批和待办都画成紧凑、按类型区分、带语法高亮的行，配色跟随当前的 Paseo 主题；整条时间线的渲染比 Paseo 自己画还快。

![Better Paseo 绘制的一轮对话：提问、读文件、完成的后台任务和回复](images/hero.png)

> Better Paseo fork 自 [ABorakati/beautiful-chat](https://github.com/ABorakati/beautiful-chat)，从 `42b61d8`（2026-09-23）接着开发。Beautiful Chat 原有的卡片都还在；本文介绍这个 fork 新增的功能和它的性能表现。

## 亮点

- **比不开插件还快。** Web 生产构建上，11 个回放场景里每一个的主线程时间都不超过 Paseo 自己的时间线（其中 1 个持平），比 Beautiful Chat 少 34–85%。见下方[性能对比](#性能对比)。
- **一个工具调用一行。** 调用默认折叠成 26pt 的一行，摘要按类型生成，点一下展开；完成、滚进历史、重新挂载后，展开状态都不会丢。
- **流式输出不跳动。** 回复按块增量解析，写到一半的代码围栏或表格不会先画成别的格式再跳回来；长回复流式时的布局偏移为 0。
- **不展开也能看内容。** 桌面上悬停折叠行或路径、手机上长按，就能在可滚动的面板里预览内容；图片可以打开全屏查看器。
- **跟随 Paseo。** 字体、字号和颜色默认跟随宿主；设置保存在 daemon 上，桌面、网页、iOS、Android 共用同一份。设置页支持英文和简体中文。

## 安装

```bash
paseo plugin install RoundRedDot/better-paseo
```

需要 Paseo `>=0.8.0`，开发与测量基于 Paseo 0.11.2。在 **设置 → 插件 → Better Paseo** 中配置。Paseo 从 GitHub 安装插件，更新到新版本：

```bash
paseo plugin update better-paseo
```

---

## 性能对比

三种模式在同一次会话里轮流回放：**不开插件**（Paseo 0.11.2 自己画时间线）、**Beautiful Chat** `42b61d8`、**Better Paseo**。探针装在宿主上，套在每一行外面，原生行和插件行用的是同一个外壳，所以三方口径一致。每格是 Web 生产构建 3 次运行的中位数；11 个脚本化场景覆盖流式回复、代码、表格、思考、大 diff、终端日志和 100 轮历史。

![各场景的 Web 主线程时间：不开插件、Beautiful Chat、Better Paseo](docs/perf/readme/web-cpu.zh.svg)

- **对比不开插件**：11 个场景里 10 个更短，少 15–61%；大 diff 持平（整段回放 0.38 秒对 0.37 秒）。
- **对比 Beautiful Chat**：11 个场景全部更短，少 34–85%。Beautiful Chat 默认展开运行中的工具，读 20 个文件要挂 56,158 个 DOM 节点、耗时 3.72 秒；Better Paseo 是 1,488 个节点、0.70 秒。
- 流式文本收益最大：长回复从 7.07 秒（不开插件）和 8.42 秒（Beautiful Chat）降到 3.67 秒。

![强制 GC 后的 JS 堆与 DOM 节点](docs/perf/readme/web-memory.zh.svg)

内存在强制垃圾回收之后读取。Better Paseo 的 JS 堆和不开插件相差 0–4MB，约等于插件代码本身的大小；长回复少用 41MB。Beautiful Chat 在展开工具输出的场景里到了 239–266MB。

流式过程中的累计布局偏移（越低越好）：

| 场景 | 不开插件 | Beautiful Chat | Better Paseo | 对比不开插件 | 对比 Beautiful Chat |
| --- | ---: | ---: | ---: | :--- | :--- |
| 长回复 | 0.157 | 0.644 | **0** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="提升">&ensp;100% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="提升">&ensp;100% |
| 代码块 | 0.039 | 0.127 | **0.012** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="提升">&ensp;69% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="提升">&ensp;91% |
| 表格 | 0.049 | 0.040 | **0.011** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="提升">&ensp;78% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="提升">&ensp;73% |
| 100 轮历史 | 0 | 0.478 | **0** | 持平 | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="提升">&ensp;100% |

### iOS

![iOS 单次提交渲染耗时 p95：不开插件与 Better Paseo](docs/perf/readme/ios-commit.zh.svg)

iOS 模拟器开发版上（每次运行前冷启动），单次提交里所有行的渲染耗时在 11 个场景里有 8 个更低，降 15–86%，2 个持平。大段终端的 p95 高 23%，但渲染总量相当（23ms 对 21ms）：Better Paseo 把工具完成那一刻的重渲染集中在一次提交里，Paseo 则分散到几次。开发版的毫秒数只适合相互比较。

在 iOS 上对比 Beautiful Chat，用的是早前几轮的卡片内部探针（`mixed-turn`，同一模拟器会话，各 4 次，p95，单位毫秒）：

| 卡片 | Beautiful Chat | Better Paseo | 变化 |
| --- | ---: | ---: | :--- |
| 提问 | 25.3 | 13.3 | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="提升">&ensp;47% |
| 回复 | 108.2 | 21.6 | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="提升">&ensp;80% |
| 思考 | 94.4 | 21.5 | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="提升">&ensp;77% |
| 工具 | 122.6 | 27.0 | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="提升">&ensp;78% |
| 待办 | 137.9 | 40.8 | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="提升">&ensp;70% |

<img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="提升"> 绿色表示比基线好，<img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="倒退"> 红色表示比基线差。相差不到一成，或两边整段回放都不到半秒，记为持平。

<details>
<summary>Web 全部数字（主线程时间，秒）</summary>

| 场景 | 不开插件 | Beautiful Chat | Better Paseo |
| --- | ---: | ---: | ---: |
| 代码块流式 | 3.81 | 3.45 | **1.70** |
| 大 diff | 0.38 | 2.41 | **0.37** |
| 100 轮历史 | 2.92 | 8.49 | **2.14** |
| 长回复 | 7.07 | 8.42 | **3.67** |
| 混合一轮 | 1.20 | 2.95 | **1.02** |
| 读 20 个文件 | 0.96 | 3.72 | **0.70** |
| 思考散文 | 2.06 | 3.57 | **1.27** |
| 思考分节 | 1.97 | 3.92 | **1.02** |
| 大段终端 | 0.88 | 1.60 | **0.64** |
| 表格流式 | 2.77 | 1.64 | **1.08** |
| 展开的工具 | 1.49 | 3.26 | **0.97** |

</details>

**测量方法。** 给 Paseo 打了一个只用于测量的补丁，把时间线的每一行都套进同一个 `React.Profiler`；Playwright 在每段回放前后读取 Chrome DevTools Protocol 的指标（任务时间、堆、DOM 节点），读内存前先强制 GC。测量时机器上还有其他任务在跑，所以三种模式交替运行、取中位数。方法、工具和全部原始数据见 [`docs/bench/native-vs-fork`](docs/bench/native-vs-fork/README.md)；和 Beautiful Chat 的逐项差异及每轮测量的来龙去脉见 [`docs/fork-vs-upstream.md`](docs/fork-vs-upstream.md)。图表由 `node docs/perf/readme-charts.mjs` 从原始数据生成。

### 时间省在哪里

- **没变的卡片不再重渲染。** Paseo 每来一个流式 chunk，都会给每一行传入新的 `theme` 和 `data` 对象。按语义比较的 `React.memo` 让没变化的卡片直接跳过渲染；只有最新一条提问跟着 agent 状态更新。100 轮历史回放里，整页渲染次数从 172,327 降到 1,319。
- **回复增量解析。** 用 `marked` 加 `remend` 按块解析；每条回复缓存已经定稿的块，只修补还在增长的那一块。离线、Web、iOS 上，流式过程中的格式翻转和高度回退都是 0。
- **代码只高亮一次，而且只在写完之后。** 没闭合的代码块不请求高亮；Shiki 跑在 daemon 上（`highlight.tokens`）。折叠的行不挂载展开体，读 20 个文件的高亮请求从 48 次降到 0。
- **大段输出分批画。** 代码和终端面板先画 400 行，再分批补上，并提供「显示全部」。iOS 上约 5,000 行的 diff，工具卡片 p50 从 2.2 秒降到 19.8ms。
- **没有装饰性循环动画。** 阴影、磨砂、光晕和呼吸动画都删了，只留运行中的圆点；在 Web 上它是 CSS 动画，不再每一帧都提交一次所在的行（混合一轮的行提交次数 1,518 → 196）。系统开启「减少动态效果」时圆点静止。
- **不再晚一拍长高。** 不逐字揭示的回复在拿到文本的同一次提交里就画出来，Paseo 的贴底滚动跟得上，回复不会事后把底部那一行往下推。
- **客户端包更小。** Paseo 每次重连都会重新发送整个客户端包。品牌图标和 Inter 字体改由 daemon 按需下发（`marks.bitmaps`、`fonts.embedded`），内嵌的 Iosevka 已移除，包内只保留 ASCII 字符，Hermes 按单字节保存源码。

---

## 功能

以下功能都建立在 Beautiful Chat 已有的能力之上：按类型区分的工具卡片、Shiki 高亮、读图、在文件管理器中显示，以及插件自己的查找栏。

![完整的一轮对话，从上到下](images/thread.png)

### 工具行

- 每个调用默认是一条无边框的行，桌面 26pt、触控 28pt，摘要按类型生成：命令、路径和行号范围、编辑的 `+4 −2`、退出码和耗时。点一下展开卡片。
- 展开状态按调用（`agentId:callId`）记在组件之外，完成、滚进历史、重新挂载都不会丢。iOS 上展开时行头留在按下的位置，内容向下打开。
- 失败的调用只显示一行错误；打开「自动展开失败的调用」后会自动展开。
- 每一行记住自己首次出现的时间，并行读取时先完成的那一行不会再换位置、改间距。
- 行首可显示图标、名称或两者都显示。长代码和终端输出先折叠到 12 行。
- 每个 `hub` 操作都有对应卡片：进程、消息和任务快照。Paseo 自己的工具带 Paseo 标识，新建的 agent 带它所属服务商的标识。

| Shell 与 Git | Read |
| --- | --- |
| ![Shell 与 Git 工具调用](docs/images/tool-bash.png) | ![Read 工具调用](docs/images/tool-read.png) |
| **Edit** | **Hub** |
| ![Edit 工具调用](docs/images/tool-edit.png) | ![Hub 工具调用](docs/images/hub.png) |

<details>
<summary>更多卡片：MCP、Eval、Ask、Task、Paseo 工具、思考工具、读图、代码块</summary>

![MCP 工具调用](docs/images/tool-mcp.png)
![Eval 工具调用](docs/images/tool-eval.png)
![Ask 工具调用](docs/images/tool-ask.png)
![Task 工具调用](docs/images/tool-task.png)
![Paseo 工具调用](docs/images/paseo.png)
![思考工具调用](docs/images/tool-thinking.png)
![读图](docs/images/tool-image.png)
![代码块](docs/images/syntax.png)

</details>

### 思考与待办

- 思考只按真实结构（`**标题**` 和各级标题）分段，不再按空行编号。默认折叠，流式时行内实时预览当前标题。
- 只有本机真的看到了思考的流式过程，才显示耗时；不做估算。
- 待办显示阶段名、每项状态、耗时，以及被阻塞的任务和原因。

![思考过程](docs/images/reasoning.png)
![待办清单](docs/images/tasks.png)

### 回复

- Markdown 由插件绘制：标题、列表、任务列表、引用、高亮代码块和本地图片。提供「文档」「紧凑」「终端」三种样式。
- 表格有列线、表头底色和圆角外框；单元格比正文小一号、行距更紧，列宽按等宽数字和中文字宽估算。
- 每张表格左上角都有复制按钮。网页和桌面上，悬停（触屏上长按）会展开「复制为 Markdown」和「复制为图片」，后者复制表格画出来的样子；直接点按复制 Markdown 源码。iOS 和 Android 上点按复制 Markdown。
- 一段回复里的多张本地图片都会画出来。
- 关闭「回复使用插件 Markdown」即可把回复交回 Paseo，由它绘制 mermaid 图表、宿主图片和文件链接。

![文档、紧凑、终端三种 Markdown 样式](docs/images/markdown-styles.png)

### 图片

- 读图时画出文件本身：从文件头读出的尺寸和大小、按内容撑满的缩略图，以及一个显示/隐藏开关，切换时行头停在按下的位置。
- 全屏查看器支持按钮、滚轮或双指以指针为中心缩放，拖动平移，双击复位，并可在文件管理器中显示。手机上长按这一行会直接打开查看器。
- 图片数据在第一次展开、预览或长按时从 daemon（`file.image`）读取。支持 PNG、JPEG、GIF、WebP、AVIF、BMP、ICO 和 SVG；超过 3MB 的文件只显示大小，不内联。

### 悬停预览

桌面上把鼠标停在折叠的工具行、思考行、图片或路径上，等待设定的延迟（0–10 秒）后弹出可滚动的预览，可换行、显示行号和奇偶行底色，也可最大化。手机上长按打开同样的预览，不会盖住顶部栏和输入框。

### 路径、复制与选中

- 路径相对工作区显示，过长时在中间省略、保留文件名；worktree 的主仓库以名称显示。复制时总是得到绝对路径。
- 复制统一走宿主的 `copyText`，在 iOS 和 Android 上同样可用：桌面悬停、触控长按，或 `⋯` 菜单。纯文本代码块可换行，并带复制按钮。iOS 上长按回复正文可以放置光标、拖动选区。
- 网页和桌面上，在卡片里选中文字会出现「复制」和「添加到对话」；后者把选中内容作为引用放进输入框，选自代码时放成代码块。

### 提问气泡

默认由 Paseo 绘制提问，保留粘贴的图片和回退菜单。打开「增强提问气泡」后改用插件的气泡：复制按钮常驻，并显示本轮 token 用量；代价是看不到粘贴的图片，回退菜单在当前 Paseo 支持时保留。

![提问气泡](docs/images/user.png)

### 审批

风险分级、完整命令、目标路径和工作目录；同意和拒绝操作仍由宿主负责。

![审批卡片](docs/images/approval.png)

---

## 设置

**设置 → 插件 → Better Paseo。** 一段用时间线组件绘制的示例对话会实时跟随每一项修改：桌面宽窗口下显示在选项旁边，其他情况显示在选项上方；其中 Read 行的悬停预览常驻展开。在网页和桌面上，预览标题栏的「桌面端 / 移动端」切换可以按 iOS 的样子绘制同一段对话：手机宽度、系统等宽字体，行内代码使用你选的颜色。父选项关闭时，子选项变灰；「恢复全部默认设置」需要再点一次确认。

![设置页与实时预览](docs/images/settings-zh.png)

| 分组 | 设置 | 默认 | 作用 |
| --- | --- | --- | --- |
| 通用 | 语言 | 跟随系统 | 设置页和工具栏提示使用英文或简体中文。插件读不到 Paseo 自身的语言设置。 |
| 外观 | 强调色 | 主题 | 跟随 Paseo 主题，或选翠绿、紫罗兰、琥珀、玫瑰。只替换强调色。 |
| 外观 | 移动端行内代码 | 深灰 | iOS 和 Android 上行内代码的文字颜色：深灰、蓝、紫、绿、珊瑚红。网页端保留灰色底块。 |
| 外观 | 界面字体 | 跟随 Paseo | Paseo 的界面字体、Inter（仅网页，由 daemon 下发）或系统字体。 |
| 代码字体 | 等宽字体 | 跟随 Paseo | 跟随 Paseo 或自定义字体。跟随 Paseo 的顺序是：宿主向插件提供字体设置时用宿主的设置；否则在网页和桌面上读取 Paseo 外观设置里的等宽字体和字号；再否则用 Paseo 默认等宽字体。iOS 和 Android 上「自定义」只列出系统自带的字体。 |
| 代码字体 | 代码字号 | 跟随 Paseo | 或 10–22px，行高为字号的 1.5 倍。作用于代码、diff、终端和路径。 |
| 工具调用 | 行首标识 | 图标 | 工具行和思考行开头显示图标、名称（如 Bash、Read）或两者。 |
| 工具调用 | 自动展开失败的调用 | 关 | 开启后，失败的调用自动展开显示错误。 |
| 工具调用 | 文件路径 | 相对 | 相对工作区或绝对路径。复制时总是绝对路径。 |
| 间距 | 紧凑行距 | 开 | 把 Paseo 0.11 在每个插件行下面多留的 16pt 收到 4pt。行与行重叠时请关闭。 |
| 间距 | 紧凑回复间距 | 开 | 回复紧挨工具行、思考行或待办行时，间距从 16pt 收到 4pt。 |
| 消息 | 增强提问气泡 | 关 | 插件气泡：显示 token 用量、复制按钮常驻，但看不到粘贴的图片。 |
| 消息 | 回复使用插件 Markdown | 开 | 关闭后回复交给 Paseo，可用 mermaid、宿主图片和 Paseo 的文件链接。 |
| 消息 | Markdown 样式 | 文档 | 文档、紧凑或终端（正文使用代码字体）。 |
| 消息 | 选中文字工具栏 | 开 | 网页和桌面：选中文字后显示「复制」和「添加到对话」。 |
| 悬停预览 | 悬停预览 | 开 | 桌面悬停、手机长按折叠行或路径时预览内容。 |
| 悬停预览 | 延迟 | 1 秒 | 桌面上预览弹出前的等待时间，0–10 秒。 |
| 悬停预览 | 自动换行 / 显示行号 / 奇偶行底色 | 开 / 关 / 开 | 预览内容的显示方式。 |

**设置存在哪里。** 偏好通过 SDK 的主机级设置保存在 daemon 上（`shared/preferences-settings.ts` 里的 `presentation` 记录），所以**连接同一个 daemon 的所有客户端共用一份设置**：在桌面上改，iOS 上也会生效，反之亦然。某个平台画不出来的值会按原样保存，只在绘制时降级（自定义字体在 iOS 和 Android 上变成系统等宽字体，Inter 变成系统字体）。网页端的 `localStorage` 只用作快速启动的缓存。设置到达之前，卡片先用缓存或默认值绘制，到达后切换一次。

**设置只对新消息生效。** Paseo 会缓存每条转换后的条目，修改设置后新到达的消息才会按新设置绘制；重新加载聊天即可重画已有消息。

---

## 查找文字

Paseo 自带的聊天查找（Ctrl/Cmd+F）定位不到插件绘制的行，因为转换后的行带的是另一个 id。所以 Better Paseo 在桌面和网页上接管 Ctrl/Cmd+F，在聊天上方打开自己的查找栏。它搜索已经渲染的所有内容，包括工具卡片：Enter 下一个，Shift+Enter 上一个，Escape 关闭。它只能搜到已加载的消息，往上滚动即可包含更早的历史。

如果想对回复使用 Paseo 原生查找（它也能搜到未加载的历史），关闭「回复使用插件 Markdown」（以及已开启的「增强提问气泡」）。这样回复和提问由 Paseo 自己绘制，Ctrl/Cmd+F 打开的就是 Paseo 的查找。工具、思考和待办卡片仍由插件绘制。

## 打开文件

读、写、编辑结果和代码块里的文件名都是链接。在桌面上，它调用 daemon 端的 `file.reveal`，按 agent 的工作目录解析路径，并在文件管理器中显示：Windows 用 `explorer.exe /select,`，macOS 用 `open -R`，其他系统用 `xdg-open <目录>`。在触控设备上，同样的点按改为复制绝对路径，因为手机打不开 daemon 那台机器的文件管理器。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 行与行重叠，或回复盖住了下一行 | 关闭「紧凑行距」或「紧凑回复间距」。 |
| 回复里需要 mermaid 图、宿主图片或 Paseo 的文件链接 | 关闭「回复使用插件 Markdown」。 |
| 提问里看不到粘贴的图片 | 关闭「增强提问气泡」；插件拿不到粘贴的图片。 |
| Ctrl/Cmd+F 搜不到较早的消息 | 先往上滚动加载，或按上文把回复交回 Paseo。 |
| 改了设置，之前的消息没变 | 重新加载聊天；转换后的条目有缓存。 |
| 旧的一轮对话没有 token 数字 | 用量不保存在时间线条目上，只有本客户端实时看到的轮次才显示。 |
| 推送了修复，但界面没变化 | 运行 `paseo plugin update better-paseo`；Paseo 运行的是 GitHub 上的版本。 |

## 等待 Paseo 支持的改动

Better Paseo 在已发布的 Paseo 上就能用，并会探测较新的宿主能力，没有时自动回退。下面几项宿主改动已在 Paseo 的 fork 里验证，尚未发布：

- 插件工具行与原生工具行的间距对齐（约 46pt 收到 30pt，原生是 32pt）。在此之前由「紧凑行距」收回多出的 16pt。
- Paseo 向插件提供字体设置，修改外观后插件实时跟上。在此之前，网页和桌面读取 Paseo 保存在本地的外观设置。
- 插件包在 Hermes 上执行前，先把 `class` 语法降级。
- 当前轮提问吸顶、展开卡片的标题吸顶；插件一侧已经接好。

把多个调用合并成「Read 12 files」一行需要宿主的分组 API；在开发版模拟器上展开 5,000 行的代码块仍需约 30 秒，彻底解决需要宿主的虚拟滚动。

开发过程中遇到的 SDK 限制、证据和对应的绕行方式见 [`docs/plugin-sdk-limitations.md`](docs/plugin-sdk-limitations.md)（英文）。

## 开发

```bash
npm install
npm run typecheck
npm test
npm run check:hermes
paseo plugin reload better-paseo
```

`npm run check:hermes` 会在 Hermes（iOS 和 Android 应用使用的 JS 引擎）里编译并运行客户端包；在网页上能跑的代码，到了 Hermes 仍可能失败，并导致整个插件无法加载。它检查的规则、项目结构，以及如何重新生成截图和图表，见 [`docs/development.md`](docs/development.md)（英文）。

## 许可证

MIT
