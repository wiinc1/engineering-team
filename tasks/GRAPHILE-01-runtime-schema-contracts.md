# [GRAPHILE-01] Build the production Graphile Worker runtime, schema, and job contracts

Template Tier: Complex

Repo gates reviewed: `docs/standards/software-development-standards.md` and `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`.

## 1. User Story

As a platform engineer, I want a pinned Graphile Worker runtime behind an application-owned job port, so that every producer and handler can migrate to a secure, versioned, testable Postgres job-delivery contract.

Business context and success metrics: initialize against the supported Node 22/Postgres environment; validate 100% of registered payloads; expose no Graphile internals to domain modules; and prove enqueue, claim, retry, graceful shutdown, and migration rollback with real Postgres automation.

## 2. Acceptance Criteria

1. Given production configuration, when the worker starts, then pinned Graphile Worker migrations and runtime initialize with the approved schema, TLS, pool, and least-privilege role.
2. Given a registered task and valid versioned payload, when the application job port enqueues it, then its semantic job key, named queue, retry policy, correlation, and registry record are persisted.
3. Given an unknown task, unsupported version, oversized payload, secret-like field, or schema-invalid payload, when enqueue or execution is attempted, then it fails closed with a sanitized stable error and no job runs.
4. Given concurrent workers, when eligible jobs are ready, then locking and named-queue serialization behave deterministically.
5. Given SIGTERM during active work, when the shutdown deadline is reached, then new claims stop, eligible work completes or is safely redelivered, and readiness reflects draining.
6. Given migrations run on empty and populated databases, when apply/rollback/apply and schema-diff validation complete, then no canonical task/audit data is changed.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence expected for this change: dependency review, ADR, schema/workflow/C4 diagrams, migrations, real-Postgres tests, payload contracts, graceful-shutdown tests, and compliance output.
- Gap observed: Graphile Worker is an operational delivery dependency, not a domain model. Documented rationale: the application port and registry prevent coupling business logic to internal worker tables (source https://worker.graphile.org/docs).

## 3. Workflow & User Journey

1. Producer submits a typed job through the application port.
2. The adapter validates payload/task/version, calculates the semantic key, and enqueues transactionally where required.
3. A registered handler receives correlation and tenant context, records outcome, and returns or throws for retry.
4. Generate `docs/diagrams/workflow-graphile-01.mmd` and cover invalid payload, duplicate key, DB outage, pool exhaustion, unknown task, and shutdown races.

## 4. Automated Test Deliverables

- Unit coverage >=95% for schemas, task catalog, job keys, retry/concurrency policy, registry mapping, errors, and redaction.
- Real-Postgres integration for setup, enqueue, claim, retry, deduplication, concurrency, LISTEN/NOTIFY, pool use, and shutdown.
- E2E for every acceptance criterion; contract tests for producer/handler payloads; property tests for payload/job-key invariants; mutation >=80% for critical decisions.
- Security/dependency/secrets tests plus 2x load and worker/DB network-chaos tests.
- Commands include focused suites, `npm test`, `npm run test:integration:docker`, `npm run test:security`, `npm run standards:check`, and `make verify`.

## Required Evidence

- Commands run: focused Graphile suites, `npm test`, `npm run test:integration:docker`, `npm run test:security`, `npm run standards:check`, and `make verify`.
- Tests added or updated: unit, real-Postgres integration, E2E, contract, property, mutation, security, performance, and chaos coverage for runtime/schema/contracts.
- Rollout or rollback notes: deploy schema/runtime disabled for production claims until full cutover; rollback uses tested migrations and no pilot or shadow execution.
- Docs updated: ADR, dependency review, runtime/configuration docs, runbook, schema/workflow/C4 diagrams, and compliance checklist.

## 5. Data Model & Schema

- Dedicated Graphile schema plus application-owned job delivery registry with tenant, workload identity, semantic key, task/payload version, Graphile reference, canonical resource, status summary, timestamps, and correlation metadata.
- Add constraints, indexes, retention, least-privilege grants, backup classification, apply/rollback/apply, and schema-diff automation.
- Generate `docs/diagrams/schema-graphile-01.mmd`.

## 6. Architecture & Integration

- Add pinned `graphile-worker` dependency and `lib/job-runtime/` port/adapter/task-catalog boundary; domain modules cannot import Graphile APIs.
- Share the approved Postgres connection posture while reserving measured pool capacity for API, LangGraph checkpoint, and worker workloads.
- `ff_graphile_worker_cutover` remains off until full cutover; this story creates production code, not a pilot path.
- Generate `docs/diagrams/architecture-graphile-01.mmd` and the job-runtime ADR.

## 7. API Design

- Define internal versioned enqueue and handler contracts plus health/readiness shape; operational HTTP routes are delivered in `GRAPHILE-03`.
- Stable errors: `job_runtime_unavailable`, `job_task_unknown`, `job_payload_invalid`, `job_version_unsupported`, and `job_schedule_conflict`.

## 8. Security & Compliance

- Allowlisted task names and JSON schemas only; no arbitrary module, command, SQL, credential, cookie, token, or executable payload.
- Threat tests: forged task -> reject; cross-tenant canonical reference -> reject; payload/log secret -> redact and fail validation.
- Require least-privilege grants, dependency provenance/license review, SAST, secrets scan, and zero unresolved high/critical findings.

## 8a. Standardized Error Logging

- Use existing `createAuditLogger`/error envelope, never `console.*`; include tenant-safe job/task/request correlation and sanitized errors.

## 8b. AI Implementation Guide

- Wrap Graphile behind the job port, use public supported APIs only, keep handlers out of this foundational story, and never treat job completion as canonical business completion.

## 9. Performance & Scalability

- Enqueue p95 <100 ms/p99 <250 ms; ready-to-start p95 <2 s; validate 2x expected QPS for 10 minutes without pool starvation.
- Document pool partition, worker concurrency, payload maximum, graceful-shutdown timeout, and retention capacity.

## 10. UI/UX Requirements

- No new screen. Existing UI remains unchanged and browser regression, accessibility, and visual tests pass; health data is sanitized for later operational UI use.

## 11. Deployment & Release Strategy

- Deploy schema/runtime disabled for production claims, validate migrations and readiness, then hand off to workload migration. No pilot or shadow side effects.
- Rollback removes compatible expansion artifacts only after automated ownership and schema checks.

## 12. Monitoring & Observability

- Emit enqueue/claim/finish/retry/fail, queue age/depth, runtime, pool, shutdown, validation failure, and unknown-version metrics with traces and alert-test fixtures.

## 13. Cost & Resource Impact

- Record dependency, worker compute, Postgres connection/IO/storage, registry retention, and removed-maintenance baseline.

## 14. Dependencies & Risks

- Blocks `GRAPHILE-02`, `GRAPHILE-03`, and `GRAPHILE-04`; coordinates with `LANGGRAPH-01` runtime/persistence.
- Risks: pool exhaustion, internal-schema coupling, invalid job versions, and dependency drift; mitigate with adapter, budgets, contracts, and pinning.

## 15. Definition of Done

- Runtime, schema, registry, port, task catalog, migrations, docs, diagrams, dependency review, observability, and automated tests are committed.
- Required compliance and repository verification commands pass; no manual testing or production pilot is used.

## 16. Production Validation Strategy

- Automated health/readiness and an idempotent synthetic task prove enqueue-to-handler behavior, shutdown, and database recovery in staging.

## 17. Compliance & Handoff

- Parent Epic: #291. Coordinate LangGraph runtime/persistence issue #280; this issue blocks #287, #288, #289, and #290.
- PR links #291 and #280, includes migration/rollback proof and `docs/reports/ISSUE-286_STANDARDS_COMPLIANCE_CHECKLIST.md`, and records exact command evidence.
