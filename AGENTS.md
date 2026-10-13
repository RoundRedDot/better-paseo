# AGENTS.md

## 提交信息语言

本仓库的 commit message 一律用英文，标题和正文都是，沿用 Conventional Commits 前缀（`feat:`、`fix:`、`docs(readme):` 等）。这条规则优先于全局或 skill 里要求中文提交信息的约定；已有的中文提交保持原样，不为此改写历史。

## 提交身份（commit 与 PR）

推到 GitHub 的提交一律用 luoph 账号身份，并把 RoundRedDot 署为公共共同作者。范围包括本仓库，以及从 RoundRedDot/paseo、luoph/paseo 发往上游 getpaseo/paseo 的 PR。

- author 与 committer：`luopeihuan <1686898+luoph@users.noreply.github.com>`
- 每个提交信息末尾加 trailer：`Co-authored-by: RoundRedDot <roundreddot@gmail.com>`，原有的 Co-authored-by 行保留

paseo 仓库的 git 配置默认是 `luopeihuan@roundreddot.com`，GitHub 会把它归到另一个账号（lukeRRD），PR 上就出现两个参与者。在那里提交要显式指定身份：

```bash
git -c user.name=luopeihuan -c user.email=1686898+luoph@users.noreply.github.com \
  commit --trailer "Co-authored-by: RoundRedDot <roundreddot@gmail.com>"
```

同步上游时，在本地 rebase 到 `origin/main` 再推送。GitHub 的「Update branch」生成的 merge commit 署点击者的账号、不带 RoundRedDot trailer，换个账号点就多出一个参与者。

### 修正已推送的提交

1. 在独立的 detached worktree 里检出 PR head，记下原 tree：`git rev-parse HEAD^{tree}`。
2. 用上面的身份把 PR 自己的提交重放到 `git merge-base HEAD origin/main` 上：`rebase --exec 'git commit --amend --no-edit --reset-author --no-verify --trailer "Co-authored-by: RoundRedDot <roundreddot@gmail.com>"'`。rebase 会把 merge commit 拍平。
3. 新旧 tree 必须完全一致，不一致就停下排查，不要推送。
4. 推送：`git push --force-with-lease="refs/heads/${ref}:${old}" "$remote" "${new}:refs/heads/${ref}"`。在 zsh 里变量要加花括号，`$new:refs` 会被当成 `:r` 修饰符。
5. 验收：`gh api repos/getpaseo/paseo/pulls/<n>/commits` 里 author 和 committer 的 login 都是 `luoph`，PR 页面显示 1 participant。
