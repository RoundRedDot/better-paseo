# 弱化工具调用行 · Claude Design 原型

- 来源：[Claude Design 项目「Better Paseo 工具调用行重设计」](https://claude.ai/design/p/d84d6fee-d421-48ef-8d8b-86dc3b7886af)
- 导出日期：2026-10-13
- 原稿：[quiet-tool-rows.html](quiet-tool-rows.html)，由 Claude Design 的 Export HTML → Standalone HTML 导出，按字节原样保存，可离线打开。
- 提示词：[quiet-tool-rows-prompt.md](quiet-tool-rows-prompt.md)，随附三张参考图：用户标了红框的聊天截图，以及 `shot-tools-v2` 的浅色、深色截图。
- 原稿 SHA-256：`245bbe5913106dd0cfda91ac5e713ca73b520fa2bd10f54a5d43d0bb03952b6b`

用户的反馈是：工具调用行与正文一样醒目，影响阅读。原稿含三块画板：同一段对话的现状与新设计对照（浅色、深色各一组）、单行状态全集、移植规格表。

## 原稿规格

工具行在静止时退到正文之后，悬停、按下、展开时恢复高对比。行高、图标槽、24px 文字起始列和 12px 字号下限都不变。`mix(A, B, t)` 指在 sRGB 中逐通道计算 A×(1−t) + B×t，结果为不透明色。

| 元素 | 公式 | 浅色 | 深色 |
| --- | --- | --- | --- |
| 目标、动词 | `foregroundMuted` | `#62626b` | `#a3a6ad` |
| meta、✓、错误摘要 | `mix(foregroundMuted, surface0, 0.10)` | `#72727a` | `#94979d` |
| 图标 | `mix(foregroundMuted, surface0, 0.30)` | `#919197` | `#77797e` |
| diff 新增 / 删除 | `mix(success 或 danger, foregroundMuted, 0.35)` | `#367c61` / `#af403a` | `#6ab191` / `#d67177` |
| 运行中的目标 | `mix(foregroundMuted, foreground, 0.5)` | `#3d3d43` | `#cbcdd1` |
| 展开后的输出块底色 | `mix(surface1, surface0, 0.30)` | `#f9f9f9` | `#151517` |
| 输出块中的命令和输出 | `mix(foreground, foregroundMuted, 0.25)` | `#2b2b2f` | `#dee0e3` |

- 失败：只有图标和「✗ n」使用 `danger`，目标保持默认弱化色，错误摘要使用 meta 色。
- 运行中：圆点仍为 `accent`，meta 用 `foregroundMuted`。
- 悬停、按下、展开：目标恢复 `foreground`，meta 与 chevron 用 `foregroundMuted`，diff 计数恢复 `success` / `danger`。展开后图标槽显示向下的 chevron。
- 等待用户作答的提问行不弱化。
- 两套参考主题下，所有文字对实际背景的对比度不低于 4.5:1，图标不低于 3:1。

## 实现

颜色由 `buildThemeTokens` 推导为 `tokens.row`（`client/components/theme-tokens.ts`）。`rowPalette` 根据行的 tone（`quiet` / `active` / `loud`）和是否点亮选出调色板，`DisclosureHeader` 通过 `RowPaletteContext` 把它传给 `RowIcon`、`RowText` 和 `PathText`（`client/ui/disclosure-header.tsx`）。工具行、Thought 行和系统卡片共用这一行组件，因此一并弱化。

与原稿的差异：

- 失败行和运行中的行展开后仍显示状态图标，不换成 chevron，因为状态比方向更重要。
- 错误摘要在行组件之外，悬停时不升为 `foregroundMuted`，始终使用 meta 色。
- 原稿建议 Web 上颜色过渡 120ms，这里未实现，颜色直接切换，与 React Native 一致。
