# [LANGGRAPH-01] Build the production LangGraph runtime, typed state, and Postgres persistence

Template Tier: Complex

## 1. User Story

As a factory platform engineer, I want a production LangGraph runtime with typed state and durable Postgres checkpoints, so that every lifecycle node can resume safely across worker restarts.

Success metrics: graph compilation is deterministic; checkpoint/resume works across processes; tenant isolation is enforced; checkpointed execution adds no duplicate side effects; and no in-memory saver is reachable in production.

## 2. Acceptance Criteria

1. Given production configuration, when the runtime starts, then pinned LangGraph and Postgres checkpointer packages initialize through the existing `pg` pool and dedicated schema.
2. Given a factory run, when a checkpoint is written, then its thread ID, namespace, graph version, tenant binding, state schema version, and timestamps are durable and queryable.
3. Given a worker dies after a node checkpoint, when another worker resumes the thread, then it continues at the next eligible node.
4. Given invalid, oversized, secret-bearing, cross-tenant, or unsupported-version state, when validation runs, then execution fails closed before graph invocation.
5. Given migrations are applied, rolled back, and reapplied, when schema verification runs, then no task/audit/queue data is lost.
6. Given production mode, when an in-memory or file checkpointer is selected, then startup fails with a stable configuration error.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring.
- Evidence expected for this change: ADR, state/schema diagrams, dependency review, migrations, typed validation, checkpoint integration tests, tenant security tests, performance results, and rollback evidence.
- Gap observed: The current runtime persists coarse phase evidence but later phases can require same-process context. Documented rationale: Postgres checkpoints must make process-local phase context durable before the full graph can replace the sequencer (source https://docs.langchain.com/oss/javascript/langgraph/persistence).

## 3. Workflow & User Journey

- Queue claim -> runtime factory -> typed graph config -> tenant-bound Postgres thread -> checkpoint -> audit metric.
- Resume -> validate tenant/version/state -> load checkpoint -> invoke next node.
- Errors include pool exhaustion, migration mismatch, corrupt state, serializer rejection, stale graph version, and concurrent resume.
- Generate workflow, schema, and C4 diagrams named with `langgraph-01`.

## 4. Automated Test Deliverables

- Unit: state schema, reducers, serializers, thread identity, runtime configuration, size/redaction guards, and errors at 95%+ coverage.
- Integration: Docker Postgres setup, checkpoint/list/history/resume, concurrent access, pool reuse, migration apply/rollback/apply, and tenant isolation.
- Contract/property/security: checkpointer adapter contract, arbitrary state validation, secret rejection, and hostile checkpoint payloads.
- Performance/chaos: checkpoint latency budget, DB interruption, worker kill, recovery, and pool saturation.
- E2E scenario for each acceptance criterion; fixtures for every supported graph/state version.

## Required Evidence

- Commands run: At closeout record focused LangGraph tests plus `npm run test:integration:docker`, `npm run test:security`, `npm run test:performance`, `npm run standards:check`, and `make verify`.
- Tests added or updated: Runtime/state/checkpointer unit, integration, contract, property, security, performance, and chaos suites.
- Rollout or rollback notes: Expand schema first; this story does not route production work independently. Rollback removes unused checkpoint objects only after verifying no active graph thread references them.
- Docs updated: ADR, dependency inventory, architecture/state/schema diagrams, migration notes, configuration reference, and checkpoint operations runbook.

## 5. Data Model & Schema

- Dedicated LangGraph checkpoint schema plus application-owned thread registry containing tenant ID, factory run ID, graph/state version, status, and retention metadata.
- Unique tenant/run/thread constraints, indexed active/stale queries, JSON size limits, UTC timestamps, and no secrets.
- Checkpoints remain execution state; canonical task and audit stores remain authoritative.

## 6. Architecture & Integration

- Create a framework adapter boundary under `lib/software-factory/langgraph/`; domain node interfaces must not depend on LangGraph types.
- Pin `@langchain/langgraph` and `@langchain/langgraph-checkpoint-postgres`; use the existing pool and TLS posture.
- Add health, setup, close, and test factories with explicit timeouts and pool limits.
- Feature controls: full runtime enable flag and global kill switch; no percentage targeting or pilot mode.

## 7. API Design

- Add internal runtime health and checkpoint-summary contracts only; never expose raw checkpoint values.
- Preserve existing API version and standardized auth/error envelope.
- Contract tests cover redaction, tenant filtering, and unavailable/unsupported states.

## 8. Security & Compliance

- Threats: checkpoint tampering -> strict state validation; tenant ID guessing -> server-derived tenant binding; secret persistence -> allowlisted schema plus automated secret scanning.
- Resume authorization is deferred to LANGGRAPH-03, but storage methods require tenant context now.
- Dependency review must record licenses, vulnerabilities, transitive packages, and update policy.

## 8a. Standardized Error Logging

- Use `createAuditLogger` and existing error envelopes; log only redacted run/thread/node/version identifiers.
- Stable error codes for configuration, migration, checkpoint availability, state validation, version, concurrency, and tenant mismatch.

## 8b. AI Implementation Guide

- Use structured schemas, deterministic reducers, JSON-serializable state, and explicit version migrations.
- Do not call external side effects from persistence adapters or use in-memory production fallbacks.

## 9. Performance & Scalability

- Checkpoint write p95 <100 ms local and <250 ms hosted staging; read p95 <150 ms local and <300 ms hosted staging.
- Pool usage stays within configured worker limits; retention keeps projected storage inside the documented monthly budget.
- Load test at 2x expected concurrent active graph threads for 10 minutes.

## 10. UI/UX Requirements

- No user-facing screen ships in this story. It supplies sanitized checkpoint summaries consumed by LANGGRAPH-03; existing UI must remain unchanged and browser regression tests must pass.

## 11. Deployment & Release Strategy

- Expand-only schema and dormant runtime deployment, followed by automated setup/health verification.
- No pilot traffic and no graph execution cutover in this story.
- Rollback is schema-compatible and automated; RTO <15 minutes.

## 12. Monitoring & Observability

- Metrics for checkpoint reads/writes/errors/latency/size, active/stale threads, pool saturation, and version mismatches.
- Alerts for unavailable checkpoint storage, high latency, corruption, and tenant rejection spikes.

## 13. Cost & Resource Impact

- Estimate and record Postgres checkpoint storage, IO, backup, and connection-pool growth before implementation approval; default paid third-party cost is $0 because LangSmith is not required.
- Enforce retention, checkpoint-size, worker-concurrency, and pool quotas so measured monthly infrastructure cost stays within the approved estimate.

## 14. Dependencies & Risks

- Blocks LANGGRAPH-02, LANGGRAPH-03, and LANGGRAPH-04.
- Risks: schema ownership ambiguity, large checkpoints, package churn, and pool exhaustion. Mitigate with ADR, size budgets, pinned versions, compatibility fixtures, and load tests.
- No permanent technical debt or alternate production saver is allowed.

## 15. Definition of Done

- Runtime, state schemas, Postgres saver, migrations, health, metrics, docs, and all automated tests are committed.
- Production rejects non-Postgres savers and invalid/cross-tenant state.
- Crash/resume and migration rollback tests pass; coverage and mutation thresholds pass.

## 16. Production Validation Strategy

- Automated health verifies schema, pool, write/read/delete of a synthetic tenant-safe checkpoint, and graph version compatibility.
- Staging crash/resume, DB failover, pool saturation, backup/restore, and alert tests pass before dependency sign-off.
- Kill switch disables new graph invocation without deleting checkpoints.

## 17. Compliance & Handoff

- PR links LANGGRAPH-EPIC and includes dependency review, ADR, migrations, diagrams, tests, redacted metrics, and compliance output.
- No manual testing is completion evidence.
