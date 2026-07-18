# Issue #281 standards compliance checklist

## Standards Alignment

- Applicable standards areas: architecture and design, coding quality, testing, deployment, observability, security, and team process.
- Evidence expected for this change: lifecycle graph, typed ports, state/retry/property/security tests, diagrams, runbook, and production restart evidence.
- Gap observed: hosted lifecycle and every-node restart evidence is pending. Documented rationale: the graph remains dormant until the coordinated production gate and cutover authorize it (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/281).

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
- [ ] Production service ports and complete golden-path equivalence fixtures are wired and verified.
- [ ] Real-Postgres node-boundary crash matrix, performance, mutation, chaos, soak, exact-head CI, and review evidence are recorded.

## Required Evidence

- Commands run: `npm run test:langgraph`, UI tests, and final repository verification; hosted performance, mutation, chaos, and restart commands remain promotion gates.
- Tests added or updated: lifecycle routing, QA loops, retry exhaustion, child DAG, attribution, state/property, runtime, and workload composition tests.
- Rollout or rollback notes: remain disabled until #282/#284/#283 gates pass; retain checkpoints on application rollback.
- Docs updated: lifecycle architecture, runbook, diagrams, API/state types, and this checklist.

- Focused lifecycle tests cover success, QA fail/fix/pass, exhaustion, retry, failure, cancellation, child concurrency/dependencies, delegation attribution, state security, workload composition, and registry terminal status.
- Existing LangGraph runtime, fencing, property, contract, security, and chaos tests remain part of `npm run test:langgraph`.
- Final closeout must add real domain-port E2E evidence, every-node process restart, full repository gates, staging proof, and immutable pipeline/review links.
