# [Epic] Replace custom factory orchestration with LangGraph in production

Template Tier: Epic

Repo gates reviewed: `docs/standards/software-development-standards.md` and `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`.

## 1. User Story

As an engineering-factory operator,
I want every supported autonomous delivery workflow to execute through a durable LangGraph state graph,
so that implementation, QA, remediation, approvals, deployment, and closeout survive process failure and follow one observable orchestration model.

Business context and success metrics:

- Replace the hand-coded production phase sequencer; this is a full implementation, not a pilot, proof of concept, or permanently parallel runtime.
- 100% of newly started supported factory delivery runs use LangGraph after cutover.
- Zero supported production routes invoke the legacy phase sequencer after the migration window closes.
- A worker crash at any graph node resumes from the last durable checkpoint without repeating a completed external side effect.
- 100% of approval waits are represented by durable interrupts and can resume after process restart.
- Existing task, audit, merge-readiness, release-evidence, and browser contracts remain compatible.

## 2. Acceptance Criteria

Must have; every scenario requires an automated E2E test:

1. Given a supported factory requirement, when execution starts, then LangGraph runs the complete intake, contract, implementation, QA, conditional fix, review, deployment, SRE, and closeout lifecycle.
2. Given a node completes and the worker exits, when another worker claims the run, then execution resumes from the persisted Postgres checkpoint without rerunning the completed node.
3. Given QA fails, when the graph evaluates the result, then it routes to the fix node and returns to QA until the bounded retry policy passes or terminates the run.
4. Given an approval is required, when the graph interrupts, then the UI and API expose the wait and an authorized decision resumes the same thread.
5. Given parallel child work is ready, when the scheduler runs, then eligible subgraphs execute concurrently without duplicate dispatch.
6. Given an external side effect times out, when retry or resume occurs, then the idempotency key prevents duplicate GitLab, GitHub, audit, deployment, or notification writes.
7. Given an unsupported, corrupted, or cross-tenant checkpoint, when it is loaded, then execution fails closed with a sanitized structured error and no side effect.
8. Given cutover is complete, when repository and runtime checks execute, then no supported production entry point references the legacy phase runner.
9. Given the LangGraph kill switch is activated, when new work arrives, then new execution is stopped safely while historical task and audit reads remain available.
10. Given production validation runs, when the 24-hour soak and disaster-recovery drill complete, then all SLO, recovery, security, and evidence gates pass automatically.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence expected for this change: ADR, graph and schema diagrams, migration evidence, OpenAPI contracts, automated unit/integration/E2E/contract/property/security/performance/chaos tests, production smoke evidence, dashboards, alerts, and rollback proof.
- Gap observed: The user story template references `docs/AI_IMPLEMENTATION_CHECKLIST.md` and `docs/STANDARDS_ADHERENCE_REPORT.md`, which do not exist in this repository. Documented rationale: this issue uses the enforced repository standards and compliance checklist as the source of truth while recording the template drift for correction (source https://docs.langchain.com/oss/javascript/langgraph/persistence).

## 3. Workflow & User Journey

User journey:

1. Operator submits a requirement and sees one factory run and graph thread.
2. PM and architect contract work completes or waits for an authorized decision.
3. Engineering implementation is dispatched and checkpointed.
4. QA passes or routes the graph through a bounded remediation loop.
5. Review, merge-readiness, deployment, and SRE gates complete.
6. The operator sees graph state, current node, wait reason, attempts, checkpoint freshness, and closeout evidence on task detail.

System flow:

1. Graphile Worker job delivery -> LangGraph runtime -> typed state graph -> existing domain services.
2. Node completion -> Postgres checkpointer -> canonical audit event/outbox -> task projections -> UI/API.
3. Interrupt -> persisted checkpoint -> authorized API decision -> `Command(resume)` -> same graph thread.
4. Terminal state -> existing release evidence and queue release/dead-letter contracts.

Error and edge cases:

- Worker termination, DB disconnect, stale lease, duplicate webhook, concurrent resume, invalid interrupt payload, graph-version mismatch, retry exhaustion, cancellation, tenant mismatch, and unavailable specialist runtime.
- Generate `docs/diagrams/workflow-langgraph-production-orchestration.mmd`.

## 4. Automated Test Deliverables

- Unit: graph state schemas, reducers, routing, retry policies, interrupt guards, idempotency, version compatibility, and error mapping at 95%+ coverage.
- Integration: real Postgres checkpoint setup, checkpoint/resume, migrations, audit/outbox projection, queue lease recovery, and all external adapters.
- E2E: one automated scenario for every acceptance criterion above, including browser approval/resume and task-detail visibility.
- Contract: API/OpenAPI consumers plus task, audit, queue, GitLab/GitHub, deployment, and specialist-runtime adapters.
- Visual/accessibility: graph status, interrupt, failure, retry, cancellation, and completed states at all supported breakpoints with WCAG 2.2 AA automation.
- Property: arbitrary valid transition sequences never bypass required gates or cross tenant boundaries.
- Performance/load: 2x expected QPS for 10 minutes; checkpoint overhead and queue latency budgets enforced.
- Chaos: kill workers at every node boundary, inject Postgres/network latency, and prove bounded recovery.
- Mutation: 80%+ score for routing, authorization, idempotency, retry, and terminal-state decisions.
- Soak/DR: automated 24-hour sustained run and restore-from-backup drill.
- Test fixtures: versioned graph-state fixtures, external adapter fakes, tenant-separated datasets, and deterministic clocks.

## Required Evidence

- Commands run: At closeout record `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:contract`, `npm run test:e2e`, `npm run test:property`, `npm run test:performance`, `npm run test:security`, `npm run test:chaos`, `npm run test:browser`, `npm run test:integration:docker`, `npm run standards:check`, `npm run build`, and `make verify`.
- Tests added or updated: LangGraph state/routing, Postgres checkpoint, lifecycle, interrupt, API/UI, migration, compatibility, idempotency, security, load, chaos, soak, and disaster-recovery suites defined by child issues.
- Rollout or rollback notes: Full production cutover only after all child issues pass; no pilot or percentage-based dual runtime. Preserve `ff_langgraph_orchestration_killswitch` to stop new runs and use the documented recovery procedure; do not silently route new work to the retired engine.
- Docs updated: `README.md`, `docs/architecture.md`, `docs/runbook.md`, feature flags, OpenAPI, ADR, workflow/schema/C4 diagrams, LangGraph operations and emergency runbooks, dashboards, alerts, and compliance checklist.

## 5. Data Model & Schema

- Use `@langchain/langgraph-checkpoint-postgres` in a dedicated schema with tenant-aware thread IDs and explicit graph/version metadata.
- Canonical tasks, audit events, job delivery registry, projections, merge-readiness records, and release evidence remain domain sources of truth; Graphile jobs are operational delivery state and checkpoints are resumable execution state only.
- Use expand-contract migrations, automated apply/rollback/apply tests, retention and backup policy, FK/check constraints where owned, and schema-diff validation.
- Provide deterministic migration/reconciliation for in-flight legacy runs; completed history is not rewritten.
- Generate `docs/diagrams/schema-langgraph-production-orchestration.mmd`.

## 6. Architecture & Integration

- Pattern: hexagonal orchestration core. Typed graph nodes call existing domain ports; adapters own GitLab/GitHub, OpenClaw, Postgres, deployment, audit, and notifications.
- Add pinned `@langchain/langgraph` and Postgres checkpointer dependencies with lockfile and dependency review.
- Use explicit timeouts, bounded exponential retry with jitter, circuit breakers, cancellation, and idempotency keys.
- Graph thread identity is stable per factory run; child work uses namespaced subgraphs.
- Feature controls: `ff_langgraph_orchestration` is enabled at full cutover; `ff_langgraph_orchestration_killswitch` is the emergency stop. No traffic-percentage pilot mode.
- Generate `docs/diagrams/architecture-langgraph-production-orchestration.mmd` and an ADR covering state ownership and legacy retirement.

## 7. API Design

- Preserve existing task/orchestration response compatibility while adding versioned graph run, checkpoint summary, interrupt, resume, retry, cancel, and health fields/routes.
- Publish `docs/api/langgraph-orchestration-openapi.yml` and validate it against runtime handlers.
- Existing clients receive additive fields during migration; removed legacy mutation behavior requires a documented deprecation and compatibility test.
- All mutations require existing JWT/session authentication, tenant derivation, RBAC, request IDs, and idempotency keys.

## 8. Security & Compliance

- Preserve current AuthN; enforce PM/admin/operator permissions for resume, retry, cancel, and override operations.
- Store only sanitized JSON-serializable state; never persist tokens, raw secrets, cookies, database URLs, private prompts containing credentials, or unredacted production identifiers.
- Threats: forged resume -> bind interrupt/thread/tenant/actor and test 401/403; checkpoint tampering -> validate schema/version and fail closed; replayed side effect -> idempotency ledger and concurrency tests.
- SOC2-relevant execution decisions remain append-only audit events with actor, tenant, request, graph, node, checkpoint, and outcome metadata.
- Require dependency, secret, SAST, DAST, and tenant-isolation tests with zero high/critical findings.

## 8a. Standardized Error Logging

- Use the repository's existing HTTP error envelope and `createAuditLogger`; do not introduce the template's Next.js/Prisma-only example infrastructure.
- No new `console.log`/`console.error`, raw error response, secret-bearing log, or catch-and-ignore behavior.
- Stable codes include `langgraph_checkpoint_unavailable`, `langgraph_state_invalid`, `langgraph_interrupt_conflict`, `langgraph_resume_forbidden`, `langgraph_retry_exhausted`, and `langgraph_version_unsupported`.
- Unit, integration, contract, and E2E tests assert sanitized standardized errors.

## 8b. AI Implementation Guide

- Read the repository architecture, audit envelope, queue leasing, task platform, feature flags, and error conventions before editing.
- Keep nodes deterministic; isolate nondeterministic and external work in checkpointed tasks.
- Side effects before interrupts must be idempotent because interrupted nodes can restart from their beginning.
- Do not claim LangGraph completion while any supported production lifecycle phase still bypasses the graph.

## 9. Performance & Scalability

- API state reads: p95 < 250 ms, p99 < 500 ms under 2x expected load.
- Scheduler-to-node-start: p95 < 2 s excluding external agent queue time.
- Checkpoint write overhead: p95 < 100 ms locally and < 250 ms in hosted staging.
- Resume-to-next-node: p95 < 2 s; duplicate side-effect rate exactly zero.
- Define retention, connection-pool, worker-concurrency, backpressure, and queue-depth scaling limits; no new Redis dependency without a separate approved ADR.

## 10. UI/UX Requirements

- Update task detail orchestration visibility with current graph node, completed nodes, interrupt reason, attempt count, last checkpoint, failure category, and next action.
- Authorized users can approve/reject/edit interrupt payloads, retry a recoverable node, cancel a run, and inspect sanitized history.
- Preserve role inboxes and existing task-detail hierarchy; use existing components and DESIGN.md tokens.
- Automate responsive, keyboard, live-region, focus, visual regression, and axe-core coverage across mobile, tablet, desktop, and large desktop.

## 11. Deployment & Release Strategy

- Deploy database expansion, compatible readers, graph workers, full graph, then cut over all new runs and remove legacy writers.
- This initiative has staging verification and a single full production cutover, not a pilot, canary user cohort, or shadow side-effect execution.
- Automated rollback stops new graph starts, drains or freezes active threads safely, restores the previous deploy only while its schema remains compatible, and never double-executes a run.
- RTO < 15 minutes; RPO is the last committed graph checkpoint and canonical audit event.

## 12. Monitoring & Observability

- SLOs: 99.9% graph scheduling availability, <0.1% framework/runtime failure rate, zero duplicate side effects, and 99% of resumable failures recovered within 5 minutes.
- Metrics: runs/nodes/interrupts/checkpoints/retries/failures/resumes/cancellations, checkpoint latency, queue-to-node latency, active threads, stale threads, version mismatches, and idempotency suppressions.
- Add structured logs and trace spans keyed by tenant-safe run/thread/node/checkpoint/request IDs.
- Commit Grafana dashboard and P0/P1/P2 alerts with runbook links and automated alert tests.

## 13. Cost & Resource Impact

- Record current and projected worker compute, Postgres checkpoint storage/IO, connection usage, retention cost, and optional LangSmith cost before approval.
- Default architecture must operate without paid LangSmith; optional tracing export requires explicit configuration and redaction review.
- Set worker, connection-pool, checkpoint-retention, and external-model/tool rate limits.

## 14. Dependencies & Risks

Blocking stories:

- `LANGGRAPH-01` runtime, state, persistence, and migrations.
- `LANGGRAPH-02` complete lifecycle graph and specialist subgraphs.
- `LANGGRAPH-03` interrupts, operational API, and UI.
- `LANGGRAPH-04` legacy migration, cutover, and code removal.
- `LANGGRAPH-05` production hardening, observability, security, and DR.
- Graphile Worker Epic #291 replaces the custom outer queue; issues #286 through #290 must coordinate with LangGraph runtime #280, cutover #283, and hardening #284.

Primary risks:

- Two sources of truth -> keep domain data canonical and reconcile checkpoints against it.
- Replayed external effects -> idempotency ledger, checkpointed tasks, and chaos tests.
- Graph definition drift -> graph versioning, compatibility fixtures, and blocked unsupported resumes.
- Framework lock-in -> domain ports and framework adapter boundary plus exportable JSON state.
- Incomplete cutover -> static/runtime checks that fail while supported legacy entry points remain.

Technical debt: no permanent compatibility adapter, dual writer, or unowned migration branch may remain when the Epic closes.

## 15. Definition of Done

- All five child stories are closed with linked automated evidence.
- Complete lifecycle graph is production code, not a fixture or milestone-only path.
- Unit coverage >=95%, critical-path E2E coverage 100%, mutation >=80%, and all contract/security/performance/chaos/soak/DR gates pass.
- Postgres migrations pass apply/rollback/apply and restore drills.
- OpenAPI, ADR, diagrams, runbooks, dashboard, alerts, and feature flag docs are committed.
- 100% of supported new production runs use LangGraph and static/runtime legacy-path checks pass.
- Legacy production phase sequencer, retry/polling branches superseded by LangGraph, and obsolete flags are removed.
- `make verify` and the required compliance commands pass.

## 16. Production Validation Strategy

- Provide `/health/langgraph-orchestration` and an authenticated, read-only/idempotent synthetic workflow.
- Run automated staging lifecycle, crash/resume at every node, concurrent interrupt, tenant-isolation, and rollback tests before cutover.
- After full cutover, run synthetic checks every five minutes, three immediate post-deploy checks, a 24-hour soak, and automated alert evaluation.
- Kill switch stops new execution within two minutes; `docs/runbooks/langgraph-orchestration-emergency.md` defines recovery and communication.

## 17. Compliance & Handoff

- Branch: `feature/langgraph-full-production-orchestration` or scoped child branches.
- PRs link the Epic and relevant child issue, compliance checklist, automated evidence, migrations, docs, and rollback proof.
- Artifacts live under `tests/`, `docs/diagrams/`, `docs/api/`, `docs/runbooks/`, `monitoring/`, and redacted `observability/` paths.
- No manual testing is accepted as completion evidence.
- Move the story to the implemented archive only after full production cutover and legacy removal are verified.
