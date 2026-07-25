# Durable runtime stories implementation status — 2026-07-18

## Outcome

All repository-local work identified for issues #280–#290 is implemented and locally verified, including an automated composed 24-hour soak runner. The full staging soak has not run yet, so the release validators correctly block production cutover. No local result is represented as hosted, reviewer-approved, or production evidence.

## Standards Alignment

- Applicable standards areas: architecture and design, coding quality, testing, deployment, observability, security, and team process.
- Evidence expected for this change: runtime suites, real PostgreSQL recovery, load, coverage, mutation, security, chaos, browser, SBOM, immutable release manifests, hosted promotion, and soak.
- Gap observed: final exact-head pipeline, reviewer, staging, alert-delivery, production synthetic, cutover, and full 24-hour soak evidence are pending. Documented rationale: these gates require execution against the immutable deployed revision and cannot be satisfied by local smoke evidence (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/290).
- Architecture and deployment: exclusive runtime ownership, fail-closed composition, reversible expansion, and evidence-gated contraction.
- Reliability and observability: durable checkpoints/effects, lease fencing, bounded recovery, metrics, alerts, synthetics, and DR proof.
- Security and quality: tenant binding, RBAC, sanitized state, dependency audit, CycloneDX SBOM, coverage, mutation, contract, chaos, browser, and standards gates.

## Story traceability

- #280: dedicated PostgreSQL checkpoint schema, guarded saver, tenant binding, leases/fencing, retention, migrations, health, recovery, and production configuration checks are implemented.
- #281: the full intake-to-closeout graph, bounded QA/fix path, child DAG, truthful delegation evidence, terminal outcomes, Graphile adapter, every-node process-restart matrix, production service-port contract, taskless-intake lifecycle ledger, canonical PostgreSQL run/task/audit reconciliation, versioned legacy-equivalence inventory, and revision-controlled production handler composition are implemented. The target composition atomically binds intake, delegates specialists, requires real implementation/QA/SRE evidence, collects live Git merge-readiness proof, verifies the exact deployed SHA, and closes canonical task/run state. A placeholder graph cannot process production work.
- #282: durable interrupts, exact-once decisions, RBAC, optimistic concurrency, retry/cancel, sanitized status, audit history, controls, browser behavior, alerts, and runbook are implemented.
- #283: reconciliation matrices, exclusive ownership epochs, dry-run preflight, ambiguity quarantine, rollback checks, and legacy-zero verification are implemented. Production inventory/reconciliation and destructive contraction remain operator-owned cutover actions.
- #284: immutable release validation, threshold enforcement, security/chaos/load/DR/browser gates, SBOM generation, integrity-checked evidence assembly, and automated 24-hour soak collection are implemented. The gate remains blocked without hosted artifacts and a completed full soak.
- #286/#287: completed prerequisites remain covered by the composed regression suites.
- #288: sanitized Graphile status/history, public-API actions, exact-once audit ledger, tenant/RBAC/version/idempotency checks, drain state, alerts/runbook, and responsive controls are implemented.
- #289: job reconciliation, ownership epochs, dry-run preflight, rollback checks, and legacy-zero verification are implemented. Production backlog/lease reconciliation and destructive contraction remain operator-owned cutover actions.
- #290: composed-runtime gates, load/chaos/security, drain/kill, exact-effect recovery, full-database restore, SBOM generation, evidence assembly, and concurrent Graphile/LangGraph soak automation are implemented. Hosted evidence and a completed full soak remain required.

## Required Evidence

The following evidence is required for local implementation confidence. Hosted promotion additionally requires the target-environment artifacts listed under “Intentionally not claimed.”

