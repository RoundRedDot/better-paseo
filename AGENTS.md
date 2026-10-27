# AGENTS.md

## 提交信息语言

本仓库的 commit message 一律用英文，标题和正文都是，沿用 Conventional Commits 前缀（`feat:`、`fix:`、`docs(readme):` 等）。这条规则优先于全局或 skill 里要求中文提交信息的约定；已有的中文提交保持原样，不为此改写历史。

## Tasks 看板：daemon 的 agent 更新会乱序

「正在运行的任务被归到已完成」反复出现过多次。根因之一：daemon 推送的 `agent_update` 不保证按 `updatedAt` 递增。Paseo 0.13.2 新建带首条 prompt 的 agent 时，会在 running 之后再补发一份更旧的 idle 快照（status 订阅收到 `remove`，done 订阅收到 `upsert idle`）。Claude、Codex 随后的流式更新会把它纠正回来，cursor 这类 turn 结束前不再推送的 provider 就会一直停在已完成。

- 看板 store 收到的快照，要和该 agent 已应用过的最大 `updatedAt` 比较（`client/tasks/data/index.ts` 的 `latestUpdates`，记录删除后仍保留）。更旧的不采用，改为按 id 重读（`confirmAgent`）。不要只和当前持有的记录比较：同一批消息里的 `remove` 会先把记录删掉。
- `remove` 只表示 agent 离开了某个过滤列表，不能据此推断它的状态。
- 排查车道归错时，先用 `paseo ls` / `paseo inspect` 确认 daemon 的实际状态，再按看板的三个过滤条件（status / attention / done）录下订阅事件，看实际收到的顺序。不要只凭读代码推测。
- 改动分类或合并逻辑时，测试要覆盖乱序：用 fake 的 `pushAgentSnapshot` 发一份比已应用更旧的快照。

## 提交身份（commit 与 PR）

推到 GitHub 的提交一律用 `luke <luopeihuan@gmail.com>`。范围包括本仓库、RoundRedDot/plugins 发往 getpaseo/plugins 的 PR，以及从 RoundRedDot/paseo 发往上游 getpaseo/paseo 的 PR。

- author 与 committer：`luke <luopeihuan@gmail.com>`
- 不加 `Co-authored-by: RoundRedDot <roundreddot@gmail.com>`；其他已有的 Co-authored-by 行照常保留。已经推送的提交不为此改写历史。

paseo 仓库的 git 配置默认是 `luopeihuan@roundreddot.com`，GitHub 会把它归到另一个账号（lukeRRD），PR 上就出现两个参与者。在那里提交要显式指定身份：

```bash
git -c user.name=luke -c user.email=luopeihuan@gmail.com commit
```

发往 getpaseo/paseo 的 PR 一律从 RoundRedDot/paseo 开。本地 checkout 是 `/Users/luopeihuan/workspace/rrd/paseo`，推送 remote 是 `fork`。先 rebase 到 `origin/main`，再推送并创建 PR：

```bash
git push -u fork HEAD
gh pr create --repo getpaseo/paseo --head RoundRedDot:<branch>
```

已经开在 luoph/paseo 上的 PR 留在原仓库。GitHub 的「Update branch」生成的 merge commit 署点击者的账号，换个账号点就多出一个参与者。

### 修正已推送的提交

1. 在独立的 detached worktree 里检出 PR head，记下原 tree：`git rev-parse HEAD^{tree}`。
2. 用上面的身份把 PR 自己的提交重放到 `git merge-base HEAD origin/main` 上：`rebase --exec 'git -c user.name=luke -c user.email=luopeihuan@gmail.com commit --amend --no-edit --reset-author --no-verify'`。rebase 会把 merge commit 拍平。
3. 新旧 tree 必须完全一致，不一致就停下排查，不要推送。
4. 推送到 RoundRedDot/paseo（remote `fork`）：`git push --force-with-lease="refs/heads/${ref}:${old}" fork "${new}:refs/heads/${ref}"`。在 zsh 里变量要加花括号，`$new:refs` 会被当成 `:r` 修饰符。
5. 验收：`gh api repos/getpaseo/paseo/pulls/<n>/commits` 里每条提交的 author 与 committer 都是 `luke <luopeihuan@gmail.com>`。

## 公开代码与私有制作资料的边界

- 公开插件仓库：`RoundRedDot/better-paseo`，主目录 `/Users/luopeihuan/workspace/rrd/beautiful-chat`。只提交插件运行源码、协议与 manifest、必要构建/CI 工具、回归测试及其最小 fixture、用户使用文档和维护这些内容所需的约束。
- 私有制作仓库：`RoundRedDot/better-paseo-media`，本地目录 `/Users/luopeihuan/workspace/rrd/better-paseo-media`。视频脚本与产物、截图与录屏、视觉原型、benchmark 工具/报告/原始数据、QA 附件、临时分析与非插件交付必需的计划文档，一律在该仓库单独提交，不提交到公开插件仓库。
- 提交前按文件用途检查范围；混合任务必须拆分提交到两个仓库。不要为归档资料把私有项目设为公开，也不要在公开仓库新增制作资料或大文件备份。
- README 和 gallery 必须使用已发布的公开资源 URL；最终公开图片/视频可以作为公开仓库的 GitHub Release assets 发布，但不把二进制文件写入插件 Git 历史，也不引用需要登录私有仓库才能访问的链接。
- 单测依赖的最小 fixture 和纯测试 helper 保留在 `test/`，不让插件构建或测试依赖私有仓库。图标、字体等运行必需资源不属于制作资料，按现有架构保留。
- `benchmark`、`docs/listing-gallery-videos`、`proto/screen-header-actions` 等旧制作/原型分支仅保留本地；未经用户明确要求，不推送这些分支或旧备份 refs，不用它们更新远程 `main`，避免重新引入已清理的大文件历史。
