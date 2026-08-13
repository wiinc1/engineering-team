# [GRAPHILE-02] Migrate all background workloads and LangGraph dispatch to Graphile Worker

Template Tier: Complex

Repo gates reviewed: `docs/standards/software-development-standards.md` and `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`.

## 1. User Story

As an engineering-factory operator, I want every supported producer and worker implemented as a registered Graphile Worker task, so that factory delivery, LangGraph start/resume, audit projections, outbox delivery, and scheduled maintenance share one delivery runtime.

Business context and success metrics: inventory 100% of producers/consumers; migrate each supported workload; prove replay-safe side effects; retain existing public behavior; and leave no supported workload dependent on bespoke lease/retry logic at cutover.

## 2. Acceptance Criteria

1. Given a factory run becomes executable, when scheduled, then Graphile Worker invokes the tenant-bound LangGraph start/resume adapter exactly once at the business-effect boundary.
2. Given audit projection or outbox work exists, when delivered, then registered handlers preserve ordering, idempotency, catch-up, and canonical audit contracts.
3. Given scheduled maintenance or recovery is due, when its cron schedule fires, then the registered task runs with bounded overlap and records auditable evidence.
4. Given a handler crashes before or after a side effect, when redelivery occurs, then canonical/idempotency checks prevent duplicate GitLab, GitHub, deployment, notification, task, audit, or checkpoint effects.
5. Given work for different tenants/resources can run concurrently, when multiple workers execute, then throughput increases without crossing tenant or required ordering boundaries.
6. Given a producer or legacy worker is omitted from the workload inventory, when the static/runtime completeness gate runs, then release is blocked.
7. Given current API/browser consumers execute, when backend delivery is Graphile-based, then their status, next-action, audit, and error contracts remain compatible.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence expected for this change: signed workload inventory, producer/consumer contract matrix, handler tests, replay proof, LangGraph correlation, diagrams, and compliance output.
- Gap observed: successful job completion cannot prove an external effect happened only once. Documented rationale: each migrated handler must use the existing canonical record or idempotency ledger as its effect boundary (source https://worker.graphile.org/docs/tasks).

## 3. Workflow & User Journey

1. Business event/API/schedule enqueues a versioned task through the shared port.
2. Graphile Worker delivers it to the mapped handler with tenant and correlation context.
3. Factory handler starts/resumes LangGraph; audit/outbox/projection handlers call their existing domain services.
4. Handler records canonical result and audit evidence; retryable errors throw, terminal business outcomes return explicitly.
5. Generate `docs/diagrams/workflow-graphile-02.mmd`; cover duplicates, ordering, cancellation, stale versions, partial side effects, and dependency outage.

## 4. Automated Test Deliverables

- Unit >=95% for every handler, payload adapter, effect idempotency guard, retry classifier, and workload policy.
- Real-Postgres integration for factory/LangGraph, audit projection, outbox, cron, concurrency, retry, and crash/redelivery.
- E2E per acceptance criterion; contracts with all producers/consumers; property tests for replay/order; mutation >=80% for side-effect and retry decisions.
- Security, 2x load, worker/process/DB/network chaos, and browser regression automation; versioned tenant-separated fixtures.
- Commands: focused handler suites plus `npm test`, Docker integration, security/performance, `npm run standards:check`, and `make verify`.

## Required Evidence

- Commands run: focused handler suites, `npm test`, Docker integration, security/performance checks, `npm run standards:check`, and `make verify`.
- Tests added or updated: every producer/handler, LangGraph start/resume, audit projection, outbox, cron, replay, ordering, concurrency, contract, security, performance, and chaos suites.
- Rollout or rollback notes: ship compatible handlers before one full cutover; no pilot, percentage routing, shadow side effects, or dual ownership is permitted.
- Docs updated: workload inventory, producer/consumer matrix, job catalog, architecture/runbook, API contract, diagrams, and compliance checklist.

## 5. Data Model & Schema

- Extend only the application delivery registry/idempotency records needed for workload identity, effect completion, handler version, ordering key, and correlation.
- Use expand-contract and apply/rollback/apply tests; do not duplicate canonical task, audit, evidence, approval, or LangGraph state in job payloads.
- Generate `docs/diagrams/schema-graphile-02.mmd`.

## 6. Architecture & Integration

- Registered tasks include factory LangGraph start/resume, projection catch-up, audit outbox delivery, and every scheduled/recovery workload found by the inventory.
- Preserve domain service boundaries; task handlers translate delivery context and classify retryability only.
- Define task-specific timeout, max attempts, backoff, named-queue concurrency, job key, and cancellation semantics.
- Generate `docs/diagrams/architecture-graphile-02.mmd`.

## 7. API Design

- Public API compatibility is additive; update `docs/api/job-runtime-openapi.yml` and contracts for sanitized workload/status fields.
- Internal job payloads carry identifiers and versions, not embedded secrets or mutable full business objects.

## 8. Security & Compliance

- Bind jobs to canonical tenant/resource records; handlers reauthorize sensitive actions rather than trusting payload claims.
- Threats: cross-tenant forged reference -> canonical lookup rejection; replay -> idempotency/effect ledger; payload injection -> strict schema/allowlist.
- Audit schedule, start, retry exhaustion, cancellation, and terminal result without logging secrets or sensitive payload bodies.

## 8a. Standardized Error Logging

- Use existing structured logger/error taxonomy with workload, job, attempt, task/run/thread, request, and tenant-safe correlation; no `console.*`.

## 8b. AI Implementation Guide

- Build the inventory before implementation, migrate one handler contract at a time behind the common port, and prove replay behavior at every external-effect boundary.

## 9. Performance & Scalability

- Queue-to-handler p95 <2 s; projection/outbox backlog stays within current SLO; 2x expected workload runs for 10 minutes without pool starvation.
- Configure fair concurrency so long factory jobs cannot starve audit/outbox processing.

## 10. UI/UX Requirements

- Preserve current task detail/queue views; expose only stable sanitized status supplied by `GRAPHILE-03`. Run automated visual, accessibility, and responsive regression tests.

## 11. Deployment & Release Strategy

- Ship all handlers and compatibility adapters before the single full cutover; they must not create shadow side effects or percentage routing.
- Rollback tests prove one delivery owner per semantic job and safe LangGraph checkpoint resume.

## 12. Monitoring & Observability

- Per-task metrics/traces for enqueue, start, duration, retry, failure, effect suppression, backlog age, and LangGraph thread correlation; alert on unknown tasks and starvation.

## 13. Cost & Resource Impact

- Measure workload-specific compute, Postgres IO/connections, payload storage, and throughput; set worker-class budgets.

## 14. Dependencies & Risks

- Requires `GRAPHILE-01`; coordinates with `LANGGRAPH-01/02/03`; blocks `GRAPHILE-04`.
- Risks: omitted producer, starvation, ordering change, replayed effects, oversized payloads. Mitigate with inventory gate, named queues, contracts, idempotency, and limits.

## 15. Definition of Done

- All supported workloads are registered, versioned, replay-safe, observable, and covered by automated evidence.
- Inventory completeness, compatibility, compliance, and repository verification gates pass; legacy execution is removed in `GRAPHILE-04`.

## 16. Production Validation Strategy

- Automated staging matrix executes each workload normally and with crash-before-effect, crash-after-effect, dependency outage, concurrency, and shutdown injection.

## 17. Compliance & Handoff

- Parent Epic: #291. Requires #286; coordinates LangGraph issues #280, #281, and #282; blocks #288, #289, and #290.
- PR links these issues, inventory, diagrams, contracts, and `docs/reports/ISSUE-287_STANDARDS_COMPLIANCE_CHECKLIST.md`.
