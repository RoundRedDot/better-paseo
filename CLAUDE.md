@AGENTS.md

## 提交身份（commit 与 PR）

推到 GitHub 的 PR 只保留 `luopeihuan@gmail.com` 这一个账号，GitHub 登录名是 `luoph`。author、committer 和 PR 参与者里不能再出现第二个账号。`luopeihuan@roundreddot.com` 会被 GitHub 算成 `lukeRRD`，PR 上就会有两个参与者。

范围包括本仓库、RoundRedDot/plugins 发往 getpaseo/plugins 的 PR，以及发往上游 getpaseo/paseo 的 PR（含已经开在 `luoph/paseo` 上的 PR）。

- author 与 committer 都是 `luke <luopeihuan@gmail.com>`。只改 author、或只用名字 `luopeihuan` 配这个邮箱，都不算完成。
- `luoph@users.noreply.github.com` 虽然也映射到 `luoph`，仍不符合本项目规定的邮箱。
- 不加 `Co-authored-by: RoundRedDot <roundreddot@gmail.com>`；其他已有的 Co-authored-by 行照常保留。身份已经正确的提交，不为了删 trailer 而改写历史。
- 规则覆盖首次提交、review 修复、merge、amend 和 rebase。`git -c` 只设置当前提交身份，不会自动替换重放提交的原 author；修正时必须同时重置 author。

paseo 仓库和它的 worktree 默认身份是 `luopeihuan <luopeihuan@roundreddot.com>`。不要改 `~/.gitconfig` 或仓库里的 `user.email`。环境变量和当前 shell 的 git 配置都不可靠，每次提交都显式指定：

```bash
git -c user.name=luke -c user.email=luopeihuan@gmail.com commit
```

创建 PR 前用 `gh api user --jq .login` 确认当前登录名是 `luoph`；fork 的组织名不代表 PR 创建者身份。

告诉用户 PR 已提交之前，先看 `gh pr view <n> --repo <owner>/<repo> --json headRefOid,commits`，再查 `gh api repos/<owner>/<repo>/pulls/<n>/commits`。每一条的 `commit.author`、`commit.committer` 姓名和邮箱都必须是 `luke <luopeihuan@gmail.com>`，`author.login`、`committer.login` 都必须是 `luoph`。GraphQL 的 `authors` 列表不能代替 committer 验证。出现错误身份时，按下面的步骤修正原分支；不要另开一个 PR，也不要在修正前报告完成。

发往 getpaseo/paseo 的 PR 一律从 RoundRedDot/paseo 开。本地 checkout 是 `/Users/luopeihuan/workspace/rrd/paseo`，推送 remote 是 `fork`。先 rebase 到 `origin/main`，再推送并创建 PR：

```bash
git push -u fork HEAD
gh pr create --repo getpaseo/paseo --head RoundRedDot:<branch>
```

已经开在 luoph/paseo 上的 PR 留在原仓库。GitHub 的「Update branch」生成的 merge commit 署点击者的账号，换个账号点就多出一个参与者。

### 修正已推送的提交

1. 先确认历史重写和推送已获授权，记录 PR 所属 fork、原分支和精确 head SHA，并用 `refs/pr-author-backup/<date>/<pr>` 备份。独立 detached worktree 放在所属主仓库的 `.worktrees/` 下，按主仓库 projectId 注册 local Paseo workspace；不切换或重置其他会话的 worktree。记下原 tree：`git rev-parse HEAD^{tree}`。
2. 用上面的身份把 PR 自己的提交重放到 `git merge-base <old-head> origin/main` 上，同时重置 author 和 committer；rebase 拍平 merge commit。纯署名修正不更新代码基线，不改源码，不顺带清理其他贡献者的署名。
3. 新旧 tree 必须完全一致，不一致就停下排查，不要推送。
4. 推回 PR 所在的 fork。新 PR 用 RoundRedDot/paseo（remote `fork`）；已经开在 luoph/paseo 上的用 `luoph-fork`。命令是 `git push --force-with-lease="refs/heads/${ref}:${old}" <remote> "${new}:refs/heads/${ref}"`。在 zsh 里变量要加花括号，`$new:refs` 会被当成 `:r` 修饰符。
5. 验收：按上面的 REST 字段逐条核对 author、committer；PR head 与 fork 远端分支必须等于新 SHA。GitHub 推送后可能短暂返回旧 head，先重新读取核对，不重复强推。CI 单独报告，`action_required` 不算通过。备份 refs 保留；PR 合并后按 worktree 清理规则收尾。
