# GP-007 adversarial audit (2026-06-24)

Audit of `docs/issues/gp-007-projection-worker-production.md` requirements vs shipped implementation on `feat/gp-007-projection-workers`.

## Findings

| ID | Severity | Requirement | Gap | Resolution |
| --- | --- | --- | --- | --- |
| A1 | High | Append → `next_required_action` updates without manual projection | Smoke only checked `task_id`/`title` on generic `task.created` | Enhanced workflow smoke: intake draft via `POST /tasks`, assert projected `next_required_action` / `waiting_state` |
| A2 | High | Metrics: `workflow_projection_events_processed_total` increments | Smoke never read counter deltas | Read `/metrics` before/after append; assert monotonic increase or lag drain |
| A3 | High | Outbox publishes without manual `audit:outbox` | No outbox verification in GP-007 verify | Assert `workflow_outbox_events_published_total` delta or integrate bridge dry-run |
| A4 | Medium | Worker process actually running | `stack.json` PID never validated alive | `process.kill(pid, 0)` liveness check |
| A5 | Medium | Hosted verify must not require local stack file | `gp-007:verify` failed on hosted without `stack.json` | `--hosted` profile skips stack-state checks |
| A6 | Medium | Manual fallback logs warning when worker lag persists | `warning` field set but not emitted to stderr | Structured stderr log on manual catch-up |
| A7 | Medium | Pushgateway exposes lag for alerts | Workers only pushed `*_last_processed` custom gauge | Push `workflow_projection_lag_seconds` + outbox counters from `store.readMetrics()` |
| A8 | Low | `FF_AUDIT_FOUNDATION=true` in production worker env | Missing from `docker-compose.production-workers.yml` | Add explicit env default |
| A9 | Low | Doc drift: `PROJECTION_CATCHUP_MAX_RETRIES` default | `audit-foundation.md` said 3, code default 5 | Align runbook to code |
| A10 | Ops | Production/staging workers deployed | Cannot deploy without operator secrets | Documented Fly/Docker path; hosted smoke remains operator step |

## Still operator-owned after code fixes

- Deploy workers to staging/prod Supabase (`fly deploy` / `audit:workers:up`)
- Hosted UI verification (intake visible in browser within one interval)
- Full QA gate smoke on hosted API (needs staged task in QA — covered locally by milestone verify)

## Verification commands

```bash
npm run dev:golden-path:up
AUTH_JWT_SECRET=golden-path-local-dev-secret \
DATABASE_URL=postgres://audit:audit@127.0.0.1:15432/engineering_team \
npm run gp-007:verify

# Hosted (after worker deploy):
AUTH_JWT_SECRET=... AUDIT_WORKERS_SMOKE_BASE_URL=https://<api> \
npm run gp-007:verify -- --hosted
```