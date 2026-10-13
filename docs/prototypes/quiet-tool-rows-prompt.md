请为 Paseo 的聊天插件 Better Paseo 重新设计「工具调用行」的视觉层级，产出一份可直接查看、可精确移植的静态 HTML/CSS 设计稿。项目名称设为「Better Paseo · 弱化工具调用行」。

背景：这是一个 coding agent 的聊天时间线。助手的正文（15px 无衬线、行高 22、正文色）和成串的工具调用行交替出现。附件 current-chat-red-boxes.png 是用户真实截图，红框里就是工具调用行；current-rows-light.png / current-rows-dark.png 是插件现有的全部行样式。用户的反馈是：红框里的输出太抢眼，干扰正文阅读，希望弱化它们、用更淡的颜色，让正文成为主角。

现状规格（请在此基础上改，不要推翻交互）：
- 每次调用一行，无边框无底色。高 26px（触屏 28px），左右各外扩 8px 再内缩 8px，圆角 6px。
- 结构：[16px 图标槽：14px 线性图标] 间距 8px [动词，仅在没有目标时显示，13px/500，正文色] [目标：12px 等宽，正文色 #18181b，单行中间截断] …… [右侧 meta：12px 等宽、等宽数字，muted 色 #62626b，如 L10–80、+2 −1、✓ 1.2s、8 files 23 matches]。
- 状态：成功的 shell 行 meta 为「✓」；失败行图标和「✗ 1」为红色 danger，下方多一行 12px 等宽 muted 的错误摘要（例如 "Tool call failed"）；运行中图标槽为蓝色 accent 实心小圆点；悬停时整行铺 surface1 底色，图标换成 chevron；按下为 surface2。
- 展开后：行下方出现 surface1 底色、圆角的输出块（例如 "$ npx vitest run …" 和 "Command completed without output."）。
- 等待用户决定的提问行（Which default for tool details? 及选项卡片）需要用户操作，不应被弱化，请保持醒目。

设计目标：
1. 工具行整体退到正文之后：目标文字、图标、meta 明显比正文淡，一眼看去是一组安静的「过程记录」，正文段落更突出。但不能淡到看不清，扫读时仍能分辨命令和路径。
2. 失败要能被注意到，但不刺眼：给出比现在更克制的失败表现（例如只有图标和 ✗ 计数带色，错误摘要更淡），由你判断。
3. 运行中的行可以略强于已完成的行。悬停 / 展开 / 按下时可恢复到更高对比度，让可交互性仍然清楚。
4. 展开后的输出块也相应安静一些，但其内容是用户主动打开的，可读性优先。
5. 不改变行高、图标槽宽度、文字起始列（距正文左边 24px）、字号下限 12px，也不新增字体。

实现约束：最终在 React Native（含 Web）里实现，宿主主题是任意的，插件只能拿到这些颜色 token：surface0（页面底色）、surface1、surface2、border、foreground、foregroundMuted、accent、success、warning、danger。请把每一个新颜色写成这些 token 的推导公式（例如 foreground 的 45% 不透明度、或 foregroundMuted 与 surface0 的混合比例），同时给出浅色和深色两套参考取值。浅色参考：surface0 #ffffff、surface1 #f6f6f7、surface2 #ededef、border #e2e2e6、foreground #18181b、foregroundMuted #62626b、accent #2563eb、success #1f8a5b、danger #d92d20。深色参考：surface0 #0f0f11、surface1 #17171a、surface2 #1f1f23、border #2a2a30、foreground #f2f3f5、foregroundMuted #a3a6ad、accent #7aa2f7、success #4cb782、danger #f2555a。请给出各元素在两套主题下对背景的对比度。

交付：
- 画板 1：同一段虚构对话（正文段落 + 一串工具行 + 一个失败行 + 一个展开的 bash 输出块 + 一个运行中的行 + 再一段正文），左右并排对比「现状」和「新设计」，浅色和深色各一组。示例数据请仿照截图虚构：bsk session start --browser cb66671f --no-focus --json、git fetch → origin/main、bsk click @e74 --session qxiu、cp "$HOME/Downloads/…/prototype.html" …、npx vitest run --config vitest.config.mts、rg -n 'box-shadow' dashboard/…/table.css 等，正文用中文。
- 画板 2：单行状态全集（默认、悬停、按下、运行中、失败带错误摘要、diff 计数、读文件行范围、搜索结果数、提问行），浅色和深色。
- 画板 3：移植规格表：每个元素的颜色公式、浅/深取值、对比度、字号字重；以及状态切换规则。
请直接给出完成度高的最终稿，不要提问，不要做页面外壳或工具栏。完成后在聊天里简短列出可移植的 token 公式。
