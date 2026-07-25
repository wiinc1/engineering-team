# Exclusive runtime cutover

Issues #283 and #289 use the same ownership primitive from migration `021_runtime_cutover_ownership.sql`. The `jobs` scope may be active only for `graphile`; the `factory` scope may be active only for `langgraph`. Each active epoch is immutable, revision/evidence-bound, and globally unique per scope. Every production enqueue, job execution, LangGraph start, resume, decision, retry, and cancel checks the configured epoch against the current database record.

This is one full switch: no pilot, percentage rollout, shadow side effect, or permanent fallback is permitted.

## Reconciliation matrices

| Scope | Legacy state | Disposition |
| --- | --- | --- |
| jobs | queued/retrying | migrate using the existing semantic key |
| jobs | leased/running | drain, prove effect ownership, then reconcile |
| jobs | completed/dead-lettered/cancelled | retain immutable history only |
| factory | queued/not_started/paused | validate and migrate to a graph checkpoint |
| factory | running | complete on the frozen legacy version; never dual-resume |
| factory | completed/failed/cancelled | retain immutable history only |

Unsupported state, invalid identity, unexpected owner, or more than one executing engine is quarantined and blocks the entire cutover. Reports store no payload or raw checkpoint content.

## Full cutover

1. Verify exact-revision Graphile and LangGraph production evidence.
2. Freeze all new starts and claims; take and verify the backup.
3. Inventory every API, event, LangGraph dispatch, script, scheduler, worker, service, and command plus all active work.
4. Run both dry-run matrices. Abort on any unresolved or ambiguous item.
5. Drain active legacy work and record payload-free reconciliation evidence.
6. Activate the `jobs/graphile` and `factory/langgraph` epochs in one approved maintenance change.
7. Enable 100% of new work, run three synthetics, and verify ownership/legacy-zero/consumer/SLO gates.
8. Only after 24 hours of clean evidence, remove executable legacy code, configuration, services, scripts, and schema. Preserve historical projections and migration evidence.

Rollback first freezes new work. It is permitted only with zero active target executions, zero ownership ambiguity, and compatible schema. Otherwise the kill switch remains active and forward recovery is required. A rollback never silently sends an active graph thread or claimed job to legacy.

`scripts/verify-runtime-cutover.js` accepts sanitized inventory plus a release manifest and produces a deterministic signed decision. It does not mutate production. Epoch activation is an authenticated, audited database deployment operation after approval.

After removal, `npm run cutover:graphile:legacy-zero` and `npm run cutover:langgraph:legacy-zero` must both pass. They intentionally fail in the pre-cutover repository while the inventoried executable paths remain.
