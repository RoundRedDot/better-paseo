# Better Paseo 视频脚本与制作 Prompt · V8

更新日期：2026-10-17。本页同步 **V8 已制作版本**：75 秒、16:9、1080p30、无解说、125 BPM 配乐。用户已明确选择约 75 秒完整版，替换早期 V5 的 59 秒／一分钟以内限制，保留桌面功能、移动交互和四个性能场景。

本版针对“镜头切换太快、生硬、主题界面不够代表产品”的反馈：镜头至少 3 秒，两页总览各 5 秒，主题展示 6 秒；整屏转场从 V7 的 14 处缩减为 5 处章节入口与 1 处片尾预叠入。制作事实依据本机 V8 的 `REPORT.md`、`timeline.json` 与 `out/review/validation.json`，技术和关键帧检查与用户主观验收分开。

性能数据仍来自 `b9dfae6`；V5 场景录制支持副本固定 `18ad7c2`，两者 runtime 范围一致的历史证据保留。V8 复用真实实录和配对截图，重新裁切、变速、保留结果帧并编排，未重跑基准、未重录客户端，也不代表后续 `main` 的重新验收。

## 可直接复制的 V8 制作 Prompt

```text
你是一名熟悉开发者工具的产品视频编导与剪辑师。用 claude-motion 的 motion-design、review-loop、sound-design 制作 Better Paseo 宣传片，交付实际 MP4、首帧封面、联系表、分镜、制作源码和数据说明。

【身份与表达】
Better Paseo 是重绘 Paseo 聊天时间线的插件，面向 Claude Code、Codex、Oh My Pi 等工具的开发者。
核心表达：“工具调用收成一行，把注意力留给工作。”
不描述为独立 AI 编程服务，不声称改变模型能力、代码质量或生成速度。

【时长与节奏】
采用用户确认的 75 秒完整版，包含音乐尾音；1920×1080、16:9、30 fps、H.264 yuv420p / BT.709 limited-range、AAC 48 kHz stereo。
无解说、无 TTS、无人声。125 BPM 器乐有推进和收尾，不靠增大音量制造节奏。中文短标题突出操作和价值，英文产品名、命令、代码保持原样。
镜头至少 3 秒，保留操作起点、真实响应与结果停顿。不要用短叠化代替足够的阅读时间。
每屏一个焦点，保留产品字体、圆角与蓝色强调；避免密集文案、夸张弹簧、粒子和爆闪。
标题约 350 ms 遮罩揭示。只在 5 个章节入口与片尾预叠入使用约 0.4 秒短叠化；桌面、图表、总览内部采用固定构图衔接，减少整屏文字与数字重影。
叠化只改变透明度，不横移、推拉或缩放手机。旧镜头末帧短暂停留属于后期转场，不能作为新增实录或成功状态。

【主题规范与首帧】
0–65 秒主体所有产品界面、代码、终端、预览、移动与四个性能场景统一真实浅色。不得反相、滤镜或涂白 UI；深色仅在 65–71 秒主题介绍出现，CTA 恢复浅色。
0 秒即完整呈现品牌、价值文案与真实离线 showcase 桌面＋手机组合，保持 3 秒；保留 showcase/deviceframe 来源标注。
hero-cover.png 必须从最终 MP4 解码第 0 帧提取。

【桌面交互 · 3–19 秒】
3–7 秒：悬停预览，保留默认 hover 等待与真实阅读画面。
7–10 秒：实际拖动、放大浮窗，末尾约 0.6 秒结果停顿。
10–13 秒：行号拖选整行，末尾约 0.6 秒结果停顿；标“行号提前开启 · 默认关闭”。复制源码保留缩进和换行，不包含显示行号。
13–16 秒：局部文字选区与 Copy，末尾约 0.6 秒结果停顿。
16–19 秒：实际表格复制菜单与反馈，末尾约 0.6 秒结果停顿。
持续标“操作演示经剪辑／加速”。局部和表格镜头仅展示已有 UI 反馈，不补造剪贴板读回、Add to chat 草稿或发送成功。

【移动交互 · 19–39 秒】
20 秒由 16 秒原生开发模拟器素材与 4 秒明确标记的 Web 移动布局组成，包含真实结果帧停顿，不是新录实机验收。
19–25 秒：原生长按折叠工具行打开预览，纵向滑动正文；手机全景与同帧局部放大。
25–30 秒：原生行号长按、连续拖选、实际菜单与复制；剪贴板读回沿用历史证据。
30–34 秒：同格两次点按与 Copy，持续标“移动布局交互演示 · 非原生录屏”；末尾增加 1 秒结果帧。
34–39 秒：原生浅色整表复制，真实结果停顿约 2.2 秒；历史读回不包装成本轮新验证。
保留标称 24 px 微灰白后期触点、细描边和短阴影；无鼠标箭头、蓝圈、发光或虚构磁吸。白点不冒充系统鼠标。
手机及同帧放大采用固定 x/y/scale，内部镜头硬切，不做横向 pan、推入或逐帧缩放漂移。

【四个性能场景 · 39–55 秒】
每场 4 秒：39–43 代码块流式 2.40→1.27 s（减少约 47.0%）；43–47 长 Markdown 4.77→2.75 s（42.5%）；47–51 连续读取文件 0.72→0.52 s（27.5%）；51–55 流式表格 1.74→1.08 s（37.9%）。
使用对应 fixture 的真实浅色画面，旁边显示独立统计图。画面解释使用场景，播放速度或停顿不作为计时证据。
指标统一为“Web 整段回放主线程 Task 时间”，秒、越低越好；不是生成等待、帧率、单次交互耗时或原生设备速度。
四图共用 0–5 s 零起点坐标轴，条长由精确中位数计算，约 0.9 秒到终值、1.1 秒显示减少比例。比例不能从显示的两位小数反推。
持续保留：2026-10-17 · b9dfae6 · 各 5 次中位数 · 最多 4 组隔离并行；本轮观测，存在波动，不代表稳定提速；完整条件、A/A 与 N/A 见仓库 README。

【完整总览 · 55–65 秒】
两页呈现全部 11 项，6 行／5 行，每页 5 秒，入场后稳定阅读约 4.6 秒。
明确写“9 项更低／2 项持平”，只对应 Web Task。大 diff 和历史回放保持中性，历史 0.71→0.78 s 的增大值不能隐藏或包装成改善。
持平定义：相差不到 10%，或双方整段 Task 时间均小于 0.5 秒。不能扩展成所有指标或所有平台更快。

【代表性主题展示 · 65–71 秒】
以真实浅深配对截图展示桌面＋手机的聊天时间线、折叠工具行、展开的代码预览与待办，替换旧版局部表格。
素材使用 images/hero-devices-light.png 与 images/hero-devices-dark.png，先核对 docs/images/screenshots.json 的哈希；保持两版相同的裁切、位置和尺度。
浅色约 2.5 秒，约 0.6 秒过渡至深色，再保留约 2.5 秒稳定展示后进入片尾。界面和标题不在阅读时移动。
持续标“浅深配对截图 · 离线 Web showcase · deviceframe 示意 · 非原生录屏”。这是离线截图的主题对照，不伪造系统点击、原生切换录像或操作响应。

【片尾 · 71–75 秒】
片尾预叠入须在 71 秒前完成。71.000 秒第一帧起品牌、地址、命令静态完整，持续 4 秒，不用入场动画消耗阅读时间：
Better Paseo
github.com/RoundRedDot/better-paseo
paseo plugin install RoundRedDot/better-paseo

【来源、检查与交付】
不补造 UI、成功状态或测量读数；原生开发模拟器、离线 Web、Web 移动布局、后期触点、配对截图和统计图分别标注。
保留 A/A、N/A、其他指标回退及未完成原生交互的边界；手机功能画面不承担 iOS 性能证明。
交付 MP4、首帧封面、联系表、原尺寸关键帧、实际 timeline.json、源码、复现命令、数据说明与制作报告。
验证包括 ffprobe 参数、全片解码、全部素材时长、实际结果停顿、图表条长、手机固定合成、浅深截图像素对应、深色出现窗口、CTA 4 秒与最终 AAC 的响度／true peak。
技术、关键帧目检、主观节奏／听感、真机与 Release 验收分开；不得用技术检查代替用户验收。
```

