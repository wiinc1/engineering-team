# Issue 282 Standards Compliance Checklist

## Standards Alignment

- Applicable standards areas: architecture and design, coding quality, testing, deployment, observability, security, and team process.
- Evidence expected for this change: durable interrupt schema, RBAC/API/UI tests, operator audit history, alerts, diagrams, runbook, and hosted concurrency/restart proof.
- Gap observed: hosted exact-head evidence is pending. Documented rationale: real PostgreSQL restart/concurrency and local responsive browser/accessibility coverage now pass, but production promotion requires the immutable #284 evidence gate (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/282).

- [x] Human gate schema and action vocabulary are versioned and allowlisted.
- [x] Interrupts, authorized roles, waits, next actions, resolutions, retry, and cancellation evidence are durable.
- [x] Tenant, actor, role, checkpoint, interrupt version, and idempotency are server enforced.
- [x] Resume uses LangGraph `Command`; application code never updates checkpoint rows directly.
- [x] Status projection excludes raw graph/checkpoint state and secrets.
- [x] Task detail component covers wait, freshness, completed work, error, decision, retry, and cancel states.
- [x] Controls have a separate global mutation flag and preserve read-only history when disabled.
- [x] Stable errors, RBAC matrix, OpenAPI, diagrams, alerts, dashboard, and emergency runbook are committed.

## Required Evidence

- Commands run: `npm run test:langgraph`, focused Vitest UI tests, then hosted integration, performance, mutation, standards, build, and repository verification.
- Tests added or updated: decision validation, exact-once resume, retry/cancel, tenant/RBAC/error contracts, routes, and responsive control UI.
- Rollout or rollback notes: keep controls disabled; kill switch blocks mutations while preserving readable checkpoint/decision history.
- Docs updated: orchestration OpenAPI, RBAC model, operations runbook, alerts/dashboard, diagrams, migration, and this checklist.

- Focused service/policy/route tests: `tests/unit/langgraph-operator.test.js`.
- UI and accessibility smoke: `src/app/LangGraphRunPanel.test.tsx`.
- Full local runtime suite: `npm run test:langgraph`.
- Real PostgreSQL restart/concurrent-resolution, browser, performance, and mutation gates pass locally. Exact-head CI, hosted visual evidence, the excluded soak, and reviewer approval remain promotion gates.
