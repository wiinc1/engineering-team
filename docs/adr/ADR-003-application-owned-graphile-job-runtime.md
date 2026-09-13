# ADR-003: Application-owned Graphile job runtime boundary

## Status

Accepted for issue #286 and extended by issue #287 for the complete supported workload catalog.

## Context

The platform needs durable PostgreSQL job delivery without making Graphile Worker a domain model. Producers require stable task, payload, deduplication, retry, queue, tenant, and correlation contracts. Operators require safe migrations, bounded connection use, health/readiness, graceful draining, retention, and sanitized telemetry. Domain completion remains in canonical task and audit state; a successful worker callback is only delivery acknowledgment.

Issue #280 establishes the coordinated LangGraph runtime/persistence posture. This decision reserves shared pool capacity for API and checkpoint work but does not implement LangGraph persistence or migrate any workload.

## Decision

- Pin `graphile-worker` at `0.17.3` and isolate every Graphile import and Graphile schema reference in `lib/job-runtime/graphile-adapter.js`.
- Expose the application-owned `JobRuntimePort`, immutable versioned task catalog, strict JSON schemas, semantic job keys, named queues, bounded retries, and an application delivery registry.
- Store no job payload in the application registry. Never accept credentials, cookies, tokens, database locations, SQL, commands, executable content, or arbitrary module names in payloads.
- Use only supported Graphile public APIs for migrations, enqueue, run, completion compensation, stop, kill, and release.
- Keep the Graphile schema opaque outside the adapter. The application registry stores only an opaque Graphile job reference and never joins to Graphile tables.
- Share the existing verified PostgreSQL TLS/pool factory. With the default pool maximum of 10, reserve 4 connections and cap every job-runtime acquisition through a six-slot facade over the same physical pool. Graphile claims, listener, housekeeping, registry/effect queries, and producers use the facade; API and coordinated LangGraph checkpoint consumers retain the original shared pool. Worker concurrency remains 4 inside that ceiling.
- Partition claims with public named-queue locks into factory, projection, outbox, and maintenance classes. One four-slot runner and one queue for each class provides 1/1/1/1 capacity without extra listener connections.
- Register all seven supported migrated workloads in an immutable versioned catalog. Sign and verify the source inventory, and fail static/runtime completeness checks when a supported producer, consumer, loop, cron, recovery job, or catalog handler is missing.
- Guard each canonical or external effect with a deterministic application-owned effect key and payload-free ledger. The owning adapter must query its canonical effect boundary before replay. Exactly-once applies to that business effect, never to Graphile delivery.
- Reauthorize tenant and canonical resource ownership in every handler. Payload tenant claims and mutable business objects are prohibited.
- Default `FF_GRAPHILE_WORKER_CUTOVER=false`. Disabled means production-ready standby, not a pilot, shadow consumer, or percentage rollout.
- Treat `delivery_acknowledged` as an operational delivery state only. Canonical business completion must be recorded by the owning domain workflow.
- Retain terminal delivery metadata for 30 days by default, prune at most 1,000 rows per hourly run, and never prune active deliveries.
- Treat operational registry reads as part of the hosted load SLO. The 2x/10-minute gate records `operational_read_p95_ms` from application-owned delivery lookups and fails at 250 ms or above, alongside enqueue, ready-to-start, pool, delivery-loss, and residual-cleanup budgets.

## Consequences

The application contract remains stable if Graphile internals change. Producers and handlers can be tested without importing the dependency. Database setup requires explicit migrator, producer, and worker roles. The worker role can mutate Graphile-owned delivery state and update/delete only application delivery metadata; it has no canonical task or audit mutation grant.

Operational HTTP routes remain deferred to issue #288. Issue #287 supplies producers, handlers, schedules, typed LangGraph injection contracts, replay guards, and migration `017`; legacy entrypoint removal and production cutover remain issue #289. Issues #280–#282 own the LangGraph runtime and persistence implementation.

## Alternatives considered

- Direct Graphile calls from domain modules were rejected because they expose dependency types, internal lifecycle assumptions, and storage details.
- Treating successful callback return as business completion was rejected because delivery acknowledgment cannot replace canonical domain state.
- Percentage, pilot, or shadow rollout was rejected because issue #286 requires the complete production runtime while claims remain exactly disabled until coordinated cutover.
- Storing payloads in the registry was rejected to reduce secret exposure, retention cost, and replay ambiguity.

## Standards Alignment

- Applicable standards areas: architecture and design; coding and code quality; security; testing and quality assurance; deployment and release; observability and monitoring; team and process.
- Evidence expected for this change: `lib/job-runtime/`, migrations `016` and `017`, database roles, inventory signature/completeness gates, contract/security/chaos/load tests, Graphile-02 diagrams, dependency review, runbook, and issue checklist.
- Evidence in this decision: Graphile imports and schema knowledge are isolated to one adapter; domain completion remains canonical and separate from delivery acknowledgment.
- Gap observed: Graphile Worker is an operational delivery dependency, not a domain model. Documented rationale: the application port and registry prevent business code from depending on worker storage and supported APIs are isolated to one adapter (source https://worker.graphile.org/docs).

## Required Evidence

- Commands run: the exact results are recorded in `docs/reports/ISSUE-287_STANDARDS_COMPLIANCE_CHECKLIST.md`.
- Tests added or updated: inventory, producer/handler, replay/effect, E2E AC1–AC7, property, security, performance/load, fairness, chaos, mutation, and real-Postgres migration suites.
- Rollout or rollback notes: keep claims disabled, drain, and retain legacy entrypoints until #289. Migration `017` rollback refuses a populated effect ledger and never alters canonical task, audit, queue, or checkpoint data.
- Docs updated: runtime contract, configuration, dependency review, runbook, diagrams, alert fixtures, ADR, and compliance checklist.
