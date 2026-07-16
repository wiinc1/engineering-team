# Job runtime internal contract v1

This is an additive in-process contract, not an HTTP endpoint. Issue #287 changes no public API, browser route, status, next-action, audit, or error response. Issue #288 owns operational HTTP exposure; the components-only OpenAPI artifact documents the compatibility boundary without adding paths.

## Producer contract

`WorkloadProducers` calls only `port.enqueue(serverContext, request)`. Server context supplies tenant, correlation, request, and trace identity. Requests contain an allowlisted task/version, workload identifier, canonical resource identity, immutable versions, and optional bounded schedule. They never contain credentials, database locations, SQL, commands, scripts, prompts, module names, executable content, or mutable business objects. The port reauthorizes canonical ownership, supplies handler/order versions, semantic key, named queue, priority, retry, timeout, and Graphile envelope.

The supported methods are `factoryStart`, `factoryResume`, `auditProjection`, `auditOutbox`, `sreMonitoringExpiry`, `factoryReconciliation`, and `registryRetention`. Their exact payloads and consumers are in `job-runtime-workloads.md` and the signed inventory.

## Handler and replay contract

Handlers receive schema-validated data and immutable delivery/tenant/workload/correlation/attempt/abort context. They resolve and reauthorize the canonical tenant/resource again before any sensitive operation. LangGraph and outbox adapters are typed injected dependencies: each operation accepts deterministic `effectKey`, each external adapter exposes `lookupEffect`, and cancellation uses the supplied abort signal.

At an effect boundary the handler must observe an already-completed canonical effect and safely acknowledge, perform and record the effect, or throw a classified retryable error. Terminal business errors are sanitized and recorded explicitly. A Graphile callback return is delivery acknowledgment only. Exactly-once describes the canonical effect keyed by tenant/task/category/resource/version, never at-least-once Graphile delivery.

## Stable errors and safety

- `job_runtime_unavailable`: retryable infrastructure/dependency or in-progress effect.
- `job_task_unknown`: task/handler is not allowlisted.
- `job_payload_invalid`: identity, tenant, authorization, size, secret, JSON shape, schedule, or schema failure.
- `job_version_unsupported`: task exists but version is unsupported.
- `job_schedule_conflict`: incompatible duplicate, transition, or terminal effect.

Messages/details are sanitized. Health/readiness expose lifecycle, database reachability, exact claims state, catalog version, and sanitized pool counts only. Payloads, dependency errors, Graphile tables, database locations, and credentials are never exposed.
