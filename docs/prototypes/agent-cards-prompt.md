请为 Paseo 的聊天插件 Better Paseo 重新设计「Agent 相关卡片」的排版，产出一份可直接查看、可精确移植的静态 HTML/CSS 设计稿。项目名称设为「Better Paseo · Agent 卡片」。

背景：这是一个 coding agent 的聊天时间线。主 agent 会调用工具去创建子 agent、给它发提示、查询状态、列出 agent、处理权限请求，子 agent 结束时宿主会把一条「Agent finished / errored / needs permission / closed」通知塞进时间线。这些卡片都画成「工具调用行」：折叠时一行，点开后行下方出现一个 surface1 底色、圆角 6px 的内容块；桌面端悬停一行会弹出浮动预览面板（顶栏 + 正文）。

附件：
- user-screenshot-old-agent-finished.png：用户截图，旧版「Agent finished」卡片，正文是没渲染的 Markdown，还露出 </agent-response> 标签，标题栏吸顶后和正文挤在一起。
- current-agent-rows-light/dark.png：现在所有 agent 卡片折叠时的行。
- current-agent-opened-light.png：每种卡片点开后的样子（灰色小字是卡片类型标注，不属于设计）。
- current-agent-hover-previews-light.png：悬停预览面板。

我看到的现状问题（请全部解决，也欢迎你指出更多）：
1. 折叠行信息不全：send_agent_prompt、get_agent_status、cancel_agent、kill_agent 的行只显示 36 位 UUID，看不出做了什么、对哪个 agent；Agent finished/errored/needs permission/closed 和收到消息的行只有标题，状态只靠图标颜色区分；list_agents 一类显示「paseo / list_agents」。等宽和无衬线字体混用。右侧 meta 是「Result received」「Request acknowledged」「Not applied」这种空话。
2. 点开后层级重复：行上已经有标题，内容块里又放一个 20px 粗体大标题再说一遍；悬停预览顶栏写「paseo / create_agent」，正文又是大标题。
3. Agent ID（UUID）在每张卡片里都占一整个元素，加粗、带复制图标，比真正有用的信息还抢眼。
4. 元数据排版不统一：create_agent 是「图标 + 文字」一行（模型、思考强度、权限模式），get_agent_status 是「Provider: codex」这样的纯文本行，list_agents 里每个 agent 又嵌套一个带 H2 标题的子卡片，过重。
5. 子 agent 的长回复（Agent finished 正文，常有几十行 Markdown）在内容块里没有和元信息分开，也没有长度控制。
6. IRC/Agent 消息（Message from reviewer）是另一套 SystemCard 样式，和其它 agent 卡片不一致。

需要覆盖的卡片（数据都在截图里，可照抄或虚构类似数据，正文可中英混排）：
A. create_agent：标题、provider 标志 + 模型名、思考强度、权限模式、新 agent 的 ID、初始提示词（Markdown）。状态：运行中、已创建、创建失败。
B. send_agent_prompt：目标 agent 的标题与 ID、投递状态（发送中/已发送/失败/未确认）、处置（Turn started / Steered / Delivered out of band）、对方当前状态、提示词（Markdown）、guidance 一句话。
C. Agent 通知：finished / errored / needs permission / closed / canceled / 收到普通消息。发送者标题与 ID、状态、正文（Markdown，可能很长，可能带 [truncated N chars] 尾注）。needs permission 需要用户注意，不能被弱化。
D. 只读查询：get_agent_status（provider、model、目录、mode、状态）、get_agent_activity（更新数 + Markdown 活动记录）、list_agents（多个 agent：标题、provider、状态、目录、ID）、list_pending_permissions（请求标题、描述、所属 agent、请求 ID）。
E. 动作：cancel_agent、kill_agent、archive_agent、update_agent、set_agent_mode、respond_to_permission，结果为成功 / 未生效 / 失败。
F. Provider 原生子任务（Claude 的 Task 工具）：子 agent 类型、描述、提示词、动作列表（工具名 + 摘要）、日志。
G. IRC 消息：Message from <agent>。

