# Better Paseo registry pin update

Use this when asked to submit the plugin update PR. Follow it as written.
The live reads are the target SHA, the pin on registry `main`, an existing open
PR, and the changes between those two commits. Remotes, validation, commit
identity, and the pull request shape are fixed here.

This pull request changes the commit [paseo.sh/plugins](https://paseo.sh/plugins)
installs for `roundreddot/better-paseo`. Git plugins are not bumped
automatically. A commit on `RoundRedDot/better-paseo` `main` stays off the
public listing until this pull request is merged.

Updating a local daemon with `paseo plugin update better-paseo` is a different
task. It installs GitHub `main` and does not edit the registry.

## Repositories

| Role | Location |
| --- | --- |
| Plugin source | `/Users/luopeihuan/workspace/rrd/beautiful-chat`. `origin` is `git@github.com:RoundRedDot/better-paseo.git`. |
| Registry checkout | `/Users/luopeihuan/workspace/rrd/paseo-plugins`. Leave whatever branch it is on. |
| Registry upstream | `origin` is `https://github.com/getpaseo/plugins.git`. `gh` user `luoph` can read it and can open pull requests. `luoph` cannot push to it. |
| Registry push | `fork` is `https://github.com/RoundRedDot/plugins.git`. |

## Pin target

In the plugin repo, `main` must match `origin/main` and the work tree must be
clean. The target is that full 40-character SHA. A local-only commit is not a
pin target.

```bash
cd /Users/luopeihuan/workspace/rrd/beautiful-chat
git fetch origin main
git status -sb
git rev-parse HEAD
git rev-parse origin/main
```

Stop when `HEAD` and `origin/main` differ, or when the work tree is dirty.

## Registry branch

Fetch registry `main`, then read the current pin from that ref. The registry
checkout itself is often on an old branch, so read `origin/main` rather than
the working tree.

```bash
cd /Users/luopeihuan/workspace/rrd/paseo-plugins
git fetch origin main
git show origin/main:plugins/roundreddot/better-paseo.json
gh pr list --repo getpaseo/plugins --search "better-paseo" --state open --limit 20
```

Stop when `artifact.commit` is already the target SHA. When an open pull
request from `RoundRedDot:update/better-paseo-<short>` already points at that
SHA, use that pull request.

`<short>` is the first 8 characters of the target SHA. The branch name is
`update/better-paseo-<short>`.

Confirm the target contains the current pin:

```bash
cd /Users/luopeihuan/workspace/rrd/beautiful-chat
git merge-base --is-ancestor <pinned full sha> <target full sha>
```

A non-zero exit means the target does not contain the published pin. Stop and
report that.

Create the branch in a new worktree. The command below makes the branch track
`origin/main` until the fork push replaces that upstream.

```bash
cd /Users/luopeihuan/workspace/rrd/paseo-plugins
git worktree add -b update/better-paseo-<short> \
  .worktrees/better-paseo-<short> origin/main
```

## Record edit

Edit `plugins/roundreddot/better-paseo.json` in the worktree. Set both fields
to the same full target SHA:

- `artifact.commit`
- `repository.commit`

Leave the rest of the record as it is on registry `main`:

- `id`, `artifact.kind`, `artifact.remote`, `repository.url`
- `categories`, `submittedBy`
- `submittedAt`, `publishedAt`, `reviewedAt`
- `listing.media`

The plugin ships `OVERVIEW.md` at the repo root. The registry has no
`plugins/roundreddot/better-paseo.md`. Leave that absence in place.

`listing.media` points at the published asset host
(`cdn.jsdelivr.net/gh/RoundRedDot/better-paseo-assets@...`). A plugin commit
does not move those URLs. The manifest `description` and `OVERVIEW.md` are
read from the pinned tree. Say they are unchanged when
`git diff <pinned> <target> -- paseo-plugin.json OVERVIEW.md package.json`
is empty. When one of those files changed, describe the change in the pull
request body and keep the registry record fields above unless the user asked
for a listing change.

A reviewer may move `reviewedAt` later. This pull request leaves it.

The diff is two lines in one file:

```text
plugins/roundreddot/better-paseo.json | 4 ++--
```

## Commit

The registry checkout uses the global git identity
`luopeihuan <luopeihuan@roundreddot.com>`. GitHub maps that email to
`lukeRRD`. This commit overrides it. Author and committer are both
`luke <luopeihuan@gmail.com>`. There is no `Co-authored-by` trailer.

```bash
cd /Users/luopeihuan/workspace/rrd/paseo-plugins/.worktrees/better-paseo-<short>
git add -- plugins/roundreddot/better-paseo.json
git -c user.name=luke -c user.email=luopeihuan@gmail.com commit -F /tmp/better-paseo-pin-msg.txt
```

`/tmp/better-paseo-pin-msg.txt` contains one line and a trailing newline:

```text
chore: update Better Paseo plugin pin
```

Read `git log -1 --format='%an <%ae>%n%cn <%ce>%n%s'` and
`git diff HEAD~1 -- plugins/roundreddot/better-paseo.json` before pushing.
The subject, author, committer, and two-line pin diff are the whole commit.

## Validation

Run these in the worktree. On macOS, `TMPDIR` is `/private/tmp`.
`os.tmpdir()` resolves through a `/var` symlink, and the registry's
git-artifact realpath check then treats the plugin directory as outside the
repo.

`package.json` has no dependencies. Node `>=22.18` runs
`node --test "scripts/**/*.test.ts"` directly. Skip `npm ci`.

Before or after the commit:

```bash
TMPDIR=/private/tmp npm test
TMPDIR=/private/tmp node scripts/validate.ts
```

After the commit. `--changed` diffs `merge-base(origin/main, HEAD)...HEAD`
and ignores uncommitted edits:

```bash
TMPDIR=/private/tmp node scripts/validate.ts --online --changed
```

A successful run prints:

- `npm test` exits 0. On 2026-10-30 the suite was 181 tests. A larger later suite that exits 0 is a pass. Record the count this run printed.
- Offline: `<N> record(s) are well-formed`. On 2026-10-30, `N` was 431. Record the count this run printed.
- Online: `1 record(s) match their pinned artifacts`.

Any other result stops the update. Leave the branch unpushed and report the
output. Registry validation fetches and reads the pinned tree. It does not
install or execute the plugin.

## Pull request

Push to `fork`. A bare `git push` follows the `origin/main` upstream created
with the worktree and is the wrong remote.

```bash
git push -u fork HEAD:update/better-paseo-<short>
gh pr create --repo getpaseo/plugins --base main \
  --head RoundRedDot:update/better-paseo-<short> \
  --title "Update Better Paseo to <short>" \
  --body-file /tmp/better-paseo-pin-pr.md
```

`gh` opens the pull request as `luoph`. The commit identity stays
`luke <luopeihuan@gmail.com>`.

The body is English:

```text
Update `roundreddot/better-paseo` from `<old full sha>` to `<new full sha>`.

- <user-visible behavior since the old pin>
- <one bullet per change a listing reader needs>

`OVERVIEW.md`, the manifest description, package metadata, and listing media URLs are unchanged.

Validation:

- Registry tests: <count> passed.
- Offline validation: <count> records are well-formed.
- Online changed-record validation: the updated record matches its pinned artifact.

[Source changes](https://github.com/RoundRedDot/better-paseo/compare/<old full sha>...<new full sha>)
```

Write the behavior bullets from `git log <old>..<new>` and the diff in the
plugin repo. Describe what a person sees. The commit subjects are the source
list, and the bullets are the summary.

Delete `/tmp/better-paseo-pin-msg.txt` and `/tmp/better-paseo-pin-pr.md` after
the pull request exists.

Confirm with:

```bash
gh pr view <number> --repo getpaseo/plugins \
  --json url,state,baseRefName,headRefName,author,commits,files
```

Expect `state` `OPEN`, base `main`, head
`RoundRedDot:update/better-paseo-<short>`, author `luoph`, one commit with
author and committer `luke <luopeihuan@gmail.com>`, and one file,
`plugins/roundreddot/better-paseo.json`.

Report the pull request URL. Registry `main` keeps serving the previous pin
until the pull request merges. Merging is a separate request.

Keep the worktree. Leave the original registry checkout on its previous branch.

## Shape that already shipped

Pull request [#1556](https://github.com/getpaseo/plugins/pull/1556), branch
`update/better-paseo-f8e3ab95`, is the shape above. It moves the pin from
`9170ebebe77ded7dff27322762ef9c7637084878` to
`f8e3ab95ed507d66ed0faac3d43f1370d9377d71`. Read registry `origin/main` for
the pin to replace next. That example is not the next target.
