# Job runtime internal contract v1

This is an in-process application contract. It is not an HTTP endpoint; operational HTTP exposure belongs to issue #288.

## Producer contract

`port.enqueue(context, request)` accepts server-derived tenant and correlation context plus an allowlisted request. Version 1 requires:

- task `job_runtime.synthetic`, version `1`
- a safe workload identifier
- canonical resource `{ type: "synthetic", id: <same workload> }`
- data matching the catalog schema
- an optional run time no more than 30 days ahead

The port creates catalog version, delivery UUID, semantic job key, low-cardinality named queue, retry policy, and the Graphile envelope. Callers cannot supply those policies. The semantic key hashes tenant, task/version, workload, and canonical resource identity. Repeating the same identity and schedule is idempotent; changing the schedule returns `job_schedule_conflict`.

## Handler contract

Handlers receive only schema-validated task data and an immutable application context containing delivery, tenant, workload, correlation, attempt, and abort signal. They never receive Graphile helpers or database internals. Returning records delivery acknowledgment; it does not complete a canonical task or audit workflow.

## Prohibited payload content

Every payload rejects credentials, passwords, cookies, tokens, authorization material, database locations, connection strings, SQL, commands, scripts, executable content, arbitrary module names, secret-like values, non-finite numbers, cycles, non-plain objects, excessive depth, arrays over 100 elements, and serialized envelopes over 65,536 bytes.

## Stable errors

- `job_runtime_unavailable` — retryable infrastructure failure.
- `job_task_unknown` — task is not allowlisted.
- `job_payload_invalid` — identity, authorization, size, secret, JSON shape, schedule, or schema failure.
- `job_version_unsupported` — task exists but payload version is unsupported.
- `job_schedule_conflict` — semantic duplicate has a different delivery schedule or an invalid state transition.

Messages and details are sanitized. Payloads and dependency error messages are never logged.

## Health and readiness

Health exposes only status, lifecycle state, database reachability, exact claims state, catalog version, and sanitized pool counts. Readiness exposes ready/draining state and whether claims are accepted. Neither surface exposes payloads, Graphile table names, database locations, or credentials.