## V8 实际分镜

以下来自 V8 `timeline.json`，所有时间包含过渡与结果停顿。

| 时间（秒） | 时长 | 内容／短标题 | 来源与边界 |
| --- | ---: | --- | --- |
| 0–3 | 3 | 工具调用收成一行 | 真实离线 UI 重排；首帧完整 |
| 3–7 | 4 | 悬停，即看 | 浅色 Web 实录；保留操作结果停顿 |
| 7–10 | 3 | 拖动。放大。 | 浅色 Web 实录；保留操作结果停顿 |
| 10–13 | 3 | 整行，轻松选 | 浅色 Web 实录；保留操作结果停顿 |
| 13–16 | 3 | 选中，就复制 | 浅色 Web 实录；保留操作结果停顿 |
| 16–19 | 3 | 表格，一键带走 | 浅色 Web 实录；保留操作结果停顿 |
| 19–25 | 6 | 长按即看 · 滑动阅读 | 原生开发模拟器；同帧全景与放大 |
| 25–30 | 5 | 连续选行 · 轻松复制 | 原生选区、菜单；复制读回沿用历史证据 |
| 30–34 | 4 | 双点整格 · 选中复制 | 真实 Web 移动布局；持续标明非原生；末帧增加 1 秒 |
| 34–39 | 5 | 整张表 · 一次带走 | 原生浅色整表复制；结果停顿约 2.2 秒 |
| 39–43 | 4 | 边生成边读代码 | `codeblock-streaming` 实际浅色画面＋独立统计图 |
| 43–47 | 4 | 阅读长回复 | `markdown-long` 实际浅色画面＋独立统计图 |
| 47–51 | 4 | 连续读取文件 | `reads-20` 实际浅色画面＋独立统计图 |
| 51–55 | 4 | 查看流式表格 | `table-streaming` 实际浅色画面＋独立统计图 |
| 55–60 | 5 | 每种工作，都有记录 | 6 行 |
| 60–65 | 5 | 完整呈现，也保留持平 | 5 行；保留两项中性结果 |
| 65–71 | 6 | 熟悉的界面，喜欢的主题。 | 浅深配对的桌面＋手机截图；非原生录屏 |
| 71–75 | 4 | Better Paseo | 71.000 秒起完整静态 4 秒 |

