# AI Agents Management Migration Application Evidence

## Summary

`db/migrations/014_ai_agents_management.sql` was applied to the configured local/staging PostgreSQL target used by the app.

The target connection was loaded from `.env.local`. Verification output was redacted to host, port, database, and masked user metadata only. No database URL, password, token, or secret value is recorded here.

## Migration Applied

- Migration: `014_ai_agents_management.sql`
- Applied at: `2026-05-31T03:00:43.982Z`
- Ledger table: `schema_migrations`
- Target host family: Supabase Postgres pooler
- Target database: `postgres`

## Commands Run

```sh
PGSSL_ACCEPT_SELF_SIGNED=true npm run audit:migrate
```

Result:

```text
postgres migrations applied
```

```sh
PGSSL_ACCEPT_SELF_SIGNED=true TENANT_ID=engineering-team npm run task-platform:verify
```

Result:

```text
database.migrationApplied=true
database.drift.ok=true
api.skipped=true
```

The API smoke section was skipped because `TASK_API_BASE_URL` and `TASK_PLATFORM_SMOKE_BEARER_TOKEN` were not configured in the local shell.

## Schema Verification

The following schema objects were verified after migration:

- `schema_migrations.version = '014_ai_agents_management.sql'`
- `ai_agents.description`
- `ai_agents.version`
- `ai_agents.created_by_actor_id`
- `ai_agents.updated_by_actor_id`
- `chk_ai_agents_version_positive`
- `chk_ai_agents_supported_role`
- `chk_ai_agents_inactive_not_assignable`
- `agent_mutations`
- `idx_agent_mutations_agent`
- `idx_agent_mutations_idempotency`

## Notes

The first migration attempt failed before executing SQL because the target pooler returned a self-signed certificate chain. The migration was rerun with `PGSSL_ACCEPT_SELF_SIGNED=true`, which is supported by the repo's Postgres configuration for this target.

## Standards Alignment

- Applicable standards areas: deployment and release, observability and monitoring, testing and quality assurance.
- Evidence in this report: redacted target metadata, migration ledger timestamp, schema-object verification, rollout verifier result, and TLS retry note.
- Gap observed: API smoke was not run from the local shell. Documented rationale: the database migration and schema were verified directly, and `task-platform:verify` reported drift clean; API smoke requires `TASK_API_BASE_URL` and a bearer token that were not configured in this shell (source https://github.com/wiinc1/engineering-team/pull/245).

## Required Evidence

- Commands run: `PGSSL_ACCEPT_SELF_SIGNED=true npm run audit:migrate`; `PGSSL_ACCEPT_SELF_SIGNED=true TENANT_ID=engineering-team npm run task-platform:verify`; direct read-only SQL verification for `schema_migrations`, `ai_agents`, and `agent_mutations`.
- Tests added or updated: docs-only evidence report; no runtime tests changed because the database migration had already merged in PR #245.
- Rollout or rollback notes: migration 014 is additive and idempotent through the normal migration runner; rollback would require an operator-authored SQL rollback for `agent_mutations` and the added `ai_agents` columns/constraints after confirming no production data depends on them.
- Docs updated: `docs/reports/ISSUE-245-migration-014-application.md`.
