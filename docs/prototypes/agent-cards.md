# Agent 卡片 · Claude Design 原型

- 来源：[Claude Design 项目「Better Paseo · Agent 卡片」](https://claude.ai/design/p/1be17df6-6dfb-469d-9902-bb75e1e2b32c)
- 导出日期：2026-10-20
- 原稿：[agent-cards.html](agent-cards.html)，由 Claude Design 的 Export HTML → Standalone HTML 导出，按字节原样保存，可离线打开。
- 提示词：[agent-cards-prompt.md](agent-cards-prompt.md)。随附五张参考图：用户截图（旧版「Agent finished」卡片露出 `</agent-response>`、正文没有渲染 Markdown），以及 `.showcase/agent-cards.tsx` 生成的现状截图（折叠行浅色和深色各一张、展开态、悬停预览）。
- 原稿 SHA-256：`1981adba0bfa916d301721d392f378bb9eb5d3f15f1fa3683fa61fecf83e73b7`

原稿有五块画板：对话对比（现状 vs 新设计，浅色、深色各一组），A–G 七类卡片的折叠行与展开态，悬停预览面板，380px 窄屏，移植规格表。

## 原稿规格

**行语法**：`[图标槽 16] 8 [动词 13/500] 8 [目标 12/400，单行截断] … [meta 12/400 muted，最多占 45%]`。七类卡片用同一套写法：

- 目标始终是 agent 标题。标题未知时显示 8 位短 ID（等宽 11px）。
- 列表类卡片的目标是数量，例如「3 agents」。
- meta 只写结果，没有结果就留空。

| 工具 / 事件 | 动词（运行中 / 完成 / 未生效或失败） | meta |
| --- | --- | --- |
| create_agent | Creating / Created / Create failed | provider；失败时为错误摘要 |
| send_agent_prompt | Sending prompt / Sent prompt / Prompt failed | turn started、steered running turn、delivered out of band、not confirmed |
| Agent 通知 | Finished、Errored、Needs permission、Closed、Canceled、Message | errored 为错误摘要，needs permission 为工具名 |
| get_agent_status | Checking status / Status | 对方状态 |
| get_agent_activity | Activity | N updates |
| list_agents | Listed agents（目标为 N agents） | 2 running · 1 idle |
| list_pending_permissions | Pending permissions（目标为 N requests） | 第一个请求的标题 |
| cancel / kill / archive / update / set_mode | Canceled turn、Closed agent、Archived、Updated、Set mode | not applied；failed · 原因；→ 新模式 |
| respond_to_permission | Allowed / Denied | — |
| Task（provider 原生子任务） | Running subtask / Subtask / Subtask failed | 类型 · N actions |

**展开块**：行上已经有标题，块内不再重复。块内结构如下：

- **身份条**：provider 标志加名称（12/500），然后是若干「12px lucide 图标 + 文字」字段，一个 6px 状态点加状态词，最后是短 ID 和复制按钮。字段间距 12，可以换行，短 ID 跟在最后一行的行尾，不独占一行。
- **分隔线**：1px border，通栏。
- **小节**：11/500 的标签（Prompt / Reply / Actions / Result），下面是 14/20 的 Markdown 正文。
- **失败**：分隔线后第一行是 13px 的 danger 错误行。

**长正文**：内联展开时，超过 12 行或 900 字符的正文折到 200px，底部 48px 渐隐，下方是「Show all · N lines」按钮；如果只会藏起不到 4 行，就不折。悬停预览不折叠，面板自身滚动。

**状态**：

- Needs permission 的图标、动词、meta 用 warning，展开块默认打开，边框为 `mix(border, warning, 0.45)`。
- Errored 用 danger，但不自动展开。
- Finished、Closed、Canceled 保持安静，其中 Finished 的图标用 success。
- 身份条上的状态点表示 agent 的当前状态，不是事件本身：running 用 accent，waiting 用 warning，error 用 danger，idle 和 closed 用 50% 透明度的 foregroundMuted。

**悬停预览**：顶栏标题写成「动词 · 目标」，例如「Finished · tasks B: cards and status icons」，不再是「paseo / create_agent」。

## 实现与原稿的差异

- 身份条里的 provider、模型和状态取自宿主的 `useAgent`，所以调用结果只带 agent ID 时也能显示实时状态。宿主还没加载这个 agent 时，对应字段直接不显示。
- 权限请求的 Allow / Deny 通过 `paseo.agents.ref(id).respondToPermission` 回应，和 Tasks 看板用的是同一个接口。只有宿主报告该 agent 仍在等待权限（或宿主不认识这个 agent）时才显示按钮。回应之后显示「Permission allowed / denied - by you」；行本身不会切换成安静态，因为行的状态来自通知内容。
- 「Show raw text」只替换正文，身份条保留。
- 渐隐在 React Native 里没有渐变可用，改成 8 段透明度递增的 surface 色块叠在正文上。
