# Graphile-02 workload inventory and replay design

## Signed inventory

`config/job-runtime-workload-inventory.json` is the machine-readable authority: schema/catalog version 1, seven migrated workloads, eighteen discovered mechanisms, and a SHA-256 signature over canonical inventory content. `npm run job-runtime:inventory` verifies the signature, scans runtime sources for supported loops/schedules, and proves every migrated entry has a catalog definition, producer, and handler. An unclassified mechanism or missing component fails the gate. Exclusions are explicit: external ingress, database/host recovery, local-only storage, destructive operator recovery, development supervisors, invocation-scoped lease heartbeats, and verification-only samplers are not semantic production background workloads.

## Producer/consumer and effect matrix

| Task v1 | Producer → consumer | Immutable payload | Queue/order | Canonical effect |
| --- | --- | --- | --- | --- |
| `factory.langgraph.start` | factory start → typed LangGraph start | run/task/thread IDs, workflow version | `factory-workflow`, global | LangGraph checkpoint |
| `factory.langgraph.resume` | factory resume → typed LangGraph resume | run/task/thread IDs, workflow/checkpoint versions | `factory-workflow`, global | LangGraph checkpoint |
| `audit.projection.catch_up` | cron/recovery → projection processor | occurrence ID, batch size | `audit-projection`, global | atomic canonical audit projection |
| `audit.outbox.deliver` | cron/recovery → outbox processor | occurrence ID, batch size | `audit-outbox`, global | per-event adapter effect: GitLab, GitHub, deployment, notification, audit record, evidence, or closeout |
| `maintenance.sre_monitoring.expire` | cron/self-schedule → expiry processor | occurrence ID, batch size | `maintenance-runtime`, global | canonical task/audit state |
| `maintenance.factory.reconcile` | cron/self-schedule → queue recovery | occurrence ID | `maintenance-runtime`, tenant | factory queue recovery |
| `maintenance.job_runtime.prune` | cron/self-schedule → retention | occurrence ID | `maintenance-runtime`, tenant | operational retention |

All definitions declare payload version and handler version 1, semantic key, strict schema, queue, ordering lanes, concurrency class, priority, timeout, exponential retry classifier/max attempts, cancellation policy `retry_if_effect_unconfirmed`, and shutdown policy `finish_until_deadline_then_reconcile`. The executable catalog is authoritative for numeric values.

## Canonical effect boundary

The deterministic key hashes version, tenant, task identifier, effect category, canonical resource type/ID, and immutable effect version. Versions are positive JavaScript-safe integers; scheduled maintenance uses its millisecond occurrence. The payload-free ledger leases an attempt. Before an external effect, the adapter's `lookupEffect(effectKey)` checks its canonical system. Completed effects are suppressed and acknowledged. A new effect is performed with the same idempotency key, then recorded. Ambiguous/crash-during or concurrent attempts reconcile against the canonical system and retry while unconfirmed. Crash-before performs nothing; crash-after is observed and suppressed. Timeouts and cancellation do not claim canonical completion.

Allowlisted boundaries cover GitLab, GitHub, deployment, notifications, canonical tasks, audit records/projections, LangGraph checkpoints, evidence, closeout, factory recovery, and operational retention. Projection/maintenance adapters must preserve their owning database transaction/idempotency semantics. No dual-side-effect or shadow path exists.

## Ordering, fairness, and scope

Projection, outbox, and factory are each globally serialized; all maintenance shares one serialized queue. One four-slot public Graphile runner plus named-queue locks enforces a 1/1/1/1 capacity ceiling without consuming a listener connection per class, so long factory work cannot starve the other classes and four shared-pool connections remain reserved. Issue #289 owns legacy entrypoint removal and enabling claims. Issues #280–#282 own LangGraph foundations. Issue #288 owns operator API/UI; #290 owns final production validation hardening.