合计：Hero 3 + 桌面 16 + 移动 20 + 四个性能场景 16 + 总览 10 + 主题 6 + 片尾 4 = **75 秒**。

V8 复用 V5/V6 的真实素材，新增后期裁切、节奏和结果帧停顿；V5 原始浅色新录不是本轮基准重跑。主题截图的来源版本为 `b9dfae6`，不冒充 `18ad7c2` 原生切换录屏。

## 性能数据与限定

原始来源：[本轮 summary.json](bench/2026-10-17-readme/parallel-v2/raw/summary.json)。只取 `platform=web`、`diagnosticOnly=false`、主组 `n=5`；`native` 为不开插件，`fork` 为当前 Better Paseo。不混入 `aa`、`parent` 或其他批次。

指标是 Web 整段回放主线程 Task 时间（秒）；下表保留精确中位数。画面秒数取两位小数，减少比例以 `(1 - fork / native) × 100` 计算，取一位小数。

| 场景 | fixture | 不开插件 s | Better Paseo s | 本轮结果 |
| --- | --- | ---: | ---: | --- |
| 边生成边读代码 | `codeblock-streaming` | 2.404590 | 1.274715 | 减少约 47.0% |
| 阅读长回复 | `markdown-long` | 4.774723 | 2.745260 | 减少约 42.5% |
| 连续读取文件 | `reads-20` | 0.722153 | 0.523460 | 减少约 27.5% |
| 查看流式表格 | `table-streaming` | 1.740413 | 1.079963 | 减少约 37.9% |
| 大段终端日志 | `shell-log-large` | 0.565722 | 0.428501 | 减少约 24.3% |
| 分节思考 | `reasoning-long-sections` | 1.467017 | 0.855735 | 减少约 41.7% |
| 混合工具任务 | `mixed-turn` | 0.839822 | 0.732460 | 减少约 12.8% |
| 长段思考 | `reasoning-long-prose` | 1.411114 | 0.931476 | 减少约 34.0% |
| 查看大 diff | `diff-large` | 0.232864 | 0.219244 | 持平 |
| 历史回放 | `history-100` | 0.712861 | 0.781135 | 持平 |
| 工具日志增长（默认） | `tool-expanded-streaming` | 0.985155 | 0.836405 | 减少约 15.1% |

环境：2026-10-17，Paseo 0.11.2，Mac Studio / Apple M5 Max / 18 核 / 64 GB / macOS 27.0.1；Web production profiling、Chrome 155、1280×900，最多 4 组隔离并行，实际重叠程度变化。

