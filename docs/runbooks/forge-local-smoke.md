# Forge Local Smoke — engineering-team operator runbook

Supports forgeadapter Phase 2 local validation against audit-api `:3000`.

## Endpoint

```http
GET /tasks/:taskId/forge-execution-readiness
Authorization: Bearer <FORGE_SERVICE_TOKEN>
```

Responses:

| Status | Meaning |
| --- | --- |
| `200` | Task is execution-ready; body is camelCase forge canonical task JSON |
| `401` | Missing or invalid `FORGE_SERVICE_TOKEN` |
| `404` | Task not found |
| `422` | Task exists but is not execution-ready (`task_not_execution_ready`) |

JWT callers need `admin` role (`forge:read`).

## Local file-backend bootstrap

For isolated local smoke without Docker Postgres:

```bash
export AUDIT_STORE_BACKEND=file
export ALLOW_FILE_AUDIT_BACKEND=true
export FORGE_SERVICE_TOKEN=local-forge-smoke-token
export FF_WORKFLOW_ENGINE=false
```

### Seed `TSK-LOCAL001`

```bash
npm run forge:local-smoke:seed -- --task-id TSK-LOCAL001 --tenant-id engineering-team
```

The seed script skips when the task is already execution-ready in the current audit data directory. If a task exists with conflicting events under the fixed idempotency keys, seeding fails with `conflicting_task_state`; use a fresh isolated data directory or a different `--task-id`.

`ALLOW_FILE_AUDIT_BACKEND=true` is required when `AUDIT_STORE_BACKEND=file`; the seed script enforces the same guard as `npm run audit:api`.

### Start audit-api

```bash
PORT=3000 npm run audit:api
```

### Verify readiness

```bash
curl -s \
  -H "Authorization: Bearer ${FORGE_SERVICE_TOKEN}" \
  http://127.0.0.1:3000/tasks/TSK-LOCAL001/forge-execution-readiness | jq .
```

Expected fields:

- `taskId`: `TSK-LOCAL001`
- `projectId`: `forgeadapter`
- `targetRepo`: `wiinc1/forgeadapter`
- `acceptanceCriteria`: non-empty array
- `requestedOwner`: `main` (optional but seeded for local smoke)

## forgeadapter token pairing

Set the same secret in forgeadapter:

```sh
ENGINEERING_TEAM_SERVICE_TOKEN=local-forge-smoke-token
ENGINEERING_TEAM_BASE_URL=http://127.0.0.1:3000
```

## Make-task-forge-ready checklist

Use this when creating tasks manually instead of the seed helper:

1. Create task with acceptance criteria and task metadata
2. Record and approve an Execution Contract with `forge_dispatch.targetRepo` and `forge_dispatch.projectId`
3. Ensure dispatch readiness gates pass
4. Move task to an execution-ready stage
5. Assign an owner that becomes `requestedOwner` in the forge payload
6. Confirm `GET /tasks/:id/forge-execution-readiness` returns `200`

Common `422` causes:

- Draft or unapproved execution contract
- Missing `forge_dispatch.target_repo` on code tasks
- Empty acceptance criteria after normalization

## Postgres local path

When using Docker Postgres (`npm run dev:postgres:up`), omit the file-backend flags and set `DATABASE_URL` before seeding and starting audit-api. Export the same `TENANT_ID` for both `npm run forge:local-smoke:seed` and `npm run audit:api` (default `engineering-team`). The same seed script and `FORGE_SERVICE_TOKEN` contract apply.

## Related docs

- `docs/runbooks/audit-foundation.md` — auth model and forge execution-readiness notes
- `docs/runbooks/task-platform-rollout.md` — Phase 2 token pairing in rollout context
- `../forgeadapter/docs/runbooks/phase2-local-smoke.md` — forgeadapter operator path