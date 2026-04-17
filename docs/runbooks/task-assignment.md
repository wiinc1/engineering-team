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
- Tier-specific projected assignee ids such as `engineer-jr`, `engineer-sr`, and `engineer-principal` are valid owner values and should still be treated as canonical engineer ownership for delivery routing.
- The SRE monitoring inbox is a separate workflow surface: tasks may appear in `/inbox/sre` by workflow stage even when `current_owner` still points at an engineer.
- If SRE creates a monitoring-anomaly child task from task detail, the new child is intentionally assigned to `pm`; that route is distinct from `PATCH /tasks/{taskId}/assignment`.
- Governed close-review cancellation recommendations and exceptional-dispute escalations are also distinct workflow routes; they may affect routing into `/inbox/human` without mutating canonical assignment state.
- Human close decisions and two-step close-review backtrack approvals are also distinct workflow routes; they may affect `/inbox/human` visibility and task stage progression without mutating canonical assignment state directly.

## Responsible escalation and current-owner enforcement
- Delivery-loop actions reserved for engineers now validate the task's current canonical assignee before mutating state.
- If a task has already been reassigned away from engineering, engineer-only actions such as check-ins, implementation submission, and above-skill escalation should fail with `403 forbidden`.
- Inactivity reassignment may promote the projected assignee from `engineer` to a tier-specific id such as `engineer-sr` so the reassigned owner is explicit in downstream read models.

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
- **403 Only the currently assigned owner may perform this action** → verify the task was not reassigned to a different canonical owner role or tier-specific engineer assignee before the caller retried the action.
- **400 Invalid agent** → verify selected agent exists and is active in the roster source.
- **404 Task not found** → verify task id and tenant/workspace scope.
- **No queue/list update visible** → this repo projects assignee into task state, but does not yet include a dedicated board/inbox UI. Downstream consumers should read `current_owner`/`assignee` from the projection.

## Dashboards + alert links
- Dashboard: `/monitoring/dashboards/task-assignment.json`
- Alerts: `/monitoring/alerts/task-assignment.yml`

## Change Ownership Notes
- Changes to the assignment mutation path in `lib/audit/http.js` or the assignment controls in `src/app/App.jsx` should update this runbook or the matching assignment API contract in the same PR.
- SRE anomaly child-task creation should continue to bypass assignment mutation and remain on its dedicated monitoring workflow endpoint.
- Close-governance human decisions and backtrack approvals should continue to bypass assignment mutation and remain on their dedicated workflow endpoints.
- Nearest verification artifacts for that surface are:
- `tests/unit/task-assignment.test.js`
- `tests/unit/audit-api.test.js`
- `tests/integration/task-assignment-integration.test.js`
- `tests/e2e/task-assignment.spec.ts`