“持平”按协议定义：相差不到 10%，或双方整段 Task 时间均小于 0.5 秒。九项更低、两项持平只适用于上述指标与对照。Web 55 对 A/A 中 34 对行渲染总量差异超过 10%，这是另一指标的波动检查，不能当作 Task 误差范围。

【必须保留的数据边界】
- 本轮共有 630 次计划内采样尝试：550 次回放、80 次长历史尝试。不能写成“630 项测试全部通过”。
- iOS 是 iPhone 16 Pro / iOS 18.6 开发版 Hermes 模拟器，不是真机或 Release 验收。
- 二十个 iOS 回放样本记录显示错误，涉及十七个配置组；当前版十一个回放场景中有六个不可比较。
- iOS 的 810 条／1 轮长历史当前版，有一次 simctl pbpaste 复制验证超时，三个阶段整组 N/A。不能从其余成功样本补算数字，也不能把超时定性为插件复制功能已确认故障。
- 不引用这些 N/A 组做 iOS 性能宣传。手机镜头展示功能，不承担性能证明。
- 不能宣称所有指标都优于原生：本轮 Web 行渲染总量的历史回放、默认工具日志更高；部分 CLS 和 JS 堆指标也更高。
- 工具测试保留各自默认展开状态，不能声称证明了强制展开工具正文的性能。
- JS 堆是强制 GC 后的 Web 读数，不是整个应用内存；不使用“全面省内存”“零卡顿”“全平台更快”等措辞。
- 810 条是记录条数，不是 810 轮对话；832 条场景才是 12 个实际 provider turn。不要把这些合成输入描述成真实用户会话。

## 实际素材边界与未采用镜头

| 内容 | V8 实际情况 | 尚缺证据／验收 |
| --- | --- | --- |
| 原生手机长按、滚动、行号与整表复制 | 16 秒 iPhone 16 Pro / iOS 18.6 / Hermes 开发模拟器素材，含结果停顿，未重录客户端 | 同版本真机与 Release |
| 同格两次点按 | 4 秒真实 Web 移动布局，含 1 秒结果停顿，持续标非原生 | 原生成功镜头；原失败素材保留 |
| Copy 与 Add to chat | 原生行号／整表、Web 单元格沿用历史读回；桌面局部／表格仍只有 UI 反馈；未演示草稿写入 | 桌面剪贴板读回、真实宿主草稿插入 |
| 主题展示 | 配对离线截图的桌面＋手机工具行、预览与待办，6 秒；不是原生切换录屏 | 用户对代表性、可读性和节奏的验收 |
| 待办／页脚等交互 | 主题截图可见待办，不等于演示实时待办浮窗；未采用页脚详情与 Markdown 切换交互 | 对应真实操作镜头 |
| 音乐 | 按 75 秒时间线重新合成 125 BPM 无人声配乐，最终 AAC -15.0 LUFS / -2.9 dBFS true peak | 人耳试听、切点和尾音主观验收 |

`reads-20` 是 fixture 名，内容实际包含 24 次 Read，上屏只写“连续读取文件”。四段录屏解释使用场景，播放速度不代表统计读数。

## 制作脚本与本机归档

本机 V8 目录：`/Users/luopeihuan/Movies/BetterPaseo/20261017-claude-motion-v8-75s/`。

**视频、封面、联系表、音轨及本机制作目录不加入 Git。** 仓库只保留本页的脚本、事实、源码索引与复现入口；不是仓库内可移植制作包，其他机器不能只凭本文命令重建。

