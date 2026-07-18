# Runtime hardening, DR, and cutover runbook

## Evidence collection

Collect immutable artifacts from the same revision and staging deployment. Run focused Graphile/LangGraph tests, Docker integration, contracts, security/SBOM/secrets, 2× load for ten minutes, deterministic chaos, browser/accessibility, rollback, three lifecycle synthetics, 24-hour soak, and disposable backup/restore/reconcile. Exercise alert delivery and both kill switches. Do not copy raw jobs, checkpoints, tokens, database URLs, or task content into evidence.

Validate with:

```sh
npm run release:graphile:verify -- artifacts/graphile-release-manifest.json
npm run release:langgraph:verify -- artifacts/langgraph-release-manifest.json
```

Any nonzero exit blocks cutover. Re-run the failing automation; do not edit or waive the result.

## Emergency response

Set `FF_GRAPHILE_WORKER_CUTOVER=false` to stop new claims and drain Graphile. Set `LANGGRAPH_GLOBAL_KILL_SWITCH=true` to stop new graph operations while retaining checkpoints. Page P0 for duplicate/concurrent ownership, cross-tenant access, or data loss; P1 for scheduling/checkpoint outage, severe backlog, stuck run/interrupt, or security anomaly; P2 for capacity, retention, or version drift.

Restore into a disposable environment in this order: canonical domain/audit, outbox/projections, application job registry and Graphile storage, then LangGraph checkpoints/threads/interrupts. Verify schema versions and evidence digests, reconcile semantic job keys and opaque thread IDs, prove RPO, and record RTO. Never start workers during restore reconciliation.

## Cutover and rollback

Generate sanitized inventory JSON for each scope and run:

```sh
npm run cutover:graphile:preflight -- --inventory artifacts/jobs-inventory.json --evidence artifacts/graphile-release-manifest.json
npm run cutover:langgraph:preflight -- --inventory artifacts/factory-inventory.json --evidence artifacts/langgraph-release-manifest.json
```

After both allow, freeze starts, back up, drain, reconcile, activate both exclusive epochs, unfreeze, and run three immediate synthetics. Watch ownership conflicts, blocked legacy invocations, duplicate suppressions, queue/checkpoint latency, stale threads, and interrupt age. Rollback only if the automated decision proves zero active target work and compatible schema; otherwise keep both kill switches active and recover forward. Target RTO is under 15 minutes.
