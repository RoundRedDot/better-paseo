# Paseo PR 审查意见后续处理计划

记录日期：2026-10-16。状态：待统一处理；本次只归档计划，未修改实现、运行回归测试、提交或推送代码。

## 范围与证据

- 本文存放于 Better Paseo 项目；下列代码路径均相对于 `getpaseo/paseo`，本地主仓库为 `/Users/luopeihuan/workspace/rrd/paseo`。
- 当次检查覆盖 `luoph` 提交的 18 个开放 PR 的审查线程、回复、最新审查摘要和相关 diff。发现 9 个 PR 有待处理意见，共 24 条；另有 1 个 PR 有非阻塞测试建议。
- 意见主要来自 Greptile。本文记录审查所述风险和拟定方案，不表示已经独立复现全部缺陷，也不表示 CI、审核或设备验收已通过。
- `P1/P2` 沿用原审查标记。未解决线程不等于代码一定未修；执行前须按最新 PR head 重新核验。已修复的意见应记录证据，有异议的意见先复现再决定是否采纳。

## 执行顺序与公共验收

1. 刷新 PR 状态、head SHA、审查线程和 CI，核对实际 head 仓库与分支。完整阅读对应实现、依赖、测试及该目录的 `AGENTS.md`/`CLAUDE.md`，确定每项意见是否仍成立。
2. 第一批处理小范围修改：`#6677`、`#7006`、`#6601`、`#6809`。
3. 第二批处理行为问题：`#7015`、`#7000`、`#6731`、`#6773`；先用回归用例确认问题，再完成最小修复。
4. 第三批单独处理 `#6737`，先确定排序意图、重连和数据清理语义，再逐项修复；`#6700` 的非阻塞测试可独立补充。
5. 每个 PR 完成后记录修改 commit、测试命令与结果、未完成的平台验证，以及每条意见的处理结论。按当时授权范围更新远端或回复审查。

需要隔离时，在核对主仓库及基线 ref、确认主仓库已忽略 `.worktrees/` 后，使用 `git -C <主仓库> worktree add <主仓库>/.worktrees/<名称>` 创建目录；再按主仓库 projectId 注册 Paseo local workspace。已有 workspace 保持原路径。

每个 PR 独立修改和验证，避免混入其他 PR 的改动；默认不增加依赖、不扩展产品功能。测试命令以各分支实际配置为准。涉及公开接口、持久化数据或排序语义的方案，在完整读码后细化，再开始实现。

验收至少包括：对应回归测试、受影响包的 typecheck/lint，以及集成路径验证。纯类型或测试结构调整可通过现有测试和类型检查验收；不为文档变更新增单测。原生设备、模拟器、浏览器和静态验证分别记录，不能相互替代。

提交及 PR 身份遵循仓库 `AGENTS.md`；本文不授权改写已推送历史。回滚以各 PR 独立修复提交为单位，持久化或协议变更另行确认回滚兼容性。

## 第一批：小范围修改

### #6677：复用 rewind 菜单 props 类型（1 条 P2）