| 入口／产物（相对制作目录） | 职责 |
| --- | --- |
| `better-paseo-claude-motion-v8-75s.mp4`、`hero-cover.png` | 成片与解码第 0 帧封面 |
| `REPORT.md`、`DATA-NOTES.md` | 来源、测量口径、验证与验收边界 |
| `timeline.json`、`data.json` | 18 段实际时间线与 11 项精确数据 |
| `src/prepare.py` | 真实素材裁切、变速、结果帧停顿、截图／数据哈希核对 |
| `src/index.tsx`、`src/scenes.tsx` | Remotion 分镜、代表性浅深主题与章节衔接 |
| `src/components.tsx`、`src/design.ts`、`src/timing.mjs` | 统一排版、固定几何和透明度包络 |
| `src/score.py` | 75 秒本地合成配乐与同步音效；使用 claude-motion sfx |
| `src/test_contract.py`、`src/timing.test.mjs` | 4 项数据／分镜测试与 1 项包络测试 |
| `src/validate.py`、`src/create_report.py` | 媒体、结果停顿、图表、手机／主题像素、封面、联系表、音频与报告 |
| `contact-sheet.png`、`theme-contact-sheet.png`、`mobile-contact-sheet.png`、`transition-contact-sheet.png` | 最终解码联系表 |
| `out/review/`、`out/frames/`、`out/wave.png` | 验证 JSON／日志、原尺寸帧与切点波形 |
| `inputs/`、`public/assets/` | 保留的文档、精确数据、真实截图与准备后片段 |
| `reproduce.sh` | 本机制作与验证入口 |

本机复现（会重建该目录的生成输出，先保留需要的成片）：

```bash
/Users/luopeihuan/Movies/BetterPaseo/20261017-claude-motion-v8-75s/reproduce.sh
```

环境：执行 Python3 前 `source ~/.pyenv/bin/activate`；依赖现有 numpy/Pillow/PyAV、ffmpeg、Node、本机 PingFang SC、包内 Inter 与 JetBrains Mono。node_modules 与 sfx 读取已安装的 `~/.local/share/claude-motion/`，toolkit 固定 ref 为 `e627941543d9988b155dc610bb9cc0115a5e365e`，MIT 许可证副本在制作目录。

准备步骤仍读取原 V5 目录、V6 已准备片段、仓库原 summary 和配对图片；后续直接渲染可复用 `public/assets/`。不宣称没有外部路径或安装依赖。

V8 技术结果：75.000 秒、1920×1080、30 fps、2250 帧；H.264 yuv420p / BT.709 limited-range、AAC 48 kHz stereo；12,654,639 bytes。SHA256：`f044d872a4fbe05f300e92a8fab400aa2ecd8827191d00aa5c90b8a237f61bd1`。完整解码、17 份操作／场景素材时长、结果停顿、8 根图表条长、1176 次未混合手机源图对照、4 组浅／深桌面／手机截图对应区域对照与静态 CTA 4 秒检查通过；24 个章节混合视图帧单列，不冒充未混合源图。65–71 秒窗口外异常广域深色为零。5 项测试及类型、Python 编译、shell 语法检查通过。

已查看最终全片、主题与转场联系表、全尺寸主题关键帧和波形；未把这些技术／关键帧检查算作主观节奏、听感、真机、Release 或用户验收。原始证据、失败素材与旧版视频保持原样。

## 历史归档

以下仅记录历史版本，不是当前 V8 制作指令。

- V6：`/Users/luopeihuan/Movies/BetterPaseo/20261017-claude-motion/`，59 秒 claude-motion 重制版。
- V7：`/Users/luopeihuan/Movies/BetterPaseo/20261017-claude-motion-v7-transitions/`，59 秒短叠化版；用户反馈仍切得过快、结尾主题不够代表产品，因此改为当前 75 秒 V8。
- V5：`/Users/luopeihuan/Movies/BetterPaseo/20261017-58s/v5-light/`，59 秒浅色主体、18 秒移动、53–55 秒原生主题介绍。V5 的 `REPORT.md`、`build/timeline.json`、`DATA-NOTES.md`、源码和素材继续保留。

V5 归档：59.000 秒、1080p30、1770 帧；H.264 High yuv420p、AAC 48 kHz stereo；12,453,943 bytes。SHA256：`03545170ef9e168bd15abc0d770d5339abb08373e14d65cb71c5062a9050b82a`。完整解码、图表、触点与手机锚点检查通过。全片 1770 帧主题审计结合来源／宿主 palette 和代表帧：指定窗口外深色 surface 0 帧，实际明显深色只在约 54.20–54.97 秒；黑字、边框及原生弹层遮罩不当作深色主题。CTA 完整静态 4 秒。配乐无人声，技术峰值 -3.0 dB；未做人耳试听、真机／Release 或用户验收。

### V4 历史归档

