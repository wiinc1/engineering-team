# Audit Foundation Runbook

> Golden-path GP-026: `lib/audit/linked-prs.js` orders PR history events deterministically before SRE `merged_pr_required` gate evaluation.
> Issue #130 standards evidence: mechanical maintainability compaction only; no runbook procedure change.
> Issue #193 standards evidence: lint-only whitespace cleanup in `lib/audit/workflow.js`; no audit runbook procedure change.

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
- `autonomous_delivery_retrospective_signals` — tenant-scoped delivery retrospective signal projection for the autonomous metrics MVP
- `autonomous_delivery_metric_snapshots` — aggregate autonomous delivery metric snapshots and threshold evaluation evidence
- `schema_migrations` — forward migration ledger; normal migration apply skips `*.down.sql` rollback files so rollback scripts must be executed only by an explicit operator rollback procedure.

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
- `admin` — full access including metrics, projection processing, and `forge:read`

Forge execution-readiness reads (`GET /tasks/:taskId/forge-execution-readiness`) accept either:
- `Authorization: Bearer <FORGE_SERVICE_TOKEN>` for forgeadapter service-to-service reads, or
- JWT callers with `forge:read` (currently granted to `admin`).

Unready tasks return `422 task_not_execution_ready` with structured details. Missing or invalid service tokens return `401`; JWT callers without `forge:read` return `403`.

Local forgeadapter Phase 2 smoke: see `docs/runbooks/forge-local-smoke.md` for seeding `TSK-LOCAL001`, file-backend audit-api bootstrap, and `FORGE_SERVICE_TOKEN` pairing with forgeadapter `ENGINEERING_TEAM_SERVICE_TOKEN`.

## Release Health

The coordinated audit API exposes unauthenticated, read-only release health at `/version`, `/api/version`, `/backend/version`, and `/health`. These routes return `engineering-team-release-health.v1`, `service=engineering-team-audit-api`, `status`, and both `commitSha` and `commit_sha` for the deployed audit API revision.

Release-health reads support `GET` and bodyless `HEAD`; unsupported methods return `405 method_not_allowed`. Responses set `cache-control: no-store` so strict delivery checks always read the current coordinated-stack revision.

Commit source order is explicit `releaseCommitSha`/`commitSha` options, coordinated-stack env vars (`ENGINEERING_TEAM_RELEASE_COMMIT_SHA`, `ENGINEERING_TEAM_COMMIT_SHA`, `RELEASE_COMMIT_SHA`, `COMMIT_SHA`, `GITHUB_SHA`), then `git rev-parse HEAD`. Strict hosted proof should require the health response to include the expected deployed commit and should use the coordinated stack endpoint, not Vercel or hosted Supabase.

