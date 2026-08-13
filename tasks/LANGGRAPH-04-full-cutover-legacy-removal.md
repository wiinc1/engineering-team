# [LANGGRAPH-04] Cut over all factory execution to LangGraph and remove the legacy orchestrator

Template Tier: Complex

## 1. User Story

As a platform owner, I want all supported production factory execution cut over to LangGraph and the superseded sequencer removed, so that the system has one execution engine and no permanent dual-run ambiguity.

Success metrics: 100% of new supported runs start in LangGraph; every in-flight legacy run is deterministically completed, migrated, or stopped with evidence; static and runtime checks find zero supported legacy entry points; and rollback never double-executes work.

## 2. Acceptance Criteria

1. Given an inventory of every execution entry point, when cutover completes, then queue workers, API actions, scripts, milestones, scheduled jobs, and production commands invoke LangGraph only.
2. Given an in-flight legacy run, when migration executes, then it is classified and deterministically resumed in LangGraph, completed on the frozen legacy version, or stopped with operator-visible evidence according to the approved matrix.
3. Given a new run after the cutover marker, when any legacy invocation is attempted, then it fails the runtime/static guard and emits an alert.
4. Given compatibility consumers, when task/audit/orchestration/evidence reads execute, then response and projection contracts remain valid.
5. Given cutover failure, when rollback runs, then new starts stop, active thread ownership is reconciled, and no run executes in two engines.
6. Given repository verification, when legacy-removal checks run, then superseded phase routing, retry/poll loops, flags, fixture defaults, scripts, and dead code are absent.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence expected for this change: entry-point inventory, migration matrix, reconciliation report, compatibility tests, static legacy guards, automated cutover/rollback drill, deletion diff, runbooks, and production evidence.
- Gap observed: The current factory queue and golden-path sequencer can represent overlapping execution ownership during migration. Documented rationale: cutover must use an explicit ownership marker and fail closed rather than operate LangGraph as a pilot beside legacy production routing (source https://docs.langchain.com/oss/javascript/langgraph/persistence).

## 3. Workflow & User Journey

1. Freeze new starts briefly and inventory active queue/legacy/graph ownership.
2. Deploy compatibility readers and migration tooling.
3. Classify and reconcile every active run.
4. Set the global cutover marker, enable LangGraph for all new starts, and disable legacy writers.
5. Verify automated production lifecycle, then delete superseded code/config.

Errors include ambiguous ownership, missing evidence, unsupported graph version, failed reconciliation, rollback during active node, and stale scheduled worker.
Generate workflow and C4 diagrams named with `langgraph-04`.

## 4. Automated Test Deliverables

- Unit: classification, ownership marker, migration mapping, reconciliation, guards, and rollback decisions at 95%+ coverage.
- Integration/E2E: mixed legacy states, active leases, restart during cutover, compatibility consumers, full new run, and rollback without double execution.
- Contract/property/security: state mapping invariants, all legacy statuses, tenant isolation, and privileged cutover operations.
- Performance/chaos/DR: production-volume migration, worker/process failures at every cutover step, DB failover, and restore/reconcile drill.
- Mutation score 80%+ for ownership and migration decisions.

## Required Evidence

- Commands run: At closeout record migration/cutover focused suites, full factory/milestone tests, `npm run test:integration:docker`, `npm run test:contract`, `npm run test:chaos`, `npm run standards:check`, `npm run build`, and `make verify`.
- Tests added or updated: Entry-point inventory guard, migration/reconciliation, compatibility, ownership, E2E cutover/rollback, property, security, performance, mutation, and chaos suites.
- Rollout or rollback notes: One full cutover after automated staging approval; no pilot, percentage split, shadow side effects, or permanent fallback. Emergency rollback uses exclusive engine ownership and documented checkpoint reconciliation.
- Docs updated: Architecture, runtime/entry-point inventory, migration and rollback runbooks, scripts/commands, feature flags, operator runbook, diagrams, and deletion record.

## 5. Data Model & Schema

- Add an immutable cutover epoch/engine ownership record and per-run ownership/version metadata where needed.
- Migration is expand-contract: compatible metadata first, exclusive ownership cutover second, legacy fields/tables only after zero-use evidence.
- Automated apply/rollback/apply and backup/restore/reconciliation tests are required.

## 6. Architecture & Integration

- Graphile Worker is the sole outer durable job-delivery runtime and releases factory work into LangGraph exclusively; the bespoke factory queue is removed by `GRAPHILE-04`.
- Remove legacy phase selection and same-process sequencer entry points after migration verification.
- Keep domain services and public read models; remove only superseded orchestration/control code.
- Feature controls are full enable and emergency kill switch, not engine-selection percentages.

## 7. API Design

- Preserve versioned public contracts; add engine/graph version only where operationally necessary.
- Privileged cutover/reconciliation endpoints or scripts require authenticated admin/operator context, idempotency, dry-run report, and explicit apply mode.
- OpenAPI and consumer compatibility tests must be green before deletion.

## 8. Security & Compliance

- Cutover tooling is fail closed, least privilege, tenant-aware, redacted, and fully audited.
- Threats: unauthorized cutover -> admin/operator proof; run hijack across engines -> immutable exclusive ownership; malicious legacy state -> validated mapping/quarantine.
- Never print tokens, DB URLs, raw checkpoint state, or private task content in reports.

## 8a. Standardized Error Logging

- Structured migration/cutover/reconciliation events include sanitized run, source engine, target engine, decision, actor, request, and outcome.
- Stable errors distinguish ambiguity, unsupported state, concurrent ownership, compatibility failure, and rollback failure.

## 8b. AI Implementation Guide

- Inventory with `rg` plus runtime manifests; do not assume scripts or test utilities are nonproduction.
- Require explicit engine ownership before invoking either path.
- Delete obsolete code only after compatibility and reconciliation evidence is generated.

## 9. Performance & Scalability

- Dry-run/reconciliation handles current production volume within the maintenance budget and bounded DB connections.
- New graph starts meet existing queue throughput; static guards add negligible build time.

## 10. UI/UX Requirements

- Task detail continues to show one coherent run state during migration; quarantined/blocked migration states have an actionable, accessible explanation.
- No engine selector is exposed to end users.

## 11. Deployment & Release Strategy

- Full cutover sequence: preflight -> short start freeze -> reconcile -> set ownership epoch -> enable all LangGraph starts -> verify -> delete legacy -> unfreeze.
- Automated abort criteria: any ambiguous ownership, contract failure, duplicate side effect, migration error, or SLO breach.
- RTO <15 minutes; rollback preserves exclusive ownership and never silently routes an active graph thread to legacy.

## 12. Monitoring & Observability

- Metrics for starts by engine, blocked legacy invocation, migration classification/outcome, ambiguous ownership, reconciliation lag, and duplicate suppression.
- P0 alert for concurrent engine ownership or duplicate effect; P1 for any post-cutover legacy invocation.

## 13. Cost & Resource Impact

- Estimate temporary migration compute, backup storage, reconciliation queries, and any short overlap in deployed worker capacity; the steady-state target must remove legacy worker cost.
- Cutover tooling uses bounded batches and pool limits, and all temporary migration resources are removed after reconciliation.

## 14. Dependencies & Risks

- Requires LangGraph issues #280, #281, and #282, production gates from #284, and the coordinated Graphile Worker runtime/cutover gates #286 through #290 under Epic #291.
- Risks: incomplete inventory, ambiguous in-flight runs, irreversible deletion, and stale worker deployment. Mitigate with manifest/static guard, dry-run matrix, backup, exclusive epoch, and deployment identity checks.
- Debt paid: retire bespoke sequencer, obsolete phase recovery, and duplicate orchestration flags.

## 15. Definition of Done

- 100% of new supported factory runs use LangGraph.
- Every in-flight legacy run has a reconciled terminal or graph-owned record.
- Zero supported production legacy entry points remain; static/runtime guards and all compatibility tests pass.
- Automated full cutover and rollback drills pass; deletion and docs are committed.

## 16. Production Validation Strategy

- Preflight generates signed/redacted inventory and dry-run reconciliation report.
- Post-cutover synthetics run three times immediately and every five minutes; blocked legacy invocation monitor stays at zero.
- A 24-hour soak precedes final legacy schema contraction; emergency runbook is executable and tested.

## 17. Compliance & Handoff

- PR/MR links Epic and all prerequisites, includes cutover approval/evidence, deletion inventory, compatibility results, rollback proof, and compliance output.
- No manual testing or undocumented in-flight exception is accepted.
