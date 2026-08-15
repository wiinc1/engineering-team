# Issue 288 Standards Compliance Checklist

## Standards Alignment

- Applicable standards areas: architecture and design, coding quality, testing, deployment, observability, security, and team process.
- Evidence expected for this change: operator schema/service/API/UI, public Graphile utility proof, tenant/RBAC tests, runbook, diagrams, and hosted migration evidence.
- Gap observed: hosted PostgreSQL and exact-head evidence is pending. Documented rationale: Graphile operations remain pre-cutover until #290 and #289 authorize production ownership (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/288).

- [x] Tenant and actor context are server-derived.
- [x] Read and write permissions are independently enforced.
- [x] Actions require reason, idempotency key, and optimistic version.
- [x] Retry/requeue/cancel use public Graphile Worker utilities only.
- [x] Operational responses and logs exclude payloads and secrets.
- [x] Stable not-found, forbidden, conflict, and unavailable errors are documented.
- [x] Operator actions are recorded in an application-owned ledger.
- [x] UI disables actions that do not match the current delivery state.
- [x] Rollback refuses to discard recorded action history.

## Required Evidence

- Commands run: `npm run test:graphile`, focused Vitest UI tests, then hosted integration, standards, build, and repository verification.
- Tests added or updated: tenant detail/history, role policy, optimistic concurrency, idempotency, retry/requeue/cancel/drain, API contracts, and UI state tests.
- Rollout or rollback notes: keep production claims disabled; rollback refuses action-history deletion and never invokes legacy fallback.
- Docs updated: Job Runtime OpenAPI, operations architecture/runbook, diagrams, migration, dashboard UI, and this checklist.

- Focused Node tests: `tests/unit/job-runtime-operator.test.js`.
- API contract: `docs/api/job-runtime-openapi.yml`.
- UI test: `src/app/AutonomyMetricsRoute.test.tsx`.
- Full runtime regression command: `npm run test:graphile`.
- Hosted PostgreSQL migration, exact-head CI, and reviewer approval remain promotion gates.
