# [GRAPHILE-05] Production-harden and verify the complete Graphile Worker runtime

Template Tier: Complex

Repo gates reviewed: `docs/standards/software-development-standards.md` and `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`.

## 1. User Story

As an SRE and security owner, I want the complete Graphile Worker runtime protected by automated resilience, performance, security, observability, disaster-recovery, and release gates, so that full production cutover is measurable and supportable without a pilot.

Business context and success metrics: 99.9% scheduling availability; <0.1% runtime-attributable failure; 99% retryable recovery within five minutes; zero duplicate completed side effects; 24-hour soak passes; and restore meets documented RTO/RPO.

## 2. Acceptance Criteria

1. Given expected and 2x load, when the performance suite runs, then enqueue/start latency, throughput, backlog, pool, CPU, memory, and storage budgets pass.
2. Given workers are killed before/after handler boundaries, when redelivery occurs, then eligible jobs recover and completed external side effects are not duplicated.
3. Given Postgres/network/external dependencies fail or slow down, when chaos automation runs, then retries, backpressure, readiness, circuit breaking, and alerts behave within policy.
4. Given malformed, forged, cross-tenant, oversized, secret-bearing, or unsupported-version jobs/actions, when security tests run, then all attempts fail closed and emit sanitized evidence.
5. Given database backup is restored into the recovery environment, when workers restart, then canonical records, job registry, Graphile state, LangGraph checkpoints, and audit correlation reconcile within RTO/RPO.
6. Given the kill switch or graceful drain is activated, when work arrives or is active, then new delivery stops within two minutes and safe recovery does not invoke the legacy runtime.
7. Given the 24-hour soak runs at expected sustained load, when it completes, then no SLO, connection, memory, retry, duplicate-effect, backlog, or data-integrity threshold is breached.
8. Given any required artifact is missing, stale, redacted incorrectly, or failing, when release readiness evaluates, then `GRAPHILE-04` full cutover is blocked automatically.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence expected for this change: load/chaos/soak/DR reports, security scans, restore reconciliation, dashboards/alerts, synthetic history, capacity/cost report, and automated release decision.
- Gap observed: framework defaults cannot define application recovery and side-effect guarantees. Documented rationale: production readiness must test the composed Graphile, LangGraph, domain, Postgres, and external-adapter system (source https://worker.graphile.org/docs).

## 3. Workflow & User Journey

1. CI and staging run security, performance, concurrency, chaos, shutdown, and recovery suites.
2. Automated evidence is validated for provenance, freshness, redaction, thresholds, and linked revision.
3. Release gate passes or blocks full cutover with stable reasons.
4. Production synthetics, alerts, soak, backup/restore, and emergency procedures continuously verify the runtime.
5. Generate `docs/diagrams/workflow-graphile-05.mmd`; cover alert failure, stale evidence, restore mismatch, pool exhaustion, and kill-switch race.

## 4. Automated Test Deliverables

- Unit >=95% for SLO calculations, release evidence, alert rules, recovery reconciliation, redaction, and gate decisions.
- Integration/E2E for health, synthetic jobs, kill/drain, security, retry exhaustion, restore, and all acceptance criteria.
- Contract/property/mutation for evidence and one-owner/idempotency invariants; mutation >=80% on release/security decisions.
- k6 2x load for 10 minutes; worker/DB/network/external chaos; 24-hour soak; automated backup/restore DR; browser monitoring regression.
- Commands include all focused suites, `npm test`, Docker integration, security/performance, `npm run standards:check`, `npm run build`, and `make verify`.

## Required Evidence

- Commands run: all focused hardening suites, `npm test`, Docker integration, security/performance, chaos/soak/DR automation, `npm run standards:check`, `npm run build`, and `make verify`.
- Tests added or updated: SLO/release gate, load, security, crash/redelivery, dependency chaos, shutdown/kill switch, 24-hour soak, backup/restore, synthetic, alert, and UI monitoring suites.
- Rollout or rollback notes: block `GRAPHILE-04` until immutable automated evidence passes; authorize one full cutover only, with no pilot, percentage rollout, or manual waiver.
- Docs updated: SLOs, capacity/cost report, dashboard, alerts, operating/emergency/DR runbooks, diagrams, release evidence, and compliance checklist.

## 5. Data Model & Schema

- Validate Graphile schema, job registry, canonical records, LangGraph checkpoints, audit/outbox/projections, backup retention, restore ordering, and reconciliation after restore.
- No test tool may persist secrets or unredacted production payloads; generate `docs/diagrams/schema-graphile-05.mmd` if DR topology changes schema ownership.

## 6. Architecture & Integration

- Build automated release-evidence collectors and a fail-closed cutover gate around the complete runtime, not a mocked worker.
- Generate `docs/diagrams/architecture-graphile-05.mmd`; document failure domains, pool budgets, recovery order, and alert routing.

## 7. API Design

- Validate health/readiness and synthetic/status contracts from `docs/api/job-runtime-openapi.yml`; synthetic mutation is authenticated, idempotent, isolated, rate-limited, and clearly labeled.

## 8. Security & Compliance

- Run SAST, DAST, dependency/license/provenance, secrets, tenant isolation, payload injection, privilege, and audit-integrity automation with zero unresolved high/critical findings.
- Threats: poisoned job -> allowlist/schema/canonical binding; DB role compromise -> least privilege and monitored grants; evidence forgery -> revision-bound provenance and validation.

## 8a. Standardized Error Logging

- Assert stable sanitized errors and structured logs/traces for every injected failure; no secret, stack, raw payload, or unbounded-cardinality label may escape.

## 8b. AI Implementation Guide

- Test the real composed path, bind evidence to commit/deployment/schema versions, make clocks/failures deterministic, and block release rather than waive a missing gate.

## 9. Performance & Scalability

- Enqueue p95 <100 ms/p99 <250 ms; ready-to-start p95 <2 s; operational reads p95 <250 ms; 99% retry recovery <5 min.
- Enforce pool, worker, payload, retry, backlog age/depth, CPU/memory, DB IO/storage, and telemetry-cardinality budgets at expected and 2x load.

## 10. UI/UX Requirements

- Automate task/queue runtime states, alerts, authorized actions, disabled/draining states, responsive screenshots, keyboard behavior, focus, live regions, and WCAG 2.2 AA.

## 11. Deployment & Release Strategy

- `GRAPHILE-04` cannot switch production ownership until this issue's immutable automated gate passes.
- There is one full cutover after gate approval, not a pilot, percentage rollout, shadow execution, or manual waiver.
- Kill switch, drain, rollback/forward recovery, alerts, communications, and restore are exercised automatically before approval.

## 12. Monitoring & Observability

- Commit SLOs, dashboard, alert rules/tests, synthetic job, traces, and operating/emergency/DR runbooks.
- P0: data loss/cross-tenant/duplicate external effect/unrecoverable runtime; P1: scheduling outage, severe backlog, exhausted critical job; P2: degradation/capacity trend.

## 13. Cost & Resource Impact

- Report baseline/projected worker compute, Postgres connections/CPU/IO/storage, retention, telemetry, backup, synthetic, and support cost with alertable budgets.

## 14. Dependencies & Risks

- Requires runtime/handlers/operations from `GRAPHILE-01/02/03`; blocks `GRAPHILE-04`. Coordinate with `LANGGRAPH-05` to avoid duplicate/conflicting gates.
- Risks: nonrepresentative load, flaky chaos, incomplete restore, stale evidence, alert blind spot. Mitigate with production-like fixtures, deterministic injection, provenance/freshness checks, and scheduled drills.

## 15. Definition of Done

- All performance, security, chaos, soak, DR, synthetic, alert, and kill/drain gates pass automatically and are revision-bound.
- SLOs, capacity/cost, runbooks, dashboards, alerts, diagrams, compliance checklist, and cutover-blocking integration are committed.

## 16. Production Validation Strategy

- Before cutover: full staging gate and restore drill. After cutover: three immediate synthetics, checks every five minutes, 24-hour soak, alert evaluation, and scheduled DR evidence.
- RTO <=15 minutes; RPO is the last committed Graphile/application registry state, LangGraph checkpoint, and canonical audit/domain transaction according to documented transaction boundaries.

## 17. Compliance & Handoff

- Parent Epic: #291. Requires #286, #287, and #288; blocks Graphile cutover #289 and coordinates with LangGraph hardening #284.
- PR links these issues, publishes redacted immutable evidence and `docs/reports/ISSUE-290_STANDARDS_COMPLIANCE_CHECKLIST.md`, and records the machine decision that blocks or authorizes cutover.
