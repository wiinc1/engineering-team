# [Epic] Replace the custom production job queue with Graphile Worker

Template Tier: Epic

Repo gates reviewed: `docs/standards/software-development-standards.md` and `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`.

## 1. User Story

As an engineering-factory platform owner,
I want every supported background workload delivered through Graphile Worker,
so that job claiming, retries, recovery, scheduling, concurrency, and shutdown use one maintained Postgres-native runtime while LangGraph and application records retain workflow and business-state ownership.

Business context and success metrics:

- This is a full implementation and production replacement, not a pilot, proof of concept, shadow queue, or permanent dual runtime.
- 100% of supported factory, LangGraph start/resume, audit projection, outbox, and scheduled recovery jobs use Graphile Worker after cutover.
- Zero supported production writers or workers use the bespoke queue, lease, polling, retry, or file-queue implementations after migration closes.
- A worker crash or process restart redelivers eligible work without losing the job or duplicating a completed external side effect.
- Queue-to-start latency, retry recovery, dead-job visibility, graceful shutdown, and disaster recovery meet the SLOs in this Epic.
- Canonical task, audit, evidence, approval, and LangGraph checkpoint contracts remain compatible.

## 2. Acceptance Criteria

Must have; every scenario becomes an automated E2E test:

1. Given any supported background workload, when it is scheduled after cutover, then one registered Graphile Worker task executes it and no legacy queue writer is invoked.
2. Given a factory run is ready to start or resume, when Graphile Worker delivers the job, then the handler invokes the same tenant-bound LangGraph thread and records correlated audit evidence.
3. Given a worker exits after claiming a job, when its lock becomes recoverable, then Graphile Worker redelivers it and idempotency prevents duplicate external side effects.
4. Given a transient failure, when retry policy applies, then bounded exponential backoff executes and terminal exhaustion becomes an operator-visible failed job with a stable error code.
5. Given duplicate scheduling requests share a semantic job key, when they race, then only the permitted job is pending and canonical records remain consistent.
6. Given multiple workers run concurrently, when jobs have tenant, resource, or named-queue constraints, then eligible jobs execute in parallel without violating configured serialization boundaries.
7. Given an authorized operator inspects, retries, cancels, or requeues work, when the action completes, then RBAC, tenant isolation, idempotency, and append-only audit requirements are enforced.
8. Given queued, leased, retrying, or dead-letter legacy work exists at cutover, when migration runs, then every item is deterministically mapped, drained, stopped, or preserved as immutable history with reconciliation evidence.
9. Given production cutover completes, when static and runtime checks run, then no supported code path, service, script, or deployment unit uses the custom queue runtime.
10. Given the queue kill switch is activated, when new work arrives, then new execution stops safely while historical status, audit, task, and checkpoint reads remain available.
11. Given the 24-hour soak and automated disaster-recovery drill complete, when the release gate evaluates evidence, then all SLO, security, recovery, and data-integrity requirements pass without manual validation.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence expected for this change: ADR, workload inventory, dependency review, migrations, API contracts, diagrams, automated unit/integration/E2E/contract/property/mutation/security/performance/load/chaos/soak/DR tests, dashboards, alerts, runbooks, rollback proof, and legacy-removal report.
- Gap observed: Graphile Worker provides at-least-once job delivery, not business-level exactly-once side effects. Documented rationale: every handler must retain an application idempotency boundary and prove replay safety (source https://worker.graphile.org/docs).
- Gap observed: the template references `docs/AI_IMPLEMENTATION_CHECKLIST.md` and `docs/STANDARDS_ADHERENCE_REPORT.md`, which are absent. Documented rationale: repository-enforced standards and `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md` are the completion baseline (source `docs/standards/software-development-standards.md`).

## 3. Workflow & User Journey

User journey:

1. Operators see one queue status model for factory and platform work.
2. Eligible work is scheduled once and delivered to a registered task handler.
3. Factory jobs start or resume LangGraph; platform jobs update canonical audit/outbox/projection records.
4. Recoverable failures retry automatically; exhausted jobs expose an authorized next action.
5. Operators inspect correlated task, graph, job, attempt, and audit history without reading internal Graphile tables directly.

System flow:

1. API/event/schedule -> application job adapter -> Graphile Worker job -> registered task handler.
2. Factory task handler -> LangGraph runtime -> checkpoint -> domain service -> audit/outbox/projection.
3. Platform task handler -> idempotent domain worker -> canonical records -> audit/metrics.
4. Operator action -> authenticated application API -> queue adapter -> Graphile Worker -> audit event.

Error and edge cases:

- Duplicate enqueue, worker crash before/after side effect, Postgres disconnect, stale job version, unknown task identifier, malformed payload, retry exhaustion, graceful-shutdown timeout, tenant mismatch, cancellation race, migration mismatch, and restore from backup.
- Generate `docs/diagrams/workflow-graphile-worker-production-runtime.mmd`.

## 4. Automated Test Deliverables

- Unit: payload schemas, task registry, job-key policy, retry mapping, concurrency policy, error mapping, idempotency, redaction, and shutdown at 95%+ coverage.
- Integration: real Postgres Graphile schema, enqueue/claim/retry/recovery, LISTEN/NOTIFY behavior, migrations, LangGraph resume, audit/outbox/projection tasks, and multi-worker execution.
- E2E: one automated scenario per acceptance criterion, tagged `@regression`.
- Contract: all producers, handlers, operational API consumers, LangGraph, audit, outbox, projection, and deployment/runtime contracts.
- Property/mutation: arbitrary duplicate and crash sequences preserve invariants; 80%+ mutation score for job identity, authorization, retry, and terminal decisions.
- Security: tenant isolation, forged payload/action, dependency/SAST/DAST/secrets scans, privilege boundaries, and sanitized error tests.
- Performance/load: 2x expected QPS for 10 minutes with latency, connection, throughput, and backlog budgets.
- Chaos/soak/DR: kill workers at job boundaries, inject Postgres/network faults, run 24 hours, and restore database/worker state automatically.
- Fixtures: versioned job payloads, deterministic clocks, tenant-separated data, duplicate requests, legacy queue states, and external adapter fakes.

## Required Evidence

- Commands run: `npm run lint`, `npm run typecheck`, focused Graphile suites, `npm test`, `npm run test:integration:docker`, `npm run test:security`, `npm run test:performance`, `npm run standards:check`, `npm run build`, and `make verify`.
- Tests added or updated: Graphile runtime/schema, every producer and handler, LangGraph dispatch, idempotency, migration, API/UI, RBAC, security, performance, chaos, soak, and disaster-recovery suites defined by the child issues.
- Rollout or rollback notes: full production cutover after all automated gates; no pilot, percentage routing, or silent legacy fallback; rollback must preserve one delivery owner.
- Docs updated: `README.md`, architecture/runbooks, ADR, OpenAPI, diagrams, dependency inventory, monitoring, alerts, migrations, and standards compliance checklist.

## 5. Data Model & Schema

- Install Graphile Worker in a dedicated Postgres schema using the existing production TLS and pool posture; pin the package and schema migration version.
- Add an application-owned job delivery registry mapping tenant-safe workload identity, semantic job key, Graphile job reference, payload version, canonical resource, status summary, and audit correlation. Graphile internal tables are operational, not business sources of truth.
- Use expand-contract migrations with tested apply/rollback/apply, schema-diff checks, least-privilege grants, retention, backup, and restore.
- Reconcile every legacy queued, leased, retrying, complete, and dead-letter record. Preserve immutable historical evidence without retaining executable legacy ownership.
- Generate `docs/diagrams/schema-graphile-worker-production-runtime.mmd`.

## 6. Architecture & Integration

- Pattern: hexagonal job-delivery adapter. Domain services depend on an application job port, not Graphile types.
- Graphile Worker owns delivery, locking, retry timing, cron, and worker concurrency. LangGraph owns lifecycle state/checkpoints. Application records own tasks, audit, approvals, evidence, and idempotency.
- Register an allowlisted, versioned task catalog; reject arbitrary task names or executable payloads.
- Use named queues and concurrency only where domain serialization requires them; define bounded retry/backoff and timeouts per workload class.
- Controls: `ff_graphile_worker_cutover` switches all supported production writers at the approved cutover; `ff_graphile_worker_killswitch` stops new delivery. Neither supports percentage targeting.
- Generate `docs/diagrams/architecture-graphile-worker-production-runtime.mmd` and an ADR for ownership, replay semantics, cutover, and legacy retirement.

## 7. API Design

- Preserve existing factory queue status and operator-action response compatibility through the application adapter; never expose direct Graphile table mutation.
- Publish `docs/api/job-runtime-openapi.yml` for authenticated status, retry/requeue, cancel, health, and sanitized attempt history.
- Version job payloads independently from HTTP contracts; reject unsupported future payload versions and migrate supported old versions explicitly.
- Require tenant context, RBAC, request IDs, optimistic concurrency where applicable, and idempotency keys for mutations.

## 8. Security & Compliance

- Preserve current AuthN; restrict inspect/retry/cancel/requeue and override capabilities by existing operator/admin permissions and tenant.
- Store no credentials, tokens, cookies, raw connection strings, or arbitrary executable content in job payloads or logs.
- Threats: forged task/payload -> allowlisted schema-validated task catalog; cross-tenant operation -> derive tenant from authenticated canonical record; replayed side effect -> semantic idempotency ledger and crash tests.
- Require least-privilege DB roles, dependency provenance/license review, secret scan, SAST/DAST, and zero high/critical unresolved findings.
- Append audit events for scheduling, delivery outcome, retry exhaustion, operator action, migration decision, cutover, and kill-switch changes.

## 8a. Standardized Error Logging

- Use the repository's existing error envelope, `httpError`, and `createAuditLogger`; the template's Next.js/Prisma examples do not match this Node service.
- No new `console.log`, raw error response, swallowed exception, or secret-bearing log.
- Stable codes include `job_runtime_unavailable`, `job_payload_invalid`, `job_version_unsupported`, `job_schedule_conflict`, `job_action_forbidden`, `job_retry_exhausted`, and `job_cutover_incomplete`.

## 8b. AI Implementation Guide

- Inventory every producer, consumer, scheduler, service unit, recovery script, status endpoint, and test before editing.
- Keep handlers thin, idempotent, tenant-bound, cancellable where possible, and independent of Graphile internal table shape.
- Never acknowledge success before canonical writes and idempotency evidence satisfy the handler contract.
- Do not claim completion while a supported workload can still execute through the custom queue.

## 9. Performance & Scalability

- Enqueue p95 < 100 ms and p99 < 250 ms; ready-job-to-handler-start p95 < 2 seconds under expected load.
- Sustain 2x expected enqueue and execution QPS for 10 minutes without connection starvation or unbounded backlog.
- Recover 99% of retryable worker failures within five minutes; duplicate completed external side effects remain exactly zero.
- Document pool allocation, worker count, graceful-shutdown timeout, named-queue limits, payload-size limit, retention, and backlog thresholds.

## 10. UI/UX Requirements

- Preserve current queue/task-detail hierarchy while showing sanitized job state, attempts, next retry, failure category, handler version, and authorized next action.
- Retry/cancel/requeue controls require confirmation, prevent duplicate submission, retain focus, and announce results accessibly.
- Automate responsive screenshots and WCAG 2.2 AA checks for ready, running, retrying, failed, cancelled, and completed states; no manual UI evidence.

## 11. Deployment & Release Strategy

- Deploy schema expansion, adapter/read compatibility, task catalog/workers, migration tooling, and monitoring before one controlled full cutover.
- At cutover: stop new legacy claims, reconcile in-flight work, switch every supported producer, start Graphile workers, verify invariants, then remove legacy executable paths.
- This is not a pilot, canary cohort, percentage rollout, or shadow side-effect run.
- Rollback is automated, time-bounded, and ownership-safe: stop new work, freeze claims, reconcile ownership, and restore a compatible release without permitting two runtimes to execute the same job.

## 12. Monitoring & Observability

- SLOs: 99.9% scheduling availability, <0.1% runtime-attributable failure, 99% retry recovery within five minutes, and zero duplicate completed side effects.
- Metrics: enqueue/start/finish/retry/fail/cancel counts, queue depth/age, runtime, lock/retry delay, worker/pool saturation, unknown payloads, idempotency suppressions, and migration reconciliation.
- Correlate tenant-safe task, factory run, LangGraph thread, job, request, attempt, and audit identifiers in structured logs and traces.
- Commit dashboard, P0/P1/P2 alerts, synthetic jobs, alert tests, and linked operating/emergency runbooks.

## 13. Cost & Resource Impact

- Baseline and report worker compute, Postgres CPU/IO/storage, connections, wake-up traffic, retention, and operational maintenance before and after replacement.
- Set enforceable connection, worker, payload, retry, retention, and backlog budgets; no additional broker is introduced.
- Quantify custom queue code and deployment units removed versus Graphile dependency and operations added.

## 14. Dependencies & Risks

Blocking stories:

- [ ] #286 `GRAPHILE-01`: production runtime, schema, and job contracts.
- [ ] #287 `GRAPHILE-02`: complete workload and LangGraph dispatch migration.
- [ ] #288 `GRAPHILE-03`: operations, security, observability, API, and UI controls.
- [ ] #289 `GRAPHILE-04`: full production cutover and legacy queue removal.
- [ ] #290 `GRAPHILE-05`: production hardening, automated release gate, soak, and disaster recovery.

Coordinate #280 through #284 and their LangGraph Epic #285, especially runtime/persistence, full cutover, and production hardening.

Primary risks:

- At-least-once replay -> application idempotency and crash-boundary tests.
- Dual ownership during cutover -> explicit ownership epoch, freeze/reconcile/switch sequence, and fail-closed guards.
- Graphile internal schema coupling -> application adapter and public APIs only.
- Connection exhaustion -> measured pool partitioning, load tests, and alerts.
- Incomplete workload inventory -> static/runtime inventory gate blocks cutover.

Technical debt: no permanent legacy adapter, poller, lease/recovery loop, file queue, duplicate service unit, or dual writer may remain when this Epic closes.

## 15. Definition of Done

- All five child stories close with linked automated evidence and compliance checklists.
- All supported workloads use Graphile Worker and every handler proves replay-safe idempotency.
- Legacy queue code, executable migrations/import paths, pollers, recovery/retry loops, deployment units, flags, and production configuration are removed.
- Unit coverage >=95%, mutation >=80%, and all integration/E2E/contract/property/security/load/chaos/soak/DR gates pass.
- Migrations pass apply/rollback/apply and backup/restore drills.
- APIs, ADR, diagrams, runbooks, dashboards, alerts, dependency review, and cutover evidence are committed.
- `npm run standards:check` and `make verify` pass with no manual-test substitute.

## 16. Production Validation Strategy

- Add authenticated health/readiness plus a read-only or idempotent synthetic job covering enqueue, delivery, canonical write, audit, and status projection.
- Before cutover, automate staging multi-worker, crash/redelivery, retry exhaustion, concurrency, tenant isolation, shutdown, migration, and rollback tests.
- After full cutover, run immediate synthetic checks, five-minute scheduled checks, a 24-hour soak, and automated alert evaluation.
- The kill switch stops new delivery within two minutes; emergency recovery preserves canonical reads and prevents legacy fallback.

## 17. Compliance & Handoff

- Branch: `feature/graphile-worker-full-production-runtime` or scoped child branches.
- PRs link this Epic, the relevant child issue, LangGraph dependencies, compliance checklist, migrations, automated evidence, and rollback proof.
- Artifacts live under `tests/`, `docs/diagrams/`, `docs/api/`, `docs/runbooks/`, `monitoring/`, and redacted `observability/` paths.
- No manual testing is accepted. Archive the Epic only after full production cutover and verified legacy removal.
- Issue-authoring compliance on 2026-07-14: template section validation, source integrity, secret scanning, and `verify-standards.js` passed. The repository-wide `npm run standards:check` then stopped on three pre-existing maintainability-baseline failures in `lib/audit/milestone-d-closeout-verify.js` and `lib/task-platform/factory-delivery-shared.js`; those unrelated failures are not waived by this Epic and must be resolved or baselined through normal governance before implementation can claim a green compliance run.
