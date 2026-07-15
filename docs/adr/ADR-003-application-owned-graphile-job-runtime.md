# ADR-003: Application-owned Graphile job runtime boundary

## Status

Accepted for issue #286. Workload migration remains blocked on issue #287.

## Context

The platform needs durable PostgreSQL job delivery without making Graphile Worker a domain model. Producers require stable task, payload, deduplication, retry, queue, tenant, and correlation contracts. Operators require safe migrations, bounded connection use, health/readiness, graceful draining, retention, and sanitized telemetry. Domain completion remains in canonical task and audit state; a successful worker callback is only delivery acknowledgment.

Issue #280 establishes the coordinated LangGraph runtime/persistence posture. This decision reserves shared pool capacity for API and checkpoint work but does not implement LangGraph persistence or migrate any workload.

## Decision

- Pin `graphile-worker` at `0.17.3` and isolate every Graphile import and Graphile schema reference in `lib/job-runtime/graphile-adapter.js`.
- Expose the application-owned `JobRuntimePort`, immutable versioned task catalog, strict JSON schemas, semantic job keys, named queues, bounded retries, and an application delivery registry.
- Store no job payload in the application registry. Never accept credentials, cookies, tokens, database locations, SQL, commands, executable content, or arbitrary module names in payloads.
- Use only supported Graphile public APIs for migrations, enqueue, run, completion compensation, stop, kill, and release.
- Keep the Graphile schema opaque outside the adapter. The application registry stores only an opaque Graphile job reference and never joins to Graphile tables.
- Share the existing verified PostgreSQL TLS/pool factory. With the default pool maximum of 10, reserve 4 connections and cap worker concurrency at 4, leaving 6 non-reserved slots.
- Default `FF_GRAPHILE_WORKER_CUTOVER=false`. Disabled means production-ready standby, not a pilot, shadow consumer, or percentage rollout.
- Treat `delivery_acknowledged` as an operational delivery state only. Canonical business completion must be recorded by the owning domain workflow.
- Retain terminal delivery metadata for 30 days by default, prune at most 1,000 rows per hourly run, and never prune active deliveries.

## Consequences

The application contract remains stable if Graphile internals change. Producers and handlers can be tested without importing the dependency. Database setup requires explicit migrator, producer, and worker roles. The worker role can mutate Graphile-owned delivery state and update/delete only application delivery metadata; it has no canonical task or audit mutation grant.

Operational HTTP routes are intentionally deferred to issue #288. Workload migration and cutover are intentionally deferred to issue #287.

## Alternatives considered

- Direct Graphile calls from domain modules were rejected because they expose dependency types, internal lifecycle assumptions, and storage details.
- Treating successful callback return as business completion was rejected because delivery acknowledgment cannot replace canonical domain state.
- Percentage, pilot, or shadow rollout was rejected because issue #286 requires the complete production runtime while claims remain exactly disabled until coordinated cutover.
- Storing payloads in the registry was rejected to reduce secret exposure, retention cost, and replay ambiguity.

## Standards Alignment

- Applicable standards areas: architecture and design; coding and code quality; security; testing and quality assurance; deployment and release; observability and monitoring; team and process.
- Evidence expected for this change: `lib/job-runtime/`, migrations `016`, database roles, contract/security/chaos/load tests, three Mermaid diagrams, dependency review, runbook, and issue checklist.
- Evidence in this decision: Graphile imports and schema knowledge are isolated to one adapter; domain completion remains canonical and separate from delivery acknowledgment.
- Gap observed: Graphile Worker is an operational delivery dependency, not a domain model. Documented rationale: the application port and registry prevent business code from depending on worker storage and supported APIs are isolated to one adapter (source https://worker.graphile.org/docs).

## Required Evidence

- Commands run: `npm run test:graphile`; `npm run test:graphile:coverage`; `npm run test:graphile:mutation`; `npm run test:integration:docker`; `npm run test:graphile:load`; repository gates listed in the issue checklist.
- Tests added or updated: unit, contract, E2E, property, security, performance/load, chaos, mutation, and real-Postgres integration suites under the issue checklist.
- Rollout or rollback notes: keep claims disabled, drain the worker, verify the registry is empty, run the scoped down migration, then reapply migration `016` if restoring the runtime. Rollback refuses a populated registry.
- Docs updated: runtime contract, configuration, dependency review, runbook, diagrams, alert fixtures, ADR, and compliance checklist.
