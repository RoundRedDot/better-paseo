# Better Paseo 宣传片 V12 · 英文版

2026-10-20 制作。分镜、时长、配乐和性能数据与 [V12 中文版](video-promo-v12.md) 相同；画面文字全部改为英文，所有录屏素材用英文界面和英文示例数据重录。

**视频、素材、音轨和制作目录不加入 Git。** 本页只记录与中文版的差异、素材来源和复现入口。

## 成片

- 目录：`/Users/luopeihuan/Movies/BetterPaseo/20261020-promo-v12-en/`
- 母版 `better-paseo-promo-v12-en.mp4`：1920×1080 / 60 fps / 64.000 s，H.264 + AAC，20,881,243 bytes，SHA256 `8b4face97e4588448b357995fe0471f307a07ae3303a7ed955f82bef11d0a6fb`。
- 网页版 `better-paseo-promo-v12-en-web.mp4`：1080p / 30 fps，两遍编码，视频 1000 kb/s，AAC 96 kb/s，8,945,314 bytes，SHA256 `c889500970f63721df38a8bf038964e85b88303fb4d499333856cee6181af6dc`。RoundRedDot 是 free plan，GitHub 内联视频单个文件上限 10 MB，README 用这一版。
- 已验证：母版用 `ffmpeg -xerror` 完整解码通过；逐秒联系表目检过，画面中没有中文。设置页语言选项里的「简体中文」是语言名称本身，保留。
- 配乐直接复用中文版的 `out/score.m4a`，时间线没有变化。

## 与中文版的差异

- **叠加文字**：标题、贴纸、数据卡、计分板、CTA 和底部来源标注全部改为英文。为避免文字溢出：
  - 手机行号镜头的标题改为「Drag lines, then copy.」。
  - 主题镜头的标题改为「Follows your theme.」。
  - 内存卡片去掉「省」字前缀，改为「123.5 MB / less JS heap」。
- **页脚耗时**：重录前修复了产品问题，页脚的紧凑耗时原本固定用中文单位，现在跟随插件语言（main `257c41b`）。所有素材都用这一版代码录制，画面里显示为 `1m 18s`、`0s`、`12s`。
- **Add to chat 镜头**：中文版录的是日常 Paseo 桌面端里的真实对话。英文版不碰日常 daemon，改为：
  - 静态托管 Paseo 0.12.0 桌面端自带的 Web 构建（`app-dist`），用 en-US locale 连接一个隔离 daemon。
  - daemon 上的 bc-bench 回放一段英文合成对话。
  - 底部标注为「Real Paseo 0.12 web client recording · not sent · sped up」。草稿只写进了输入框，读回已确认，没有发送。该镜头的 zoom 按新的画面布局改为 `[1.35, 0.1, 0.9]`。
- **手机镜头**：在 rrd-mac-studio 的 `bc-range-ios` 模拟器（iOS 26.5，en-US）上重录，fixture 已翻成英文。preview 这段带行号，因为当前插件默认开启行号。
- **主题截图**：用 `.showcase/tools/shots.mjs` 以 en-US 重拍 `shot-hero-devices`，再按 V11 的坐标裁出桌面图和手机图，手机图用 `tools/matte_phone.py` 处理成外侧透明。

## 素材来源

| 素材 | 来源 |
| --- | --- |
| desktop-tools / stream / maximize / drag，workflow-tasks / questions / usage，settings-controls | 离线 showcase：复用 V10 的录制脚本，locale 设为 en-US，fixture 译成英文，插件为 `257c41b`。按 V11 的剪辑点切片（`tools/assemble_en.py`） |
| workflow-add | Paseo 0.12.0 Web 构建 + 隔离 daemon（`inputs/host/tools/record-add.mjs`） |
| mobile-preview / lines / table-copy | iOS 模拟器原片（`inputs/ios/`），由 `tools/build_mobile_en.py` 缩放到 416×904 并叠加触点 |
| theme-* | `shots.mjs` 以 en-US 拍摄 |

## 复现

制作目录不是可移植包。各步骤的入口如下：

1. Web take：`capture/src/record.mjs`。
2. 宿主 take：`inputs/host/tools/record-add.mjs`，需要 daemon 6898 和 `serve-app.mjs 8096`。
3. 切片：`tools/assemble_en.py`。
4. 手机片段：`tools/build_mobile_en.py`。
5. 渲染与混音：`npm run render`，然后 `python3 src/mux.py`。
