# ADR-004: Tenant-bound Postgres persistence for LangGraph

## Status

Accepted for GitLab issue #280 (`LANGGRAPH-01`).

## Context

Factory phases currently persist coarse evidence while later phases can still require process-local context. A worker restart therefore cannot safely resume every lifecycle node. The foundation must be durable before #281–#283 add lifecycle graphs and operator resume controls. Canonical task and audit stores must remain authoritative; checkpoints are execution state only.

## Decision

- Pin `@langchain/langgraph` `1.4.8` and `@langchain/langgraph-checkpoint-postgres` `1.0.4`. All framework imports live under `lib/software-factory/langgraph/`; domain nodes expose only the application `FactoryDomainNode` interface.
- Construct `PostgresSaver` with the existing `pg` pool and verified TLS posture. A two-slot facade bounds checkpoint acquisitions without creating another physical pool.
- Use dedicated schema `langgraph_checkpoint`. Package-owned checkpoint tables remain opaque. Application table `factory_threads` owns tenant/run/thread binding, graph/state versions, lifecycle status, retention, lease, timestamps, and sanitized size/node metadata.
- Derive opaque thread IDs from server tenant and factory-run identity. Every saver method requires an async server binding and rechecks the registry. User graph configuration cannot provide tenant authority.
- Admit only allowlisted, JSON-serializable `FactoryGraphStateV1`. Reject unknown keys, cycles, secrets, oversize values, identity mismatch, and unsupported versions before graph invocation and checkpoint persistence.
- Use deterministic reducers. Domain nodes cannot mutate identity/version fields and persistence performs no external side effects. Resumption is lease-serialized and begins from LangGraph's next checkpointed node. A heartbeat renews ownership; renewal loss aborts and locally fences the stale runnable. Saver write transactions recheck and lock the owner/unexpired lease immediately before `COMMIT`, lifecycle status and registry-head advancement are owner-conditional, and loads/history follow only the registry-accepted checkpoint chain.
- Production accepts only the guarded Postgres saver. Memory/file/unguarded savers fail with `langgraph_configuration_invalid`; there is no production fallback.
- Deploy migration `018` expand-first and runtime dormant (`FF_LANGGRAPH_RUNTIME=false`). The global kill switch disables new invocation without deleting checkpoints. There is no pilot, percentage, shadow, or cutover in this story.
- Expose authenticated internal v1 health and sanitized checkpoint-summary routes only. Raw checkpoint values are never an API contract. Request IDs are reflected only after bounded single-value normalization, artifact references reject embedded credentials and secret-bearing query/fragment fields, and wrapped-route failures use a generic error message.

## Consequences

Worker replacement is safe at node boundaries and tenant checks are enforced below the API. The runtime adds package-owned checkpoint tables, one small registry, checkpoint IO, backups, and at most two shared-pool acquisitions. Schema setup and a synthetic deep health probe are required before traffic. Rollback refuses referenced state and has a 15-minute operator objective.

## Alternatives considered

- `MemorySaver` and file persistence were rejected because they cannot resume across workers and may silently lose state.
- A new Postgres pool was rejected because it would bypass the established TLS posture and connection budget.
- Raw checkpoint APIs were rejected because they leak implementation state and increase secret/tenant risk.
- Storing lifecycle state in canonical tasks was rejected because operational replay state is not canonical business state.

## Standards Alignment

- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; team and process.
- Evidence expected for this change: ADR, exact dependency pins, typed state boundary, dedicated migration, tenant isolation, crash/resume, coverage/mutation/security/chaos/load, API/runbook/monitoring, full repository verification, and exact-head CI.
- Gap observed: Hosted staging failover, backup/restore, alerts, and latency proof remain pending environment promotion. Documented rationale: LANGGRAPH-01 delivers a dormant foundation and cannot claim deployed-environment evidence before merge and promotion (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/280).

Architecture, coding quality, security, testing, deployment, observability, and operations apply. Evidence is indexed in `docs/reports/ISSUE-280_STANDARDS_COMPLIANCE_CHECKLIST.md`: dependency review, migration apply/rollback/apply, typed validation, crash/resume, tenant/property/security tests, performance/load/chaos, alerts, diagrams, and runbook. The upstream persistence rationale is documented at <https://docs.langchain.com/oss/javascript/langgraph/persistence>.

## Required Evidence

- Commands run: production audit; lint; typecheck; focused LangGraph, coverage, mutation, security, performance, chaos, and exclusive load; full test/browser and coverage; standards; build; `make verify`; isolated Docker integration; diff checks.
- Tests added or updated: LangGraph unit, mutation-contract, contract, E2E, property, security, performance, chaos, live PostgreSQL migration/resume/history/tenant/health tests, V1 fixtures, and server wrapper coverage.
- Rollout or rollback notes: deploy migration 018 and saver setup dormant with the feature flag false; use the kill switch to stop starts/resumes; retain additive storage on app rollback; physical down migration refuses referenced data.
- Docs updated: ADR-004, runtime architecture/capacity, API contract, dependency review, traceability checklist, operations runbook, three Mermaid diagrams, alerts, dashboard, and environment example.

Promotion requires exact dependency/lock verification, production audit, focused coverage and mutation, live Postgres migration, real SIGKILL/fresh-process resume, local database interruption and destructive backup/restore, exact alert-contract tests, tenant/security/property/chaos tests, the exclusive 10-minute 2× load artifact, full repository/browser/standards/build verification, and an exact-head merge-request pipeline. Hosted staging recovery, backup/restore, alerts, and latency remain a later environment gate.
