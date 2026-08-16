# [LANGGRAPH-02] Implement the complete factory lifecycle as a LangGraph state graph

Template Tier: Complex

## 1. User Story

As an engineering-factory operator, I want the entire supported delivery lifecycle modeled and executed as one versioned LangGraph, so that routing, specialist work, retries, gates, and terminal outcomes are explicit and durable.

Success metrics: all phases 0-6 and completion use graph nodes; QA remediation is conditional and bounded; ready child work uses subgraphs; every node emits canonical evidence; and behavior matches or improves every existing lifecycle contract.

## 2. Acceptance Criteria

1. Given a valid requirement, when the graph runs, then it executes intake, PM refinement, execution contract, architect handoff, implementation, QA, conditional fix, review, merge readiness, deployment, SRE, and closeout nodes.
2. Given QA passes, when routing evaluates state, then fix is skipped; given QA fails, fix runs and returns to QA within a configured maximum.
3. Given multiple independent child tasks are ready, when the parent schedules work, then child subgraphs execute concurrently and dependency-blocked children wait.
4. Given specialist delegation succeeds or fails, when the node completes, then truthful runtime ownership or fallback evidence is persisted.
5. Given retry exhaustion, policy failure, cancellation, or nonrecoverable error, when routing terminates, then the correct failed/dead-letter/cancelled state and evidence are produced.
6. Given a worker restart at every node boundary, when execution resumes, then the final result is equivalent and no completed external task is rerun.
7. Given legacy fixture and real-evidence suites, when executed against the graph, then all required golden-path, persona, governance, and release evidence remains present.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, observability and monitoring, deployment and release.
- Evidence expected for this change: versioned graph definition, routing table, subgraph contracts, node adapter tests, equivalence fixtures, E2E lifecycle evidence, performance/chaos results, diagrams, and runbook.
- Gap observed: Factory lifecycle transitions and polling/retry loops are distributed across imperative phase functions. Documented rationale: a single versioned graph must own production routing before the legacy sequencer can be retired (source https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs).

## 3. Workflow & User Journey

- START -> intake -> refinement/contract -> architect -> implement -> QA -> conditional fix loop -> reviews/merge readiness -> deploy -> SRE -> closeout -> END.
- Parent dependency planner -> ready child subgraphs -> join -> next gate.
- Recoverable errors use bounded retry; user-fixable waits route to interrupts supplied by LANGGRAPH-03; fatal errors route to terminal evidence.
- Generate workflow and C4 diagrams named with `langgraph-02`.

## 4. Automated Test Deliverables

- Unit: every node, edge, reducer, conditional route, retry policy, subgraph interface, and terminal state at 95%+ coverage.
- Integration: existing audit/task/queue/delegation/GitLab/GitHub/deployment services through real adapters and Postgres checkpoints.
- E2E: every acceptance criterion, complete success path, QA fail/fix/pass, rejection, cancellation, unavailable specialist, and retry exhaustion.
- Contract/property/mutation: node I/O schemas, all consumers, arbitrary valid transition orders, and 80%+ mutation score.
- Performance/load/chaos: parallel children, backpressure, node timeouts, worker kills, external latency, and 24-hour lifecycle soak.

## Required Evidence

- Commands run: At closeout record lifecycle-focused tests plus `npm run test:delegation:verification`, milestone/full factory verification, `npm run test:integration:docker`, `npm run test:chaos`, `npm run standards:check`, and `make verify`.
- Tests added or updated: Graph nodes/routes/subgraphs, lifecycle integration/E2E, equivalence, property, delegation, performance, mutation, and chaos suites.
- Rollout or rollback notes: Graph remains disabled for production starts until LANGGRAPH-03/04/05 are complete; no partial phase cutover and no pilot graph.
- Docs updated: Graph contract, workflow/C4 diagrams, architecture, factory lifecycle runbook, evidence taxonomy, and node ownership map.

## 5. Data Model & Schema

- Use LANGGRAPH-01 versioned state; add only state fields and event taxonomy required for full lifecycle, routing decisions, child namespaces, attempts, and terminal outcomes.
- Validate every node input/output; never copy canonical task rows into an independently mutable graph source of truth.

