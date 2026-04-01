# USER STORY — Software Factory Kanban Board UI

**As a:** Software Engineering Team Lead
**I want:** A Kanban board UI that represents the full software factory task lifecycle
**So that:** I can track work from creation through SRE-verified completion

---

## 📋 Lifecycle Represented

```
BACKLOG → TODO → IN_PROGRESS → VERIFY → DONE
               ↑                    ↓
               ←────── REOPEN ←─────┘
```

**State Definitions:**
- `BACKLOG` — Triaged, waiting for prioritization
- `TODO` — Approved, ready for execution
- `IN_PROGRESS` — Agent dispatched, actively working
- `VERIFY` — SRE gate — logs/telemetry/metrics review in progress
- `REOPEN` — Issues found, returned to TODO or new sub-task created
- `DONE` — SRE approved, task closed

---

## 🎯 User Story

**As a** team member (developer, SRE, QA, or manager)
**I want to** see and interact with a Kanban board
**So that** I can understand the current state of all work, move tasks through the lifecycle, and trust that the SRE gate ensures quality before completion

---

## ✅ Acceptance Criteria

### Board View
- [ ] Single board displays all tasks grouped by status column
- [ ] Each column: BACKLOG | TODO | IN_PROGRESS | VERIFY | DONE | REOPEN
- [ ] Task cards show: Task ID, Title, Priority badge (P0/P1/P2/P3), Assigned Agent
- [ ] REOPEN column highlighted visually (red border/background) to draw attention
- [ ] VERIFY column shows SRE pending icon/label

### Task Cards
- [ ] Clicking a task card opens detail panel
- [ ] Detail panel shows: Full description, Deliverables checklist, Status history, SRE verification checklist, Findings log (if reopened)
- [ ] Status badge updates in real-time when task moves

### Task Creation
- [ ] "New Task" button opens creation form
- [ ] Required fields: Title, Priority (P0-P3 dropdown), Agent type (dev/sre/qa/research/design)
- [ ] Optional: Description
- [ ] On create: Task file generated in `tasks/TSK-XXX.md`, board updated immediately

### Task Movement
- [ ] Drag-and-drop between columns updates status
- [ ] Moving to VERIFY: System prompts "SRE review required" and notifies SRE
- [ ] Moving to REOPEN: System requires a note/finding to be logged
- [ ] Moving to DONE: Only allowed from VERIFY (SRE must approve first)
- [ ] Status history row appended on every move with timestamp + actor

### SRE Gate (VERIFY State)
- [ ] Tasks in VERIFY are visually locked — cannot move to DONE without SRE action
- [ ] SRE can: Approve (→ DONE) or Find Issues (→ REOPEN with findings logged)
- [ ] SRE findings include: Finding description, Recommended action, Timestamp
- [ ] Reopened tasks show findings in card detail view

### Filtering & Search
- [ ] Filter by: Priority, Agent type, Status
- [ ] Search by: Task ID, Title keyword
- [ ] Sprint view: Toggle to show only current sprint's tasks

### Persistence (GitHub-backed)
- [ ] All changes sync to `engineering-team/BOARD.md` and `tasks/` directory
- [ ] Changes committed to git automatically
- [ ] Board state recoverable from git history

---

## 📊 Views

### Main Board View
```
┌──────────┬──────────┬─────────────┬─────────┬───────┬────────┐
│ BACKLOG  │   TODO   │ IN_PROGRESS │ VERIFY  │ DONE  │ REOPEN │
├──────────┼──────────┼─────────────┼─────────┼───────┼────────┤
│ [Card]   │ [Card]   │   [Card]    │ [Card]  │ [Card]│ [Card] │
│ [Card]   │          │             │         │       │        │
└──────────┴──────────┴─────────────┴─────────┴───────┴────────┘
```

### Mobile View
- [ ] Horizontal scroll through columns
- [ ] Cards stack vertically within each column
- [ ] Quick-action buttons on cards (move, assign, comment)

---

## 🧩 Component Inventory

| Component | States |
|-----------|--------|
| TaskCard | default, hover, dragging, VERIFY-lock, REOPEN |
| Column | default, drop-target, empty |
| PriorityBadge | P0 (red), P1 (orange), P2 (yellow), P3 (gray) |
| AgentBadge | dev, sre, qa, research, design |
| StatusHistory | table rows with timestamp + actor |
| SREChecklist | unchecked, checked, failed |
| NewTaskForm | empty, filled, validating, error |
| TaskDetailPanel | open, loading, error |

---

## 🔗 Integrations

- **Discord channel** — Board updates post to `#software-factory` on status changes
- **GitHub** — Task files committed to `engineering-team` repo on every change
- **Agents** — When task moves to IN_PROGRESS, appropriate agent is dispatched via OpenClaw

---

## 📤 Out of Scope

- User authentication (team is known, no login required)
- Time tracking / estimation
- Custom columns beyond the defined lifecycle
- Multi-board support (single board for now)

---

## Definition of Done

- [ ] Board renders all six columns with correct states
- [ ] Task cards display all required metadata
- [ ] Drag-and-drop updates status and commits to git
- [ ] VERIFY gate enforces SRE approval before DONE
- [ ] REOPEN captures findings and returns task to TODO
- [ ] Discord notifications fire on status changes
- [ ] Git sync verified (local → GitHub push confirmed)
- [ ] Mobile responsive (tested at 375px width)