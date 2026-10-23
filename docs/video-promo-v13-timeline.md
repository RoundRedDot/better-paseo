# Better Paseo 宣传片 V13 · 时间线（手机与 iPad）

2026-10-23 制作，2026-10-24 使用新测数据更新性能段并在 Mac Studio 重渲染。V13 拆成两支独立短片：本片讲聊天时间线的优化，[Tasks 片](video-promo-v13-tasks.md)讲新加的 Tasks board。两支都把镜头集中在 iPhone 和 iPad 上，桌面只在文字里带过。画面文字全部用英文，可以直接放进 README。

**视频、素材、音轨和制作目录不加入 Git。** 本页记录分镜、素材与测量来源、验证结果和复现入口。

## 成片

- 目录：`/Users/luopeihuan/Movies/BetterPaseo/20261023-promo-timeline/`
- 母版 `better-paseo-promo-v13-timeline.mp4`：1920×1080 / 30 fps / 64.000 s，H.264 + AAC 48 kHz stereo，23,884,211 bytes，SHA256 `a862965488d6502a786e465022f72dde21248b2604a057b76c587d90a58f8590`。
- 网页版 `better-paseo-promo-v13-timeline-web.mp4`：两遍编码，视频 1000 kb/s，AAC 96 kb/s，8,651,011 bytes（低于 GitHub free plan 的 10 MB 上限），SHA256 `8009ce0bd8a6ac7477b0ae3fbcad83214816c975499498a5412bc4cd3d2af0da`。README 用这一版。
- 封面 `hero-cover.png`（母版第 0 帧），逐秒联系表 `contact-sheet-web.png`。
- 已验证：两个文件都在 Studio 用 `ffmpeg -xerror` 完整解码通过，`hyperframes check` 为 `ok:true`；逐秒联系表及 51–60 秒性能段已目检，四张卡和完整脚注可读。网页版直接保留旧版 AAC 音轨（音频 stream SHA256 一致），`loudnorm` 输入分析为 -14.97 LUFS、true peak -1.24 dBTP。配乐听感没有人试听过。
- 旧 spec 保存在 `better-paseo-timeline/spec.placeholder.json`，旧母版和网页版分别保存在 `better-paseo-promo-v13-timeline.placeholder.mp4`、`better-paseo-promo-v13-timeline-web.placeholder.mp4`；旧封面和联系表也保留为 `.placeholder.png`。

## 分镜

切点以工程里的 `spec.json` 为准（`better-paseo-timeline/spec.json`，由 `tools/gen.py` 生成各帧）。

| 时间 | 内容 | 画面 |
| --- | --- | --- |
| 0–5 | 「Agent timelines, made to read on phone and iPad.」品牌、一句话定位 | iPad 横屏侧边面板 + iPhone 时间线，两台设备同框，第 0 帧即完整画面 |
| 5–13 | 「Every tool call, one tidy row.」 | iPhone：新一轮流式回复，Read、Edit、Bash、测试逐行收成一行 |
| 13–22 | 「Tap a row. Details rise.」 | iPhone：点失败的 `npm test` 行升起抽屉 → 横滑表头跳到上一块（Edit diff）→ 拖到全高 → 关闭；附「Swipe → previous block」「Drag up → full height」贴纸 |
| 22–32 | 「Pinch to set the text size.」 | iPhone：Read 抽屉里双指捏合三次，字号 14 → 17，徽章「Text size N」，再点 Reset 回到默认；捏合时同帧放大 1.35 倍 |
| 32–38 | 「On iPad, a floating panel.」 | iPad 竖屏：点运行中的 soak test 行，浮动面板居中出现并持续跟随输出，向上拖到全高；同帧放大面板 |
| 38–43 | 「Turn it sideways: a side panel.」 | iPad 横屏：同一个 Bash 块在侧边面板里流式增长；同帧放大面板 |
| 43–51 | 「Hold a line number. Drag. Copy.」→「Long-press the footer for the turn's numbers.」 | iPhone：长按行号栏后拖选 7 行、点 Copy（剪贴板读回见下）；长按回复页脚弹出 Turn details（模型、时间、输入/缓存/输出 token） |
| 51–60 | 「Smooth on long replies, too.」四张实测对比卡与完整统计脚注 | 纯图形；数据见下 |
| 60–64 | Better Paseo、安装命令、GitHub 地址 | 静态 CTA |