Autonomous delivery metrics are exposed behind `ff_autonomous_delivery_metrics_mvp`.
PM, product-owner, SRE, and admin roles with `metrics:read` can read tenant metrics and task retrospective signals.
Only admin role holders with `projections:rebuild` can rebuild the projection.

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
- Canonical `/api/v1/tasks/{taskId}/merge-readiness-reviews` is implemented by the audit HTTP server but governed by the task-platform contract in `docs/api/task-platform-openapi.yml`; it stores linked source-log references only, not full source logs.
- Engineer-only delivery-loop mutations now validate the task's current canonical assignee before accepting writes.
- Tier-based reassignment may emit explicit assignee ids such as `engineer-sr` in workflow payloads and task-detail context so downstream consumers can tell when ownership changed materially.
- Approved Execution Contracts now expose `executionContract.dispatchReadiness.dispatchPolicy`, which selects Jr, Sr, or Principal Engineer from template tier, risk flags, and contract dispatch signals. Standard-or-higher work defaults to Sr and can allow QA coverage work in parallel; unsafe Jr proposals are blocked unless the work is constrained Simple scope with a clear failing/pending test plan; Principal triggers require Principal approval/involvement before dispatch.
- Versioned section reviews are accepted on `POST /api/v1/tasks/{taskId}/execution-contract/{version}/sections/{sectionId}/review`. The route records reviewer contribution and approval as a new `task.execution_contract_version_recorded` event, rejects stale versions with `stale_execution_contract_review`, and keeps dispatch blocked when material changes create a new latest version after approval.
- Low-risk Simple Execution Contracts may request `autoApproval=true` on the approval route. The `execution-contract-low-risk-simple-auto-approval.v1` policy records Operator Approval only when acceptance criteria are complete, dependencies are clear, no risk flags or production auth/security/data-model paths are present, rollback is clear, and reviewer gates are ready; Task detail and generated artifacts show the policy, rationale, and timestamp.
- Contract Coverage Audit is a required post-implementation gate for approved Execution Contracts. Engineers submit `task.contract_coverage_audit_submitted` through `POST /tasks/{id}/contract-coverage-audit`, QA validates through `POST /tasks/{id}/contract-coverage-audit/validate`, `implementation_incomplete` blocks QA Verification and Operator Closeout, and Task detail exposes `executionContract.contractCoverageAudit`.
- The operator-hosted API routes the nested versioned task workflow actions through `api/v1/task-workflow-proxy.js`: `/api/v1/tasks/{taskId}/refinement/start`, `/api/v1/tasks/{taskId}/execution-contract/{action}`, `/api/v1/tasks/{taskId}/contract-coverage-audit/{action}`, and `/api/v1/tasks/{taskId}/sre-monitoring/{action}`. `__workflow_path` is an internal rewrite parameter only; use `/api/v1/...` or `/backend/v1/...` for validation while preserving shared-handler JWT/RBAC enforcement.
- The operator-hosted API also routes unversioned task detail read aliases through the same proxy: `/api/tasks/{taskId}`, `/api/tasks/{taskId}/detail`, `/api/tasks/{taskId}/history`, `/api/tasks/{taskId}/observability-summary`, and `/api/tasks/{taskId}/state`. `__audit_path` is an internal rewrite parameter only and is allowlisted for read-model routes so task detail refreshes can hydrate owner, history, state, and telemetry without adding more serverless functions.
- SRE monitoring expiry is now worker-driven: reads reflect the current state but no longer append escalation events when the window has expired.
- SRE monitoring also exposes `POST /tasks/{id}/sre-monitoring/anomaly-child-task`, which creates a linked child task with machine-generated telemetry context, records the auto-`P0` rationale, and blocks the parent while leaving it readable/commentable.
- The anomaly-child parent block is cleared automatically when the linked child reaches a resolved terminal state; generic `task.unblocked` event injection is not the supported path for this workflow.
- PM anomaly follow-up now also exposes `POST /tasks/{id}/pm-business-context`, which records `task.pm_business_context_completed`, clears `pm_business_context_required`, and marks the anomaly context as finalized by PM for task detail consumers. Generic event injection is not a supported completion path for this workflow.
- Human close decisions now require explicit decision readiness. The runtime rejects stakeholder close decisions until either both PM and Architect cancellation recommendations are recorded or an escalation is active for the task.
- Close-review backtrack now requires dual-party evidence. The first PM/Architect request records a backtrack recommendation for the supplied agreement artifact; the counterpart request with the same artifact completes the transition back to implementation.
- PM refinement starts through the app workflow on Intake Draft creation and can be retried through `POST /api/v1/tasks/{taskId}/refinement/start` after runtime configuration is corrected. The route is PM/admin-only and records `task.refinement_started` with runtime evidence, followed by `task.refinement_completed` on successful Execution Contract drafting or `task.refinement_failed` with fallback evidence when delegation cannot run.
- GitHub issue intake (`POST /github/webhooks` with `FF_GITHUB_INTAKE_NORMALIZER=true`) waits for projected task state before starting PM refinement in async Postgres mode so `task.refinement_requested` does not fail with `task_not_found`. If projection lag exceeds the bounded wait window, callers may observe `503 projection_not_ready`.
- `POST /tasks/{id}/qa-results` drains the Postgres projection queue inline before appending the follow-on `task.stage_changed` event so workflow guards see the just-recorded `task.qa_result_recorded` event. File-backed stores skip the inline drain because projections are synchronous.

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

