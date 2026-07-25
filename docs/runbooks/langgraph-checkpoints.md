# LangGraph checkpoint operations runbook

## Provision and deploy dormant

1. Confirm the shared Postgres pool/TLS settings and at least two budgeted acquisitions without reducing API/job-runtime reserves.
2. Run `npm run audit:migrate` to apply expand-only migrations `018`, `020`, and `022`, then `npm run langgraph:setup`. Setup applies pinned saver migrations and performs deep synthetic health.
3. Run `npm run test:langgraph:docker`, `npm run test:integration:docker`, focused coverage/mutation/security/performance/chaos, and the ten-minute 2× load gate.
4. Deploy with `FF_LANGGRAPH_RUNTIME=false`, `LANGGRAPH_GLOBAL_KILL_SWITCH=false`, and `LANGGRAPH_CHECKPOINTER=postgres`. Do not route production graph work in LANGGRAPH-01.
5. Before enabling, set `LANGGRAPH_LIFECYCLE_SERVICES_MODULE=lib/task-platform/langgraph-production-handlers.js`. The synchronous factory receives `{ baseDir, env, store }` and reuses the API's canonical PostgreSQL audit store. It implements every `PRODUCTION_SERVICE_BINDINGS` operation plus the child DAG. Intake atomically creates the canonical project/task and binds `factory_delivery_queue.task_id`; all later handlers require that binding. Startup fails closed for a missing/incomplete or asynchronous module, a path outside the deployed revision, or a non-PostgreSQL canonical store.
6. Configure the target adapters before promotion: OpenClaw specialist routing, GitHub API credentials, and `factory_delivery_queue.metadata.realDelivery` with the repository, branch, pull request, exact commit/merge SHA, hosted deployment URL, and health path. The health endpoint must report the exact deployed SHA. Missing, fixture, stale, or mismatched evidence fails closed.
6. Run `npm run langgraph:lifecycle:equivalence`; archive `.artifacts/langgraph-02-equivalence.json` with the exact deployment revision.
7. Verify authenticated internal shallow/deep health, alerts, backups, and schema compatibility. Browser regression must remain unchanged.

## Diagnose

- `langgraph_checkpoint_unavailable`: verify database/TLS, pool budget/waiters, schema existence, saver migration, and timeout. Never fall back to memory/file.
- `langgraph_migration_mismatch`: stop invocation; apply compatible `018` and pinned saver setup before retry.
- `langgraph_state_invalid`: inspect only safe reason/field, then correct producer state. Do not log or query raw values during routine diagnosis.
- `langgraph_version_unsupported`: deploy a reader compatible with retained threads or migrate via an explicit supported state version path.
- `langgraph_concurrency_conflict`: allow the current lease to finish; investigate renewal loss, database reachability, or a stuck owner after lease expiry. Do not run parallel resume. A failed renewal aborts and fences that worker; never bypass the registry head to resume a newer unaccepted saver row.
- `langgraph_tenant_mismatch`: treat repeated events as a security signal; verify authenticated/server tenant and run identity.
- `canonical_task_missing`: intake may begin without a task, but it must bind one before intake finish. Stop the run, inspect the tenant/run-scoped queue row and append-only lifecycle ledger, and repair through the approved intake idempotency path. Never invent a task binding.
- Pool saturation: preserve the two-slot LangGraph budget and global pool reserves. Reduce worker concurrency before raising connection limits.

Alerts in `monitoring/alerts/langgraph-runtime.yml` cover unavailable storage, latency, corruption/validation, tenant rejection spikes, pool saturation, stale threads, and version mismatch. Logs contain only redacted thread/checkpoint/node/version identifiers.

## Alerts and triage

Every rule links here and is contract-tested against its reviewed expression, threshold, duration, and severity. For unavailable storage, corruption, tenant rejection, version mismatch, or pool saturation, block new execution and inspect deep health, database reachability, migration/version compatibility, and the pool budget before clearing the alert. For write/read latency or stale threads, preserve the checkpoint evidence, compare hosted p95 and pool waiters to the dashboard, and drain concurrency before changing capacity. Never weaken a threshold or silence an alert without updating the reviewed fixture and obtaining normal change approval.

## Crash, failover, backup/restore

After a worker kill, start another compatible worker and call the application resume boundary with server tenant/thread context; it must continue at `snapshot.next`. After DB interruption/failover, require deep health before resuming. After restore, validate canonical task/audit data first, then saver migration, registry/checkpoint counts, graph/state compatibility, and a synthetic probe. Never infer canonical business completion from a checkpoint.

Staging sign-off requires automated worker-kill/resume, DB failover/recovery, pool saturation, schema backup/restore, all alert expressions, hosted p95 budgets, and no cross-tenant/raw-state exposure.

The local Docker rehearsal must retain `.artifacts/langgraph-01-recovery.json`: it records exact restored versions/counts, snapshot equality, one execution per node, and measured recovery time. This is prerequisite evidence, not a substitute for the hosted staging promotion run.

## Kill switch and rollback (RTO objective <15 minutes)

1. Set `LANGGRAPH_GLOBAL_KILL_SWITCH=true`; this blocks new start/resume but retains all data. Drain active workers and confirm leases expire/release.
2. Keep migration `018` in place for ordinary application rollback. Deploy the prior reader-compatible application and verify health.
3. Remove the schema only when no active or retained graph thread or lifecycle event references it. Migration `022` refuses rollback while lifecycle evidence exists; migration `018` independently counts registry, checkpoints, blobs, writes, and lifecycle events. Archive under approved retention instead of deleting evidence to force rollback.
4. If an approved destructive schema rollback is truly required, apply `022_langgraph_lifecycle_events.down.sql` before `018_langgraph_runtime_persistence.down.sql`. Reapply `018`, saver setup, `020`, and `022` when restoring standby. Verify canonical task/audit/queue counts are unchanged.

No percentage/pilot path exists. LANGGRAPH-02/03 own lifecycle cutover and resume authorization.
