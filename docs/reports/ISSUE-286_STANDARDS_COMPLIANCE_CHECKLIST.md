# Issue #286 standards compliance checklist

## Linked Standards

- Standards document: `docs/standards/software-development-standards.md`.
- Implementation playbook: `docs/standards/ai-implementation-playbook.md`.
- Template: `docs/templates/USER_STORY_TEMPLATE.md` and `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`.

## Change Metadata

- Change or task ID: GitLab issue #286, `[GRAPHILE-01] Build the production Graphile Worker runtime, schema, and job contracts`.
- Owner: Engineering Team implementation agent.
- Date: 2026-07-14.
- Scope: production runtime/schema/contracts only. Coordinates pool posture with LangGraph issue #280; excludes workload migration issue #287 and operational HTTP issue #288.

## Standards Alignment

- Standards baseline reviewed: `docs/standards/software-development-standards.md`.
- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; authentication and secret handling; team and process.
- Evidence expected for this change: dependency review, ADR, schema/workflow/C4 diagrams, migrations, real-Postgres tests, payload contracts, graceful-shutdown/chaos/load tests, alert fixtures, and exact compliance output.
- Gap observed: The repository-wide gates include unrelated failures on clean `origin/main`. Documented rationale: issue #286 fixes all findings introduced by its diff and records exact clean-main proof without modifying unrelated audit/reviewer/report code solely to hide upstream failures (source https://gitlab.com/wiinc1/engineering-team/-/issues/286).

## Architecture and Design