## Control-plane operating model

The control-plane policy model is additive to the audit stream:

- `task.control_plane_decision_recorded` stores inspectable policy decisions with policy name, version, input facts, decision, rationale, override, actor, timestamp, and context provenance.
- `task.control_plane_exception_recorded` stores linked workflow Exception records without requiring a lifecycle stage change.
- `task.closed` is enriched with `delivery_retrospective_signal` when no caller-supplied signal exists.
- Execution Contracts now include `context_provenance` with source intake, repo docs, ADRs, code inspection, issue/PR history, logs, external sources, previous failures, and specialist contributions where supplied or inferable.

Implemented policy versions:

- `control-plane-policy-decision.v1`
- `control-plane-capability-model.v1`
- `control-plane-context-provenance.v1`
- `delivery-retrospective-signal.v1`
- `autonomy-confidence-thresholds.v1`
- `control-plane-exception-recovery.v1`
- `control-plane-work-prioritization.v1`
- `control-plane-wip-limits.v1`
- `control-plane-delivery-budgets.v1`
- `control-plane-prompt-boundary.v1`

WIP limits can be attached to a stage transition under `payload.control_plane.wip_limits`. In `observe_only` mode, a would-block decision increments `feature_control_plane_wip_would_block_total` and the transition continues. In `enforced` mode, excess stage, role, or concrete-agent obligations are blocked unless the payload identifies production incident or S1 security/data-risk preemption.

Budget policy can be attached to any event under `payload.control_plane.budget`. Exhausted time, cost, iteration, or retry budget records `control_plane_budget_decision`, a linked workflow exception, `waiting_state=workflow_exception`, and a next required recovery action.

## Intake Draft creation
Use `POST /tasks` with `raw_requirements` to create a Task in `DRAFT` from raw operator requirements. `title` is optional, capped at 120 characters, and blank or omitted titles are stored as `Untitled intake draft`. Created Intake Drafts are routed to `current_owner=pm`, set `waiting_state=task_refinement`, and expose `next_required_action=PM refinement required` in list/detail projections. The app immediately attempts PM runtime delegation and records `task.refinement_started`; successful runtime dispatch also records `task.refinement_completed` with `agent_id`, OpenClaw `session_id`, `delegation_artifact_path`, delegation id, and truthful runtime attribution before drafting the first Execution Contract. Missing or disabled runtime delegation records `task.refinement_failed`, keeps ownership on PM, and leaves the next action as operator/runtime intervention. Retry PM refinement with `POST /api/v1/tasks/{taskId}/refinement/start` after setting `FF_REAL_SPECIALIST_DELEGATION=true` and `SPECIALIST_DELEGATION_RUNNER='node scripts/openclaw-specialist-runner.js'`. Intake Draft stage changes are blocked until PM refinement creates a non-intake execution contract.

The legacy refined-field task creation body remains accepted for compatibility, but the browser task creation route should submit raw intake requirements only.

