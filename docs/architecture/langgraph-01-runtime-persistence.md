# LangGraph-01 runtime, state, capacity, and configuration

## Boundary and lifecycle

`lib/software-factory/langgraph/index.js` composes the runtime over the existing `pg` pool. Only this directory imports LangGraph packages. Application nodes implement `FactoryDomainNode`; they receive immutable application state and return allowlisted state updates. The flow is queue claim → runtime factory → server-derived thread → guarded Postgres checkpoint → registry/metrics. Resume revalidates registry, tenant, versions, and loaded state before LangGraph advances to the next eligible node.

Canonical tasks and audit events remain authoritative. A checkpoint proves execution position, not business completion. Persistence adapters never call external effects. Later lifecycle nodes must use the existing canonical effect/idempotency boundary.

Single-writer safety uses both a renewable registry lease and a database commit fence. A renewal failure aborts the runnable and marks its server binding stale even when node code ignores cancellation. `put` and `putWrites` transactions lock and verify the same owner and an unexpired lease immediately before commit; mismatch rolls back. Registry status and `last_checkpoint_id` advance only for that owner, and root loads plus history traverse from the accepted registry head through its parent chain, so an unaccepted physical saver row cannot become resumable or visible as accepted history. Pending writes wait for their in-flight checkpoint acceptance; writes that arrive after a successor is accepted are admitted only when a tenant-rooted recursive lookup proves the target is on that accepted parent chain, never merely because a physical row exists.

## Configuration

| Variable | Default | Bounds and behavior |
| --- | ---: | --- |
| `FF_LANGGRAPH_RUNTIME` | `false` | Exact boolean. Enables invocation only; false is dormant infrastructure. |
| `LANGGRAPH_GLOBAL_KILL_SWITCH` | `false` | Exact boolean. True blocks new start/resume and preserves checkpoints. |
| `LANGGRAPH_CHECKPOINTER` | `postgres` | Production accepts only `postgres`; `memory` and `file` fail startup. |
| `LANGGRAPH_CHECKPOINT_SCHEMA` | `langgraph_checkpoint` | Fixed dedicated schema; alternate/public schemas fail startup. |
| `LANGGRAPH_MAX_STATE_BYTES` | `262144` | 4 KiB–1 MiB admission and persistence limit. |
| `LANGGRAPH_POOL_BUDGET` | `2` | 1–16 acquisitions over the existing physical pool. Default expected active concurrency is 2. |
| `LANGGRAPH_OPERATION_TIMEOUT_MS` | `10000` | 100 ms–120 s for setup, checkpoint IO, graph invocation, and health. |
| `LANGGRAPH_RESUME_LEASE_MS` | `60000` | 1 s–15 min single-resumer lease. |
| `LANGGRAPH_RETENTION_DAYS` | `30` | 1–365 days for terminal checkpoints. |

`PGPOOL_MAX` / `PG_POOL_MAX`, `DATABASE_URL`, `PGSSLMODE`, `PGSSL_ACCEPT_SELF_SIGNED`, and related TLS settings remain owned by `lib/audit/postgres.js`. No LangGraph-specific database secret exists.

## State and versioning

Version `FactoryGraphStateV1` contains identity/version fields, current/completed lifecycle nodes, artifact references with SHA-256 checksums, finite decisions, attempt, and UTC update time. Artifact bodies, arbitrary context, credentials, commands, SQL, cookies, and tokens are not accepted. Allowed artifact-reference strings are still parsed and rejected when they contain URL credentials, secret-bearing query/fragment keys, bearer/JWT/provider tokens, or control characters. Reducers sort and deduplicate nodes/artifacts/decisions so replay order does not change state.

Graph and state compatibility fixtures live in `tests/fixtures/langgraph/`. A new graph/state version requires an additive migration function, fixture, cross-version read test, and deployment that can read every active retained thread before any writer changes. Unknown versions increment mismatch telemetry and fail closed.

## Storage, retention, backup, and recovery

- Package-owned `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, and `checkpoint_migrations` live only in `langgraph_checkpoint`.
- The durable application namespace is `factory` in `factory_threads`; LangGraph's package-owned rows use its required empty root `checkpoint_ns`. Non-empty package namespaces are reserved for later subgraphs.
- Application-owned `factory_threads` stores no raw state or secrets. Active/stale and retention queries are indexed.
- `pruneExpired` deletes only terminal, past-retention, unleased threads in bounded batches. Active/paused threads are never pruned.
- Back up the full dedicated schema with the database. Restore canonical task/audit data first, then the checkpoint schema at the same graph/state compatibility level.
- Deep health writes, reads, validates, and deletes an isolated synthetic checkpoint. It also verifies schema/package migration and pool availability.

## Capacity and cost estimate

Default maximum state is 256 KiB and retention is 30 days. Planning case: 10,000 active/retained threads × 8 checkpoints × 64 KiB average serialized state ≈ 4.9 GiB primary data; allow 2× for indexes/MVCC and 2× backup copies, for an operating allocation of about 20 GiB-month. At 100,000 checkpoints/month, the incremental workload is about 100,000 writes plus reads/resume/backup IO. The runtime adds zero paid third-party cost: LangSmith is not required. Review actual `langgraph_checkpoint_size_bytes`, thread counts, WAL/backup growth, and pool waiters monthly; reduce retention or state size before increasing budget.

The automated load gate runs four concurrent threads (2× the default expected two) for 600,000 ms. Local budgets are write p95 <100 ms and read p95 <150 ms; hosted staging budgets are <250 ms and <300 ms. Pool active acquisitions must reach but never exceed the configured two, ending waiters must be zero, and completed invocations must exactly equal observed side effects. The exclusive exact-revision evidence ran for 600,018 ms and completed 59,968 invocations at 99.94 QPS with invocation p95/p99 50/68 ms, 179,904 writes at p95/p99 11/14 ms, and 179,904 reads at p95/p99 7/10 ms. It recorded zero failures, zero post-side-effect failures, exact effects 59,968/59,968, zero duplicate node executions, pool peak/budget 2/2, ending active/waiters 0/0, and zero residual registry/checkpoint/blob/write rows. Observed state averaged 307 bytes (p95/p99/max 328/328/328); the measured-size projection for 10,000 threads × 8 checkpoints is 24.56 MB primary or 98.24 MB with 2× MVCC/index allowance and two backup copies. Hosted staging remains a separate promotion gate.

The local recovery rehearsal uses separate OS processes and the real saver: it SIGKILLs the checkpointing worker, verifies a fresh worker executes only the next node, pauses/unpauses PostgreSQL to prove fail-closed recovery, then performs custom-format backup, destructive schema loss, restore, exact snapshot/version comparison, and resume. The final exact-revision rehearsal restored 3 checkpoints, 20 blobs, and 17 writes with one execution per domain node in 1,689 ms. Hosted failover/restore remains a separate promotion gate.
