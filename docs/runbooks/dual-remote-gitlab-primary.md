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

Helper:

```bash
npm run remotes:sync-status
# or
node scripts/dual-remote-sync-status.js
```

## Recover when GitHub is ahead of GitLab

If work landed on GitHub first (emergency CI path):

1. Point a branch at `github/main` and push to GitLab:
   ```bash
   git fetch github
   git push origin github/main:refs/heads/sync/gitlab-primary-main
   ```
2. Open a GitLab MR: `sync/gitlab-primary-main` → `main` and **merge on GitLab** (primary).
3. Re-fetch; `origin/main` should contain the same commits as `github/main` (modulo merge commit).

## Auth notes

- SSH as `wiinc1` can push **non-protected** branches to GitLab.
- Protected `main` requires a user/private token with **merge** rights (project bot / `gitlab-ci-token` is not enough for merge API).
- GitHub uses `gh` auth for PR CI and merge; branch protection still requires required checks + `Merge readiness` status.

## Related

- Branch protection (GitHub backup CI): `.github/BRANCH_PROTECTION.md`
- Local remote cheat sheet: `TOOLS.md`
