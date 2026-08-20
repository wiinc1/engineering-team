# Production job runtime runbook

## Scope and safety

This runbook covers the #286 runtime plus all seven #287 workloads. Keep `FF_GRAPHILE_WORKER_CUTOVER=false` until #289 removes legacy entrypoints and authorizes coordinated cutover. Do not run legacy and Graphile producers for the same semantic effect. #288 operator routes and #280–#282 LangGraph foundations are outside this change.

## Provision and migrate

1. Provision NOLOGIN roles from `db/roles/job_runtime_roles.sql`; attach environment login/group membership outside source control.
2. Use the approved shared PostgreSQL secret and verified TLS posture. Never put database locations or secrets in payloads/logs.
3. Run `npm run job-runtime:setup` to apply the pinned public Graphile migration and application migrations `016`/`017`, grants, and verification.
4. Run `npm run job-runtime:inventory` and `npm run test:integration:docker` before promotion.
5. Start `npm run job-runtime:worker` in standby. Expected health is `ok`, state `standby`, `acceptingClaims=false`.
6. At #289 cutover, wire canonical, audit, outbox, factory recovery, and typed LangGraph adapters; each external adapter must honor `effectKey` and implement canonical `lookupEffect`. Enable claims only after dependency and readiness checks pass.

Migrator owns schema changes; producer can enqueue and register delivery; worker can claim and mutate only delivery/effect metadata. No runtime role receives general canonical task, audit, approval, evidence, closeout, or checkpoint mutation grants.

## Health, alerts, and diagnosis

Rules in `monitoring/alerts/job-runtime.yml` cover unavailable workers, backlog age/depth, per-queue starvation, retry/failure exhaustion, unknown versions/tasks, repeated tenant rejection, pool waiting, and retention. Structured events/metrics correlate only safe tenant/task/workload/delivery/attempt/resource/request/trace identifiers.

- Factory-only backlog with healthy protected queues: inspect external dependency latency; do not consume protected slots.
- Projection/outbox/maintenance starvation: drain and investigate the affected worker class, locks, pool, and dependency health.
- Repeated tenant rejection: identify the producer/context mismatch or abuse; never relax canonical lookup/authorization.
- Effect suppression: expected after ambiguous redelivery; verify the canonical system and ledger agree.
- Retry exhaustion or terminal result: repair the owning dependency/business condition, then replay with the same immutable identity when policy permits.
- Pool waiting: preserve four reserved connections and the measured six-connection runtime ceiling. The runtime facade may queue an acquisition before the physical pool does; inspect both `job_runtime_pool_waiting_requests` and the load report's base/runtime ending-waiter fields before changing the four-slot default.
- Unknown version: deploy matching producer/handler/catalog versions; never dynamically resolve modules.

## Drain, replay, and recovery

SIGTERM/SIGINT immediately rejects readiness and stops new claims. Workers finish until `JOB_RUNTIME_SHUTDOWN_MS`; forced stop leaves unconfirmed work for redelivery/reconciliation. For database, network, process, or dependency loss, restore the dependency, verify TLS/schema/roles/readiness, then restart the pinned runtime.

For ambiguous effects, query the owning canonical system by deterministic effect key. If completed, record/reconcile and acknowledge; if absent, allow the classified retry; if terminal, preserve the sanitized outcome. Delivery acknowledgment is not business completion: Graphile delivery or registry state is never canonical evidence. Restore canonical task/audit/checkpoint data before reconstructable delivery/effect metadata.

## Migration rollback

1. Set claims false and drain all worker classes.
2. Keep legacy entrypoints unchanged unless #289 explicitly coordinates the cutover state.
3. Apply `017_job_runtime_workloads.down.sql`. It refuses rollback while effect evidence exists; archive/retain evidence under approved policy rather than deleting it to force rollback.
4. The down migration removes only #287 application-owned indexes/columns/table and does not alter canonical task, audit, projection, outbox, factory queue, or checkpoint data.
5. If fully removing the base runtime, separately require an empty registry before applying migration `016` down.
6. Reapply `016` then `017`, grants, setup verification, inventory gate, and real-Postgres tests to restore standby.

## Verification

Run the exact focused, coverage, mutation, real-Postgres, security, performance, 10-minute 2× load, repository, standards, build, and `make verify` commands recorded in `docs/reports/ISSUE-287_STANDARDS_COMPLIANCE_CHECKLIST.md`. The hosted load artifact must derive its load factor from submitted jobs divided by measured wall-clock submission duration; target QPS or requested duration alone is not promotion evidence. Never enable or merge with a red gate.
