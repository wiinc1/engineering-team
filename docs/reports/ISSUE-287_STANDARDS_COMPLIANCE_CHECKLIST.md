# Issue #287 standards compliance checklist

## Linked Standards and Change Metadata

- Standards: `docs/standards/software-development-standards.md`, AI implementation playbook, user-story and compliance templates.
- Change: GitLab #287 `[GRAPHILE-02] Migrate all background workloads and LangGraph dispatch to Graphile Worker`.
- Date/branch: 2026-07-15, `feature/graphile-02-workload-migration`.
- Scope: seven production semantic workloads on the #286 application-owned runtime. #280–#282 foundations, #288 API/UI, #289 legacy removal/cutover, and #290 final production validation are explicitly excluded.

## Standards Alignment

- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; authentication and secret handling; team and process.
- Evidence expected for this change: signed workload inventory, immutable contracts, typed producers/handlers, effect replay protection, migration and rollback proof, fairness/pool evidence, security/chaos/load tests, operations docs, and exact local/remote verification results.
- Architecture/coding: signed inventory, immutable versioned catalog, strict payloads, application port, canonical reauthorization, Graphile isolation, ordering and protected fairness classes.
- Security/data: tenant-derived identity, prohibited secret/executable content, payload-free registry/effect ledger, deterministic canonical effect keys, least privilege, bounded retention, sanitized telemetry.
- Quality: unit, per-workload contract, E2E AC1–AC7, property, mutation, real-Postgres, security, performance/load, fairness, chaos, browser/visual/accessibility/responsive compatibility, and inventory completeness.
- Deployment/operations: disabled-by-default claims, `017` apply/rollback/apply, canonical-data preservation, scheduled maintenance, drain/reconcile, alert fixtures, capacity/cost/backup/recovery documentation.
- Gap observed: legacy execution remains available. Documented rationale: #289 owns removal and coordinated cutover; #287 must not create dual side effects and ships claims disabled (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/289).

## Acceptance and review evidence

- Inventory: seven supported workloads and eighteen classified mechanisms; SHA-256 verified by `npm run job-runtime:inventory`. LANGGRAPH-01 explicitly classifies its invocation-scoped lease heartbeat and verification-only load sampler as non-semantic exclusions.
- Catalog/contracts: start/resume, projection, outbox, SRE expiry, factory reconciliation, retention; all v1 producer/handler pairs are statically and dynamically complete.
- Replay: GitLab, GitHub, deployment, notification, canonical task, audit record/projection, LangGraph checkpoint, evidence, closeout, factory recovery, and retention boundaries are allowlisted and tested for before/after-effect replay.
- Isolation: enqueue and handler canonical lookups reject tenant mismatch; external effects receive deterministic tenant-scoped keys.
- Ordering/fairness: projection/outbox/factory global order, one shared maintenance queue, a single four-slot runner enforcing 1/1/1/1 named-queue capacity, and a six-slot runtime facade over the same shared physical pool preserving four connections for API/LangGraph consumers.
- Compatibility: no HTTP route or browser UI change; components-only OpenAPI has empty paths; operational routes remain #288.
- Scope review: no Graphile domain import/internal-table access and no #288–#290 implementation expansion.

## Required Evidence

### Recorded focused results

- `npm run job-runtime:inventory`: pass; 7 workloads, 18 mechanisms, signed digest verified.
- `npm run test:graphile:workloads`: pass; 52/52 focused tests.
- `npm run test:graphile`: pass; 122/122 unit, contract, E2E, property, security, and chaos tests.
- `npm run test:graphile:coverage`: pass; 88/88 tests, 99.87% lines, 97.64% functions, and 95.22% branches across `lib/job-runtime`.
- `npm run test:graphile:mutation`: pass; 81.83% mutation score (765 killed, 5 timed out, 171 survived), above the unchanged 80% break threshold.
- `npm run test:integration:docker`: pass; 16/16 live PostgreSQL scenarios, including apply/rollback/apply, rollback refusal, one-long-factory 1/1/1/1 fairness, LISTEN/NOTIFY, and crash-after reconciliation.
- Housekeeping-boundary proof: 75,000 ms at 50 QPS, 3,750/3,750 acknowledged across all seven workloads, enqueue p95 8.999 ms, p99 26.734 ms, ready-to-start p95 10 ms, measured physical pool peak 6/10, and zero physical/runtime-facade ending waiters.
- Required 10-minute 2× proof: 600,000 ms at 50 QPS, 30,000/30,000 acknowledged across all seven workloads, enqueue p95 22.250 ms, p99 38.472 ms, ready-to-start p95 34 ms, measured physical pool peak 6/10, and zero physical/runtime-facade ending waiters.

### Final commands

- `npm install`: pass; lockfile installation is current. `npm audit --omit=dev`: pass; zero production vulnerabilities.
- `npm run lint` and `npm run typecheck`: pass.
- `npm run test:security`: pass; 59/59. A dedicated pre-mutation pipeline stage runs all 17 Node performance files serially and runs browser Core Web Vitals in a fresh one-worker process. Downstream functional, mutation, integration, load, and `make verify` gates depend on that stage and do not duplicate its evidence on a thermally loaded shared host. The reviewed Node p95/p99 and browser timing budgets are unchanged.
- `npm test`: pass, including the repository Node suites and 199/199 executed browser scenarios with 23 intentional visual-platform skips.
- `npm run coverage`: pass; 928/928 tests and 77.25% repository line coverage; the policy floor is 70%.
- `npm run standards:check`: pass; secrets, standards, maintainability, and current coverage policy all green.
- `npm run build`: pass; the existing >500 kB chunk advisory is non-blocking and no UI code changed.
- `make verify`: pass; policy, Python (100/100), lint, typecheck, unit, browser, build, standards, artifact-provenance, and test-policy gates all green.
- Remote pipeline, review, merge SHA, and issue-closeout evidence are recorded in the GitLab merge request and #287 comment because those immutable identifiers are created only after this artifact is committed.

### Artifacts

- Runtime: catalog/policies/port, producers/handlers/scheduler/inventory, effect guard/ledger, protected Graphile runners, registry metrics, migration `017`, roles, alerts.
- Tests: unit, contract, E2E AC1–AC7, property, mutation, security, performance/load, chaos, real-Postgres, deterministic fixtures, repository UI regressions.
- Documents: updated ADR/contract/config/runbook; inventory/matrix/replay design; dependency review; OpenAPI compatibility components; workflow/schema/C4 diagrams; this checklist.
- Rollout/rollback: exact-disabled standby until #289; drain and reconcile; `017` refuses populated effect-ledger rollback and preserves all canonical data.

- Commands run: install, production dependency audit, inventory, focused Graphile/workload/coverage/mutation suites, live PostgreSQL integration, 75-second housekeeping and full 10-minute seven-workload load proofs, lint, typecheck, security, performance, full repository tests/coverage, standards, build, and `make verify`; all local gates passed.
- Tests added or updated: job-runtime unit, contract, E2E AC1–AC7, property, security, chaos, mutation, seven-workload load, migration, rollback, live PostgreSQL replay, and protected-class fairness suites.
- Rollout or rollback notes: ship with claims exactly disabled until #289 coordinates legacy removal and cutover; drain workers before rollback, preserve canonical data, and refuse migration `017` rollback while effect evidence remains.
- Docs updated: ADR-003, dependency review, internal and components-only OpenAPI contracts, runtime capacity guide, workload inventory/replay design, runbook, alerts, workflow/schema/architecture diagrams, ownership map, and this checklist.