## Runtime configuration
- `FF_AUDIT_FOUNDATION=false` — hard-disable the slice at runtime
- `FF_INTAKE_DRAFT_CREATION=false` — disables raw Intake Draft creation while preserving legacy task creation behavior
- `FF_AUTONOMOUS_DELIVERY_METRICS_MVP=false` — disables `GET /api/v1/metrics/autonomous-delivery`, `GET /api/v1/tasks/{taskId}/retrospective-signal`, and `POST /api/v1/metrics/autonomous-delivery/rebuild`
- Shared feature-flag parsing in `lib/audit/feature-flags.js` also backs specialist delegation rollout control; prefer `FF_REAL_SPECIALIST_DELEGATION` as the canonical operator-facing name, while `FF_SPECIALIST_DELEGATION` remains a legacy-compatible alias.
- `AUDIT_STORE_BACKEND=file|postgres` — optional explicit backend override; guarded runtime entrypoints default to `postgres` and require `DATABASE_URL` or an injected pool unless a local/test file fallback is explicitly selected
- `ALLOW_LEGACY_HEADERS=true` — permit legacy non-JWT auth fallback
- `DATABASE_URL=postgres://...` — required for PostgreSQL backend; in production this should be the Supabase Postgres connection string
- `PGSSL_ACCEPT_SELF_SIGNED=1` — explicit dev-only escape hatch when a managed provider presents a chain your environment cannot validate
- `ALLOW_FILE_AUDIT_BACKEND=true` or `TASK_PLATFORM_ALLOW_FILE_BACKEND=true` — explicit local/test-only fallback opt-in for isolated file-backed harnesses
- `PUSHGATEWAY_URL=http://...` — optional worker metric push target

## Deployment posture
- **Production:** Supabase Postgres only. `run-audit-api.js` and `run-audit-workers.js` now fail fast if production is configured to use the file backend or if `DATABASE_URL` is missing for Postgres.
- **Local development / test:** use Dockerized Postgres by default. `docker-compose.yml` now runs Postgres with disposable storage (`tmpfs`), so `docker compose down -v` / `npm run dev:postgres:reset` gives a clean slate quickly.
- **Fallback local harness:** file backend remains available for fast isolated runs. Set `AUDIT_STORE_BACKEND=file`, set `ALLOW_FILE_AUDIT_BACKEND=true` or `TASK_PLATFORM_ALLOW_FILE_BACKEND=true`, and keep `NODE_ENV=development` or `test`.
- **Managed Postgres in dev/staging:** use the same Postgres path as production by setting `DATABASE_URL`; no code-path change is required.
- **TLS guidance:** prefer verified TLS. If a provider like Supabase is reachable only with an untrusted/self-signed chain in your current environment, set `PGSSL_ACCEPT_SELF_SIGNED=1` explicitly instead of hiding the relaxation in the connection string. Treat that as temporary dev/staging-only posture.

## Runtime Backend Selection Guard
All deployable audit runtimes call the backend guard before they create an API server or worker. The guard defaults to the canonical Postgres path, rejects production/staging file persistence, and rejects implicit local file fallback unless `ALLOW_FILE_AUDIT_BACKEND=true` or `TASK_PLATFORM_ALLOW_FILE_BACKEND=true` is present.

Every guarded entrypoint emits a structured `backend_selection` log entry. Postgres selection logs `outcome=success`; explicit local/test file fallback logs `outcome=fallback_warning`, `warning_code=file_backend_fallback`, and a remediation telling the operator to start Dockerized Postgres or provide `DATABASE_URL`.

## Production workers (GP-007)

The operator-hosted audit API accepts writes. **Projection + outbox workers must run as a separate long-lived process** against the same operator-hosted Postgres `DATABASE_URL`.

### Start workers (Docker reference)

```bash
export DATABASE_URL='postgres://...'
npm run audit:workers:up
```

Uses `docker-compose.production-workers.yml` + `Dockerfile.workers`. For Fly.io, deploy with `fly.toml` and set secrets for `DATABASE_URL`, `AUTH_JWT_SECRET`, and optional forge-bridge env vars.

### Required env vars

