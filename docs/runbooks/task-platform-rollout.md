# Runbook — Canonical Task Platform Rollout

## Scope
This runbook covers the first environment rollout of the additive canonical task platform introduced for Issue #30.

It assumes:
- audit storage is already configured to use PostgreSQL through `DATABASE_URL`
- the additive `/api/v1/tasks` and `/api/v1/ai-agents` routes are deployed with the current repo code
- legacy audit-backed task routes remain available during the rollout window

## Preconditions
- target environment has a valid `DATABASE_URL`
- target environment can reach PostgreSQL
- operator has a bearer token with admin access for smoke checks
- task-assignment rollout flags remain in their intended state for the environment

If the target PostgreSQL endpoint does not support TLS, set `PGSSLMODE=disable` explicitly for the migration and backfill commands. For managed staging or production databases, prefer verified TLS instead.

## Rollout Sequence
1. Confirm the target `DATABASE_URL` points at the intended staging or production database.
2. Apply schema migrations.
3. Run canonical task backfill.
4. Verify canonical row counts and checkpoint state.
5. Smoke the `/api/v1` routes.
6. Observe logs, metrics, and alerts during the rollout window.
7. Only after the environment is stable, decide whether read surfaces can move from projection-first to canonical-first.

## Commands
### Run the full rollout sequence
```bash
DATABASE_URL=postgres://... TENANT_ID=engineering-team npm run task-platform:rollout
```

### Run the full rollout sequence when TLS is intentionally disabled
```bash
DATABASE_URL=postgres://... PGSSLMODE=disable TENANT_ID=engineering-team npm run task-platform:rollout
```

### Apply migrations
```bash
DATABASE_URL=postgres://... npm run audit:migrate
```

### Apply migrations when TLS is intentionally disabled
```bash
DATABASE_URL=postgres://... PGSSLMODE=disable npm run audit:migrate
```

### Run canonical backfill
```bash
DATABASE_URL=postgres://... TENANT_ID=engineering-team npm run task-platform:backfill
```

### Run canonical backfill when TLS is intentionally disabled
```bash
DATABASE_URL=postgres://... PGSSLMODE=disable TENANT_ID=engineering-team npm run task-platform:backfill
```

### Run rollout verification
```bash
DATABASE_URL=postgres://... TENANT_ID=engineering-team npm run task-platform:verify
```

### Run rollout verification with optional API smoke
```bash
DATABASE_URL=postgres://... \
TENANT_ID=engineering-team \
TASK_API_BASE_URL=https://<host> \
TASK_PLATFORM_SMOKE_BEARER_TOKEN=<admin-jwt> \
npm run task-platform:verify
```

`npm run task-platform:rollout` is the preferred operator entrypoint. Use the individual commands only when a step must be rerun in isolation.

## Database Verification
`npm run task-platform:verify` automates the core checks below. Use the SQL directly when an operator needs to inspect raw rows.

```sql
select version
from schema_migrations
where version = '006_canonical_task_persistence.sql';

select count(*) as canonical_task_count
from tasks
where tenant_id = 'engineering-team';

select sync_status, count(*) as task_count
from task_sync_checkpoints
where tenant_id = 'engineering-team'
group by sync_status
order by sync_status;

select task_id, owner_agent_id, migration_state, last_audit_sequence_number
from tasks
where tenant_id = 'engineering-team'
order by updated_at desc
limit 20;
```

Expected results:
- the migration row exists in `schema_migrations`
- canonical task count is non-zero in a non-empty environment
- checkpoint rows are present for backfilled tasks
- `sync_status` is predominantly `synced` or `active`
- legacy-only owners may appear as imported canonical agents rather than causing dropped ownership

## API Smoke Checks
Replace placeholders before running:

```bash
curl -sS \
  -H "Authorization: Bearer <admin-jwt>" \
  https://<host>/api/v1/ai-agents
```

```bash
curl -sS \
  -H "Authorization: Bearer <admin-jwt>" \
  https://<host>/api/v1/tasks
```

```bash
curl -sS \
  -H "Authorization: Bearer <admin-jwt>" \
  https://<host>/api/v1/tasks/<task-id>
```

Verify:
- responses return `200`
- task payloads include `taskId`, `version`, and owner metadata when assigned
- previously audit-owned tasks are visible canonically after backfill

## Observability Checks
- review structured logs for `feature=ff_task_platform`
- confirm backfill logs show `action=canonical_backfill` with `outcome=success` or an explained `partial`
- check assignment monitoring artifacts under [monitoring/dashboards/task-assignment.json](/Users/wiinc2/.openclaw/workspace/engineering-team/monitoring/dashboards/task-assignment.json) and [monitoring/alerts/task-assignment.yml](/Users/wiinc2/.openclaw/workspace/engineering-team/monitoring/alerts/task-assignment.yml)
- verify no unexpected drift symptoms appear in task detail, task list, or assignment flows during the window

## Rollback Posture
This rollout is additive. The first rollback action is operational containment, not destructive schema rollback.

1. Stop read-path cutover work if it has begun.
2. Leave legacy audit-backed routes in place.
3. Disable assignment rollout flags if the incident affects assignment behavior.
4. Investigate backfill errors or canonical drift before rerunning backfill.

If assignment behavior is part of the incident, use [task-assignment-emergency.md](/Users/wiinc2/.openclaw/workspace/engineering-team/docs/runbooks/task-assignment-emergency.md).

## Completion Criteria
Treat the environment rollout as complete only when:
- migration succeeded in the target environment
- backfill completed without unexplained failures
- `/api/v1/ai-agents` and `/api/v1/tasks` smoke checks are green
- logs and alerts stay within baseline during the observation window
- a human reviewer signs off on the rollout outcome
