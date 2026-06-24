## Phase A — GP-002: GitHub issue → ET intake normalizer

**Parent epic:** #269 (golden-path supervised delivery — closed)  
**Golden-path step:** `GP-002` in `observability/golden-path-manual-steps.json`  
**Priority:** P0 (automation priority table in `docs/runbooks/golden-path-autonomous-delivery.md`)  
**Automate-as:** `intake_normalizer_from_github_issue`

### Problem

Today, turning a GitHub issue into an engineering-team Intake Draft is manual. The golden-path pilot used `lib/task-platform/golden-path-phase0.js` / `scripts/seed-golden-path-phase0.js` to copy issue body + URL into `POST /api/v1/tasks` with `github_issue_url` metadata. That operator step blocks unattended intake and is the first friction point on every new delivery loop.

GitHub webhook infrastructure already exists for **PR sync** (`lib/audit/github.js`, `ff_github_sync`), but **issue opened/edited → intake draft** is not wired.

### Goal

When a configured GitHub issue is opened (or labeled for factory intake), engineering-team automatically creates an Intake Draft task linked to that issue, routes to PM refinement, and records auditable evidence — without operator copy/paste.

### User story

As a Software Factory operator, I want a new GitHub issue to become an Intake Draft in engineering-team automatically, so delivery can start from the issue surface without manual intake transcription.

### Scope (v1)

**In scope**

- Handle `issues.opened` (and optionally `issues.edited` for body updates before refinement) on `wiinc1/engineering-team`
- Opt-in via label (e.g. `factory-intake`) or issue template marker to avoid creating tasks for every issue
- Normalize issue `title`, `body`, `html_url`, `number`, labels into `POST /tasks` / `POST /api/v1/tasks` with `raw_requirements`
- Persist `github_issue_url` (and issue number) on task metadata / audit payload
- Idempotent: re-delivery of the same issue event must not create duplicate tasks (stable idempotency key from `repository + issue.number + action`)
- Record `task.created` + `task.refinement_requested` (existing intake path) and auto-start PM refinement per `docs/runbooks/audit-foundation.md`
- Feature flag: `ff_github_intake_normalizer` (default off; fail closed)
- Webhook signature verification reusing `verifyGitHubWebhookSignature` from `lib/audit/github.js`
- Unit + integration + security tests; OpenAPI/runbook update

**Stretch (same issue if small, else follow-up)**

- GP-005: auto-create/link Project when issue has `golden-path` or `factory-intake` label (mirror `golden-path-phase0.js` project bootstrap)

**Out of scope**

- PM/Architect agent refinement (GP-003/004)
- Creating GitHub issues from ET (reverse direction)
- Multi-repo intake (single repo v1: `wiinc1/engineering-team`)
- Unattended forge dispatch (separate bridge work)

### Acceptance criteria

#### Must have

- [x] `issues.opened` with opt-in label creates exactly one Intake Draft (`DRAFT`, `intake_draft=true`) per issue
- [x] Task metadata includes `github_issue_url` matching the issue `html_url`
- [x] `raw_requirements` contains issue body (or a structured fallback when body is empty)
- [x] Duplicate webhook delivery returns existing task (no second `task.created`)
- [x] Task list/detail shows `waiting_state=task_refinement` and PM owner after creation
- [x] `ff_github_intake_normalizer=false` returns `503 feature_disabled` without side effects
- [x] Invalid/missing webhook signature returns `401` without creating tasks
- [x] Tests cover happy path, idempotency, flag off, and signature failure
- [x] Runbook section added under `docs/runbooks/golden-path-autonomous-delivery.md` or `docs/runbooks/audit-foundation.md` with webhook setup steps

#### Verification

- [x] Local: POST simulated signed webhook → task visible at `http://127.0.0.1:15173` after `npm run dev:golden-path:up`
- [x] Evidence JSON snippet or test fixture showing `GP-002` satisfied without `seed-golden-path-phase0.js`

### Implementation notes

- Manual baseline to replace: `lib/task-platform/golden-path-phase0.js` (`createTask` payload with `github_issue_url`, `intake_draft`)
- Intake API contract: `POST /tasks` with `raw_requirements` per `docs/runbooks/audit-foundation.md` § Intake Draft creation
- Reuse existing GitHub webhook route/handler patterns from PR sync; extend `inferTaskIdsFromWebhook` only if issue body already contains `TSK-*`
- Tenant mapping: default `engineering-team` tenant for `wiinc1/engineering-team` repo (configurable env)
- Update `observability/golden-path-manual-steps.json` summary when shipped (`GP-002` → automated)

### Verification commands

```bash
npm run dev:golden-path:up
npm run gp-002:verify
```

Writes `observability/gp-002-staging/gp-002-complete.json` and canonical `observability/gp-002-github-intake-smoke.json`.

### Dependencies

- Postgres audit API + workers healthy (see GP-007 issue for production worker posture)
- `FF_INTAKE_DRAFT_CREATION=true` in target environment

### Risk

**Simple** — additive webhook handler, no schema/auth changes. Rollback: disable `ff_github_intake_normalizer` and revert webhook subscription.

### Related

- `docs/runbooks/golden-path-autonomous-delivery.md` — automation priority P0
- `docs/reports/GOLDEN_PATH_PILOT_EVIDENCE.md` — manual GP-002 interventions logged
- Issue #18 / SF-013 — existing GitHub webhook PR sync (pattern reference)