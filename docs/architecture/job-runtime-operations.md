# Job Runtime Operations

Graphile 03 adds an application-owned operational plane around the durable job runtime. Operators read sanitized delivery metadata from `job_runtime.job_delivery_registry`; request history is sourced from `job_runtime.job_operator_actions`. Neither surface exposes payloads or reads Graphile-owned tables.

Recovery calls require an authenticated tenant and actor, `factory-queue:write`, a reason, an idempotency key, and the current `operatorVersion`. Retry and requeue use Graphile Worker's public `rescheduleJobs` utility. Cancel uses the public `completeJobs` utility. A stale version or an incompatible delivery state fails closed with `job_action_conflict`.

The action ledger is claimed before the worker utility is called, which prevents duplicate concurrent actions. A successful action advances `operator_version`; a failed call records a stable error code for later inspection. Runtime drain is a separate privileged action and delegates to the existing graceful-drain lifecycle.

The API and dashboard return operational identifiers, bounded status metadata, attempt counts, stable error codes, and audit history only. Raw job payloads, database errors, credentials, and Graphile schema details are excluded.
