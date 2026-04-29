# Audit Foundation Runbook

## Scope
This slice supports both the original file-backed audit path and a PostgreSQL-backed store contract, plus bounded async workers for projection catch-up and outbox publication.

Supabase Postgres is the canonical production/staging database. Dockerized Postgres is now the canonical local development/testing path. File-backed persistence remains available only as a fallback local harness.

`ff_audit_foundation` is now a real runtime gate. When disabled, audit API routes return `503 feature_disabled`, store methods reject writes/reads, and workers stop making progress until the flag is re-enabled.

## What exists
### File backend artifacts
- Source of truth: `data/workflow-audit-events.jsonl`
- Idempotency index: `data/workflow-audit-idempotency.json`
- Projection queue: `data/workflow-audit-projection-queue.jsonl`
- Outbox queue: `data/workflow-audit-outbox.jsonl`
- Read models:
  - `data/task-history-projection.json`
  - `data/task-current-state-projection.json`
  - `data/task-relationship-projection.json`
- Structured audit telemetry: `observability/workflow-audit.log`
- Metrics export: `GET /metrics`

### PostgreSQL backend artifacts
- `audit_events` — append-only source of truth
- `audit_projection_queue` — projection work queue
- `audit_outbox` — downstream publication queue
- `audit_task_history` — projected task history read model
- `audit_task_current_state` — projected current-state read model
- `audit_task_relationships` — projected relationship read model
- `audit_metrics` — persisted telemetry counters/gauges

## HTTP authz model in this slice
Default auth contract: bearer JWT with tenant + actor claims.

Legacy fallback headers are accepted **only** when `ALLOW_LEGACY_HEADERS=true`:
- `x-tenant-id`
- `x-actor-id`
- `x-roles`

Supported roles:
- `reader` — read history/state/relationships/observability
- `contributor` — append audit events plus read
- `sre` — read plus metrics access
- `admin` — full access including metrics and projection processing

## API error/logging contract
Audit HTTP responses now follow a standardized envelope:

```json
{
  "error": {
    "code": "feature_disabled",
    "message": "Audit foundation is disabled by ff_audit_foundation",
    "details": { "feature": "ff_audit_foundation" },
    "request_id": "..."
  }
}
```

Every response also includes `x-request-id`. Error logs in `observability/workflow-audit.log` include:
- `feature`
- `action`
- `outcome`
- `request_id`
- `status_code`
- `error_code`
- `error_message`
- `duration_ms`

Successful read/write access is now logged with `action=audit_access` so tenant-scoped history/state/metrics reads are auditable.

Audit HTTP maintenance note:
- When `lib/audit/http.js` changes, update the nearest API or runbook artifact in the same PR.
- Current nearest artifacts for HTTP-surface changes are this runbook plus the matching `docs/api/*.yml` contract for the affected route family.
- Engineer-only delivery-loop mutations now validate the task's current canonical assignee before accepting writes.
- Tier-based reassignment may emit explicit assignee ids such as `engineer-sr` in workflow payloads and task-detail context so downstream consumers can tell when ownership changed materially.
- SRE monitoring expiry is now worker-driven: reads reflect the current state but no longer append escalation events when the window has expired.
- SRE monitoring also exposes `POST /tasks/{id}/sre-monitoring/anomaly-child-task`, which creates a linked child task with machine-generated telemetry context, records the auto-`P0` rationale, and blocks the parent while leaving it readable/commentable.
- The anomaly-child parent block is cleared automatically when the linked child reaches a resolved terminal state; generic `task.unblocked` event injection is not the supported path for this workflow.
- PM anomaly follow-up now also exposes `POST /tasks/{id}/pm-business-context`, which records `task.pm_business_context_completed`, clears `pm_business_context_required`, and marks the anomaly context as finalized by PM for task detail consumers. Generic event injection is not a supported completion path for this workflow.
- Human close decisions now require explicit decision readiness. The runtime rejects stakeholder close decisions until either both PM and Architect cancellation recommendations are recorded or an escalation is active for the task.
- Close-review backtrack now requires dual-party evidence. The first PM/Architect request records a backtrack recommendation for the supplied agreement artifact; the counterpart request with the same artifact completes the transition back to implementation.