- `DATABASE_URL` — Supabase Postgres (same as API)
- `FF_AUDIT_FOUNDATION=true`
- `PROJECTION_INTERVAL_MS` / `OUTBOX_INTERVAL_MS` (default `5000`)
- `ET_FORGE_DISPATCH_ENABLED=true` when enabling the ET→forge bridge in production
- `FORGEADAPTER_BASE_URL`, `FORGEADAPTER_SERVICE_TOKEN`, `FORGE_SERVICE_TOKEN`, `AUTH_JWT_SECRET` — required when forge dispatch is enabled
- `PUSHGATEWAY_URL` — optional; recommended so `monitoring/alerts/audit-foundation.yml` lag alerts fire

### Smoke verification

```bash
export AUTH_JWT_SECRET='...'
export AUDIT_WORKERS_SMOKE_BASE_URL='https://<hosted-et-api>'
npm run audit:workers:production-smoke
```

Writes `observability/audit-workers-production-smoke.json`. On deployed operator URLs, the smoke appends and reads through `/api/v1/tasks/{taskId}/events` and `/api/v1/tasks/{taskId}/state` (not bare `/tasks/...`, which resolves to the SPA). Target: `workflow_projection_lag_seconds < 5` within one worker interval after an append.

### Rollback

1. Stop the worker process (`npm run audit:workers:down` or platform equivalent).
2. Drain queues with admin fallback: `POST /projections/process?limit=100` and `npm run audit:project -- . 100`.
3. Re-enable workers once `DATABASE_URL` and publisher targets are healthy.

Golden-path phase runners treat manual projection scripts as **fallback only** when lag remains above the threshold after `PROJECTION_CATCHUP_MAX_RETRIES` (default 5) worker polls (see `lib/audit/projection-catch-up.js`). Manual fallback emits a structured stderr warning. Milestone A operator checklist: `docs/runbooks/milestone-a-hosted-factory.md`.

## GitHub issue intake webhook (GP-002)

`POST /github/webhooks` also accepts `issues` events when `FF_GITHUB_INTAKE_NORMALIZER=true`.

1. Configure the GitHub webhook on `wiinc1/engineering-team` for **Issues** (and keep existing PR events for `ff_github_sync`).
2. Set `GITHUB_WEBHOOK_SECRET` on the API and worker hosts.
3. Add label `factory-intake` (override with `GITHUB_INTAKE_OPT_IN_LABEL`) to issues that should become Intake Drafts.
4. Issues map to tenant `engineering-team` by default (`GITHUB_INTAKE_DEFAULT_TENANT` / `GITHUB_INTAKE_REPO_TENANT_MAP`).

Successful intake creates `POST /tasks`-equivalent Intake Draft state: `task.created`, `task.refinement_requested`, PM refinement auto-start, and `github_issue_url` on the audit payload.

