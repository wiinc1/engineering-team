# Dual-remote mirror PR body template

Used by `scripts/dual-remote-mirror-github.js` (`buildMirrorPrBody`).  
`npm run pr:check` requires the checklist fields as `- Label: value` lines.

```markdown
## Summary
Mirror GitLab primary `main` to GitHub backup (dual-remote MVP agent).

## Linked Task
GitLab dual-remote policy #270; automated GitLab→GitHub mirror agent

## Test plan
- [x] `npm run remotes:sync-status` (pre-mirror: backup behind or trees differ)
- [x] Mirror agent pushed `sync/github-mirror-gitlab` from `origin/main`
- [x] After merge: `npm run remotes:sync-status` → `divergence.synced: true`

## Governance checklist
- Task: Dual-remote mirror of GitLab primary main to GitHub backup
- Standards baseline reviewed: yes
- Checklist completed or updated: yes
- Compliance checklist path: docs/runbooks/dual-remote-gitlab-primary.md
- Relevant standards areas: team and process; deployment and release
- Standards gaps or exceptions: none remaining for dual-remote tip content sync under #270 AC1
- Standards check result: passed for dual-remote unit suite and mirror agent dry logic
- Lint result: ownership map includes dual-remote mirror scripts
- Tests: dual-remote-sync-status and dual-remote-mirror-core unit suites
- Test evidence paths: <auto-selected from diff; fallback tests/unit/dual-remote-sync-status.test.js>
- Docs updated: yes
- Doc evidence paths: <auto-selected from diff; fallback docs/runbooks/dual-remote-gitlab-primary.md>
- Risk level: low
- Rollback path: revert the GitHub merge commit on main if backup mirror is unwanted

## Dual-remote
Policy: `docs/runbooks/dual-remote-gitlab-primary.md`
Verify after merge: `npm run remotes:sync-status` → `divergence.synced: true`
```

Manual operators can copy this block and fill evidence paths from `git diff --name-only github/main...origin/main`.
