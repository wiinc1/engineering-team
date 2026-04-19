# Runbook — Orchestration Visibility

## What this feature does
Adds a task-detail orchestration surface that shows `ready`, `running`, `blocked`, `failed`, and `completed` child work from one server-prepared read model.

## Live route shape
- Embedded task-detail surface: `GET /tasks/{taskId}/detail`
- Dedicated orchestration surface: `GET /tasks/{taskId}/orchestration`

## How to verify the feature is working
1. Confirm `FF_ORCHESTRATION_VISIBILITY` is enabled.
2. Open a parent task that has orchestration planner or run state.
3. Verify the task-detail page renders the orchestration summary strip and work-item table.
4. Confirm blocked rows show dependency blockers or fallback reasons without opening raw history.
5. Refresh the page after orchestration state changes and confirm the summary and rows reflect the latest persisted state.
6. Repeat with a low-permission reader and confirm the orchestration section is omitted server-side with an explanatory hidden-state message.

## How to rollback
1. Disable `FF_ORCHESTRATION_VISIBILITY`.
2. Confirm task detail still loads without orchestration sections.
3. Confirm the dedicated orchestration route is no longer exposed in the UI.

## Feature flags
- `FF_DEPENDENCY_PLANNER`
- `FF_ORCHESTRATION_VISIBILITY`
- Reference: `/docs/feature-flags.md`

## Common errors + resolutions
- **Orchestration section missing for authorized users** → confirm both planner and visibility flags are enabled and the task has child work.
- **Hidden-state message shown unexpectedly** → verify the caller has `relationships:read`.
- **Counts do not match persisted state** → refresh task detail and confirm the parent read model includes current child-task lifecycle state.

## Dashboards + alert links
- Dashboard: `/monitoring/dashboards/orchestration-visibility.json`
- Alerts: `/monitoring/alerts/orchestration-visibility.yml`

## Change Ownership Notes
- Changes to orchestration rendering in `src/app/App.jsx`, `src/app/styles.css`, or the task-detail adapter should update this runbook and the task-detail contract in the same PR.
