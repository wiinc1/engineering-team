# Issue #287 dependency review

## Standards Alignment

- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; authentication and secret handling; team and process.
- Evidence expected for this change: exact package pin/integrity, public-API isolation, inventory/catalog completeness, migration, replay, security, mutation, chaos, and load gates.
- Gap observed: issues #280–#282 are not yet merged. Documented rationale: #287 defines and tests a typed injected LangGraph adapter contract without importing or duplicating the foundational runtime; #289 must wire the resulting implementation before claims are enabled (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/287).

## Decision

- Continue the exact `graphile-worker` `0.17.3` pin and lock integrity approved in #286. No new production package is introduced by #287.
- All Graphile imports, supported public calls, cron parsing, and opaque schema knowledge remain in `lib/job-runtime/graphile-adapter.js`.
- Application modules own the catalog, validation, producers, handlers, registry, effect ledger, scheduler, and canonical authorization. They neither query Graphile internal tables nor export Graphile types.
- Use public `makeWorkerUtils`, `run`, `parseCronItems`, `addJob`, `completeJobs`, `stop`, `kill`, and `release` behavior already covered by dependency/import/security tests.
- One public runner plus documented named-queue serialization provides protected class capacity without extra listener connections or undocumented queue-table access.

## Security and operational review

Strict identifier/version-only payloads, recursive prohibited-content checks, canonical tenant lookup at enqueue and execution, payload-free registries, least-privilege roles, sanitized errors/logs, deterministic idempotency keys, and external `lookupEffect` contracts constrain dependency risk. Package audit, source import scan, real-Postgres migrations, fault injection, mutation, fairness, and 2× load evidence are required before merge. Upstream references: https://worker.graphile.org/docs and https://github.com/graphile/worker.

## Required Evidence

- Commands run: final exact outcomes are recorded in `ISSUE-287_STANDARDS_COMPLIANCE_CHECKLIST.md`.
- Tests added or updated: workload unit/contract/E2E/property/security/chaos/mutation/load and real-Postgres suites.
- Rollout or rollback notes: claims stay false until #289; migration `017` rollback refuses retained effect evidence.
- Docs updated: ADR, inventory/matrix/replay design, internal/OpenAPI compatibility contracts, capacity guide, runbook, diagrams, alerts, dependency review, and checklist.