## Tenant isolation guarantees in this slice
- Idempotency is tenant-scoped. The same `idempotencyKey` may legitimately exist in different tenants without collision.
- File-backed projections are keyed by `tenant_id::task_id`, not bare `task_id`, so same task ids in different tenants do not overwrite each other.
- PostgreSQL production posture now expects a `(tenant_id, idempotency_key)` uniqueness contract.

## History API pagination
`GET /tasks/:id/history` still returns a plain array for backwards-compatible unpaginated reads.

When `limit` and/or `cursor` is present, the route returns:

```json
{
  "items": [],
  "page_info": {
    "limit": 100,
    "next_cursor": "42",
    "has_more": true
  }
}
```

`cursor` is an exclusive sequence-number cursor.

## Supported event types in this slice
See `lib/audit/event-types.js`. The store handles the declared workflow event types used by Issue #22: task creation, assignment changes, stage transitions, child links, escalation/decision records, and closure. Intake Draft creation also records `task.refinement_requested` after `task.created` so task history shows PM refinement routing without any implementation-start event. Incomplete Intake Draft creation may record `task.intake_creation_failed` as a compensating audit marker.

## Intake Draft creation
Use `POST /tasks` with `raw_requirements` to create a Task in `DRAFT` from raw operator requirements. `title` is optional, capped at 120 characters, and blank or omitted titles are stored as `Untitled intake draft`. Created Intake Drafts are routed to `current_owner=pm`, set `waiting_state=task_refinement`, and expose `next_required_action=PM refinement required` in list/detail projections. Intake Draft stage changes are blocked until PM refinement creates a non-intake execution contract.

The legacy refined-field task creation body remains accepted for compatibility, but the browser task creation route should submit raw intake requirements only.

## Runtime configuration
- `FF_AUDIT_FOUNDATION=false` — hard-disable the slice at runtime
- `FF_INTAKE_DRAFT_CREATION=false` — disables raw Intake Draft creation while preserving legacy task creation behavior
- Shared feature-flag parsing in `lib/audit/feature-flags.js` also backs specialist delegation rollout control; prefer `FF_REAL_SPECIALIST_DELEGATION` as the canonical operator-facing name, while `FF_SPECIALIST_DELEGATION` remains a legacy-compatible alias.
- `AUDIT_STORE_BACKEND=file|postgres` — optional explicit backend override; if omitted, runtime prefers `postgres` when `DATABASE_URL` is present and otherwise falls back to `file`
- `ALLOW_LEGACY_HEADERS=true` — permit legacy non-JWT auth fallback
- `DATABASE_URL=postgres://...` — required for PostgreSQL backend; in production this should be the Supabase Postgres connection string
- `PGSSL_ACCEPT_SELF_SIGNED=1` — explicit dev-only escape hatch when a managed provider presents a chain your environment cannot validate
- `ALLOW_FILE_AUDIT_BACKEND_IN_PRODUCTION=true` — emergency escape hatch only; normal production posture should leave this unset/false
- `PUSHGATEWAY_URL=http://...` — optional worker metric push target

## Deployment posture
- **Production:** Supabase Postgres only. `run-audit-api.js` and `run-audit-workers.js` now fail fast if production is configured to use the file backend or if `DATABASE_URL` is missing for Postgres.
- **Local development / test:** use Dockerized Postgres by default. `docker-compose.yml` now runs Postgres with disposable storage (`tmpfs`), so `docker compose down -v` / `npm run dev:postgres:reset` gives a clean slate quickly.
- **Fallback local harness:** file backend remains available for fast isolated runs. Set `AUDIT_STORE_BACKEND=file` and keep `NODE_ENV=development` or `test`.
- **Managed Postgres in dev/staging:** use the same Postgres path as production by setting `DATABASE_URL`; no code-path change is required.
- **TLS guidance:** prefer verified TLS. If a provider like Supabase is reachable only with an untrusted/self-signed chain in your current environment, set `PGSSL_ACCEPT_SELF_SIGNED=1` explicitly instead of hiding the relaxation in the connection string. Treat that as temporary dev/staging-only posture.

