# 插件做不到的事

[English](limitations.md) | **简体中文**

[← 返回 README](../README-zh.md)

<a id="插件做不到的事"></a>

Better Paseo 只能画 Paseo 插件 SDK 允许插件画的东西。下面列出你可能期待、但在已发布的 Paseo 上做不到或只能绕开 SDK 做到的功能（2026-10-23 对照 `@getpaseo/plugin` 0.12.0 和 0.13.0-beta.1 核实），插件现在的替代做法，以及各自在等待的上游改动。上游状态也截至同一天。

## 时间线相关

| 做不到 | 现在的做法 | 等待 |
| --- | --- | --- |
| 点文件时在 Paseo 的文件面板中打开。插件拿不到跳转到文件的导航；0.13 允许插件添加文件查看器，但仍不能打开文件。 | 桌面上用默认应用打开，或在访达、资源管理器中显示；触控设备上复制路径（见[打开文件](../README-zh.md#打开文件)）。 | [getpaseo/paseo#7318](https://github.com/getpaseo/paseo/pull/7318)，未合并 |
| 显示粘贴在提问里的图片。Paseo 交给插件的条目里没有这些图片。 | 「增强提问气泡」默认关闭，提问和图片由 Paseo 绘制；打开后，带有插件画不了的附件的提问仍交给 Paseo。 | [#6736](https://github.com/getpaseo/paseo/pull/6736)，草稿，未合并 |
| 在插件的提问气泡上提供 Paseo 的回退菜单，在插件的回复信息栏上提供 Fork 操作。插件只能整行替换，借不到宿主的菜单。 | 需要回退时关闭「增强提问气泡」，需要 Fork 时关闭「回复使用插件 Markdown」。 | [#6677](https://github.com/getpaseo/paseo/pull/6677)（回退）、[#7462](https://github.com/getpaseo/paseo/pull/7462)（Fork），未合并 |
| 让 Paseo 的 Ctrl/Cmd+F 定位到插件画的行。 | 插件自己的查找栏，搜索已加载的消息（见[查找文字](../README-zh.md#查找文字)）。 | 尚无上游提案 |
| 让插件行与原生工具行间距一致。Paseo 在每个插件行下方留 16pt 间距。 | 「紧凑行距」和「紧凑回复间距」在安全的地方把大部分间距收回。 | [#6602](https://github.com/getpaseo/paseo/pull/6602)，未合并 |
| 实时跟随 Paseo 外观设置里的字体修改。Paseo 不向插件提供字体设置。 | 网页和桌面读取 Paseo 保存在这台电脑上的字体；iOS 和 Android 上「跟随 Paseo」即系统等宽字体、12px。 | 尚未向上游提交 |
| 在 iOS 和 Android 上为表格选区提供「添加到对话」。插件无法向 Paseo 的输入框写入文字。 | 「复制选中」。网页上插件自己把文字插入输入框。 | 尚未向上游提交 |
| 滚动时把当前提问或展开卡片的标题固定在顶部。 | 插件一侧已经接好，Paseo 提供后自动启用。 | 尚未向上游提交 |
| 把多个调用合并成「Read 12 files」一行。Paseo 的工具调用显示设为「摘要」时会把连续调用折在一起，但不收插件行。 | 每个调用仍占一行。 | [讨论 #7687](https://github.com/getpaseo/paseo/discussions/7687)，未关闭 |
| 快速滚动 5,000 行的代码块（开发版模拟器上打开约需 30 秒）。 | 长输出折叠到 12 行并分批绘制。 | 宿主没有对应 API |
| 显示插件安装之前那些轮次的 token 数字。Paseo 只在实时事件里带用量。 | 插件的服务端从运行起记录每一轮的开始、结束、错误和用量，此后的轮次在任何客户端上都有数字。 | [#7000](https://github.com/getpaseo/paseo/pull/7000)（轮次时间），未合并 |
| 在 iOS 和 Android 上，详情面板打开时仍能操作后面的时间线。插件在这两个平台上的浮层只能是全屏模态层。 | 浮动面板和侧边面板点外面即关闭；网页上它们不是模态的。 | 尚无上游提案 |

## Tasks 看板相关

看板上有几项功能目前没有插件 API。它们在已发布的 Paseo 0.12 上能用，是因为插件服务端绕开了 SDK：在 daemon 那台机器上调用 Paseo 的 CLI，或者借 Paseo 安装的客户端模块自己连接 daemon。这些都是过渡办法，Paseo 提供官方 API 后就改用官方 API。

| 功能 | 现在怎么做 | 等待 |
| --- | --- | --- |
| 标签颜色和项目图标 | 插件服务端向 daemon 读取标签定义和项目图标（`tasks.labels`、`tasks.project-icons`）。看板先问插件 API，所以在提供了这两个 API 的 Paseo 上会自动改用官方调用。两边都没有结果时，标签按名称取一个颜色，项目显示生成的首字母图标。 | [#7482](https://github.com/getpaseo/paseo/pull/7482)，未合并（[讨论 #7481](https://github.com/getpaseo/paseo/discussions/7481)） |
| 停止 | 调用 `paseo agent stop`；找不到 CLI 时隐藏。 | 尚无上游提案 |
| 取消归档 | 调用 `paseo agent reload`；找不到 CLI 时隐藏。 | 尚无上游提案 |
| 标为已读 | 通过服务端自己的 daemon 连接清除这个 agent 的提醒；连不上时隐藏。 | [#7647](https://github.com/getpaseo/paseo/pull/7647)（CLI 命令），未合并 |
| 服务商子 agent 的卡片 | 服务端向 daemon 读取会话里的子 agent 并跟随更新；没有这条连接时看板上不显示。 | 尚无上游提案 |

归档不需要绕：它用的就是插件 API。

| 做不到 | 现在的做法 | 等待 |
| --- | --- | --- |
| 打开已归档任务的 tab。插件打开的 tab 无法固定，Paseo 会丢掉已归档 agent 的 tab，改为显示同一 workspace 的另一个 tab。 | 已归档任务在原来「打开」的位置显示「取消归档」；取消归档后就能打开。因 workspace 归档而列入的任务仍显示「打开」。 | [#6382](https://github.com/getpaseo/paseo/pull/6382)，草稿，未合并 |

## 全局

| 做不到 | 现在的做法 | 等待 |
| --- | --- | --- |
| 手机断开连接时保留插件界面。连接一断，Paseo 会移除所有插件，重连后再把它们的客户端包全部重发一遍，所以打开着的看板会显示「This plugin surface is unavailable.」，直到重新连上。 | 看板回来时保留原来的卡片、所在列和过滤条件；客户端包经过压缩，看板按需加载，插件清单从 1,977 KB 降到 722 KB（改动合入时在 Paseo 0.12 daemon 上测得）。 | [#7088](https://github.com/getpaseo/paseo/issues/7088)（issue）、[#6731](https://github.com/getpaseo/paseo/pull/6731)、[#6732](https://github.com/getpaseo/paseo/pull/6732)，未合并 |
| 按设备分别保存设置。插件设置只能是整台主机共用的。 | 同一 daemon 的所有客户端共用一份设置，抽屉的双指字号也一样。 | 尚无上游提案 |

开发过程中遇到的 SDK 限制、证据和对应的绕行方式见面向开发者的 [`docs/plugin-sdk-limitations.md`](plugin-sdk-limitations.md)（英文）。

<a id="插件绕开的-paseo-问题"></a>

## 插件绕开的 Paseo 问题

| 问题 | 插件的处理 | 修复 |
| --- | --- | --- |
| 前一轮的后台子 agent 让 Paseo 0.12 把后面的工具调用画两遍。 | 隐藏重复的行和它们留下的间距。 | [#7541](https://github.com/getpaseo/paseo/issues/7541) / [#7543](https://github.com/getpaseo/paseo/pull/7543)，未合并 |
| Claude 一轮碰到会话额度（或密钥无效）时按正常回复结束，agent 看起来已经完成。 | Tasks 看板把它放进待查看，标为失败并显示错误。 | [#7636](https://github.com/getpaseo/paseo/issues/7636) / [#7637](https://github.com/getpaseo/paseo/pull/7637)，未合并 |
| Grok 和 Cursor 的历史重新加载后没有逐条时间。 | 对这两个服务商隐藏不足 1 秒的耗时；实时运行的轮次照常显示。 | 服务商一侧 |

<a id="兼容性"></a>

## 兼容性

Better Paseo 需要 Paseo 0.14.0 或更新版本。任务看板使用该版本的后台 workspace 查询 API，在隐藏的子任务仍运行时保持父任务为运行中。
性能测量基于 Paseo 0.13.0，尚未在 0.14.0 上重新测量（详见 [性能测试报告](performance-zh.md)）。
