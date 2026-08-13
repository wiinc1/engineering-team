# [GRAPHILE-03] Deliver Graphile Worker operations, security, observability, and operator controls

Template Tier: Complex

Repo gates reviewed: `docs/standards/software-development-standards.md` and `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`.

## 1. User Story

As an operator and security owner, I want supported APIs, UI controls, telemetry, and runbooks for the Graphile job runtime, so that failed or delayed work can be diagnosed and acted on without direct database access or weakened tenant controls.

Business context and success metrics: all operator actions are authenticated, tenant-bound, idempotent, and audited; all SLO signals and alerts are automated; direct mutation of Graphile tables is unnecessary; and current queue consumers remain compatible.

## 2. Acceptance Criteria

1. Given an authorized operator, when job status is requested, then sanitized state, attempts, next retry, failure category, handler version, and canonical correlation are returned without exposing payloads or internal tables.
2. Given an authorized retry, requeue, cancel, or safe-drain request, when submitted with an idempotency key, then the action occurs once and an append-only audit event records actor, tenant, reason, request, and result.
3. Given an unauthorized, cross-tenant, stale, or invalid action, when requested, then it fails closed with 401/403/409/422 as applicable and no job changes.
4. Given queue age, failures, worker health, pool saturation, or retry exhaustion breaches a threshold, when alert evaluation runs, then the correct severity and runbook link are emitted automatically.
5. Given a job crosses API, Graphile, LangGraph, Postgres, and an external adapter, when traces are inspected, then tenant-safe correlation identifies the path and retry attempt without secrets.
6. Given the runtime is draining, unavailable, or killed, when health/readiness is queried, then status accurately prevents unsafe traffic while historical reads remain available.
7. Given any supported UI state, when browser automation runs, then controls are responsive, keyboard accessible, WCAG 2.2 AA compliant, and visually stable.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence expected for this change: OpenAPI, RBAC matrix, threat tests, dashboard/alerts, trace fixtures, runbooks, visual/a11y results, and compliance output.
- Gap observed: direct access to Graphile internal tables would couple operations to an implementation detail and bypass application authorization. Documented rationale: all supported reads and mutations use the application job-runtime adapter (source https://worker.graphile.org/docs).

## 3. Workflow & User Journey

1. Operator opens task/queue detail and sees stable delivery state and next action.
2. Authorized action is validated against canonical tenant/resource state and expected version.
3. Adapter performs the supported Graphile action and emits audit/telemetry.
4. UI refreshes without duplicate submission; alerts link to the matching runbook.
5. Generate `docs/diagrams/workflow-graphile-03.mmd`; cover stale action, race, secret redaction, unavailable DB, and partial telemetry failure.

## 4. Automated Test Deliverables

- Unit >=95% for RBAC, status mapping, action validation, error/redaction, metric and alert rules.
- Integration with real Postgres jobs and audit records; E2E per acceptance criterion; OpenAPI/consumer contracts; property tests for tenant/action invariants; mutation >=80% on authorization/actions.
- Browser visual/accessibility at supported breakpoints; security/DAST; 2x API load; telemetry-failure and worker/DB chaos.
- Commands include focused API/browser/monitoring suites, full repository tests, `npm run standards:check`, and `make verify`.

## Required Evidence

- Commands run: focused API/browser/monitoring suites, full repository tests, security/DAST checks, `npm run standards:check`, and `make verify`.
- Tests added or updated: RBAC, tenant isolation, status/actions, OpenAPI contracts, audit, telemetry, alert rules, visual, accessibility, security, load, and chaos suites.
- Rollout or rollback notes: deploy compatible reads and telemetry before full cutover; enable mutations only under Graphile ownership and never use direct-table or pilot fallback.
- Docs updated: OpenAPI, RBAC matrix, dashboards, alert rules, operating/emergency runbooks, UI states, diagrams, and compliance checklist.

## 5. Data Model & Schema

- Reuse delivery registry and canonical audit records; store operator reason, expected version, action idempotency, and sanitized status projection only where required.
- Expand-contract migrations and apply/rollback/apply tests; generate `docs/diagrams/schema-graphile-03.mmd`.

## 6. Architecture & Integration

- API/UI -> job-runtime service -> adapter/public Graphile API -> audit/metrics. No route or browser component queries worker tables.
- Add OpenTelemetry-compatible spans/metrics through existing observability patterns without replacing the append-only audit log.
- Generate `docs/diagrams/architecture-graphile-03.mmd`.

## 7. API Design

- Publish and validate `docs/api/job-runtime-openapi.yml` for health/readiness, status/history, retry/requeue, cancel, and drain.
- Preserve compatible existing factory-queue routes through adapters and publish deprecation/removal dates for legacy-only fields.
- Require current AuthN, tenant derivation, RBAC, request IDs, idempotency keys, and optimistic version checks.

## 8. Security & Compliance

- Threats: forged operator action -> RBAC/canonical binding; cross-tenant enumeration -> tenant-filtered lookup and indistinguishable denial; payload leakage -> allowlisted sanitized projections/redaction tests.
- No raw payload, token, database URL, cookie, prompt secret, or internal stack is exposed through API/UI/log/trace/metric labels.
- Require SAST/DAST/dependency/secrets tests and append-only audit coverage for every mutation and kill-switch change.

## 8a. Standardized Error Logging

- Use existing `httpError`, standardized response envelope, and `createAuditLogger`; stable codes include `job_not_found`, `job_action_forbidden`, `job_action_conflict`, and `job_runtime_unavailable`.

## 8b. AI Implementation Guide

- Map operational state to stable application terms, keep metrics low-cardinality, preserve current UI patterns, and automate every operator journey.

## 9. Performance & Scalability

- Status reads p95 <250 ms/p99 <500 ms; actions p95 <500 ms excluding handler execution; dashboards avoid high-cardinality labels.
- Validate 2x expected operational QPS and large queue pagination without unbounded queries.

## 10. UI/UX Requirements

- Show ready/running/retrying/failed/cancelled/completed, attempt count, next retry, last error category, handler version, timestamps, correlation, and permitted next action.
- Use existing components/tokens; confirmation for destructive actions, focus restoration, live-region results, no nested cards, and mobile/tablet/desktop/large-desktop automation.

## 11. Deployment & Release Strategy

- Deploy compatible read routes/telemetry before cutover and enable mutation controls with Graphile ownership at full cutover only. No pilot or direct-table fallback.

## 12. Monitoring & Observability

- Dashboard and alerts cover scheduling availability, depth/age, starts/completions/failures/retries, runtime, exhausted jobs, worker/pool saturation, unknown versions, and duplicate-effect suppression.
- Add synthetic job and automated P0/P1/P2 alert tests with operating/emergency runbooks.

## 13. Cost & Resource Impact

- Budget telemetry cardinality/retention, synthetic frequency, dashboard query cost, and status projection storage.

## 14. Dependencies & Risks

- Requires `GRAPHILE-01` and observable handlers from `GRAPHILE-02`; blocks production cutover.
- Risks: leaking payloads, unsafe actions, misleading health, alert fatigue, high cardinality. Mitigate with schemas, RBAC, readiness contracts, tested thresholds, and label budgets.

## 15. Definition of Done

- APIs/UI, OpenAPI, RBAC, audit, telemetry, dashboard, alerts, runbooks, diagrams, and all automated tests pass with no direct Graphile-table operator dependency.

## 16. Production Validation Strategy

- Automated staging synthetics validate healthy, delayed, retrying, exhausted, draining, killed, and restored states plus every authorized/denied operator action.

## 17. Compliance & Handoff

- Parent Epic: #291. Requires #286 and #287; blocks #289 and #290.
- PR links these issues and includes `docs/reports/ISSUE-288_STANDARDS_COMPLIANCE_CHECKLIST.md`, screenshots/traces with redacted fixtures, alert results, and runbook links.
