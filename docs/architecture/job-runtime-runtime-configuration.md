# Job runtime architecture, capacity, and configuration

## Runtime boundary

`lib/job-runtime/index.js` composes the shared PostgreSQL pool, delivery registry, effect ledger, catalog, application port, typed workload producers/handlers, scheduler, metrics, and lifecycle. Only `graphile-adapter.js` imports Graphile Worker or knows its schema. Domain modules use application contracts. Successful Graphile completion acknowledges delivery only; canonical task, audit, evidence, closeout, approval, and LangGraph state remain authoritative.

## Configuration

| Variable | Default | Bounds and meaning |
| --- | ---: | --- |
| `FF_GRAPHILE_WORKER_CUTOVER` | `false` | Exact boolean; false is production standby, not shadow or percentage delivery. |
| `PGPOOL_MAX` / `PG_POOL_MAX` | `10` | Existing verified TLS pool, 3–100 connections. |
| `JOB_RUNTIME_CONCURRENCY` | `4` | Exactly 4 when claims are enabled; other values fail closed. |
| `JOB_RUNTIME_RESERVED_CONNECTIONS` | `4` | 2–64; protects API and coordinated LangGraph checkpoint capacity. |
| `JOB_RUNTIME_POLL_INTERVAL_MS` | `1000` | 100–60,000 ms; LISTEN/NOTIFY remains enabled. |
| `JOB_RUNTIME_SHUTDOWN_MS` | `30000` | 1–300 seconds before forced stop/redelivery. |
| `JOB_RUNTIME_RETENTION_DAYS` | `30` | 1–365 days for terminal delivery/effect metadata. |
| `JOB_RUNTIME_RETENTION_BATCH` | `1000` | 1–10,000 terminal rows per scheduled pass. |

Default pool maximum 10 minus 4 reserved leaves a hard ceiling of 6 runtime connections. A job-runtime-only connection-budget facade caps all runtime acquisitions on that same physical shared pool at six; Graphile claims, LISTEN/NOTIFY, housekeeping, registry/effect queries, and producers all pass through it. API and future coordinated LangGraph checkpoint code retain the original shared pool and its four reserved slots. One public Graphile runner has four slots. Factory, projection, outbox, and shared maintenance each have one named queue, so each class can hold at most one slot. Claims fail closed unless concurrency is exactly four, preserving verified 1/1/1/1 fairness and leaving room for runner/listener/housekeeping overhead inside the six-connection ceiling. PostgreSQL construction reuses `lib/audit/postgres.js` and its verified TLS policy.

## Storage, retention, backup, and recovery

- `graphile_worker` is opaque operational dependency state.
- `job_runtime.job_delivery_registry` stores payload-free delivery metadata.
- `job_runtime.job_effect_ledger` stores deterministic effect identity, lease, terminal state, and sanitized result code; it never duplicates effect bodies.
- Canonical domain and LangGraph tables remain the only business source of truth.
- Backup classification: both application tables are operational/reconstructable data. Back them up for incident correlation; restore canonical business data first.
- Retention is a Graphile-scheduled, bounded, tenant-authorized workload. It deletes only eligible terminal operational records. Active deliveries/effects are never pruned.
- Recovery restarts the pinned workers, then lets semantic job keys, ordering queues, canonical lookup, and effect lookup reconcile redelivery. Never infer business completion from worker metadata.

## Capacity and cost

Incremental steady-state cost is one Node worker process, one Graphile runner with four active claims, at most six non-reserved shared-pool connections including runner/listener overhead, Graphile delivery tables, and 30 days of payload-free registry/effect metadata. At 25 expected QPS, the 2× gate runs all seven workload types at 50 QPS for 10 minutes (30,000 jobs). Production capacity reviews must measure row size, queue age, per-class starvation, pool waiters, and effect-ledger growth. Named-queue fairness avoids per-class listener connections while bounding projection/outbox/maintenance latency under long factory work.
