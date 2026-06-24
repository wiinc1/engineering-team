## Phase A — GP-007: Always-on projection + outbox workers (production)

**Parent epic:** #269 (golden-path supervised delivery — closed)  
**Golden-path step:** `GP-007` in `observability/golden-path-manual-steps.json`  
**Priority:** P0 (automation priority table in `docs/runbooks/golden-path-autonomous-delivery.md`)  
**Automate-as:** `always_on_projection_worker`

### Problem

Postgres audit writes enqueue projection and outbox work asynchronously. Read models (task detail, workflow gates, SRE monitoring expiry, ET→forge bridge) stay stale until something processes the queues.

**Local/golden-path:** `scripts/run-audit-workers.js` runs supervised projection + outbox loops (`PROJECTION_INTERVAL_MS`, `OUTBOX_INTERVAL_MS`). `npm run dev:golden-path:up` starts this automatically.

**Production gap:** Vercel-hosted API accepts writes but does not run long-lived workers. Golden-path replay had to call `scripts/process-audit-projection-queue.js` manually and retry QA gates when projections lagged (`GOLDEN_PATH_PILOT_EVIDENCE.md` automation gaps). `workflow_projection_lag_seconds` can grow unbounded without an always-on worker.

This blocks reliable workflow gates (QA, SRE `merged_pr_required`, closeout) and the `et-forge-dispatch-bridge` outbox path in hosted environments.

### Goal

Projection and outbox workers run continuously against production/staging Supabase Postgres, keep `workflow_projection_lag_seconds` under the existing alert threshold, and eliminate operator/manual catch-up as a routine step.

### User story

As a Software Factory operator, I want audit read models to stay fresh automatically after every write, so workflow gates and forge dispatch bridge actions succeed without manual projection catch-up.

### Scope (v1)

**In scope**

- Deploy `scripts/run-audit-workers.js` as an always-on process in **staging + production** (separate from Vercel serverless API)
- Worker processes both:
  - **Projection queue** (`createProjectionWorker`) — read models, SRE monitoring expiry materialization
  - **Outbox queue** (`createOutboxWorker`) — including `et-forge-dispatch-bridge` when `ET_FORGE_DISPATCH_ENABLED=true`
- Health/readiness: worker logs structured errors; expose progress via existing `/metrics` (Pushgateway optional: `PUSHGATEWAY_URL`)
- Alert wiring: `monitoring/alerts/audit-foundation.yml` `WorkflowProjectionLag` (`> 5s` for 5m) and outbox failure alerts fire meaningfully in prod
- Document deployment + rollback in `docs/runbooks/audit-foundation.md` (new § Production workers)
- Integration test or smoke script proving: append event → worker processes → task detail `next_required_action` updates without manual `POST /projections/process`
- Update golden-path phase runners to treat manual projection script as **fallback only** (log warning if worker lag detected)

**Out of scope**

- Rewriting projection logic
- Redis / new queue infrastructure
- Sub-second synchronous projections (keep async queue model)
- Generic multi-tenant worker fleet autoscaling

### Acceptance criteria

#### Must have

- [x] Staging worker deployment documented (`docs/runbooks/gp-007-production-workers.md`, `docker-compose.production-workers.yml`, `fly.toml`)
- [ ] Production worker deployment running against Supabase Postgres (operator: `fly deploy` or `npm run audit:workers:up`)
- [x] After a workflow write, `workflow_projection_lag_seconds` returns to `< 5` within one worker interval on coordinated stack (`npm run gp-007:verify`)
- [x] Golden-path phase runners treat manual projection script as fallback only (`lib/audit/projection-catch-up.js`)
- [ ] Outbox events publish on hosted staging without manual `audit:outbox` runs (requires deployed workers + `ET_FORGE_DISPATCH_ENABLED`)
- [x] Runbook covers start/stop, env vars, failure modes, lag remediation (`docs/runbooks/gp-007-production-workers.md`, `docs/runbooks/audit-foundation.md`)
- [x] `observability/golden-path-manual-steps.json`: `GP-007` automated on coordinated stack

#### Verification

- [x] Coordinated-stack smoke: append event → projected state visible without `POST /projections/process` (`npm run gp-007:verify`)
- [ ] Hosted staging smoke: intake draft → PM refinement visible in UI within one interval
- [ ] Hosted staging smoke: QA result write → gate evaluation without admin `POST /projections/process`
- [ ] Metrics check on hosted API: `workflow_projection_events_processed_total` increments; lag gauge near zero
- [ ] If `ET_FORGE_DISPATCH_ENABLED=true`, contract-approval triggers forge outbox publish without operator script

### Implementation notes

- Existing code paths:
  - `scripts/run-audit-workers.js` — supervised loops
  - `docker-compose.yml` — reference local deployment (`audit-workers` service)
  - `scripts/dev-golden-path/stack.js` — spawns workers in dev stack
  - `POST /projections/process` — admin fallback only
- Deployment options (pick one, document in runbook):
  - Long-running container (Fly.io, Railway, ECS, homelab Docker)
  - systemd service on existing host
  - **Not** Vercel cron-only unless supplemented — cron can be backup, not primary
- Production guard: `assertAuditBackendConfiguration()` already fails fast without Postgres in production
- Coordinate with ET→forge bridge rollout: outbox worker must run wherever `ET_FORGE_DISPATCH_ENABLED=true`

### Dependencies

- Supabase `DATABASE_URL` with migrations applied (`npm run audit:migrate`)
- `FF_AUDIT_FOUNDATION=true`
- Monitoring sink for `/metrics` or Pushgateway (optional but recommended)

### Risk

**Simple** — operational/deployment change using existing worker code. Rollback: stop worker process; operators use `POST /projections/process` + `audit:project` fallback (current behavior).

### Related

- `docs/runbooks/audit-foundation.md` — Worker operations, failure modes
- `docs/runbooks/golden-path-autonomous-delivery.md` — GP-007 manual step + P0 priority
- `lib/task-platform/et-forge-dispatch-bridge.js` — depends on outbox worker
- `monitoring/alerts/audit-foundation.yml` — `WorkflowProjectionLag`
- Golden-path PR #270 — bridge implemented; production enablement blocked without workers