When `FF_GITHUB_INTAKE_PROJECT_BOOTSTRAP=true`, issues with `factory-intake` or `golden-path` also auto-create an ACTIVE Project (mirroring `golden-path-phase0.js`) and attach the intake task via `PATCH /api/v1/tasks/{id}/project`. Verify with `npm run gp-005:verify`.

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
3. Include `riskFlags` so deterministic reviewer routing can select Architect, UX, QA, SRE, and Principal Engineer reviewers with explainable reasons. QA approval is required for Standard, Complex, and Epic contracts. SRE is required for deployment, observability, reliability, authentication, data, or production-behavior risk. Principal Engineer is required for high-risk engineering triggers.
4. If model judgment requests a stricter reviewer than deterministic rules, leave that reviewer required or include an operator-visible downgrade rationale in the reviewer entry. Deterministic hard requirements still win when the supplied judgment is less strict.
5. Save another contract version when section body, payload JSON, payload schema version, owner/approval metadata, reviewer routing, risk flags, review feedback, or provenance references change materially.
6. Have reviewers record section-level contribution or approval with `POST /api/v1/tasks/{taskId}/execution-contract/{version}/sections/{sectionId}/review`. If the response is `stale_execution_contract_review`, reload the latest projection and retry against the latest version.
7. Use `POST /tasks/{id}/execution-contract/validate` to enforce the tier-required sections.
8. If validation is valid, use `POST /tasks/{id}/execution-contract/markdown` to generate a non-authoritative review story.
9. Use `POST /tasks/{id}/execution-contract/approve` only after all `reviewer_routing.required_role_approvals` have `status=approved` and all blocking questions in contract feedback, workflow threads, or review questions are resolved. For low-risk Simple work, include `autoApproval=true` only when acceptance criteria are complete, dependencies are clear, no risk flags or production auth/security/data-model paths are present, and rollback is clear.
10. If approval returns `execution_contract_auto_approval_blocked`, use explicit Operator Approval instead of policy approval and preserve the returned blocking reasons for audit. If approval returns `execution_contract_approval_blocked`, clear `missing_required_approvals` and `unresolved_blocking_questions`. Review `approval_summary.nonBlockingComments`, but do not treat those comments as blocking.
11. After approval and before implementation preparation, use `POST /tasks/{id}/execution-contract/verification-report` to generate the `docs/reports/{display-id}-{slug}-verification.md` skeleton from approved-contract evidence. The skeleton is required for Standard, Complex, Epic, and risk-bearing Simple contracts; Simple contracts without risk flags may proceed without it.
12. If implementation dispatch returns a workflow violation mentioning a missing verification report skeleton, generate the skeleton through the dedicated route. Do not inject `task.execution_contract_verification_report_generated` through the generic events route.
13. Before leaving `DRAFT`, after the skeleton gate is satisfied, use `POST /tasks/{id}/execution-contract/artifacts` to generate the reviewable repo artifact bundle. Production bundles require a `TSK-123` display ID. Staging/local bundles must use aliases such as `STG-123` or `LOCAL-123`.
14. Inspect the bundle paths before commit: generated stories use `docs/user-stories/{display-id}-{slug}.md`, Refinement Decision Logs use `docs/refinement/{display-id}-{slug}.md`, verification report skeletons use `docs/reports/{display-id}-{slug}-verification.md`, and PR guidance must link display-ID paths rather than opaque internal IDs.
15. Use `POST /tasks/{id}/execution-contract/artifacts/approve` only after PM approval plus required section-owner approvals are recorded. Approval calls may be incremental; newly supplied role approvals merge with existing bundle approvals, and omitted roles are not reset. Operator approval is required when the artifact reveals scope mismatch, promotes a Deferred Consideration, changes a committed requirement, accepts unresolved non-blocking comments, or is bundled with Operator Approval or Closeout.
16. If approval returns `artifact_bundle_approval_blocked`, clear the listed `missing_required_approvals` before preparing a commit.
17. Confirm task history includes `task.execution_contract_version_recorded`, `task.execution_contract_validated`, `task.execution_contract_markdown_generated`, `task.execution_contract_approved`, `task.execution_contract_verification_report_generated` when required, `task.execution_contract_artifact_bundle_generated`, and `task.execution_contract_artifact_bundle_approved`.
18. For policy-approved Simple work, confirm `executionContract.approval.autoApproval` exposes the policy version, rationale, and timestamp, generated artifacts include the auto-approval rationale, and `feature_operator_trusted_autonomous_delivery_rate` includes the task after successful close.
19. Confirm `committed_scope.committed_requirements` contains only approved implementation scope, while `out_of_scope`, `deferred_considerations`, and `follow_up_tasks` remain excluded. Confirm GitHub issue creation stayed default-off unless explicitly requested.
19. Confirm Standard-or-higher and risk-bearing Simple tasks cannot enter implementation preparation before the skeleton event, while Simple no-risk tasks are allowed to proceed without one.
Rollback: set `FF_EXECUTION_CONTRACTS=false` to stop contract reads and mutations while preserving historical audit events.