## 素材与标注

- 全部是本机录制：iPhone 17 Pro、iPad Pro 11-inch (M5) 两台 iOS 26.5 模拟器（`bc-video-iphone`、`bc-video-ipad`），装的是从 studio `~/bc-range/r012` 拷来的 Paseo 0.12.0 **Release** 构建（`sh.paseo`；录制阶段只拷贝构建，未在 studio 运行模拟器；本次合成/编码在 studio 独立的 `~/bc-video-render` 执行）。界面语言 en-US。
- 连接私有 daemon `~/.paseo-video`（127.0.0.1:6911），用户日常的 6767 没有碰过。插件是 `git archive` 导出的副本：时间线镜头录制时是 main `f2f64009`；录完后 main 到了 `7e8d412f`，新增提交只改 Tasks 卡片和图片查看器，本片画面不涉及，未重录。
- 演示界面数据为示例：自写的 `bc-video` 示例 provider 回放仓库里的 stream fixture（`mixed-turn`、`tool-expanded-streaming` 等），卡片上显示的模型名（Opus 4.7 等）和 token 数都是示例值。每帧底部持续标注「simulator · sample data」以及是否加速（1.4×–1.7×，抽屉镜头为原速）。
- 触点是后期叠加的白色圆点，位置和时间来自录制时的手势日志（serve-sim ws 注入），不是录屏里自带的。
- 行号复制的剪贴板读回：`raw/a4-lines.clipboard.txt`，7 行 TypeScript，不含行号。

## 性能数据与来源

51–60 秒使用 **2026-10-23 的新测结果**：Paseo 0.12.0、Better Paseo `f2f64009`、Mac Studio M5 Max；Web 与 iOS 各 11 场景 × 2 配置 × 5 次，共 **220 次串行回放**，使用每格 5 次中位数。iOS 是 iPhone 17 Pro / iOS 26.5 Release 模拟器，不能推广为真机性能。界面中的模型/token 是示例，性能段数值来自实际 benchmark。

权威文件位于主仓库本地、Git 忽略的 `docs/bench/2026-10-23-paseo-012-f2f64009/`：`readme-tables.md`（README 表格、计数、条件）与 `summary.md`（方法、边界与归因）。绝对目录为 `/Users/luopeihuan/workspace/rrd/beautiful-chat/docs/bench/2026-10-23-paseo-012-f2f64009/`。下表行号均指该目录的 `readme-tables.md`。

| 卡片 | 指标 | 不开插件 | Better Paseo | 画面显示 | 来源行 |
| --- | --- | ---: | ---: | --- | --- |
| Long reply · iOS | 整个 App 进程 CPU 时间（Release 模拟器） | 30.64 s | 8.16 s | ⬆ 73% less | 102 |
| Long reply · Web | 整段回放主线程 Task 时间 | 15.617 s | 3.153 s | ⬆ 80% less | 34 |
| Code block streaming · Web | 整段回放主线程 Task 时间 | 3.714 s | 1.401 s | ⬆ 62% less | 31 |
| Table streaming · Web | 整段回放主线程 Task 时间 | 2.242 s | 1.012 s | ⬆ 55% less | 40 |

画面脚注明确写出测量日期、机器、Paseo/Better Paseo 版本、220 次串行回放、5 次中位数、Web/iOS 指标及「Bar animation proportional」。其中日期/版本/跑次来自第 17 行，指标口径来自第 85、133 行；比例柱终值按同卡最大值归一化，绿色带杆上箭头表示改善，名称使用 Better Paseo。

