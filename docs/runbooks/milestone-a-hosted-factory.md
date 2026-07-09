# Milestone A — Coordinated Stack Factory Is Reliable

Prove the **single-machine golden-path stack** is reliable for factory delivery before agent-driven autonomy (Milestone B).

**Architecture:** One operator machine runs Postgres, audit API, audit workers, UI, and forgeadapter together via `npm run dev:golden-path:up`. Vercel and Supabase are **not** part of this factory delivery path.

**Scope:** P0.1–P0.4 + P1.1 + P1.6 from the factory remaining-work prioritization plan.

## What the stack already enables

`dev:golden-path:up` (`scripts/dev-golden-path/stack.js`) starts:

| Component | Default | Milestone A item |
|---|---|---|
| Docker Postgres | `:15432` | shared `DATABASE_URL` for API + workers |
| Audit API | `http://127.0.0.1:13000` | control plane writes |
| Audit workers | background | **P0.1** GP-007 always-on projection + outbox |
| `ET_FORGE_DISPATCH_ENABLED=true` | on workers | **P0.2** ET→forge bridge |
| `FF_GITHUB_INTAKE_NORMALIZER=true` | on API | **P0.3** GP-002 intake webhook |
| forgeadapter | `http://127.0.0.1:14010` | implementation lifecycle |
| ET UI | `http://127.0.0.1:15173` | operator sign-in |

No separate worker deployment, no external DB host, and no hosted API platform are required for Milestone A.

## Step 1 — Start the coordinated stack (P0.1 + P0.2 + P0.3)

```bash
cd engineering-team
npm run dev:golden-path:up
```

Confirm:

```bash
npm run dev:golden-path:status
curl -s http://127.0.0.1:13000/version
curl -s http://127.0.0.1:13000/metrics | grep workflow_projection_lag_seconds
curl -s http://127.0.0.1:14010/health
```

`/version` exposes the audit API commit SHA used by strict release-health proof when the coordinated stack is promoted through a non-local operator/API endpoint. Workers log to `observability/golden-path-local-dev/logs/audit-workers.log`. State: `observability/golden-path-local-dev/stack.json`.

Optional: enable continuous factory ticks when bringing the stack up:

```bash
FF_FACTORY_ORCHESTRATOR_ENABLED=true \
OPENCLAW_BASE_URL=http://127.0.0.1:18789 \
npm run dev:golden-path:up
```

## Step 2 — Verify bridge config (P0.2)

With the stack running, bridge env is already set on workers. Dry-run smoke:

```bash
ET_FORGE_DISPATCH_ENABLED=true \
FORGEADAPTER_BASE_URL=http://127.0.0.1:14010 \
ENGINEERING_TEAM_BASE_URL=http://127.0.0.1:13000 \
npm run audit:et-forge:smoke
```

## Step 3 — Verify intake webhook (P0.3)

GP-002 is enabled on the stack API. Smoke without GitHub:

```bash
GITHUB_WEBHOOK_SECRET=golden-path-local-webhook-secret \
npm run golden-path:smoke:gp-002 -- --base-url http://127.0.0.1:13000
```

For real GitHub webhooks, point the repo webhook at your operator machine's reachable audit API URL (or tunnel) and use the same `GITHUB_WEBHOOK_SECRET` as the stack.

## Step 4 — Milestone A verification (P0.4 + P1.6)

Against the **local coordinated stack** (default):

```bash
export AUTH_JWT_SECRET=golden-path-local-dev-secret
export GITHUB_WEBHOOK_SECRET=golden-path-local-webhook-secret
npm run milestone-a:verify
```

This runs worker lag smoke, bridge smoke, GP-002 intake smoke, and factory orchestrator intake→phase1 against `http://127.0.0.1:13000`.

Artifacts: `observability/milestone-a-staging/` (path name kept for tooling compatibility).

### Full golden-path replay on the same stack

```bash
export AUTH_JWT_SECRET=golden-path-local-dev-secret
export FORGE_SERVICE_TOKEN=local-golden-path-forge-token
npm run golden-path:replay:postgres -- --fresh-bootstrap
```

Use `--require-delegation-smoke --openclaw-url http://127.0.0.1:<port>` when proving live OpenClaw (GP-013).

### Factory orchestrator loop

```bash
npm run factory:submit -- --file /tmp/factory-requirements.json
npm run factory:orchestrator -- --once
```

The factory queue uses Postgres table `factory_delivery_queue` by default instead of the JSON queue file. Run migrations first, then submit and tick the orchestrator:

```bash
npm run audit:migrate
npm run factory:submit -- --file /tmp/factory-requirements.json
npm run factory:orchestrator -- --once
```

Operators can inspect status with `GET /api/v1/factory/queue`. If a row reaches `dead_letter`, SRE/admin review the failure evidence, then call `POST /api/v1/factory/queue/<queue-id>/requeue` with `factory-queue:write` and a reason. Requeue only succeeds for tenant-scoped rows already in `dead_letter`; it clears stale lease/error fields and resumes from the recorded failed stage.

Use `FACTORY_QUEUE_BACKEND=file FACTORY_ALLOW_FILE_QUEUE=true` only for isolated local smoke fixtures with a non-default `FACTORY_QUEUE_PATH` or `--queue`; the migrated default queue path stays reserved for Postgres.

## Step 5 — Projection fallback policy (P1.1)

Phase runners call `lib/audit/projection-catch-up.js`:

1. Poll `http://127.0.0.1:13000/metrics` for `workflow_projection_lag_seconds` (up to `PROJECTION_CATCHUP_MAX_RETRIES`, default 3)
2. Trust always-on stack workers when lag stays under threshold
3. Fall back to `process-audit-projection-queue.js` only when workers are down or lag persists

Force fallback for debugging: `GOLDEN_PATH_PROJECTION_FALLBACK=force`.

## Exit criteria

- [x] `dev:golden-path:up` reaches green (API, UI, forgeadapter, workers)
- [x] `workflow_projection_lag_seconds < 5` after writes **without** manual projection scripts
- [x] `golden-path:smoke:gp-002` passes against `:13000`
- [x] `audit:et-forge:smoke` passes with stack bridge env
- [x] `milestone-a:verify` → `milestone-a-staging-verify.json` summary `passed: true`
- [x] Factory orchestrator advances at least one queue item to `phase1_complete` on the stack

Completion evidence: `observability/milestone-a-complete.json` (2026-06-24, `factory-mqsdwq7q-b74ec4` → `phase6_complete`).

## Rollback

```bash
npm run dev:golden-path:down
# preserve pilot data:
npm run dev:golden-path:down -- --keep-postgres
```

## Optional: Docker workers reference (not factory default)

`docker-compose.production-workers.yml` and `fly.toml` exist for **long-lived worker patterns** against an arbitrary Postgres `DATABASE_URL`. Use only if you operate a separate Postgres host outside the golden-path stack. The factory Milestone A proof path does **not** require them.

## Related

- [milestone-b-orchestration.md](milestone-b-orchestration.md) — agent-driven phase 1 + orchestration hardening
- [milestone-c-agent-autonomy.md](milestone-c-agent-autonomy.md) — implementer/QA agent phases
- [milestone-d-closeout-automation.md](milestone-d-closeout-automation.md) — GP-027 closeout report (P3)
- [golden-path-autonomous-delivery.md](golden-path-autonomous-delivery.md) — coordinated stack defaults
- [audit-foundation.md](audit-foundation.md) — GP-007 workers, GP-002 webhook
- [gp-007-projection-worker-production.md](../issues/gp-007-projection-worker-production.md) — notes optional non-stack worker deployment
