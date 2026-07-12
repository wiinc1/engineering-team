# Dual-remote operations — GitLab primary, GitHub backup

## Policy

| Role | Remote | URL | Default git remote |
| --- | --- | --- | --- |
| **Primary** | GitLab | `ssh://git@192.168.1.116:2424/wiinc1/engineering-team.git` | `origin` |
| **Backup** | GitHub | `https://github.com/wiinc1/engineering-team.git` | `github` |

Rules:

1. **Canonical `main` is GitLab `origin/main`.** Ship through GitLab MRs into protected `main` first whenever possible.
2. **GitHub is the public/CI backup.** After GitLab lands (or in parallel when dual-open is required), mirror the same branch tip to `github` and open/merge the GitHub PR so Actions and public history stay current.
3. **Never treat GitHub-only green as the end of the ship** while `origin/main` lags.
4. **Push order for feature branches:** `git push origin <branch>` first, then `git push github <branch>`.
5. **Fetch both before planning merges:** `git fetch origin && git fetch github`.

## Operator ship checklist

```bash
# 1. Branch work
git fetch origin github
git checkout -b feat/… origin/main   # prefer GitLab main as base when it is current

# 2. Push primary then backup
git push -u origin HEAD
git push -u github HEAD

# 3. Open GitLab MR (primary) → merge when approved
# 4. Open GitHub PR (backup) from the same tip → merge when CI + Merge readiness green

# 5. Confirm tips
git fetch origin github
git log -1 --oneline origin/main
git log -1 --oneline github/main
# Content should match; merge commit SHAs may differ across forges.
```

Helper (GitLab **#270** bar):

```bash
npm run remotes:sync-status
# or
node scripts/dual-remote-sync-status.js
```

`divergence.synced` is **true** when:

1. zero unique commits on either side (`commitSynced`), **or**
2. main tip **trees are identical** even if forge-local merge SHAs differ (`shaOnlyDivergence` / #270 AC1).

Exit codes: `0` synced · `2` primary behind backup (content) · `3` backup behind primary (content) · `1` other unsynced.

## Recover when GitHub is ahead of GitLab

If work landed on GitHub first (emergency CI path):

1. Point a branch at `github/main` and push to GitLab:
   ```bash
   git fetch github
   git push origin github/main:refs/heads/sync/gitlab-primary-main
   ```
2. Open a GitLab MR: `sync/gitlab-primary-main` → `main` and **merge on GitLab** (primary).
3. Re-fetch; `origin/main` should contain the same commits as `github/main` (modulo merge commit).

## Recover when both sides diverged (unique commits on each)

1. From `origin/main`, merge `github/main` on a sync branch (resolve conflicts if any):
   ```bash
   git fetch origin github
   git checkout -B sync/equalize-dual-main origin/main
   git merge --no-ff github/main -m "sync: equalize dual-remote main tips"
   git push -u origin HEAD
   ```
2. Merge the GitLab MR into `main` (primary becomes content-complete).
3. Mirror primary → GitHub backup:
   ```bash
   git fetch origin
   git push github origin/main:refs/heads/sync/github-mirror-gitlab
   # open/merge GitHub PR sync/github-mirror-gitlab → main
   ```
4. Confirm: `npm run remotes:sync-status` → `divergence.synced: true` (trees equal under AC1 is enough).

## Auth notes

- SSH as `wiinc1` can push **non-protected** branches to GitLab.
- Protected `main` requires a user/private token with **merge** rights (project bot / `gitlab-ci-token` is not enough for merge API). Use a token with merge rights (see operator `.env.local` `GITLAB` / personal access token).
- GitHub uses `gh` auth for PR CI and merge; branch protection still requires required checks + `Merge readiness` status.

## Related

- Branch protection (GitHub backup CI): `.github/BRANCH_PROTECTION.md`
- Local remote cheat sheet: `TOOLS.md`
- Issue tracking: GitLab **#270** (equalize dual-remote tips)

## Last operator mirror

- **2026-07-10:** GitHub backup re-synced from GitLab primary after readiness assessment !286.
- **2026-07-11 (#270):** Equalized tips after factory-stack ships (!289/!290) left unique commits on both sides. GitLab primary merged `github/main` history, then GitHub backup mirrored `origin/main`. Confirm with `npm run remotes:sync-status` (`divergence.synced` / tree equality).

## Automation backlog (GitLab → GitHub mirror)

Today dual-remote sync is **operator-driven** (`npm run remotes:sync-status` + manual mirror PR). Desired state: after GitLab `main` updates, GitHub backup is content-aligned shortly thereafter without manual steps.

### Current state

| Capability | Status |
| --- | --- |
| Status evaluator | Shipped: `scripts/dual-remote-sync-status.js` / `npm run remotes:sync-status` (#270 AC1 tree-equality) |
| Manual equalize/mirror runbook | Shipped (this document) |
| Auto-mirror on GitLab merge | **Missing** |
| Auto-open/merge GitHub PR with green CI | **Missing** |
| Auto-emit Merge readiness status | Partial (script exists; not wired to mirror path) |

### Recommended automation design

1. **GitLab webhook or scheduled poller** (local OrbStack/GitLab or launchd) on `Push Hook` for `refs/heads/main` (or `Merge Request Hook` on merge to main).
2. **Mirror job** (script `scripts/dual-remote-mirror-github.js` or extend `dual-remote-sync-status.js`):
   - `git fetch origin github`
   - If already `divergence.synced` → no-op success
   - Else push `origin/main` → `github:sync/github-mirror-gitlab` (force-with-lease on mirror branch only)
   - Open or update GitHub PR head → `main` with **governance-complete PR body template** (required fields for `npm run pr:check`)
   - Optionally `gh pr merge --auto` once required checks + `Merge readiness` are green
3. **Secrets**: GitHub `GH_TOKEN`/`gh` auth with PR+merge rights; never use read-only GitLab MCP PAT for merges.
4. **Equalize path**: if `primaryBehindBackup` (GitHub unique content), fail closed and open/notify GitLab equalize MR instead of force-overwriting primary.
5. **Observability**: write `observability/dual-remote/last-sync.json` with tips, trees, PR URL, outcome; alert if unsynced > N minutes.
6. **CI companion**: GitHub Action on `schedule` + `workflow_dispatch` that only runs when `github/main` tree ≠ recorded GitLab tip (defense in depth if webhook missed).

### MVP slice (suggested issue)

- Script: push mirror branch + open/update PR with template body
- launchd or cron every 5–15 minutes calling the script
- Exit codes aligned with `dual-remote-sync-status.js` (0 synced, 3 backup behind, 2 primary behind, 1 error)

### Non-goals for MVP

- Rewriting GitHub history / force-push to protected `main`
- Making GitHub primary
- Skipping required GitHub checks