- Applicable: yes; new production delivery runtime and PostgreSQL schemas.
- Evidence: `lib/job-runtime/`, ADR-003, internal contract, runtime configuration, and workflow/schema/C4 diagrams.
- The Graphile dependency and schema are isolated to `graphile-adapter.js`; domain modules use only application contracts.
- Delivery acknowledgment is explicitly non-canonical. Canonical task/audit workflows own business completion.
- Gap observed: Graphile Worker is an operational delivery dependency, not a domain model. Documented rationale: the application port and registry prevent coupling business logic to internal worker tables (source: https://worker.graphile.org/docs).

## Coding and Code Quality

- Applicable: yes.
- Evidence: immutable catalog/config records; stable errors; strict JSON schemas; semantic keys; low-cardinality queue policy; bounded retry, concurrency, pool, payload, schedule, retention, and shutdown policies.
- Manual implementation edits use scoped files only; no workload handlers from #287 are included.
- Graphile public APIs are isolated and no internal table structure is exported.
- Gap observed: none for issue scope. Documented rationale: the application boundary, import scan, and contract tests enforce the intended dependency direction (source: ADR-003).

## Testing and Quality Assurance

- Applicable: yes; Complex tier.
- Unit/coverage: schema, catalog, errors, redaction, port, adapter, registry, roles, metrics, lifecycle, and artifacts.
- E2E: AC1 through AC6, each tagged `@regression`.
- Contract/property/mutation: producer-handler v1 contract, seeded invariant tests, Stryker critical-decision score.
- Integration: real PostgreSQL Graphile setup, LISTEN/NOTIFY, enqueue/claim/retry/dedupe/named queue, pool, schema fingerprint, retention, migration apply/rollback/apply, and shutdown.
- Security/performance/chaos: dependency/import/secrets/roles, latency/2x load, database/network/worker/shutdown failures.
- Determinism: versioned fixtures under `tests/fixtures/job-runtime/` and injected clocks/timers/UUIDs.
- Exact final command results are recorded under Required Evidence after the final verification pass.
- Gap observed: UI visual/accessibility/browser artifacts are not applicable because issue #286 adds no screen or HTTP route. Documented rationale: automated repository browser regression remains part of `npm test`/`make verify`, while runtime behavior is covered through in-process contracts and real PostgreSQL (source: issue #286 sections 7 and 10).

## Deployment and Release

- Applicable: yes.
- Claims default exactly disabled via `FF_GRAPHILE_WORKER_CUTOVER=false`; percentage values fail closed. This is production standby, not pilot, mock, shadow, or percentage rollout behavior.
- Setup: roles SQL, public pinned Graphile migration, application migration `016`, scoped grants, and verification.
- Rollback: drain, require an empty registry, apply scoped down migration; canonical task/audit data is untouched. Apply/rollback/apply is automated.
- Gap observed: workload cutover is intentionally absent. Documented rationale: issue #287 owns producer/handler migration and is blocked by this foundation (source: GitLab issue #286).

## Observability and Monitoring

- Applicable: yes.
- Structured sanitized events cover startup, enqueue/reject, claim, acknowledgment, retry/fail, worker/network/pool failure, retention, drain, and shutdown.
- Metrics cover enqueue/claim/finish/retry/fail, validation/unknown version, ready-to-start/runtime latency, queue depth/age, pool totals/idle/waiting, claims state, shutdown, network/fatal errors, and retention.
- Alert-test fixture: `monitoring/alerts/job-runtime.yml`, validated by `tests/unit/job-runtime-artifacts.test.js`.
- Correlation: delivery, tenant, safe task identifier, correlation id, request id, and trace id; payload and raw dependency messages are excluded.
- Gap observed: operational HTTP exposure is absent. Documented rationale: health/readiness are application-owned in-process contracts until issue #288 adds routes (source: issue #286 section 7).

## Authentication and Secret Handling

- Applicable: yes.
- AuthN/AuthZ surfaces: no new public authentication surface. Producer context is server-derived; canonical tenant/resource authorization is mandatory before enqueue.
- Redaction: recursive secret-like keys and values are rejected in payloads and redacted from structured logs/errors.
- Prohibited: tokens, credentials, cookies, passwords, database locations, connection strings, SQL, commands, scripts, executable content, and arbitrary module names.
- Database roles: NOLOGIN migrator/producer/worker roles with schema-specific grants and no canonical task/audit mutation access.
- Dependency evidence: exact pins, integrity, MIT review, import boundary test, and zero unresolved production audit vulnerabilities.
- Rollback impact: no canonical or credential data is stored or removed.
- Gap observed: rate limiting is not an independent runtime concern. Documented rationale: enqueue is internal, bounded by strict authorization/schema, semantic idempotency, named queues, worker concurrency, and shared pool budgets; public abuse controls belong with future HTTP exposure (source: issue #288 boundary).

## Data, Retention, Backup, and Cost

- Registry stores operational metadata only and no payload.
- Constraints/indexes enforce tenant/id/version/status/attempt/size/trace contracts and support queue, canonical, correlation, and terminal-retention access.
- Terminal metadata retention defaults to 30 days, hourly, 1,000 rows per skip-locked batch; active delivery states are never pruned.
- Backup class is operational/reconstructable; canonical task/audit data remains authoritative.
- Default pool 10, reserve 4, worker concurrency 4; 2x load is 50 QPS for 10 minutes.
- Resource/cost details are recorded in `docs/architecture/job-runtime-runtime-configuration.md`.

## Team and Process

- Applicable: yes.
- Issue #286 is authoritative; ADR and contracts coordinate with #280 without implementing #287.
- Branch: `feature/graphile-01-runtime-schema-contracts`.
- Required review: security, tenant isolation, replay/idempotency, pool exhaustion, migration safety, redaction, and scope.
- Gap observed: merge and cutover are pending required review gates. Documented rationale: the issue must remain open until merge and required reviews complete (source: GitLab issue #286).

## Required Evidence

### Automated results recorded so far

- Focused unit/contract/E2E/property/security/chaos tests: 72/72 pass.
- Real-Postgres #286 scenarios: 5/5 pass. The combined integration command passes 11/12 and reports one unrelated audit projection failure (`404 !== 201`); the same assertion fails on clean `origin/main` commit `c59e07b` (6/7 clean-main integration scenarios pass), proving it predates this branch.
- Coverage: 53/53 tests pass with 100% lines, 98.45% functions, and 91.56% branches across `lib/job-runtime`; configured 95% line/function and 90% branch thresholds pass.
- Mutation: 90.52% (315 killed, 33 survived, 348 total), above 80% threshold.
- Full real-Postgres 2x load: 600,000 ms at 50 QPS; 30,000/30,000 acknowledged; enqueue p95 7.414 ms and p99 16.718 ms; ready-to-start p95 26 ms; pool peak 4/10 and zero ending waiters.
- Production dependency audit: zero vulnerabilities with `npm audit --omit=dev --json`; full audit has no high/critical findings.

### Final commands

- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm run test:graphile`: pass, 72/72.
- `npm run test:graphile:coverage`: pass, 53/53; 100% lines, 98.45% functions, 91.56% branches.
- `npm run test:graphile:mutation`: pass, 90.52% mutation score (315 killed, 33 survived, 348 total).
- `npm test`: exits 1 with 944/947 unit tests passing. The three failures are in pre-existing Execution Contract reviewer/approval assertions (`audit-api.test.js` once and `execution-contracts.test.js` twice); the identical focused failures reproduce on clean `origin/main` commit `c59e07b` (95/98 passing).
- `npm run test:integration:docker`: exits 1 with 11/12 passing; all 5/5 job-runtime scenarios pass and the single audit projection failure reproduces on clean `origin/main`.
- `npm run test:security`: pass, 58/58.
- `npm run test:performance`: pass, 13/13.
- `npm run test:graphile:load`: pass at the full 600,000 ms, 50 QPS target with 30,000/30,000 acknowledgments.
- `npm run standards:check`: exits 1 only because two pre-existing reports lack `Standards Alignment`: `FACTORY_GAP_RESOLUTION_PLAN_2026-07-13.md` and `SIMPLE_TRUSTED_COHORT_REPORT_2026-07-13.md`. The same two failures reproduce on clean `origin/main`; the branch maintainability scan has exactly the same 20 pre-existing hard findings as clean main and introduces none.
- `npm run build`: pass.
- `make verify`: exits 2 at `npm run test:unit` with the same 944/947 result above, after all design/policy gates, lint, typecheck, 100/100 Python tests, and changed-file maintainability pass.

### Artifacts

- Tests: unit, integration, E2E, contract, property, mutation, security, performance/load, chaos, deterministic fixtures.
- Migrations: `db/migrations/016_job_runtime_registry.sql` and tested scoped down migration; public Graphile migration invoked through the adapter.
- Docs: ADR-003, dependency review, internal contract, runtime configuration/cost/backup guide, production runbook, Mermaid workflow/schema/C4 diagrams, alerts, and this checklist.

- Commands run: focused Graphile, coverage, mutation, 10-minute load, lint, typecheck, security, performance, production audit, real-Postgres integration, full test, build, standards, and `make verify`; exact outcomes and clean-main upstream failure proofs are recorded above.
- Tests added or updated: unit, contract, E2E AC1–AC6, property, mutation, security, performance/load, chaos, migration, and real-Postgres integration suites listed above.
- Rollout or rollback notes: deploy in exact disabled standby, validate schema/readiness, and hand workload cutover to #287; rollback drains workers and refuses registry removal while populated.
- Docs updated: ADR-003, dependency review, internal contract, runtime/config/cost/backup guide, runbook, Mermaid workflow/schema/C4 diagrams, alert fixtures, ownership map, and this checklist.