## Local Docker workflow
### Start disposable local Postgres
```bash
npm run dev:postgres:up
```

### Start the full local audit stack
```bash
npm run dev:audit:up
```

### Reset local state completely
```bash
npm run dev:postgres:reset
# or
npm run dev:audit:reset
```

### Run the Postgres integration suite against Docker and tear it down automatically
```bash
npm run test:integration:docker
```

### Host-run scripts/tests against Docker Postgres
```bash
export DATABASE_URL=postgres://audit:audit@127.0.0.1:5432/engineering_team
npm run audit:migrate
npm run test:integration:postgres
```

## Worker operations
### Rebuild projections from source of truth
```bash
npm run audit:rebuild -- /path/to/repo-root
```

### Process queued projection work
```bash
npm run audit:project -- /path/to/repo-root 100
```

Projection-worker processing also evaluates expired SRE monitoring windows through `processExpiredSreMonitoring`, so bounded worker progress materializes any overdue human escalation events.

### Process queued outbox messages
```bash
npm run audit:outbox -- /path/to/repo-root 100
```

### Trigger bounded projection processing via HTTP
```bash
curl -X POST \
  -H 'Authorization: Bearer <jwt>' \
  'http://localhost:3000/projections/process?limit=100'
```

## Failure modes
### Duplicate writes
Symptom: repeated command delivery.
Expected behavior: same idempotency key returns the existing event and does not append a second row.

### Projection lag / drift
Symptom: queued events are older than the read models and `workflow_projection_lag_seconds` rises.
Immediate action:
1. Check `/metrics` for `workflow_projection_lag_seconds`, `projection_checkpoint`, and `workflow_projection_failures_total`.
2. Run `npm run audit:project -- /path/to/repo-root 100`.
3. If projections are corrupted, rebuild with `npm run audit:rebuild -- /path/to/repo-root`.

### Outbox stuck
Symptom: audit events persist but downstream publishers do not receive them.
Immediate action:
1. Check `/metrics` for `workflow_outbox_publish_failures_total` and `outbox_checkpoint`.
2. Review `observability/workflow-audit.log` for `outbox_publish` failures.
3. Retry with `npm run audit:outbox -- /path/to/repo-root 100` after fixing publisher issues.

### Feature disabled / kill switch engaged
Symptom: API calls fail with `503 feature_disabled` and workers or store methods reject with `ff_audit_foundation` in the error.
Immediate action:
1. Confirm whether the disable is intentional.
2. Re-enable `FF_AUDIT_FOUNDATION` when safe.
3. Replay queues if lag accumulated while disabled.

### SRE monitoring window expired without escalation
Symptom: a task remains in `SRE_MONITORING` past its deadline with no human escalation.
Immediate action:
1. Confirm the projection worker is running or invoke bounded worker processing locally.
2. Verify the task has `sre_monitoring_window_ends_at` set and no `sre_approved_at`.
3. Re-run projection worker processing; successful processing should append an auditable `task.escalated` event with `reason=sre_monitoring_window_expired`.
4. Confirm the task now projects a human decision card with the expiry summary and recommendation in the authenticated browser inbox.

### Exceptional dispute raised during PM close review
Symptom: PM and Architect cannot align on cancellation vs. reopening implementation, and the final authority must move to a human stakeholder.
Immediate action:
1. Use `POST /tasks/{id}/close-review/exceptional-dispute` with a concise summary, recommendation, rationale, and severity.
2. Confirm the task history contains `task.escalated` with `reason=exceptional_dispute`.
3. Confirm the task projects `waiting_state=awaiting_human_stakeholder_escalation` and the human inbox renders the escalation card with approve/reject/request-more-context actions.

### Human close decision rejected as not decision-ready
Symptom: stakeholder action on `POST /tasks/{id}/close-review/human-decision` returns `409 human_close_decision_not_ready`.
Immediate action:
1. Confirm whether both PM and Architect cancellation recommendations have been recorded.
2. If they are not both present, either collect the missing recommendation or raise `POST /tasks/{id}/close-review/exceptional-dispute`.
3. Re-check the task detail or list projection and confirm `close_governance.humanDecision.decisionReady=true` before retrying the stakeholder decision.

