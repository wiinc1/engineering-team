# Runbook — Task Assignment

## What this feature does
Allows an authorized Product Manager to assign or reassign an AI agent as the owner of a task.

## How to verify the feature is working
1. Open a task in an environment where `ff_assign-ai-agent-to-task` is enabled.
2. Confirm the owner selector renders for authorized PM users.
3. Assign a valid active AI agent.
4. Verify the owner updates on the task detail page.
5. Verify the task card/list view reflects the new owner.
6. Verify an audit log entry exists with previous owner and new owner.
7. Verify the assigned agent queue shows the task.

## How to rollback
1. Disable `ff_assign-ai-agent-to-task`.
2. If needed, disable `ff_assign-ai-agent-to-task_killswitch` globally.
3. Confirm assignment controls are hidden and no traffic hits the assignment endpoint.

## Common errors + resolutions
- **401 Authentication error** → verify session/auth provider and PM login state.
- **403 Authorization error** → verify user role includes task-management permission.
- **400 Invalid agent** → verify selected agent exists and is active in the roster source.
- **404 Task not found** → verify task id and tenant/workspace scope.
- **409 Conflict** → refresh task detail and retry if concurrent update occurred.

## Dashboards + alert links
- Dashboard: `/monitoring/dashboards/task-assignment.json`
- Alerts: `/monitoring/alerts/task-assignment.yml`