V4 保留在 `/Users/luopeihuan/Movies/BetterPaseo/20261017-58s/v4-mobile/`，不覆盖。历史成片 `better-paseo-mobile-v4.mp4`：58.000 秒、1740 帧、12,444,653 bytes；SHA256 `952a66ff197d8082ba62ec0c77b8e90e2616de3670725afc7342727f8896c598`。V4 Hero 为深色桌面＋浅色手机，Web 移动和四场景为深色，28–32 秒含手机主题切换，53–58 秒 CTA 终态约 4.33 秒；音轨沿用 V3 AAC。这些是历史制作事实，不再是 V5 的制作指令。V5 目录 `inputs/video-prompt-before.md` 保留本页修改前的完整未提交 V4 文档，原 V4 脚本／报告／素材仍在原路径只读保留。

## 下一轮可优化项

V8 已增加总览阅读、操作结果与主题展示时间，并减少整屏叠化；观看节奏仍需用户确认，不把时长延长自动当作体验合格。

| 优先级 | 待优化项 | 验收方式 |
| --- | --- | --- |
| 高 | 原生单元格双点，替换 Web 补充镜头 | 同版本原生成功菜单、复制读回；保留原失败证据 |
| 高 | 完整观看与配乐试听 | 真人检查操作因果、总览阅读、代表性主题和尾音 |
| 中 | Copy／Add to chat 证据 | 桌面剪贴板读回与真实宿主引用进入草稿，不自动发送 |
| 中 | 连续工作线索 | 采用真实可录上下文串起桌面与手机，不虚构跨端联动 |
| 低 | 小屏层级 | 在缩略图和手机上确认品牌、关键操作与必要限定可读 |

## 素材与事实来源

素材均相对仓库根目录；下列截图另有对应的 `-dark.png` 版本。截图为离线 Web showcase，手机外框为示意，不能替代原生设备录屏。

| 用途 | 素材 |
| --- | --- |
| 产品全景 | [`images/hero-devices-light.png`](../images/hero-devices-light.png) |
| 工具与预览 | [`docs/images/tool-read-light.png`](images/tool-read-light.png)、[`tool-bash-light.png`](images/tool-bash-light.png)、[`tool-edit-light.png`](images/tool-edit-light.png) |
| Markdown 与表格 | [`markdown-styles-light.png`](images/markdown-styles-light.png)、[`table-copy-menu-light.png`](images/table-copy-menu-light.png) |
| 文本与表格选区 | [`selection-actions-light.png`](images/selection-actions-light.png)、[`table-selection-light.png`](images/table-selection-light.png) |
| 独立预览与待办浮窗 | [`markdown-preview-window-light.png`](images/markdown-preview-window-light.png)、[`checklist-window-light.png`](images/checklist-window-light.png) |
| 待办与图片 | [`tasks-light.png`](images/tasks-light.png)、[`shared-image-cards-light.png`](images/shared-image-cards-light.png) |
| 主题与设置 | [`settings-zh-light.png`](images/settings-zh-light.png) |
| Web 数据图 | [`web-cpu.zh.svg`](perf/readme/web-cpu.zh.svg) |

- [功能与公开数据](../README-zh.md)
- [本轮协议、失败记录及限制](bench/2026-10-17-readme/README.md)
- [精确中位数、范围与 A/A](bench/2026-10-17-readme/parallel-v2/raw/summary.json)
- [长历史结果](bench/2026-10-17-readme/parallel-v2/history/RESULTS.md)
- [截图来源、尺寸与哈希](images/screenshots.json)
- 新增镜头实现：[表格菜单动效](../client/components/markdown/render/table-copy-menu.tsx)、[流式跟随](../client/ui/preview-tail.ts)、[代码预览切换](../client/components/markdown/render/code-preview.tsx)、[待办](../client/components/task-list.tsx)、[回复页脚](../client/components/turn-footer.tsx)、[详情与提示](../client/ui/toolbar-button.tsx)
- 交互实现核对：[预览与窗口操作](../client/ui/hover-preview.tsx)、[行号显示](../client/ui/preview-lines.tsx)、[行号拖选与触屏复制](../client/ui/line-selection.tsx)、[Web 选区浮条](../client/components/selection-actions.ts)、[表格复制菜单](../client/components/markdown/render/table-copy-menu.tsx)

两组代表数据的舍入核对（四组完整数据见上表）：代码块流式为 `2.404590 → 1.274715 s`，长回复为 `4.774723 → 2.745260 s`。视频显示值分别为 `2.40 → 1.27 s`、`4.77 → 2.75 s`；不要反用显示值计算新的精确百分比。
