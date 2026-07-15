# Job runtime architecture and configuration

## Runtime boundary

`lib/job-runtime/index.js` composes the shared PostgreSQL pool, application delivery registry, strict catalog/validator, application port, Graphile adapter, task executors, metrics, and lifecycle. Only `graphile-adapter.js` knows the Graphile dependency or schema. Domain modules consume the application port and application handler context.

The only catalog entry in issue #286 is the idempotent synthetic production-validation task. Adding migrated workloads belongs to issue #287.

## Configuration

| Variable | Default | Bounds and meaning |
| --- | ---: | --- |
| `FF_GRAPHILE_WORKER_CUTOVER` | `false` | Exact boolean. No percentage values. False initializes standby without claims. |
| `PGPOOL_MAX` / `PG_POOL_MAX` | `10` | Shared existing TLS pool, 3–100 connections. |
| `JOB_RUNTIME_CONCURRENCY` | `4` | 1–32; must fit after reservation. |
| `JOB_RUNTIME_RESERVED_CONNECTIONS` | `4` | 2–64; protects API and coordinated LangGraph checkpoint capacity. |
| `JOB_RUNTIME_POLL_INTERVAL_MS` | `1000` | 100–60,000 ms. LISTEN/NOTIFY remains enabled. |
| `JOB_RUNTIME_SHUTDOWN_MS` | `30000` | 1–300 seconds before forced stop/redelivery. |
| `JOB_RUNTIME_RETENTION_DAYS` | `30` | 1–365 days for terminal application delivery metadata. |
| `JOB_RUNTIME_RETENTION_BATCH` | `1000` | 1–10,000 terminal rows per maintenance pass. |
| `JOB_RUNTIME_RETENTION_INTERVAL_MS` | `3600000` | 1 minute–24 hours. |

With defaults, pool maximum 10 minus 4 reserved leaves 6 available, and worker concurrency 4 fits without exhausting the shared pool. Configuration fails closed if the budget is invalid. PostgreSQL connection construction reuses `lib/audit/postgres.js`, including verified TLS and the explicit non-production self-signed escape hatch already documented for the repository.

## Database ownership and backup

- `graphile_worker` is operational dependency state, owned only by the adapter/migrator.
- `job_runtime.job_delivery_registry` is application-owned operational metadata and stores no payload.
- Canonical task and audit tables remain authoritative business state.
- Backup classification: operational/reconstructable. Include the application registry in normal database backups for incident correlation, but never use it to reconstruct canonical business completion. Graphile delivery state follows the platform database backup policy.
- Retention deletes only `delivery_acknowledged` and `delivery_failed` registry records older than the configured cutoff in bounded, skip-locked batches.

## Cost and capacity

Incremental cost is one long-lived Node worker process, up to four active worker claims, shared-pool usage bounded by the connection budget, Graphile delivery tables, and 30 days of payload-free registry metadata. At 25 expected QPS, 30-day raw registry volume is approximately 64.8 million records before retention; production capacity planning must measure actual completion rate and row size and reduce the retention window or archive metadata if storage alarms trend upward. The automated gate sustains 50 QPS (2x) for 10 minutes while checking latency and pool starvation.

The application boundary removes maintenance cost from bespoke retry, locking, and LISTEN/NOTIFY code, while retaining explicit ownership of domain contracts and completion semantics.
