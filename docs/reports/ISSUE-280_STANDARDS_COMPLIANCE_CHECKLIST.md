# Issue #280 standards compliance and traceability checklist

## Change identity

- GitLab: #280 `[LANGGRAPH-01] Build the production LangGraph runtime, typed state, and Postgres persistence`; parent epic/work item #285 (`LANGGRAPH-EPIC`).
- Branch/base: `feature/langgraph-01-runtime-persistence` from `origin/main` `30dc7d91d0a87fc944d9d1e26e7f9faf18f14820`.
- Reserved migration: `018_langgraph_runtime_persistence`.
- Scope: dormant foundation only. #281 owns lifecycle graph nodes, #282 resume authorization/API/UI, #283 durable subgraphs, and later coordinated cutover. No pilot, percentage routing, user screen, or production execution cutover.

## Standards Alignment

- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; team and process.
- Evidence expected for this change: complete AC1–AC6 traceability, exact dependencies, design/diagrams, migrations, typed state, tenant/security controls, API/monitoring/runbook, focused and full tests, coverage, mutation, chaos, exclusive load, live PostgreSQL, browser, build, and CI.
- Gap observed: Hosted staging recovery, backup/restore, alerts, and latency plus exact-head pipeline/review remain pending. Documented rationale: local implementation evidence is complete before publication, while immutable CI/review and deployed-environment evidence can exist only after the branch is pushed and promoted (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/280).

Architecture/design, coding quality, testing/QA, security, deployment/release, observability/monitoring, data lifecycle, and team/process apply. Primary standards are `docs/standards/software-development-standards.md`, ADR-004, and the issue's Complex template. Evidence is automated; no manual test is counted.

## Acceptance-criteria traceability

| Requirement | Implementation evidence | Automated evidence | Status |
| --- | --- | --- | --- |
| AC1 exact packages, existing pool, dedicated schema | exact `package*.json` pins; `checkpointer.js`; `pool.js`; migration 018 | contract dependency/adapter tests; live Postgres setup/pool/schema test; production audit | Verified locally; exact-head CI pending |
| AC2 durable/queryable thread, namespace, versions, tenant, timestamps | `factory_threads`; guarded metadata; history/summary runtime | live checkpoint history/summary test; migration contract | Verified locally; exact-head CI pending |
| AC3 replacement worker resumes next eligible node | lease + `graph.invoke(null, config)` + `snapshot.next` status | live Postgres SIGKILL plus fresh-process resume with exact side-effect ledger | Verified locally; exact-head CI pending |
| AC4 invalid/oversize/secret/cross-tenant/version rejection before invocation | strict `state.js`; server-derived thread; async tenant binding; guarded saver | unit/property/security/E2E/live tenant tests | Verified locally; exact-head CI pending |
| AC5 apply→rollback→apply without task/audit/queue loss | additive 018; guarded down migration | live Postgres canonical count comparison and rollback refusal | Verified locally; exact-head CI pending |
| AC6 production memory/file saver rejection | `runtimeConfig` + guarded saver production assertion | unit/E2E configuration tests | Verified locally; exact-head CI pending |

## Full requirement inventory

