# Issue #281 standards compliance checklist

## Standards Alignment

- Applicable standards areas: architecture and design, coding quality, testing, deployment, observability, security, and team process.
- Evidence expected for this change: lifecycle graph, typed ports, state/retry/property/security tests, diagrams, runbook, and production restart evidence.
- Gap observed: hosted lifecycle evidence and deployed service-port proof are pending. Documented rationale: the revision-controlled target handler composition is now implemented locally, but target-environment proof still requires an immutable deployment. Local real-PostgreSQL SIGKILL coverage exercises every production node boundary, while active processes fail closed when lifecycle ports or target evidence are absent (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/281).

- Architecture: one versioned lifecycle graph; domain ports do not depend on LangGraph types.
- Security: tenant-derived identity, strict state validation, bounded routing, sanitized evidence, and truthful delegation attribution.
- Reliability: checkpoint-safe idempotency identities, bounded retries and QA remediation, deterministic terminal outcomes, and dependency-aware child work.
- Deployment: graph remains disabled until LANGGRAPH-03/04/05 complete; no pilot, percentage routing, shadow side effects, or legacy fallback.

## Acceptance traceability

- [x] Intake through closeout are explicit graph nodes with conditional edges.
- [x] QA pass skips remediation; failure runs bounded fix/QA and exhaustion dead-letters.
- [x] Independent child work runs concurrently while dependencies wait under stable namespaces.
- [x] Delegation evidence rejects false or malformed runtime attribution.
- [x] Retry exhaustion, failure, dead letter, and cancellation produce terminal evidence.
- [x] Runtime and Graphile workload adapter preserve checkpoint/resume and canonical effect identities.
- [x] Production service-port contract, taskless-intake ledger, canonical PostgreSQL run/task/audit reconciliation, store-aware revision-controlled composition loader, and complete golden-path/persona/governance/release equivalence inventory are wired and verified locally.
- [x] Real-Postgres node-boundary crash matrix, local performance, mutation, and chaos evidence are recorded.
- [x] The target deployment handler module atomically binds intake and composes specialist, Git, deployment-health, SRE, and closeout adapters.
- [ ] The excluded soak, exact-head CI, hosted service-port proof, and review evidence are recorded.

## Required Evidence

- Commands run: `npm run test:langgraph`, UI tests, and final repository verification; hosted performance, mutation, chaos, and restart commands remain promotion gates.
- Tests added or updated: lifecycle routing, QA loops, retry exhaustion, child DAG, attribution, state/property, runtime, and workload composition tests.
- Rollout or rollback notes: remain disabled until #282/#284/#283 gates pass; retain checkpoints on application rollback.
- Docs updated: lifecycle architecture, runbook, diagrams, API/state types, and this checklist.

- Focused lifecycle tests cover success, QA fail/fix/pass, exhaustion, retry, failure, cancellation, child concurrency/dependencies, delegation attribution, state security, workload composition, canonical service binding, and registry terminal status.
- `npm run langgraph:lifecycle:equivalence` proves the versioned mapping contains all 27 legacy steps, nine persona roles, ten governance gates, eleven release-evidence classes, and seven required branch families without loss or duplicate ownership.
- Production wiring coverage is 97.71% lines, 97.37% functions, and 85.26% branches after adding lazy canonical-store composition; equivalence/port/canonical-service mutation is 84.54%, above the 80% break threshold. Core lifecycle coverage remains at least 95% for lines, branches, and functions.
- Real PostgreSQL verification proves intake-start persistence without a task, task creation/binding before intake finish, exact-once task-audit reconciliation, append-only mutation rejection, migration rollback/reapply, every-node process recovery, and destructive restore with the lifecycle ledger included.
- Existing LangGraph runtime, fencing, property, contract, security, and chaos tests remain part of `npm run test:langgraph`.
- Final closeout must add deployed domain-port E2E evidence, staging proof, the excluded soak, and immutable pipeline/review links.