来源：[Props have two separate definitions](https://github.com/getpaseo/paseo/pull/6677#discussion_r4244645277)。

问题：`PluginRewindMenuProps` 重复定义 SDK 的 `RewindMenuProps`，存在类型漂移风险。

- [ ] 修改 `packages/app/src/plugins/react-native/rewind-menu.tsx`，复用 `@getpaseo/plugin/client/react-native` 导出的规范类型，按既有导出关系保留必要别名。
- [ ] 验收：相关 typecheck、现有 rewind 测试通过；菜单能力判断、回退操作和提示词恢复行为不变。

### #7006：提取流式 E2E 采样 helper（1 条 P2）

来源：[Sampling hides the test’s intent](https://github.com/getpaseo/paseo/pull/7006#discussion_r4281613635)。

问题：测试正文直接包含帧循环、DOM 读取和 Promise 等待机制，不符合审查引用的测试结构要求。

- [ ] 修改 `packages/app/e2e/browser/agent-stream-closing-fence.spec.ts`，参考邻近的 `sampleStreamFrames`，提取具名采样 helper，正文保留场景操作和结果断言。
- [ ] 验收：原有关闭围栏回归场景通过，采样覆盖与断言强度保持不变；不改变流式渲染实现。

### #6601：编译步骤与确定性测试（2 条 P2）

来源：[Compilation steps are combined](https://github.com/getpaseo/paseo/pull/6601#discussion_r4241421069)、[Tests depend on machine speed](https://github.com/getpaseo/paseo/pull/6601#discussion_r4241421077)。

- [ ] 修改 `packages/server/src/server/plugins/compiler.ts`，使用显式条件分支选择 client bundle 输出，再调用 `wrapCommonJsBundle`，保持转换顺序及目标范围不变。
- [ ] 修改同目录 `compiler.test.ts`，移除以实际墙钟耗时判定成功的断言；保留 class 消除、依赖 bundle 转换及执行结果检查。性能预算按仓库现有 benchmark 入口单独验证。
- [ ] 验收：编译器测试及 server typecheck/lint 通过；client bundle 转换和非 client bundle 行为保持一致。Hermes 运行验证单独记录。

### #6809：保留 Task 提示词原文（1 条 P2）

来源：[Card prompts lose whitespace](https://github.com/getpaseo/paseo/pull/6809#discussion_r4258785233)。

问题：实时声明、sidechain 更新和历史回放裁剪了提示词首尾空白，导致显示和复制内容不同于原始输入。

- [ ] 完整追踪 Claude 三条路径，包括 `packages/server/src/server/agent/providers/claude/sidechain-tracker.ts` 及 prompt 读取 helper。
- [ ] 仅用裁剪结果判断是否为空，存储和传递原始字符串；核对 helper 本身是否已经裁剪。
- [ ] 验收：三条路径均覆盖前导缩进、末尾换行及空白输入，确认非空 prompt 逐字保留；保持原有空值语义。

## 第二批：行为修复

### #7015：消除选项答案歧义（1 条 P1）

来源：[Agents receive the wrong selections](https://github.com/getpaseo/paseo/pull/7015#discussion_r4282825457)。

问题：桥接层从逗号拼接的展示文字反推选择。选项 `Red`、`Blue`、`Red, Blue` 共存时，选择前两项可能被还原成第三项；Grok 备注也可能被当成选项。

- [ ] 阅读共享问题表单、答案协议、`packages/server/src/server/agent/providers/cursor-questions.ts` 及 Grok 对应 bridge，确定可保留明确选项标识的最小路径。
- [ ] 用无歧义的选择值传递答案，独立传递自由输入/备注；停止从展示标签猜测选择。不预设可只改 bridge，若必须调整共享协议，先明确调用方和迁移影响。
- [ ] 验收：Cursor/Grok 均补标签冲突往返测试，并覆盖多选、单选、备注与标签相同的输入；确认 provider 收到的 ID/选择与用户输入一致。

### #7000：关联 Claude 实时与历史消息 ID（1 条 P1）

来源：[Claude timing disappears after reload](https://github.com/getpaseo/paseo/pull/7000#discussion_r4281114401)。

问题：实时 `message.id` 与 transcript `entry.uuid` 不同时，重载后无法通过保存的消息 ID 或运行时 `turnId` 匹配耗时。

- [ ] 阅读 Claude 实时/历史转换、`packages/server/src/server/agent/agent-manager.ts`、耗时存储与分页查询路径，确认稳定 ID 的来源和可用时机。
- [ ] 在 provider 边界保留历史可识别的稳定 ID，或建立明确映射；不按文本、顺序或时间猜测关联。评估已有耗时记录的读取兼容性。
- [ ] 验收：用不同的 provider message ID 与 transcript UUID 补完整持久化/重载测试；重载前后同一回复耗时一致，分页不带入无关回合的数据。

### #6731：重连刷新插件设置（1 条 P1、1 条 P2）

来源：[Settings stay stale after reconnect](https://github.com/getpaseo/paseo/pull/6731#discussion_r4249718488)、[Tests bypass real reconnect behavior](https://github.com/getpaseo/paseo/pull/6731#discussion_r4254236885)。

- [ ] 阅读 `packages/app/src/plugins/catalog-sync.tsx`、settings 查询键与订阅生命周期，重连时使对应 host 的设置查询失效并刷新，保留未变化的安装实例。
- [ ] 将 `catalog-sync.test.tsx` 中依赖 JSDOM、组件挂载及模块替换的新增覆盖，迁移到具名边界的注入依赖测试或真实应用测试，按该分支的测试规范选择最小方案。
- [ ] 验收：客户端 A 断连、B 修改设置、A 重连后读取新值及 revision，随后保存成功；安装实例不因设置刷新被无故重建，其他 host 不受影响。

### #6773：触屏大纲跳转与无障碍（2 条 P1、2 条 P2）

来源：

| 意见 | 链接 | 修改范围与计划 |
| --- | --- | --- |
| P1：回底部操作被旧跳转覆盖 | [Bottom navigation gets undone](https://github.com/getpaseo/paseo/pull/6773#discussion_r4254251936) | `packages/app/src/agent-stream/strategy-native.tsx`：先调用 `endPromptJump` 结束旧跳转，再发起底部滚动请求，确保后续 tick 不覆盖最新操作。 |
| P1：无障碍步进卡住 | [Screen reader stepping gets stuck](https://github.com/getpaseo/paseo/pull/6773#discussion_r4254251945) | `packages/app/src/agent-stream/chat-outline/rail.tsx`：区分视口 reading line 与最后请求的无障碍选择；定义用户滚动后选择状态的同步规则。 |
| P2：测试绕过原生阅读位置 | [Tests bypass native reading](https://github.com/getpaseo/paseo/pull/6773#discussion_r4254251950) | 调整 `chat-outline/use-chat-outline.test.tsx` 新增覆盖，使用注入依赖和 typed fake，或在真实应用路径验证，不继续叠加 JSDOM/mock。 |
| P2：位置参数含义不明确 | [Arguments are easy to mix](https://github.com/getpaseo/paseo/pull/6773#discussion_r4254251955) | 将 `resolvePromptSlotAt`、`scrollToIndexAtTop`、`tickMagnification` 对应多参数或布尔参数接口改为具名对象，更新调用方。 |

- [ ] 验收：跳转进行中点击回底部，最终保持底部且不再被旧任务拉回。
- [ ] 验收：落点被限制为零时，无障碍仍可连续前进/后退到剩余提示词；手动滚动与请求选择的衔接正确。
- [ ] 验收：相关模型测试、真实应用集成及原生阅读位置报告分别记录；浏览器测试不代替原生验收。

## 第三批：#6737 跨客户端排序专项

共 11 条意见：6 条 P1、5 条 P2。应在该 PR 内分步修改，不和其他 PR 混在一起。

### 排序意图与合并（3 条 P1）

- [ ] [New items jump back](https://github.com/getpaseo/paseo/pull/6737#discussion_r4250158522)：`packages/app/src/ordering/index.ts` 的 `mergeIntent` 应保留新条目的请求位置，同时保留客户端不可见的既有条目。覆盖 shared `[a,b]`、local `[c,a,b]`，接受回复后 `c` 仍在请求位置。
- [ ] [Split drags reorder unrelated tabs](https://github.com/getpaseo/paseo/pull/6737#discussion_r4250158533)：显式携带被拖拽 pane 的目标集合，只调整该集合的顺序，不能发布所有 pane 的扁平顺序。覆盖 shared `[a,b,c,d]`、pane `[a,c]` 与 `[b,d]` 的场景，验证无关关系不变。
- [ ] [Untouched hosts adopt cached orders](https://github.com/getpaseo/paseo/pull/6737#discussion_r4254248248)：置顶拖拽仅发布实际改变的 host 内部顺序；跨 host 行位置继续按原设计保持本地。覆盖未操作 host 尚无共享顺序的情况，确认不会从缓存创建该 host 的共享顺序。

### 连接与并发（3 条 P1）

- [ ] [Reconnect silently drops drags](https://github.com/getpaseo/paseo/pull/6737#discussion_r4250158545)：在 `packages/app/src/ordering/replica.ts` 及其调用入口定义未就绪状态下的手势处理。优先检查能否暂存明确拖拽并在快照到达后按最新 revision 合并；同时覆盖 host 尚未进入 `hosts` 的窗口。若采用禁用拖拽方案，应先明确可见反馈和状态转换。
- [ ] [Cleanup removes fresh pinned ordering](https://github.com/getpaseo/paseo/pull/6737#discussion_r4250158555)：在 `packages/server/src/server/ordering/runtime.ts` 的队列清理实际执行时重查当前 pin 状态，避免旧快照删除刚接受的置顶排序。使用可控写入顺序验证并发 archive/pin。
- [ ] [Ordering failures disable labels](https://github.com/getpaseo/paseo/pull/6737#discussion_r4254299932)：在 `packages/app/src/runtime/directory-sync/index.ts` 独立建立排序与 labels 订阅，并正确管理各自失败和释放。覆盖排序请求失败/超时但 host 在线时，labels 仍可订阅及修改。

### 数据生命周期（1 条 P2）

- [ ] [Old tabs exhaust saved ordering](https://github.com/getpaseo/paseo/pull/6737#discussion_r4256431716)：先明确跨客户端目标存活与删除信号，再设计有界清理。不可直接以当前客户端的已打开列表删除共享目标。覆盖 4096 限制边界、关闭后恢复同步及其他客户端仍使用的目标；不得只提高上限掩盖累积问题。

### 工程规范（4 条 P2）

- [ ] [Browser mechanics obscure test intent](https://github.com/getpaseo/paseo/pull/6737#discussion_r4250158566)：`packages/app/e2e/browser/sidebar-reorder.spec.ts` 提取 tab 拖拽及独立客户端建立 helper，测试正文表达跨客户端操作与断言。
- [ ] [Public inputs lack named types](https://github.com/getpaseo/paseo/pull/6737#discussion_r4250158576)：为 `createOrderingRuntime`、`OrderingService.prune`、`SharedOrderingController.connect` 的公共输入建立具名类型。
- [ ] [Toasts show internal error strings](https://github.com/getpaseo/paseo/pull/6737#discussion_r4254248251)：`packages/app/src/components/sidebar-workspace-list.tsx` 的 toast 只显示翻译文案，将内部错误细节保留在日志中，验证错误提示不含内部路径或原始报错。
- [ ] [Arguments lack names](https://github.com/getpaseo/paseo/pull/6737#discussion_r4256808103)：将 `OrderReplica`、`OrderingService`、`createOrderingSession`、`OrderingSession` 的相关多位置参数改为具名对象，保持排序行为不变。

专项验收：确定性模型/并发测试、两客户端 E2E、多 pane 与多 host 回归、重连与失败路径、持久化边界、受影响包 typecheck/lint。排序意图和清理策略尚待完整读码确认，不将本文的方案当作已经定稿的接口规格。

## 非阻塞建议与已处理项

### #6700：补双重翻转测试（1 条 P2，非阻塞）

来源：[Two flips lack coverage](https://github.com/getpaseo/paseo/pull/6700#discussion_r4246523563)。最新审查摘要将其标为非阻塞建议。

- [ ] 在 `packages/app/modules/paseo-scroll/android/src/androidTest/java/sh/paseo/scroll/ScrollSelectionTest.kt` 增加 `scaleY = -1f` 与 `rotation = 180f` 同时存在的用例，确认正立视图会滚动显示屏外选区。
- [ ] 运行 Android instrumentation test，记录设备/模拟器与结果；不因补覆盖而改变当前异或判断语义。

### #6972：已有修复，仅待核验审查收尾

来源：[作者处理回复](https://github.com/getpaseo/paseo/pull/6972#discussion_r4279775379)。

已在 `199aae9dde46838538d74f16c9f035ac9c74885f` 补 Escape 回归测试并回复，覆盖第一次关闭 popover 不中断 agent、第二次中断，并说明已做移除 guard 后失败的验证。检查时线程仍未解决，最新摘要将剩余建议标为非阻塞。

- [ ] 后续重新核对当前 head 与测试结果，再按实际情况完成审查收尾；不重复计为尚未修改的代码问题。

### 其余 PR

当次未发现需纳入本计划的未处理审查意见：`#7014`、`#6762`、`#6738`、`#6736`、`#6732`、`#6699`、`#6602`。这不代表它们已获正式批准或当前 CI 全绿。`#6602` 先前的 CI 阻塞已由维护者在评论中说明解除。

`#6682` 已关闭，其修复通过 `#6690` 合入，不列入开放 PR 处理范围。

## 完成记录格式

后续每完成一个 PR，在对应章节补充：

```text
状态：待处理 / 已修复待验证 / 已验证 / 不采纳（附理由）
核验 head：<sha>
修复 commit：<sha>
审查意见处理：<逐条链接及结论>
验证：<命令、结果、平台>
尚缺验证：<明确缺口或无>
远端更新与审查回复：<实际执行情况>
```