- Commands run: Graphile/LangGraph suites and coverage, mutation, real PostgreSQL Docker integration, two ten-minute load tests, security, chaos, UI/browser, audit, SBOM, standards, lint, typecheck, build, and repository verification.
- Tests added or updated: lifecycle routing/restart, checkpoint fencing, operator exact-once behavior, migrations, composed DR, cutover/release gates, evidence collection, HTTP controls, UI/browser, coverage, and mutation contracts.
- Rollout or rollback notes: production ownership remains unchanged; cutover requires an immutable passing release decision, freeze/reconciliation, exclusive epoch, and zero ambiguous work. Rollback may never create dual execution.
- Docs updated: design, API/runbooks/diagrams from the story set, issue checklists, and this consolidated status report.

### Verified local evidence

- Real PostgreSQL integration: the broad 29/29 suite and latest focused 12/12 LangGraph suite pass, including taskless intake, append-only lifecycle/task-audit reconciliation, SIGKILL resume, every lifecycle boundary, migration down/up, exact-once operator resolution, and composed database restore.
- Composed restore: `public`, `job_runtime`, `graphile_worker`, `langgraph_checkpoint`, and `runtime_control` schemas reconcile after destructive loss, including the lifecycle ledger; the latest measured RTO was 1.808 seconds against a 15-minute limit.
- Graphile 2× ten-minute run: 30,000/30,000 deliveries, enqueue p95 26.76 ms, p99 40.52 ms, ready-to-start p95 38 ms, no pool waiters.
- LangGraph 2× ten-minute run: 60,504 completions, zero failures or duplicate effects, 100.84/s, invocation p95 55 ms, checkpoint write p95 11 ms, read p95 8 ms.
- Coverage: Graphile broad gate at least 95%; operator line/function coverage above 95%. LangGraph baseline 100% lines/functions and 97.4% branches; lifecycle 100% lines, 95.16% branches, 96.88% functions.
- Mutation: Graphile operator 84.59%, LangGraph baseline 86.02%, lifecycle 80.88%, operator decisions 89.55%, and release/cutover/evidence-assembler gates 83.80%; all exceed their enforced break thresholds.
- Contract, security, chaos, UI, browser, build, audit, lint, typecheck, standards, and `make verify` gates pass. Production dependency audit reports zero vulnerabilities.
- CycloneDX production-dependency SBOM generation succeeds from the lockfile with 76 components and creates revision-bound Graphile and LangGraph evidence components.
- Lifecycle equivalence verification maps all 27 legacy golden-path steps exactly once across the graph and covers nine persona roles, ten governance gates, eleven release-evidence classes, and seven success/remediation/failure/cancel/restart branch families.
- Production lifecycle wiring coverage is 97.71% lines, 97.37% functions, and 85.26% branches after adding lazy canonical-store composition; mutation across equivalence, ports, and canonical lifecycle services is 84.54%, above the 80% break threshold.
- The composed soak harness passes a real five-second PostgreSQL smoke at 25 Graphile jobs/s plus LangGraph concurrency two with zero violations, zero connection leaks, and transactionally verified run-scoped cleanup. This validates the harness only; it does not satisfy the 86,400-second release threshold.

## Intentionally not claimed

- The full 24-hour soak has not run.
- The implementation branch is pushed and merge request !322 is open. A final exact-head GitLab pipeline, human reviewer approval, staging deployment, production mutation, alert delivery, production synthetic, and cutover are not yet complete.
- Production release remains blocked until every required artifact is collected for one immutable revision. The evidence assembler permits partial output for diagnosis but returns a failing decision and non-zero exit status while any artifact—including soak—is missing.

## Remaining operator-authorized sequence

1. Push the final soak-automation revision and obtain a passing exact-head GitLab pipeline for merge request !322.
2. Deploy that revision to staging with the revision-controlled lifecycle handler module and target credentials/evidence configured.
3. Collect hosted contract, security/DAST, SBOM, load, chaos, DR, synthetic, alert-delivery, kill-switch, rollback, browser/checkpoint-retention, and composed-runtime evidence.
4. Run the separately scheduled 24-hour soak.
5. Assemble and validate both runtime manifests; only a passing immutable decision permits #283/#289 cutover.
6. Freeze, inventory, reconcile, switch exclusive ownership, verify zero legacy execution, and obtain review approval before any legacy contraction.
