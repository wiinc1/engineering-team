# Software Factory — Kanban Board

> Source of truth: `engineering-team/BOARD.md` in both workspace and GitHub repo.
> Sync: bidirectionally mirrored via git.

---

## 🎯 Sprint Active

| Task | Priority | Assignee | Status | Updated |
|------|----------|----------|--------|---------|
| — | — | — | — | — |

---

## 📋 Backlog

| Task | Priority | Age |
|------|----------|-----|
| TSK-002 — Assign AI Agent to a Task (needs re-scope; core behavior already shipped) | P1 | 8d |

---

## 🔄 Workflow States

```
BACKLOG → TODO → IN_PROGRESS → VERIFY → DONE
               ↑                    ↓
               ←────── REOPEN ←─────┘
```

**State Definitions:**
- `BACKLOG` — Triaged, waiting for prioritization
- `TODO` — Approved, ready for execution
- `IN_PROGRESS` — Agent has been dispatched
- `VERIFY` — SRE gate: logs/telemetry/metrics review
- `REOPEN` — Issues found, returned to TODO or new sub-task created
- `DONE` — SRE approved, task closed

---

## 📊 Metrics

```
Open:        1
In Progress: 0
Verify:      0
Done:        1
Reopened:    0
```

---

_Last sync: 2026-04-09_
