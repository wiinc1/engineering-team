# Coordinated Graphile and LangGraph production gates

Issues #284 and #290 share one revision-bound, fail-closed evidence contract. `lib/release-gates/runtime-evidence.js` requires automated staging deploy, contracts, security, SBOM, 2×/10-minute load, chaos, 24-hour soak, DR restore, three lifecycle synthetics, alert delivery, kill switch, and exclusive rollback evidence. Graphile additionally requires composed-runtime proof; LangGraph requires checkpoint-retention and browser proof.

Every artifact must be passed, redacted, automation/provenance labeled, unexpired, and bound to the exact 40-character revision. SHA-256 artifact identifiers are stored, while raw payloads, checkpoint state, credentials, URLs, and task content are forbidden. There is no manual waiver. `runtime_release_evidence_failed` blocks both cutover preflight commands.

## SLO and capacity budgets

- Graphile scheduling availability: 99.9%; runtime-attributable failure below 0.1%; enqueue p95 below 100 ms and p99 below 250 ms; operational reads p95 below 250 ms; ready-to-start p95 below 2 seconds; 99% retry recovery within five minutes.
- LangGraph scheduling availability: 99.9%; framework failure below 0.1%; status and hosted checkpoint p95 below 250 ms; resume p95 below 2 seconds; graph overhead below 10%; 99% resumable recovery within five minutes.
- Both runtimes: zero duplicate completed effects, RTO at most 15 minutes, RPO at the last committed registry/checkpoint/audit boundary, no stuck interrupt beyond policy, bounded pool usage, and zero high/critical security findings.
- The load artifact must prove at least 2× expected load for 600 seconds. The soak artifact must prove at least 86,400 seconds with zero SLO, leak, growth, backlog, duplicate, or integrity violations.

## Failure domains and recovery order

Graphile owns outer durable delivery; LangGraph owns factory workflow execution; canonical domain/audit records remain authoritative. Restore canonical records and audit/outbox first, then the job registry and Graphile schema, then LangGraph checkpoints and thread/interrupt ledgers. Reconciliation compares only opaque IDs, versions, semantic keys, and completion evidence. Workers stay drained and graph starts stay killed until reconciliation is exact.

Database, network, external adapter, and process failures are exercised at pre-effect and post-effect boundaries. Effect-ledger reconciliation suppresses completed replays. Optional telemetry export is disabled by default and never blocks core execution. Automatic kill switches trigger on duplicate effects, ownership conflicts, checkpoint loss, severe latency/error burn, or cross-tenant evidence.

## Cost controls

Worker concurrency and shared-pool budgets remain bounded at the configured limits. Metrics use allowlisted low-cardinality labels; logs/traces retain only opaque identifiers; terminal registries and checkpoints follow bounded retention. Staging load/soak, disposable DR databases, backups, synthetic calls, telemetry retention, and optional export must be itemized in the environment artifact before approval. Temporary resources are removed after reconciliation.

Run `npm run release:graphile:verify -- <manifest>` and `npm run release:langgraph:verify -- <manifest>`. A successful local unit test proves the validator, not production readiness; only immutable environment artifacts can authorize cutover.
