# GP-007 — Always-on projection + outbox workers

**Golden-path step:** `GP-007` in `observability/golden-path-manual-steps.json`  
**Issue:** `docs/issues/gp-007-projection-worker-production.md`

## Problem

The Vercel-hosted audit API accepts Postgres writes but does not run long-lived workers. Without always-on projection + outbox loops, read models lag and workflow gates fail until an operator runs `POST /projections/process` or `npm run audit:project`.

## Architecture

| Component | Runtime | Responsibility |
| --- | --- | --- |
| Audit API | Vercel / `run-audit-api.js` | Append events, enqueue projection + outbox work |
| Audit workers | `run-audit-workers.js` | Drain projection queue + publish outbox (incl. ET→forge bridge) |
| Postgres | Supabase (prod/staging) or Docker `:15432` (local) | Shared `DATABASE_URL` between API and workers |

Workers are **not** serverless. Deploy them as a separate long-running process.

## Local proof (coordinated stack)

```bash
npm run dev:golden-path:up
unset AUTH_JWT_SECRET DATABASE_URL
AUTH_JWT_SECRET=golden-path-local-dev-secret \
DATABASE_URL=postgres://audit:audit@127.0.0.1:15432/engineering_team \
npm run gp-007:verify
```

Evidence:

- `observability/gp-007-staging/gp-007-complete.json`
- `observability/audit-workers-production-smoke.json`

Workers log to `observability/golden-path-local-dev/logs/audit-workers.log`.

## Staging / production deploy

### Option A — Docker Compose (homelab / VM)

```bash
export DATABASE_URL='postgres://...'   # Supabase connection string
export AUTH_JWT_SECRET='...'
export ET_FORGE_DISPATCH_ENABLED=true  # when bridge is enabled
export FORGEADAPTER_BASE_URL='...'
export FORGEADAPTER_SERVICE_TOKEN='...'
export FORGE_SERVICE_TOKEN='...'
export ENGINEERING_TEAM_BASE_URL='https://<hosted-et-api>'
export PUSHGATEWAY_URL='http://<pushgateway>:9091'  # optional, recommended

npm run audit:workers:up
```

Stop / rollback:

```bash
npm run audit:workers:down
# fallback drain:
# POST /projections/process?limit=100
# npm run audit:project -- . 100
```

### Option B — Fly.io

```bash
fly apps create engineering-team-audit-workers  # once
fly secrets set \
  DATABASE_URL='postgres://...' \
  AUTH_JWT_SECRET='...' \
  ET_FORGE_DISPATCH_ENABLED=true \
  FORGEADAPTER_BASE_URL='...' \
  FORGEADAPTER_SERVICE_TOKEN='...' \
  FORGE_SERVICE_TOKEN='...' \
  ENGINEERING_TEAM_BASE_URL='https://<hosted-et-api>'
fly deploy -c fly.toml
```

`fly.toml` runs migrations then `run-audit-workers.js` on a 512MB VM.

## Hosted smoke verification

After workers are deployed against the same `DATABASE_URL` as the hosted API:

```bash
export AUTH_JWT_SECRET='...'
export AUDIT_WORKERS_SMOKE_BASE_URL='https://<hosted-et-api>'
npm run audit:workers:production-smoke
```

Target: `workflow_projection_lag_seconds < 5` within one worker interval (default 5s) after appending a smoke event.

## Environment reference

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes (prod) | — | Same Supabase Postgres as API |
| `FF_AUDIT_FOUNDATION` | yes | — | Must be `true` |
| `PROJECTION_INTERVAL_MS` | no | `5000` | Worker poll interval |
| `OUTBOX_INTERVAL_MS` | no | `5000` | Outbox poll interval |
| `ET_FORGE_DISPATCH_ENABLED` | when bridge on | `false` | Requires forge env vars |
| `PUSHGATEWAY_URL` | no | — | Enables `WorkflowProjectionLag` alert scraping |

## Monitoring

Alerts in `monitoring/alerts/audit-foundation.yml`:

- `WorkflowProjectionLag` — `workflow_projection_lag_seconds > 5` for 5m
- `WorkflowProjectionFailures` — projection worker errors
- `WorkflowOutboxPublishFailures` — outbox publish errors
- `WorkflowAuditMissingTelemetry` — writes without lag gauge (workers likely down)

## Golden-path fallback policy

Phase runners call `lib/audit/projection-catch-up.js`:

1. Poll `/metrics` for `workflow_projection_lag_seconds` (worker-first)
2. Retry up to `PROJECTION_CATCHUP_MAX_RETRIES` (default 5)
3. Fall back to `scripts/process-audit-projection-queue.js` only when lag persists

Set `GOLDEN_PATH_PROJECTION_FALLBACK=force` to test manual fallback explicitly.

## Related

- `docs/runbooks/audit-foundation.md` — worker operations, failure modes
- `docker-compose.production-workers.yml` — reference container deployment
- `fly.toml` — Fly.io worker app
- `lib/task-platform/et-forge-dispatch-bridge.js` — requires outbox worker when enabled