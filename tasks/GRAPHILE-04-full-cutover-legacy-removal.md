# [GRAPHILE-04] Cut over all production jobs to Graphile Worker and remove the legacy queues

Template Tier: Complex

Repo gates reviewed: `docs/standards/software-development-standards.md` and `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`.

## 1. User Story

As a platform owner, I want every supported production workload cut over to Graphile Worker and all superseded queue implementations removed, so that only one runtime can own and execute a semantic job.

Business context and success metrics: 100% of new jobs use Graphile Worker; every in-flight legacy item is reconciled; zero supported legacy entry points remain; no duplicate external side effect occurs during migration or rollback; and the change is a full cutover, not a pilot.

## 2. Acceptance Criteria

1. Given the approved producer/consumer inventory, when cutover completes, then APIs, event handlers, LangGraph dispatch, scripts, schedules, workers, and deployment units enqueue or execute through Graphile Worker only.
2. Given a legacy item is queued, leased, retrying, completed, or dead-lettered, when migration runs, then it is deterministically migrated, drained, stopped, or retained as immutable history according to the approved matrix.
3. Given a legacy item is actively executing at the freeze boundary, when reconciliation occurs, then ownership is resolved before Graphile can run the same semantic job.
4. Given the ownership epoch switches, when concurrent old/new processes attempt work, then stale legacy writers and claimers fail closed.
5. Given cutover verification succeeds, when cleanup runs, then custom Postgres/file queue modules, lease/recovery/retry/polling logic, obsolete scripts, service units, flags, configuration, and executable schema paths are removed.
6. Given rollback is triggered within the supported window, when automation runs, then new claims stop, ownership reconciles, schema remains compatible, and two runtimes never execute the same job.
7. Given any legacy reference or runtime metric appears after closure, when static/runtime compliance gates run, then deployment fails.
8. Given historical operators inspect pre-cutover work, when legacy executable tables/code are removed, then immutable audit and migration evidence remains available through supported reads.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence expected for this change: signed inventory, migration/reconciliation matrix, dry-run and production artifacts, ownership proof, deletion manifest, static/runtime gates, rollback test, and compliance output.
- Gap observed: a normal percentage rollout would create two potential job owners. Documented rationale: deploy compatibility in stages but perform one freeze/reconcile/switch full cutover with no percentage routing or silent fallback (source https://worker.graphile.org/docs).

## 3. Workflow & User Journey

1. Preflight validates all child gates, backups, workers, capacity, inventory, and rollback compatibility.
2. Stop new legacy claims/writes and record cutover epoch.
3. Drain or freeze active work; classify and reconcile every legacy item.
4. Switch all producers and workers, start Graphile ownership, and run automated invariants/synthetics.
5. Remove legacy executable paths and publish immutable evidence.
6. Generate `docs/diagrams/workflow-graphile-04.mmd`; cover late legacy writer, active lease, duplicate key, failed migration, partial deploy, rollback, and stale process.

## 4. Automated Test Deliverables

- Unit >=95% for classification, ownership epoch, mapping, reconciliation, cleanup detection, and rollback decisions.
- Real-Postgres integration for every legacy state and migration apply/rollback/apply; E2E per criterion; producer/consumer compatibility contracts.
- Property tests prove one owner per semantic key; mutation >=80% for migration/ownership gates; security tests reject stale/forged writers.
- 2x load during switch, process/DB/network chaos at every cutover step, browser/API regression, and versioned migration fixtures.
- Commands include migration dry-run/reconcile/static checks, full repo tests, `npm run standards:check`, and `make verify`.

## Required Evidence

- Commands run: migration dry-run, reconcile, ownership and legacy-reference checks, full repository tests, `npm run standards:check`, and `make verify`.
- Tests added or updated: migration state matrix, ownership epoch, concurrency, rollback, restore, producer/consumer compatibility, security, load, chaos, API/browser regression, and legacy-zero gates.
- Rollout or rollback notes: perform one freeze/reconcile/switch full production cutover with no pilot or percentage split; rollback requires one-owner proof and compatible schema.
- Docs updated: migration/cutover/rollback runbooks, ownership ADR, API deprecation, deletion manifest, LangGraph architecture, diagrams, and compliance checklist.

## 5. Data Model & Schema

- Add time-bounded ownership epoch/migration mapping needed for deterministic cutover; preserve immutable audit evidence.
- After verified rollback window, remove executable legacy queue tables/columns/functions using tested contract migrations; retain only explicitly required historical projection data.
- Generate `docs/diagrams/schema-graphile-04.mmd`.

## 6. Architecture & Integration

- Replace all imports/callers of `factory-delivery-queue-*`, `factory-delivery-file-queue`, legacy audit worker pollers, recovery/requeue logic, and duplicate deployment services identified by inventory.
- Update LangGraph cutover architecture: Graphile Worker is the sole outer job-delivery runtime and LangGraph is the sole supported factory workflow engine.
- Generate `docs/diagrams/architecture-graphile-04.mmd` and update the ownership ADR.

## 7. API Design

- Complete migration of compatible queue status/actions to `docs/api/job-runtime-openapi.yml`; remove legacy-only fields/routes only after automated consumer evidence and documented deprecation.
- Historical read compatibility must not preserve executable legacy mutations.

## 8. Security & Compliance

- Only approved cutover automation can change ownership epoch; authenticate, authorize, audit, and make it idempotent.
- Threats: stale process execution -> epoch guard; forged migration mapping -> canonical reconciliation/signature evidence; rollback double run -> global freeze and one-owner invariant.
- Backups and reports contain no secrets or unredacted sensitive payloads.

## 8a. Standardized Error Logging

- Stable sanitized codes: `job_cutover_preflight_failed`, `job_ownership_conflict`, `job_migration_unresolved`, `legacy_job_writer_blocked`, and `job_rollback_unsafe` through existing logging/error infrastructure.

## 8b. AI Implementation Guide

- Never delete before inventory/reconciliation evidence; never enable fallback execution; update all LangGraph documents/issues that name the custom queue as outer scheduler.

## 9. Performance & Scalability

- Cutover handles current backlog plus 2x expected arrival rate without exceeding normal latency SLO after stabilization.
- Define freeze/drain/reconcile time budgets and fail closed when exceeded.

## 10. UI/UX Requirements

- Existing task/queue screens remain available during the short freeze with accurate draining/unavailable state; no misleading success or duplicate action.
- Automate responsive visual/accessibility regression for cutover and historical states.

## 11. Deployment & Release Strategy

- Full sequence: preflight -> backup -> freeze legacy starts/claims -> drain/reconcile -> set ownership epoch -> switch 100% of producers/workers -> verify -> remove legacy -> unfreeze.
- No pilot, canary cohort, percentage split, shadow side effect, or permanent dual runtime.
- Rollback is allowed only while schema/code compatibility and one-owner proof pass; otherwise kill switch and forward recovery are required.

## 12. Monitoring & Observability

- Cutover dashboard shows legacy/new enqueue and execution counts, unresolved mappings, ownership conflicts, backlog/age, worker health, idempotency suppressions, and synthetic status.
- Alert if any legacy writer/claimer metric is nonzero after epoch switch.

## 13. Cost & Resource Impact

- Report custom modules, scripts, services, config, tests, operational storage, and maintenance burden removed; validate no orphan runtime cost remains.

## 14. Dependencies & Risks

- Requires `GRAPHILE-01/02/03` and production gate from `GRAPHILE-05`; coordinates with `LANGGRAPH-04/05` and blocks their final production claim if job delivery is not migrated.
- Risks: incomplete inventory, active legacy lease, migration ambiguity, unsafe rollback, historical data loss. Mitigate with gates, freeze/reconcile, immutable evidence, restore tests, and fail-closed ownership.

## 15. Definition of Done

- 100% of supported jobs use Graphile; all legacy executable paths and deployment units are removed; one-owner static/runtime gates pass.
- Migration, rollback, restore, API/browser compatibility, docs, diagrams, deletion manifest, compliance, and repository verification evidence pass.

## 16. Production Validation Strategy

- Run automated preflight and dry-run on a production-like snapshot, then immediate post-switch synthetics, reconciliation, legacy-zero checks, and the `GRAPHILE-05` soak/DR gate.

## 17. Compliance & Handoff

- Parent Epic: #291. Requires #286, #287, #288, and production gate #290; coordinates and blocks final closure of LangGraph cutover #283 and hardening #284.
- PRs and cutover change record link these issues, migration evidence, deletion manifest, and `docs/reports/ISSUE-289_STANDARDS_COMPLIANCE_CHECKLIST.md`.