- [x] Framework boundary under `lib/software-factory/langgraph/`; domain node declaration contains no LangGraph types.
- [x] Deterministic graph order/reducers; JSON-only allowlisted V1 state; explicit graph/state versions and compatibility fixture.
- [x] Existing verified Postgres pool/TLS reused; dedicated schema; setup/health/close/test composition; explicit operation timeout, resume lease, pool budget.
- [x] Durable application thread registry with unique tenant/run/thread binding, active/stale/retention indexes, UTC timestamps, size check, no secrets/raw values.
- [x] Saver read/write/list/pending-write paths require server async tenant binding and registry/version validation; deletion is tenant/registry fenced. Version checks remain on state read/write paths.
- [x] Crash/resume next-node behavior; one-resumer lease; no persistence-adapter side effects; canonical stores remain authoritative.
- [x] Stable errors for configuration, migration, availability, validation, version, concurrency, and tenant mismatch; audit logger redaction.
- [x] Full enable flag and global kill switch only; production memory/file/unguarded saver rejection; no fallback/pilot/percentage.
- [x] Authenticated internal v1 health and tenant-filtered checkpoint summaries; standard envelopes; no raw checkpoint contract.
- [x] Metrics for reads/writes/errors/latency/size, active/stale, pool, versions, tenants, retention; dashboard and eight alert conditions.
- [x] Retention/state/concurrency/pool quotas; estimated storage/IO/backup/connection growth; $0 third-party cost.
- [x] Expand-only dormant rollout, deep write/read/delete health, guarded <15-minute rollback procedure, backup/restore/failover staging checklist.
- [x] Workflow, schema, and C4 diagrams named `langgraph-01`; ADR, dependency inventory, config/capacity design, migration/rollout runbook, API contract.
- [x] Unit, integration, contract, property, security, performance, chaos, E2E AC1–AC6, compatibility fixtures, coverage, mutation, and 2×/10-minute load implementations.
- [x] Local PostgreSQL staging simulation covers SIGKILL/fresh-process resume, database interruption/recovery, custom-format schema backup, destructive loss, restore/resume, exact snapshot/version integrity, RTO, and every alert contract.
- [ ] Hosted staging worker kill, DB failover, pool saturation, backup/restore, alerts, and hosted p95 proof. This is an environment promotion gate and must not be claimed from local evidence.
- [x] Local browser regression, full repository tests/coverage/standards/build/`make verify`, and isolated Docker integration evidence.
- [ ] Exact-head pipeline and MR review evidence.

## Security and dependency review

Threats map to controls: checkpoint tampering → validation after deserialize; tenant guessing → server-derived opaque identity plus registry binding; secret persistence → allowlist, recursive secret scan, size cap; concurrent replay → lease; saver fallback → production configuration error. Resume authorization is intentionally deferred to #282 while every storage method requires tenant context now. Dependency licenses, vulnerabilities, transitives, public-API boundary, and update policy are recorded in `ISSUE-280_DEPENDENCY_REVIEW.md`.

## Rollout and rollback

Apply 018 and pinned saver setup before deploying dormant code. Keep `FF_LANGGRAPH_RUNTIME=false`; deep health may operate independently. Do not cut over graph execution. The kill switch blocks new invocation without deleting state. Ordinary application rollback keeps the additive schema. Physical schema rollback drains workers, confirms no active/retained references, and uses the refusing down migration. Reapply 018/setup/health to restore standby. Exact operator steps are in `docs/runbooks/langgraph-checkpoints.md`.

## Required Evidence

- Commands run: production audit; lint/source integrity/secrets/typecheck; focused LangGraph, coverage, mutation, security, performance and chaos; exclusive ten-minute load; full test/browser/coverage; standards; build; `make verify`; live Docker PostgreSQL; diff and repository cleanup checks.
- Tests added or updated: unit, mutation-contract, contract, E2E AC1–AC6, property, security, performance, chaos, V1 fixtures, HTTP wrapper, and live PostgreSQL setup/resume/history/isolation/health/migration preservation.
- Rollout or rollback notes: migration/setup deploy dormant with no routed work; feature flag and global kill switch are the only controls; app rollback retains data; schema down refuses referenced rows; hosted promotion checklist remains open.
- Docs updated: ADR-004, architecture/capacity/version design, dependency review, API contract, runbook, standards checklist, Mermaid architecture/schema/workflow diagrams, alert rules, dashboard, and `.env.example`.

Recorded so far:

- Unit + mutation contracts + contract + alert contracts + E2E AC1–AC6 + property + security + chaos: 121/121 pass after timeout, lease/commit/accepted-chain fencing, artifact-reference, request-ID, and wrapped-route exception hardening.
- Focused live PostgreSQL: 6/6 pass, including independent-runtime next-node resume/history, cross-tenant/concurrency rejection, versioned synthetic CRUD with zero residual rows, and 018 apply→rollback→apply with populated canonical task/audit/queue sentinels unchanged.
- Focused Docker recovery: 9/9 pass. A PostgreSQL worker was SIGKILLed after node-one checkpoint and a fresh process resumed node two with exact side effects `{process_claimed: 1, process_resumed: 1}`. Database pause failed closed, unpause restored deep health, `pg_dump -Fc` survived destructive schema loss, `pg_restore` reproduced the registry/checkpoint/blob/write/effect snapshot exactly, and the final full-integration rehearsal resumed in 1,689 ms against the <15-minute RTO. The suite also proves cross-tenant delete isolation by unchanged physical row count and atomically rolls back a stale COMMIT before accepting the new owner. Restored registry remained `factory-v1`, state schema `1`, status `paused`; restored row counts were 3 checkpoints, 20 blobs, and 17 writes. Artifact: `.artifacts/langgraph-01-recovery.json`.
- Alert contract: all eight alert names, PromQL expressions/thresholds, durations, severities, and resolvable runbook links match the reviewed fixture.
- Dedicated boundary coverage: 99.42% lines, 97.71% branches, and 100% functions across configuration, error, identity, and state.
- Comprehensive issue-scoped runtime coverage: 99.67% lines, 96.21% branches, and 96.08% functions across binding, guarded saver, configuration, errors, identity, registry, runtime, and state (106/106 tests). CI enforces 95% for all three measures; deterministic valid/lost/expired COMMIT fencing covers both checkpoint and pending-write transactions, and accepted-ancestor versus stale-sibling tests cover late LangGraph writes.
- Dedicated mutation: 590/635 killed, 92.91% mutation score, zero uncovered mutants or errors (85% break threshold).
- LangGraph performance + chaos: 15/15 pass (4 performance, 11 chaos); assertions cover validation p95 <10 ms, graph p95 <100 ms, DB interruption, all public-operation timeouts, lease-loss fencing, synthetic cleanup, and pool peak at configured budget. The isolated repository performance suite also passes 17/17.
- Exclusive 600,018 ms PostgreSQL load at four workers (2× expected): 59,968 completed, 0 failures, empty failure-code set, 0 post-side-effect failures, 99.94 QPS; invocation p95/p99 50/68 ms; 179,904 writes p95/p99 11/14 ms; 179,904 reads p95/p99 7/10 ms; exact completed/observed effects 59,968/59,968 with 0 duplicates; pool peak/budget 2/2 and ending active/waiters 0/0; cleanup registry/checkpoint/blob/write rows all 0. Checkpoint bytes average/p95/p99/max 307/328/328/328 and the 10,000-thread × 8-checkpoint projection is 24.56 MB primary / 98.24 MB with MVCC plus two backups. Artifact: `.artifacts/langgraph-01-load.json`.
- Full isolated Docker/PostgreSQL integration: 29/29 pass in 28.506 seconds across audit, registration, delivery queue, Graphile/job runtime, canonical lifecycle port/audit binding, every-node process recovery, and composed restore; teardown left no issue container, volume, network, or port listener.
- Full repository verification: Node unit 1,039/1,039; Python 100/100; UI Vitest 171 pass / 2 skip; Playwright 199 pass / 23 configured skips; Node/API coverage 953/953 with 74.97% lines, 66.65% branches, and 79.19% functions; aggregate coverage policy 98.165%; build and final `make verify` pass.
- Static and governance gates: typecheck, syntax, lint/source integrity, secrets, standards, architecture/docs/release validators, artifact provenance, test policy, diff whitespace, and maintainability pass; all tracked dependency-install churn was restored.
- `npm audit --omit=dev`: 0 production vulnerabilities.

Still to record before merge: final diff review, commit/MR/pipeline SHA, exact-head pipeline, review approval, and hosted staging promotion evidence. Remote immutable evidence belongs in the draft MR and issue comment after creation.

## Artifact index

- Runtime/state/persistence/API: `lib/software-factory/langgraph/`, migration 018, `.env.example`, setup/load scripts.
- Tests: `tests/{unit,contract,e2e,property,security,performance,integration}/...langgraph...`, `chaos/langgraph-resilience.test.js`, V1 fixture, Stryker config.
- Operations: ADR-004, architecture/config/cost document, dependency review, API contract, runbook, alerts/dashboard.
- Diagrams: `workflow-langgraph-01.mmd`, `schema-langgraph-01.mmd`, `architecture-langgraph-01.mmd`.
