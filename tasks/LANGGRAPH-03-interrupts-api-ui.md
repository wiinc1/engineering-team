# [LANGGRAPH-03] Add durable LangGraph interrupts, operational APIs, and task-detail controls

Template Tier: Complex

## 1. User Story

As an authorized PM, operator, reviewer, or SRE, I want durable workflow waits and operational controls in the existing app, so that I can understand, approve, reject, edit, retry, resume, or cancel a graph run without losing its state.

Success metrics: all human gates use LangGraph interrupts; actions survive restart; unauthorized and stale decisions fail closed; and task detail exposes one accurate next action and graph status.

## 2. Acceptance Criteria

1. Given a graph reaches a human gate, when it interrupts, then the checkpoint, interrupt ID/type/payload schema, authorized roles, wait reason, and next action are durably exposed.
2. Given an authorized fresh decision, when accept/reject/edit is submitted, then the same thread resumes exactly once and records an audit event.
3. Given an unauthorized, cross-tenant, stale, duplicate, malformed, or conflicting decision, when submitted, then it returns the standardized 4xx response and does not resume.
4. Given a recoverable failed node, when an authorized retry is requested, then only the eligible node resumes under its retry budget.
5. Given cancellation, when authorized, then new node dispatch stops, in-flight handling follows documented semantics, and the run becomes terminal without deleting history.
6. Given task detail on mobile or desktop, when graph state changes, then current node, completed work, wait, attempts, checkpoint freshness, errors, and next action remain accessible and non-overlapping.
7. Given polling/reconnect after process restart, when state is reloaded, then UI and API show the same durable interrupt and no transient in-memory state is required.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, observability and monitoring, deployment and release.
- Evidence expected for this change: OpenAPI, RBAC matrix, interrupt schemas, API/browser tests, visual/accessibility evidence, audit events, dashboards, alerts, and emergency runbook.
- Gap observed: Existing approval and orchestration surfaces do not expose a single durable LangGraph interrupt contract. Documented rationale: interrupts must be persisted and resumed with the same thread identifier to support process-safe human decisions (source https://docs.langchain.com/oss/javascript/langgraph/interrupts).

## 3. Workflow & User Journey

1. User opens task detail and sees the current graph node or wait.
2. Authorized role inspects sanitized context and chooses accept, reject, edit, retry, or cancel.
3. API validates auth, tenant, role, interrupt version, expected checkpoint, and idempotency key.
4. Runtime issues resume/cancel command; audit and projections update; UI refreshes.

Errors include stale decisions, concurrent reviewers, expired sessions, deleted tasks, unsupported graph versions, worker unavailable, and interrupt payload conflicts.
Generate workflow and C4 diagrams named with `langgraph-03`.

## 4. Automated Test Deliverables

- Unit: interrupt policy/schema, RBAC, optimistic concurrency, idempotency, response/view-model formatting, and error mapping at 95%+ coverage.
- Integration/contract: real Postgres interrupt/resume and OpenAPI/runtime parity across all consumers.
- E2E/browser: every acceptance criterion, all roles, refresh/reconnect, keyboard flow, live regions, stale/conflict states, and cancellation.
- Visual/accessibility: mobile/tablet/desktop/large desktop for running/waiting/failure/retry/cancelled/completed states; zero serious/critical axe violations.
- Security/performance/mutation: tenant isolation, replay/CSRF/AuthZ, state read/action latency, and 80%+ critical-decision mutation score.

## Required Evidence

- Commands run: At closeout record focused API/UI tests plus `npm run test:ui`, `npm run test:browser`, `npm run test:contract`, `npm run test:security`, `npm run test:performance`, `npm run standards:check`, and `make verify`.
- Tests added or updated: Interrupt/RBAC/API integration, browser E2E, contract, visual, accessibility, security, performance, and mutation suites.
- Rollout or rollback notes: APIs and UI deploy compatibly before full cutover; controls stay hidden until graph execution is enabled. Kill switch disables mutations while preserving read-only history.
- Docs updated: OpenAPI, RBAC matrix, task-detail/orchestration docs, workflow/C4 diagrams, feature flags, operator and emergency runbooks.

## 5. Data Model & Schema

- Application-owned interrupt registry/index includes tenant, run/thread, interrupt/checkpoint IDs, type/version, state, authorized roles, created/resolved timestamps, resolver, and idempotency key.
- Raw secrets and unrestricted graph state are never copied into interrupt payloads.
- Apply/rollback/apply and concurrent-resolution constraints are automated.

## 6. Architecture & Integration

- Existing API handler/auth/audit/projector layers call the LangGraph runtime adapter; browser consumes task-detail read models, not raw checkpoints.
- Add additive feature flag fields plus global kill switch; no pilot targeting.
- Resume calls use expected checkpoint/interrupt versions and explicit timeout/circuit breaker behavior.

## 7. API Design

- Add versioned read model and mutations for graph run status, interrupt decision, retry, cancel, and health under the existing API conventions.
- Publish `docs/api/langgraph-orchestration-openapi.yml`; preserve existing route payloads through additive fields/adapters.
- Require `Idempotency-Key` and optimistic concurrency token for all graph mutations.

## 8. Security & Compliance

- Server derives tenant/actor; RBAC is action and interrupt-type specific; registration/OIDC/session behavior remains unchanged.
- Threats: replay -> idempotency and consumed interrupt; privilege escalation -> RBAC/tenant tests; payload injection -> schema allowlist and sanitization.
- Audit every view-sensitive mutation and decision without logging secret or private raw state.

## 8a. Standardized Error Logging

- Use shared HTTP errors and audit logger for validation, authentication, authorization, conflict, unavailable runtime, unsupported version, and timeout.
- Stable errors are exposed to UI with request ID and recoverable/nonrecoverable classification.

## 8b. AI Implementation Guide

- Resume only through the LangGraph command contract; never edit checkpoint rows directly.
- Keep browser state derived from server read models; no client-side authorization or fabricated graph status.
- Follow DESIGN.md and existing component/icon patterns.

## 9. Performance & Scalability

- Status read p95 <250 ms; accepted decision response p95 <500 ms excluding async node work; UI update visible within current freshness budget.
- Concurrent reviewer tests prove one winner and deterministic conflict responses.

## 10. UI/UX Requirements

- Task detail is the primary screen; role inboxes show graph waits as next actions without new marketing surfaces.
- Above fold: stage, owner, run state, current node/wait, checkpoint freshness, next action, and failure status.
- Controls use existing buttons/icons, accessible confirmation where destructive, stable dimensions, tooltips, and live status.
- All breakpoints, focus order, keyboard actions, contrast, error/loading/disabled states, and text wrapping are automated.

## 11. Deployment & Release Strategy

- Deploy additive API/read model, then UI, then enable with full graph cutover. No pilot or percentage rollout.
- Automatic rollback hides/disables controls and restores previous compatible read rendering; active checkpoints remain intact.

## 12. Monitoring & Observability

- Metrics for active interrupts, age, decisions by type/outcome, conflicts, unauthorized attempts, resume latency/failure, retries, cancels, and stale UI reads.
- Alerts for stuck interrupts, resume failures, authorization anomaly spikes, and UI/API contract errors.

## 13. Cost & Resource Impact

- Estimate incremental API reads, polling, checkpoint history queries, browser telemetry, and retained interrupt metadata; record the measured monthly delta before cutover.
- Reuse current polling/read-model infrastructure and impose history pagination/retention limits to prevent unbounded storage or query cost.

## 14. Dependencies & Risks

- Requires LANGGRAPH-01 and LANGGRAPH-02; blocks LANGGRAPH-04 full cutover.
- Risks: double resume, sensitive context exposure, confusing dual status, and stale UI. Mitigate with concurrency tokens, redacted read models, one status derivation, and reconnect tests.

## 15. Definition of Done

- All human gates use durable interrupts and every action has API/UI/RBAC/audit coverage.
- OpenAPI, browser, visual, accessibility, security, performance, and mutation gates pass.
- No raw checkpoint or client-only authorization is exposed.

## 16. Production Validation Strategy

- Automated synthetic creates a safe interrupt, verifies status, resumes idempotently, and confirms audit projection.
- Staging tests restart API/worker/browser sessions between interrupt and resume and test concurrent decisions.
- Kill switch response and emergency recovery are verified automatically.

## 17. Compliance & Handoff

- PR links Epic and prerequisites and includes OpenAPI, diagrams, RBAC, UI evidence, tests, runbooks, dashboards, and compliance output.
- No manual UI testing is completion evidence.
