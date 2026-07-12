# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.

## Related

- [Agent workspace](/concepts/agent-workspace)


## Dual remotes (this engineering-team worktree)

| Role | Remote name | URL |
| --- | --- | --- |
| **Primary** | `origin` | `ssh://git@192.168.1.116:2424/wiinc1/engineering-team.git` (GitLab) |
| **Backup** | `github` | `https://github.com/wiinc1/engineering-team.git` |

- Prefer basing branches on **`origin/main`** when it is current.
- Push **`origin` first**, then **`github`**.
- Status: `npm run remotes:sync-status`
- Mirror agent (GitLab → GitHub): `npm run remotes:mirror` / `remotes:mirror:dry` / `remotes:mirror:merge`
- Always-on (macOS): `npm run remotes:mirror:install` · `remotes:mirror:status` · `remotes:mirror:uninstall`
- Runbook: `docs/runbooks/dual-remote-gitlab-primary.md`
