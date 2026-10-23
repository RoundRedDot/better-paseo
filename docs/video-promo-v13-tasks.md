# Better Paseo 宣传片 V13 · Tasks board（手机与 iPad）

2026-10-23 制作。V13 的第二支：只讲新加的 Tasks board，镜头集中在 iPad 横屏的多泳道看板和 iPhone 的单泳道形态。与[时间线片](video-promo-v13-timeline.md)共用设计、配乐和制作工具。画面文字全部用英文。

**视频、素材、音轨和制作目录不加入 Git。** 本页只记录分镜、素材来源和复现入口。本片没有性能段，不等新测数据。

## 成片

- 目录：`/Users/luopeihuan/Movies/BetterPaseo/20261023-promo-tasks/`
- 母版 `better-paseo-promo-v13-tasks.mp4`：1920×1080 / 30 fps / 64.000 s，H.264 + AAC 48 kHz stereo，22,322,624 bytes。
- 网页版 `better-paseo-promo-v13-tasks-web.mp4`：两遍编码，视频 1000 kb/s，AAC 96 kb/s，8,611,048 bytes，SHA256 `32ff435eddcd184eb2756b48e1589cad8a3560f0fe32d1b1dca364b058ae6fd0`。README 用这一版。
- 封面 `hero-cover.png`，逐秒联系表 `contact-sheet-web.png`。
- 已验证：两个文件 `ffmpeg -xerror` 完整解码通过；逐秒联系表已目检。网页版 -14.8 LUFS，true peak -1.2 dBFS。配乐听感没有人试听过。

## 分镜

| 时间 | 内容 | 画面 |
| --- | --- | --- |
| 0–5 | 「Every agent, one board.」 | iPad 横屏四泳道看板 + iPhone 单泳道，同框 |
| 5–17 | 「Four lanes. Live.」→「Done, and Archived too.」 | iPad：Needs input / Running / Review / Done；一个刚跑完的任务从 Running 滑进 Review，泳道计数滚动（同帧放大）；随后横滑到 Done 和 Archived 泳道（Archive / Unarchive 按钮），带出项目图标、分支胶囊、彩色标签 |
| 17–26 | 「Tap a card: the whole story.」 | iPad：点运行中的卡片，右侧详情栏：本轮计时、上下文环、首个提示、最新消息、分支、用量和费用；后半段 2× 滚动详情 |
| 26–32 | 「Approve it from the card.」 | iPad：等待批准的卡片直接点 Allow，卡片离开 Needs input、计数变化（同帧放大） |
| 32–40 | 「On iPhone, one lane at a time.」 | iPhone：从侧栏进入 Tasks，四格状态条，左右滑切泳道；Running 泳道里子任务卡带 **Open parent** |
| 40–48 | 「Details in a sheet. Step through the lane.」 | iPhone：点 Review 卡片弹出详情 sheet，箭头走到下一张，向上拉满 |
| 48–54 | 「Filter by agent, label or workspace.」 | iPhone：筛选 sheet 里选 Codex (sample)，「Show 6 tasks」后计数滚动；底部提示被筛掉的数量 |
| 54–60 | 「Stop, or mark as read.」 | iPhone：Stop → 系统确认框「Stop this task?」→ Stop 按钮转圈 → 卡片离开 Running（Running 4 → 3，Review +1）；再在 Review 卡上点 Mark as read，卡片进 Done |
| 60–64 | Better Paseo、安装命令、地址，「The Tasks board is on by default」 | 静态 CTA |

## 素材与标注

- 全部本机录制，环境与时间线片相同：iOS 26.5 的 iPhone 17 Pro / iPad Pro 11-inch 模拟器，Paseo 0.12.0 Release 构建，私有 daemon `~/.paseo-video`（6911），en-US。
- 插件版本：iPad 镜头（看板、详情、Allow）和 iPhone 的详情 sheet、筛选、Mark as read 录于 main `f2f64009`；iPhone 的泳道切换和 Stop 两段在 main 前进到 `7e8d412f` 后换新副本**重录**，因为画面里有子任务卡，新版在 Open tab 旁边加了 Open parent。其余画面不含子任务卡或图片查看器，未重录。
- 看板数据全部是示例：`tools/seed-tasks.mjs` 建 14 个示例 agent（3 个示例项目 acme-web / acme-api / acme-mobile，各带 favicon 作为项目图标），覆盖四条泳道和 Archived，含父子任务、彩色标签、一个失败卡、两个等待批准的卡，部分分支领先 main 1–3 个提交。provider 是自写的示例 provider（显示为 Claude Code (sample) / Codex (sample)），模型、token、费用都是示例值。
- 每帧底部标注设备、「sample agents and data」和是否加速；手机泳道、sheet、筛选三段剪掉了操作之间的空等（标「idle time cut」）；Stop 一段等待 CLI 的几秒加速 3.5×。
- 触点为后期叠加，来自录制时的手势日志。

## 录制中的发现

- **Stop 在机器高负载时会失败。** 插件通过 `paseo agent stop` 停止任务，超时 10 秒。录制时本机 1 分钟负载一度在 300 以上，桌面版 CLI 光启动就要 4–7 秒，一次 Stop 弹出「Could not stop task: Paseo CLI failed to stop the agent.」。负载回落后同样操作约 5 秒完成。片中用的是成功的那次。这是否需要放宽超时，留给用户判断。
- iOS 上 Stop 的系统确认框不能用 AXe 点（调用挂起），用 serve-sim 的触摸可以。

## 复现

与时间线片相同（脚本在 `better-paseo-tasks/tools/`），另外：

- 造数据：`node tools/reset-tasks.mjs` 清掉上一轮，`node tools/seed-tasks.mjs` 重建；正在运行的卡由很慢的 fixture 回放维持（`prompts.json` 里 `speed:0.001`–`0.004`）。
- 切片、合成、渲染、网页版命令同时间线片第 3–5 步。
