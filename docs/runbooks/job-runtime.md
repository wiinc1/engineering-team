# Production job runtime runbook

## Scope and safety

This runbook operates the issue #286 runtime only. It does not migrate workloads (#287), expose operational HTTP routes (#288), or change LangGraph persistence (#280). Keep `FF_GRAPHILE_WORKER_CUTOVER=false` until the coordinated workload cutover is approved. This is a production runtime in standby, not a pilot or shadow worker.

## Provision and migrate

1. Provision the NOLOGIN roles in `db/roles/job_runtime_roles.sql` and attach environment-specific login/group membership outside source control.
2. Use the approved shared PostgreSQL connection secret and verified TLS posture. Never put a database location in a job payload or log.
3. Run `npm run job-runtime:setup`. It applies the pinned public Graphile migration, application migration `016`, least-privilege grants, and schema verification.
4. Run `npm run test:integration:docker` for apply/rollback/apply and real-Postgres behavior before promotion.
5. Start with `npm run job-runtime:worker`. In standby, health is `ok`, state is `standby`, and `acceptingClaims=false`.

Database roles:

- migrator: create/use runtime schemas and migrate runtime objects.
- producer: public Graphile enqueue functions plus select/insert/update on the registry.
- worker: Graphile delivery operations plus select/update/bounded terminal delete on the registry.
- no runtime role receives a canonical task or audit mutation grant.

## Health and readiness

- `ready`: database/schema/role checks passed and claims are enabled.
- `standby`: checks passed but claims are exactly disabled; this is the expected pre-cutover state.
- `draining`: readiness is false and new claims have stopped.
- `failed`: startup, database, worker, or shutdown safety failed.

Health and readiness are in-process contracts until #288. Inspect structured `job_runtime` events and exported metrics through the existing observability integration. Never log raw dependency errors or payloads.

## Alerts and response

Rules live in `monitoring/alerts/job-runtime.yml` and are contract-tested.

- Runtime unavailable while claims enabled: keep claims disabled or drain, check database/TLS/role health, and restart only after readiness passes.
- Queue age over 2 seconds or depth growth: inspect handler failure/retry rate and pool waiting. Do not increase concurrency beyond the pool budget.
- Pool waiting: protect API/LangGraph capacity first; verify reservation, leaks, and database saturation.
- Delivery failure/retry spike: correlate by safe task identifier and correlation/trace id, then repair the application handler or dependency. Graphile acknowledgment is not business completion.
- Unknown version/validation spike: identify the producer contract mismatch. Do not relax schemas or add dynamic task/module resolution.
- Shutdown deadline/redelivery: confirm the replacement worker claims the redelivery and that canonical business state remains unchanged.
- Retention failure: restore the scoped worker DELETE grant or database availability; never run an unbounded delete.

## Drain and shutdown

Send SIGTERM or SIGINT. The runtime immediately enters draining, rejects readiness, stops new claims, and waits up to `JOB_RUNTIME_SHUTDOWN_MS`. At the deadline it force-stops the public runner, marks application `running` deliveries as `redelivery_pending`, closes the adapter/pool utilities, removes signal handlers, and reports failure if cleanup was incomplete.

## Recovery and replay

- Database/network outage: claims stop through worker/database failure; restore connectivity, verify readiness, and restart. Graphile locking/retry plus registry semantic keys prevent a second application schedule.
- Worker loss: restart the same pinned runtime. Named-queue serialization and Graphile locking control concurrent claims.
- Ambiguous handler outcome: inspect canonical domain state before replay. A registry acknowledgment is delivery evidence only.
- Forced redelivery: handlers must be idempotent against canonical state. Never mark canonical completion from the registry.

## Rollback

1. Set `FF_GRAPHILE_WORKER_CUTOVER=false` and drain all workers.
2. Verify no active or retained registry rows remain. Migration rollback intentionally refuses a populated registry.
3. Apply `db/migrations/016_job_runtime_registry.down.sql` through the approved migration mechanism.
4. The rollback removes only the application registry/schema. It does not delete or update canonical task/audit data and does not depend on Graphile internal tables.
5. Reapply migration `016` and `npm run job-runtime:setup` to restore standby.

## Evidence commands

Run focused tests, coverage, mutation, real-Postgres integration, security, performance, chaos, and the 10-minute load gate listed in `docs/reports/ISSUE-286_STANDARDS_COMPLIANCE_CHECKLIST.md`, then run all repository gates before review.