### Deferred Considerations review
Symptom: PM identifies an idea, alternative, or future enhancement during refinement that is useful context but not current approved scope.
Immediate action:
1. Use `POST /tasks/{id}/deferred-considerations` to capture title, known context, deferral rationale, source section, source comment or source agent, owner, revisit trigger or date, and open questions.
2. Confirm Task detail exposes `deferred_considerations.summary.total` and `summary.unresolved_count`; the browser detail page shows the count badge.
3. Use `GET /deferred-considerations` as the PM review queue for unresolved items across Tasks. Review by revisit date, dependency trigger, or source Task.
4. Before Operator Approval, confirm `approvalSummary.deferredConsiderationsNotInScope` lists unresolved items and `deferredConsiderationsExcludedFromCoverage=true`.
5. During Operator Closeout, inspect `closeGovernance.deferredConsiderations`. Unresolved items must show `leave_deferred`, `promote_to_intake_draft`, and `close_no_action`, and must keep `blocks_qa_verification=false` and `blocks_operator_closeout=false`.
6. To promote, use `POST /tasks/{id}/deferred-considerations/{deferredConsiderationId}/promote`. Confirm the new Intake Draft raw requirements include source Task ID, source Execution Contract version, Deferred Consideration ID, known context, rationale, and open questions.
7. To close with no action, use `POST /tasks/{id}/deferred-considerations/{deferredConsiderationId}/close` with rationale.
8. If review determines the item blocks current work, use `POST /tasks/{id}/deferred-considerations/{deferredConsiderationId}/review` with `action=convert_blocker` and `conversion_type=refinement_blocking_question` or `operator_decision_required_exception`. It must not remain only deferred.
9. Do not inject Deferred Consideration events through the generic `/events` route. The dedicated routes enforce role, state, promotion, and blocker-conversion policy.
Rollback: set `FF_EXECUTION_CONTRACTS=false` to stop contract-adjacent reads and mutations while preserving append-only Deferred Consideration audit events.

### Contract Coverage Audit gate
Symptom: an approved-contract task has implementation complete and needs to move toward QA Verification.
Immediate action:
1. Confirm the task has the latest approved Execution Contract and a current `task.engineer_submission_recorded` implementation attempt.
2. Have the implementing Engineer call `POST /tasks/{id}/contract-coverage-audit` with rows mapped to each committed requirement. Rows are versioned to the Execution Contract and implementation attempt. Deferred Considerations, out-of-scope notes, and follow-up tasks are excluded unless promoted into a new approved contract version.
3. Move the task from `IMPLEMENTATION` or `IN_PROGRESS` to `CONTRACT_COVERAGE_AUDIT`. The workflow rejects this transition when the current implementation attempt has no submitted matrix.
4. Have QA call `POST /tasks/{id}/contract-coverage-audit/validate`. QA must validate every row before QA Verification begins.
5. Treat a covered row as sufficient only when it has both implementation evidence and verification evidence. Manual-only evidence, unmapped evidence, partial implementation, implementation without verification evidence, or verification without implementation evidence creates a blocking `implementation_incomplete` exception.
6. For non-code or not-applicable rows, require explicit rationale. Approved not-applicable or scope exceptions are neutral autonomy-confidence signals; committed-requirement `implementation_incomplete` is negative; first-pass full coverage is positive.
7. If validation returns `implementation_incomplete`, the workflow returns the task to `IMPLEMENTATION`. The Engineer must submit a new implementation attempt and a new coverage audit before QA can revalidate impacted and dependent rows.
8. Only after QA validation returns `status=closed` may the task enter `QA_TESTING`. Operator Closeout is blocked until the latest coverage validation for the current implementation attempt is closed and no committed requirement remains uncovered.
9. Read the generated Markdown through `GET /tasks/{id}/contract-coverage-audit/markdown`; the path points to the verification report under `docs/reports/`, but the structured Task audit remains authoritative.
10. Confirm metrics include `feature_contract_coverage_audits_submitted_total`, `feature_contract_coverage_audits_closed_total`, `feature_contract_coverage_implementation_incomplete_total`, `feature_autonomy_confidence_positive_signals_total`, `feature_autonomy_confidence_neutral_signals_total`, `feature_autonomy_confidence_negative_signals_total`, and `feature_autonomy_confidence_signal_score`.
Rollback: set `FF_EXECUTION_CONTRACTS=false` to stop contract and coverage-audit reads and mutations while preserving historical audit events.

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
- `feature_contract_coverage_audits_submitted_total`
- `feature_contract_coverage_audits_closed_total`
- `feature_contract_coverage_implementation_incomplete_total`
- `feature_autonomy_confidence_positive_signals_total`
- `feature_autonomy_confidence_neutral_signals_total`
- `feature_autonomy_confidence_negative_signals_total`
- `feature_autonomy_confidence_signal_score`
- `feature_execution_contract_section_reviews_total`
- `feature_execution_contract_material_versions_total`
- `feature_control_plane_decisions_total`
- `feature_control_plane_exceptions_total`
- `feature_control_plane_wip_would_block_total`
- `feature_control_plane_wip_blocks_total`
- `feature_control_plane_budget_exhausted_total`
- `feature_control_plane_delivery_retrospective_signals_total`
- `feature_task_detail_next_action_impressions_total{role,action}`
- `feature_task_detail_next_action_clicks_total{role,action}`
- `feature_task_detail_next_action_errors_total{type}`
- `feature_task_detail_next_action_duration_seconds{action}`

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