## 6. Architecture & Integration

- Graph nodes adapt existing functions such as specialist delegation, task platform transitions, audit writes, merge readiness, deployment, and release evidence.
- Use explicit subgraphs for child work and specialist workflows; keep all external integrations behind existing domain ports.
- Retry, timeout, circuit breaker, and idempotency policies are declared per node.
- Full-enable and kill-switch controls only; no pilot percentage or fixture-only production branch.

## 7. API Design

- Internal graph invocation/result contracts are versioned and typed; public operational endpoints arrive in LANGGRAPH-03.
- Existing task, orchestration, audit, and factory queue contracts must pass compatibility tests unchanged or with documented additive fields.

## 8. Security & Compliance

- Graph routing cannot bypass AuthZ, required approvals, merge readiness, SRE, or evidence gates.
- Threats: prompt/tool output controls routing -> validate structured outputs; cyclic denial of service -> bounded loops; confused-deputy node -> tenant/actor context on every port call.
- Security/property tests prove required gates dominate all paths to success.

## 8a. Standardized Error Logging

- Emit structured node start/success/retry/interrupt/failure/terminal events through the audit logger with sanitized context.
- Stable per-node error classification; no swallowed fallback or false delegated ownership.

## 8b. AI Implementation Guide

- Keep nodes small, deterministic, independently testable, and under maintainability limits.
- Wrap nondeterminism and external effects in checkpointed tasks with idempotency keys.
- Encode policy in named conditional edges, not prompt text or scattered status checks.

## 9. Performance & Scalability

- Scheduler-to-node p95 <2 s excluding external work; graph overhead <10% of end-to-end baseline.
- Parallel child concurrency is bounded and respects database/runtime capacity; 2x expected load maintains error and latency SLOs.

## 10. UI/UX Requirements

- No standalone UI ships here, but state exposes stable labels and sanitized summaries for LANGGRAPH-03.
- Existing task-detail and orchestration visual/accessibility regressions must pass.

## 11. Deployment & Release Strategy

- Deploy the complete graph disabled for production starts, run automated full-lifecycle staging verification, then hand off to cutover stories.
- No partial phase, pilot, or shadow side-effect rollout.
- Rollback disables invocation and retains checkpoints/evidence for diagnosis.

## 12. Monitoring & Observability

- Metrics by graph version/node/outcome, edge selection, loop attempts, child concurrency, specialist outcome, terminal reason, and duration.
- Trace parent/child/subgraph relationships without logging sensitive state.

## 13. Cost & Resource Impact

- Estimate additional worker CPU/memory and model/tool calls from checkpointed nodes, QA loops, and child subgraphs; compare against current phase-runner baseline before approval.
- Bound loop attempts and child concurrency; recovered checkpoints must avoid paying again for already completed model/tool work.

## 14. Dependencies & Risks

- Requires LANGGRAPH-01; blocks LANGGRAPH-03 and LANGGRAPH-04.
- Risks: missed legacy behavior, unbounded cycles, duplicate effects, and oversized state. Mitigate with equivalence inventory, bounded edges, idempotency, and state budgets.
- Debt paid: remove duplicated orchestration rules during LANGGRAPH-04, not in parallel indefinitely.

## 15. Definition of Done

- Every supported production lifecycle phase has a graph node/edge and automated test.
- Required gates cannot be bypassed; full success, remediation, failure, cancel, and restart paths pass.
- Graph/state version and node ownership docs are complete; coverage/mutation/performance/security/chaos gates pass.

## 16. Production Validation Strategy

- Automated staging runs execute all lifecycle branches with real Postgres checkpoints and controlled external adapters.
- Crash every node, exhaust every retry, and validate final evidence equivalence.
- Synthetic full lifecycle is idempotent and suitable for LANGGRAPH-05 production monitoring.

## 17. Compliance & Handoff

- PR links Epic and LANGGRAPH-01, includes graph diagrams, routing inventory, evidence comparison, test reports, and compliance output.
- No manual testing is completion evidence.