### Close-review backtrack recorded but not yet routed
Symptom: `POST /tasks/{id}/close-review/backtrack` returns `202` and the task remains in `PM_CLOSE_REVIEW`.
Immediate action:
1. Inspect the response payload for `awaitingRole`.
2. Have the counterpart role submit the same `agreementArtifact` through the backtrack route.
3. Confirm the follow-up request returns `201` and the task transitions to `IMPLEMENTATION`.

### Monitoring anomaly requires tracked child work
Symptom: SRE identifies a production anomaly that should become first-class tracked work.
Immediate action:
1. Use `POST /tasks/{id}/sre-monitoring/anomaly-child-task` with service, anomaly summary, metrics, logs, and error samples.
2. Confirm the parent task gains a `task.child_link_added` event and a blocking `task.blocked` event referencing the new child id.
3. Confirm the child task is created as `P0`, linked back to the parent, and routed with `waiting_state=pm_business_context_required`.
4. Use `POST /tasks/{childId}/pm-business-context` to finalize the machine-generated business context before architect work begins.
5. Confirm the parent task is automatically unblocked when the linked child reaches its normal resolved terminal state.

### Execution Contract refinement from Intake Draft
Symptom: PM needs to turn a raw Intake Draft into an approval-ready structured contract without dispatching implementation.
Immediate action:
1. Confirm the task is an Intake Draft in `DRAFT` and is assigned to `pm`.
2. Use `POST /tasks/{id}/execution-contract` with the selected template tier and any completed section bodies.
3. Use `POST /tasks/{id}/execution-contract/validate` to enforce the tier-required sections.
4. If validation is valid, use `POST /tasks/{id}/execution-contract/markdown` to generate a non-authoritative review story.
5. Confirm task history includes `task.execution_contract_version_recorded`, `task.execution_contract_validated`, and `task.execution_contract_markdown_generated`.
6. Confirm implementation dispatch is still blocked until a future approval/dispatch workflow is implemented.
Rollback: set `FF_EXECUTION_CONTRACTS=false` to stop contract reads and mutations while preserving historical audit events.

## Observability hooks
Structured log fields emitted in this slice:
- `feature`
- `action`
- `outcome`
- `task_id`
- `event_id`
- `event_type`
- `correlation_id`
- `trace_id`
- `duration_ms`

Prometheus-style metrics exported include:
- `workflow_audit_events_written_total`
- `workflow_audit_write_failures_total`
- `workflow_history_queries_total`
- `workflow_history_errors_total`
- `workflow_history_query_latency_regressions_total`
- `workflow_projection_events_processed_total`
- `workflow_projection_failures_total`
- `workflow_projection_lag_seconds`
- `workflow_outbox_events_published_total`
- `workflow_outbox_publish_failures_total`
- `projection_checkpoint`
- `outbox_checkpoint`
- `last_write_duration_ms`
- `last_history_query_duration_ms`

## Validation suites
- Unit: `npm run test:unit`
- Contract: `npm run test:contract`
- E2E API acceptance coverage: `npm run test:e2e`
- Property-based invariants: `npm run test:property`
- Performance: `npm run test:performance`
- Security: `npm run test:security`
- Chaos: `npm run test:chaos`
- Postgres integration against disposable Docker Postgres: `npm run test:integration:docker`
- Manual host-run Postgres integration: `DATABASE_URL=postgres://audit:audit@127.0.0.1:5432/engineering_team npm run test:integration:postgres`

## UI-linked validation note
This repository now ships the browser-rendered task detail history / telemetry UI on `/tasks/:taskId`. Executable coverage exists today in the mounted app tests and Playwright browser suite. `tests/visual/` still documents the current visual-regression gap: browser evidence exists, but dedicated screenshot baseline assertions have not been added yet.

## Schema naming note
The implementation uses `audit_task_*` for PostgreSQL read models and `task-*-projection.json` for the file backend. That naming split is now documented rather than silently divergent; no schema expansion from Issue #24 was pulled into this pass.