## Delegated AI-agent activation gate
Delegation-enabled AI agents must be previewed before they can become active. Operators use `POST /api/v1/ai-agents/preview` to review normalized agent data, assignment/role-inbox/PM-bucket impact, delegation routing, OpenClaw dry-run proof, fallback behavior, permissions, reporting, and audit impact. Saving the active agent requires `agents:write`, `agent-delegation:write`, and a matching approved preview token.

The gate fails closed. Missing or invalid delegation mappings, route/task-type collisions, runtime-agent mismatches, or sample routing mismatches block live activation and do not fall back to a coordinator owner. If preview fails in staging or production, keep the agent inactive/draft, correct the delegation config, rerun preview, and only then retry the create/update request with the new confirmation token.

## UI-linked validation note
This repository now ships the browser-rendered task detail history / telemetry UI on `/tasks/:taskId`. Executable coverage exists today in the mounted app tests and Playwright browser suite.

Issue #153 adds a feature-flagged role-specific next-action layer on top of the existing task-detail read model. Roll out with `ff_task_detail_next_action_redesign` enabled for staging, then internal PM/QA/SRE users, then all authenticated users. Roll back by setting `ff_task_detail_next_action_redesign=0`; the route continues to render the prior task-detail hierarchy because the resolver and panel are client-side only and no server fields are removed.

Operators should watch task-detail route errors, action submission errors, next-action impression/click ratios, and render budget drift during rollout. Synthetic monitoring should open seeded PM, QA, SRE, reader, blocked, done, and stale task-detail fixtures and assert a `.task-next-action` element with the expected `data-next-action` value.

## Schema naming note
The implementation uses `audit_task_*` for PostgreSQL read models and `task-*-projection.json` for the file backend. That naming split is now documented rather than silently divergent; no schema expansion from Issue #24 was pulled into this pass.

## Local live factory proof

When proving live OpenClaw milestone C/D on the coordinated stack, use the durable factory stack so projection catch-up does not rely on inventing a worker process:

```bash
npm run factory:stack:up      # launchd KeepAlive: postgres-ensure, API, workers, UI, forgeadapter
npm run factory:stack:status
npm run factory:stack:accept  # GitLab #269 acceptance criteria
# emergency fallback only if factory stack is not installed:
npm run audit:workers
```

See also `docs/runbooks/golden-path-autonomous-delivery.md` (**Durable factory stack** / GitLab #269) and readiness assessment appendix.
