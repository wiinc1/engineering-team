# LangGraph checkpoint operations runbook

## Provision and deploy dormant

1. Confirm the shared Postgres pool/TLS settings and at least two budgeted acquisitions without reducing API/job-runtime reserves.
2. Run `npm run audit:migrate` to apply expand-only migration `018`, then `npm run langgraph:setup`. Setup applies pinned saver migrations and performs deep synthetic health.
3. Run `npm run test:langgraph:docker`, `npm run test:integration:docker`, focused coverage/mutation/security/performance/chaos, and the ten-minute 2× load gate.
4. Deploy with `FF_LANGGRAPH_RUNTIME=false`, `LANGGRAPH_GLOBAL_KILL_SWITCH=false`, and `LANGGRAPH_CHECKPOINTER=postgres`. Do not route production graph work in LANGGRAPH-01.
5. Verify authenticated internal shallow/deep health, alerts, backups, and schema compatibility. Browser regression must remain unchanged.

## Diagnose

- `langgraph_checkpoint_unavailable`: verify database/TLS, pool budget/waiters, schema existence, saver migration, and timeout. Never fall back to memory/file.
- `langgraph_migration_mismatch`: stop invocation; apply compatible `018` and pinned saver setup before retry.
- `langgraph_state_invalid`: inspect only safe reason/field, then correct producer state. Do not log or query raw values during routine diagnosis.
- `langgraph_version_unsupported`: deploy a reader compatible with retained threads or migrate via an explicit supported state version path.
- `langgraph_concurrency_conflict`: allow the current lease to finish; investigate renewal loss, database reachability, or a stuck owner after lease expiry. Do not run parallel resume. A failed renewal aborts and fences that worker; never bypass the registry head to resume a newer unaccepted saver row.
- `langgraph_tenant_mismatch`: treat repeated events as a security signal; verify authenticated/server tenant and run identity.
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
3. Remove the schema only when no active or retained graph thread references it. The down migration checks registry, checkpoints, blobs, and writes and refuses otherwise. Archive under approved retention instead of deleting evidence to force rollback.
4. Apply `018_langgraph_runtime_persistence.down.sql`, then reapply the up migration and `npm run langgraph:setup` if restoring standby. Verify canonical task/audit/queue counts are unchanged.

No percentage/pilot path exists. LANGGRAPH-02/03 own lifecycle cutover and resume authorization.