现状规格（行的尺寸与列请保持）：
- 行：高 26px（触屏 28px），无边框无底色；[16px 图标槽：14px 线性图标（lucide）] 间距 8px [动词 13px/500] [目标：12px，单行截断] …… [右侧 meta：12px，muted]。悬停整行铺 surface1，图标换成 chevron。运行中图标槽是 accent 色实心小圆点。失败图标和 meta 用 danger。
- 展开块：surface1 底色、圆角 6px、内边距 8px 12px；Markdown 正文 14px/20 无衬线。
- 悬停预览面板：宽约 640px，圆角 10px，1px border，顶栏 36px（左：换行开关、原文/渲染切换；中：图标 + 标题；右：复制按钮），正文可滚动，最高约 60vh。
- 字体：UI 用系统无衬线；代码与 ID 用等宽。字号下限 11px，不新增字体。

设计目标：
1. 折叠行一眼读出「做了什么 + 对哪个 agent + 结果」：动词（Created / Sent prompt / Finished / Needs permission / Status / Canceled …）+ agent 标题（不要 UUID）+ 简短结果。七类卡片使用同一套行语法。
2. 点开后不要重复行上已有的标题。给出统一的「agent 身份条」：agent 标题、provider 标志、状态点/标签，ID 退到次要位置（短 ID 或悬停才显示，仍可一键复制）。
3. 元数据统一成一种排法（例如图标 + 文字的 chip 行，或两列 key/value 小表），在 create_agent、status、list、permission 之间一致。list_agents 的多个 agent 用紧凑列表，不要嵌套大标题卡片。
4. 正文（提示词、子 agent 回复、活动记录）是主角，和元信息之间有清楚的分隔；长正文给出折叠/渐隐 + 「展开全部」的处理，并说明阈值。
5. needs permission 和 errored 要醒目但克制；其它完成态安静，和普通工具行一样退到正文之后。
6. 悬停预览顶栏用人话（例如「Finished · tasks B: cards and status icons」），不要「paseo / create_agent」。
7. 窄屏（380px 宽，手机）下同样成立：身份条和元数据可以换行，ID 不撑满整行。

实现约束：最终在 React Native（含 Web）里实现，宿主主题任意，插件只能拿到这些颜色 token：surface0（页面底色）、surface1、surface2、border、foreground、foregroundMuted、accent、success、warning、danger。新颜色请写成 token 推导公式（例如 foreground 的 60% 不透明度），并给出浅/深两套参考值。浅色：surface0 #ffffff、surface1 #f6f6f7、surface2 #ededef、border #e2e2e6、foreground #18181b、foregroundMuted #62626b、accent #2563eb、success #1f8a5b、warning #a36a00、danger #d92d20。深色：surface0 #0f0f11、surface1 #17171a、surface2 #1f1f23、border #2a2a30、foreground #f2f3f5、foregroundMuted #a3a6ad、accent #7aa2f7、success #4cb782、warning #e0a84a、danger #f2555a。不要阴影以外的装饰（不要渐变底、不要彩色整块底色），图标只用 lucide。

交付：
- 画板 1：一段虚构对话（中文正文段落 + 一串 agent 行 + 一个展开的 Agent finished + 一个 needs permission + 再一段正文），左右并排对比「现状」和「新设计」，浅色和深色各一组。
- 画板 2：七类卡片 A–G 的新设计全集：折叠行 + 展开态，桌面 720px 宽，浅色和深色。
- 画板 3：悬停预览面板（create_agent、Agent finished 长正文、list_agents），浅色。
- 画板 4：窄屏 380px 下的 A、B、C、D（浅色）。
- 画板 5：移植规格表：行语法（每种工具的动词/目标/meta 文案表）、身份条和元数据的尺寸/间距/字号字重、颜色公式与浅深取值、长正文折叠阈值、状态切换规则。
请直接给出完成度高的最终稿，不要提问，不要做页面外壳或工具栏。完成后在聊天里简短列出关键规格。
