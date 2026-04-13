# Runbook — Task Assignment

## What this feature does
Allows an authorized Product Manager to assign or reassign an AI agent as the owner of a task.

## Live route shape
- Canonical runtime route: `PATCH /tasks/{taskId}/assignment`
- Compatibility alias also accepted by the API server: `PATCH /api/tasks/{taskId}/assignment`
- Agent roster endpoint for the UI: `GET /ai-agents` (also accepts `/api/ai-agents`)
- Task-list read surface used by the thin browser runtime: `GET /tasks`
- Operator health endpoint: `GET /health/task-assignment`
- Internal smoke endpoint: `GET /api/internal/smoke-test/task-assignment`

## Owner visibility contract
- Any authenticated caller with `state:read` can see additive owner metadata on `GET /tasks/{taskId}` and `GET /tasks` via `current_owner` and `owner`.
- That visibility is intentionally read-only; it does **not** grant assignment capability.
- Only callers with `assignment:write` (PM/admin in the current role map) can mutate owner state through `PATCH /tasks/{taskId}/assignment`.
- Restricted telemetry behavior is separate: lower-privilege readers still get owner metadata, while `GET /tasks/{taskId}/observability-summary` omits privileged telemetry fields server-side.

## How to verify the feature is working
1. Open a task in an environment where the audit/task-detail UI is enabled.
2. Confirm the owner selector renders for authorized PM users.
3. Assign a valid active AI agent.
4. Verify the owner updates on the task detail page.
5. Verify `GET /tasks/{taskId}` returns the new `current_owner` and `owner` projection fields.
6. Verify `GET /tasks` returns the same owner projection for list consumers, including `null` for unassigned tasks.
7. Verify an audit log entry exists with previous owner and new owner.
8. If a downstream list/queue surface is present in your deployment, verify it filters from the projected assignee state.

## How to rollback
1. Disable `ff_assign-ai-agent-to-task`.
2. If needed, disable `ff_assign-ai-agent-to-task_killswitch` globally.
3. Confirm assignment controls are hidden and no traffic hits the assignment endpoint.

## Feature flags
- Runtime flag env var: `FF_ASSIGN_AI_AGENT_TO_TASK`
- Emergency kill switch env var: `FF_ASSIGN_AI_AGENT_TO_TASK_KILLSWITCH`
- Reference: `/docs/feature-flags.md`

## Common errors + resolutions
- **401 Authentication error** → verify session/auth provider and PM login state.
- **403 Authorization error** → verify user role includes task-management permission.
- **400 Invalid agent** → verify selected agent exists and is active in the roster source.
- **404 Task not found** → verify task id and tenant/workspace scope.
- **No queue/list update visible** → this repo projects assignee into task state, but does not yet include a dedicated board/inbox UI. Downstream consumers should read `current_owner`/`assignee` from the projection.

## Dashboards + alert links
- Dashboard: `/monitoring/dashboards/task-assignment.json`
- Alerts: `/monitoring/alerts/task-assignment.yml`
