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
- **2026-07-12:** After #273 / equalize / ownership companions, GitHub PR #303 mirrored GitLab primary. Trees matched (`divergence.synced: true`). MVP mirror agent shipped (`remotes:mirror*`).

## Automation: GitLab → GitHub mirror agent (MVP)

Desired state: after GitLab `main` updates, GitHub backup is content-aligned shortly thereafter without manual steps.

### Shipped MVP

| Capability | Status |
| --- | --- |
| Status evaluator | `npm run remotes:sync-status` (#270 AC1 tree-equality) |
| Mirror job | `npm run remotes:mirror` → `scripts/dual-remote-mirror-github.js` |
| Governance PR body | Auto-built; template `docs/templates/dual-remote-mirror-pr-body.md` |
| Optional auto-merge | `npm run remotes:mirror:merge` (`--merge-when-ready` + Merge readiness status) |
| launchd agent (macOS) | `npm run remotes:mirror:install` (default every **15 minutes**) |
| Observability | `observability/dual-remote/last-sync.json` |
| Fail-closed equalize | Exit **2** when GitLab is behind GitHub content (no force-overwrite) |

### Operator commands

```bash
# Status only
npm run remotes:sync-status

# Dry-run mirror plan (no push/PR)
npm run remotes:mirror:dry

# Push mirror branch + open/update PR when GitHub is behind
npm run remotes:mirror

# Same, then merge if checks are already green
npm run remotes:mirror:merge

# Install / inspect / remove always-on agent (macOS launchd)
npm run remotes:mirror:install          # every 15m; logs ~/Library/Logs/engineering-team-dual-remote/
npm run remotes:mirror:status
npm run remotes:mirror:uninstall

# Custom interval (seconds)
node scripts/dual-remote-mirror-agent.js install --interval-sec 600
```

### Exit codes

| Code | Meaning |
| --- | --- |
| **0** | Content-synced (noop) or post-merge synced |
| **2** | Primary (GitLab) behind backup content — **equalize GitLab first** |
| **3** | Backup (GitHub) behind primary — mirror path taken / PR open until merged |
| **1** | Error or both sides diverged in content |

### Behavior

1. `git fetch origin` + `git fetch github` (unless `--no-fetch`)
2. If `divergence.synced` → write status, exit **0**
3. If `primaryBehindBackup` → **do not** push; write status, exit **2**
4. If both sides have unique content → exit **1** with equalize remediation
5. If `backupBehindPrimary`:
   - `git push --force-with-lease github origin/main:refs/heads/sync/github-mirror-gitlab`
   - Open/update PR with governance checklist body (evidence paths from the real diff)
   - With `--merge-when-ready`: if checks complete green, emit **Merge readiness** commit status and `gh pr merge --merge`
6. Always write `observability/dual-remote/last-sync.json`

### Secrets

- **GitHub**: `gh` auth (or `GH_TOKEN` / `GITHUB_TOKEN`) with PR create/edit/merge + commit status rights
- **GitLab**: SSH `origin` fetch is enough for the poller; do **not** use read-only MCP PAT for GitHub merges
- launchd inherits user `PATH` / `HOME` so `gh` and `git` from Homebrew work when installed for that user

### Cron alternative (non-macOS)

```bash
*/15 * * * * cd /path/to/engineering-team && npm run remotes:mirror:merge >>/var/log/dual-remote-mirror.log 2>&1
```

### Follow-ups (not MVP)

1. GitLab **Push Hook** on `refs/heads/main` for near-real-time runs (instead of 15m poll)
2. Auto-open GitLab equalize MR when exit **2** (primary behind)
3. GitHub Action `schedule` defense-in-depth if the host agent is down
4. Alerting when `last-sync.json` is stale or exit ≠ 0 for > N minutes

### Non-goals (MVP)

- Rewriting GitHub history / force-push to protected `main`
- Making GitHub primary
- Skipping required GitHub checks

## E2E automation (definition of done)

The mirror agent is **end-to-end** when a GitLab-ahead tip becomes `divergence.synced: true` with **no human steps**:

1. Detect backup behind primary  
2. Preflight (maintainability + ownership lint)  
3. Push `sync/github-mirror-gitlab` (single-flight; skip thrash if CI running and head not stale)  
4. Open/update PR with governance body (evidence paths ⊆ live diff only)  
5. **Wait** for required checks (metadata, Repo validation, Browser validation, verify)  
6. Post **Merge readiness** on final head  
7. Merge (admin fallback if `BEHIND` from forge-local merge SHAs only)  
8. Next poll → `noop_synced` / `mirror_merged_synced`

### Required GitHub contexts

- Pull request metadata  
- Repo validation  
- Browser validation  
- verify  
- Merge readiness  

### Durable install (recommended)

```bash
# Stable clone (not a disposable worktree)
git clone ssh://git@192.168.1.116:2424/wiinc1/engineering-team.git ~/src/engineering-team
cd ~/src/engineering-team
git remote add github https://github.com/wiinc1/engineering-team.git   # if missing
git fetch origin github
gh auth status   # must work non-interactively for launchd user
npm run remotes:mirror:install
# or: node scripts/dual-remote-mirror-agent.js install --root "$HOME/src/engineering-team"

npm run remotes:mirror:status
```

Auth: `gh` login or `GH_TOKEN`/`GITHUB_TOKEN` with PR create/edit/merge + commit statuses.  
Token scopes: `repo` (or fine-grained: contents, PRs, commit statuses). Rotate via operator secrets store.

### E2E drill

```bash
# Dry-run decision matrix
npm run remotes:mirror:dry

# Full agent cycle with wait+merge (can take ≤25m while CI runs)
npm run remotes:mirror:merge

# Expect last-sync action mirror_merged_synced or noop_synced
cat observability/dual-remote/last-sync.json
npm run remotes:sync-status   # divergence.synced true
```

### Single-flight + locks

- Lock file: `observability/dual-remote/mirror.lock`  
- Skip force-push while an open mirror PR has CI in progress **unless** head is stale vs `origin/main`  
- Overlapping launchd ticks exit with `lock_busy`

### Follow-ups (optional)

- GitLab Push Hook on `main` for near-real-time runs  
- Auto-open GitLab equalize MR on exit 2 (notify only; no auto-merge to primary)  
- GitHub Actions schedule backup watcher if host agent is down  
- Alerting when exit ≠ 0 or last-sync older than 2× interval  
