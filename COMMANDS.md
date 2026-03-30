# Discord Commands — Software Factory

> All commands work in `#software-factory` or via DM to @claw_mac_ultra
> Tasks are created as files in `engineering-team/tasks/` and synced to GitHub

---

## 📋 Board Commands

### `/board`
Show current kanban board status.
```
/board
```

### `/board task TSK-XXX`
Show a specific task's full details.
```
/board task TSK-001
```

---

## ✅ Task Commands

### `/task create <title> --priority <P0|P1|P2|P3> --agent <dev|sre|qa|research|design> --description <text>`
Create a new task. Files created locally → pushed to GitHub.
```
/task create "Implement auth service" --priority P1 --agent dev --description "JWT-based auth with refresh tokens"
```

**What happens:**
1. Task file `tasks/TSK-XXX-title.md` created in workspace
2. Added to BOARD.md
3. Git commit + push to `engineering-team` repo
4. Discord confirmation with task ID and link

---

### `/task move <TSK-XXX> <BACKLOG|TODO|IN_PROGRESS|VERIFY|DONE|REOPEN> [--note <text>]`
Move a task to a new state.
```
/task move TSK-001 IN_PROGRESS
/task move TSK-001 VERIFY --note "All deliverables complete, sending to SRE"
/task move TSK-001 REOPEN --note "Latency spike detected in logs, returning to TODO"
```

**What happens:**
- Task file updated with status change
- Status history row appended
- If VERIFY → notification to SRE agent
- If REOPEN → findings field activated
- Git commit + push

---

### `/task assign <TSK-XXX> <agent>`
Assign or reassign an agent to a task.
```
/task assign TSK-001 dev
```

---

### `/task comment <TSK-XXX> <text>`
Add a comment to a task.
```
/task comment TSK-001 "Auth service deployed to staging, smoke tests green"
```

---

### `/task list [--status <status>] [--priority <P0|P1|P2|P3>]`
List tasks, optionally filtered.
```
/task list
/task list --status IN_PROGRESS
/task list --priority P1
```

---

## 🔄 Sprint Commands

### `/sprint start <name>`
Start a named sprint. Creates SESSION.md snapshot.
```
/sprint start "Sprint 1 — Auth Foundation"
```

### `/sprint log <note>`
Append to the sprint log.
```
/sprint log "TSK-001 moved to VERIFY — auth service awaiting SRE review"
```

### `/sprint end`
Close current sprint, archive to `sessions/`, snapshot BOARD.md.

---

## 📊 Meta Commands

### `/factory stats`
Show aggregate stats: open tasks by priority, avg cycle time, SRE reopen rate.

### `/factory sync`
Force a git sync between workspace and GitHub repo.

### `/factory help`
Show this command reference.

---

## ⚠️ SRE Special Commands

### `/sre findings <TSK-XXX>`
Add findings to a task in VERIFY (auto-switches to REOPEN).
```
/sre findings TSK-001 --finding "Error rate elevated: 2.1% vs 0.1% baseline" --action "dev needs to patch connection pool"
```

### `/sre approve <TSK-XXX>`
SRE approves task — moves directly to DONE.
```
/sre approve TSK-001
```

---

## 🔑 Priority Reference

| Priority | Meaning | SLA |
|----------|---------|-----|
| P0 | Critical / outage | Immediate |
| P1 | High / broken feature | 24h |
| P2 | Medium / degraded | 72h |
| P3 | Low / nice to have | backlog |

---

_Last updated: 2026-03-30_