脚注同时保留整体结果与反例：Web 主线程 **9 lower / 1 even / 1 higher**（第 25 行）；iOS App CPU **3 lower / 7 even / 1 higher**（第 93 行）；历史回放 **Web +39%**（第 33 行）、**iOS +12%**（第 101 行）。不声称所有场景更快。差异不足 10% 为 even；Web 整段回放两边均低于 0.5 秒也为 even，详见第 133 行。

本次只修改 `spec.json` 的 `08-perf.perf`，再运行 `python3 tools/gen.py .`；生成文件仅 `compositions/frames/08-perf.html` 改变，其余八场景、时长、素材和 Tasks 片未修改。

## 录制中的发现

- **双指缩放后 Reset 不生效：是注入问题，不是插件 bug。** serve-sim 的多点触控 `end` 送达后，RN 要等到下一次触摸才收到这次捏合的结束，所以字号要到下一次触摸时才提交；紧接着的 Reset 点击被这次“补发的结束”吃掉。在捏合之后先补一次不在演示范围内的轻点（AXe），再点 Reset，就能稳定回到默认（`detailsTextZoom` 读回为 0）。片中的捏合用的就是这个顺序，补发的轻点不画触点。真机上没有这一步，无需改插件。
- iPad 横屏下 AXe 的坐标映射会报错，改用 serve-sim ws 并在脚本里把横屏坐标换算回竖屏 HID 坐标（`tools/g.mjs` 的 `ROT=lr`）。

## 复现

制作目录不是可移植包，入口如下（脚本都在 `better-paseo-timeline/tools/`）：

1. 环境：`up.sh iphone|ipad`（daemon 6911、探针控制 8199、serve-sim 3171/3172）；Release 构建里的 host probe 轮询 `localhost:8199`，用 `ev.sh`/`open.sh` 导航。用完 `down.sh`。
2. 录制：`rec.sh start <udid> <out.mp4>` / `rec.sh stop`；手势 `GLOG=<take>.touch.jsonl node g.mjs <port> <w> <h> '<steps>'`。
3. 切片：`python3 tools/prep.py .`（按 `shots.json` 切成 30 fps CFR 片段并换算触点时间）。
4. 合成：`python3 tools/gen.py .`，`npx hyperframes check`，`npx hyperframes render --quality delivery --output renders/master.mp4`。
5. 网页版：视频用 libx264 `-preset slow -b:v 1000k` 两遍编码，AAC 96k。重新生成音频时使用 `volume=-0.6dB,alimiter=limit=0.79:level=false`，避免限幅器默认自动增益；本次最终文件直接复用旧网页版的 AAC 音轨，新视频流不再编码。

### Mac Studio 重渲染

工具链固定 HyperFrames 0.8.173、Chrome Headless Shell 152.0.7977.30、Node 24.22.1、ffmpeg 9.0.2；字体、音乐、CFR 素材及 raw 已复制到 `~/bc-video-render`，专用 HOME/TMP/cache 也在其中。root HTML 仍需访问固定的 GSAP 3.14.2 CDN。先同步已更新 spec/生成场景，然后在本机执行：

```bash
~/Movies/BetterPaseo/20261023-promo-timeline/studio-check/render-and-sync.sh timeline <unique-run-label>
```

命令包含生成、check、2-worker 低优先级渲染、两遍网页编码、ffprobe、完整解码、10 MB gate 和回传，输出到新的 `studio-check/timeline-<unique-run-label>/`，拒绝覆盖同名远端输出目录。本轮目录为 `studio-check/timeline-phase2-20261024-measured/`，含 `check.json`、两份 ffprobe、decode 日志、最终 SHA256、逐秒联系表和 `visual/perf-51.png`–`perf-60.png`。旧网页 AAC 音轨复用是本轮渲染后的显式 remux 步骤，命令见 `/tmp/orch-bc/B.md`。
