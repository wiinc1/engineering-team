# Runbook — Dependency Planner

## What this feature does
Adds a server-authoritative dependency planner for parent tasks with child work. The planner computes child dependency state as `ready`, `blocked`, `in_progress`, or `done`, normalizes blocker reasons, and exposes a `readyWork` queue for orchestration and operator review.

## Live route shape
- Canonical read surface in task detail: `GET /tasks/{taskId}/detail`
- Dedicated planner/orchestration read surface: `GET /tasks/{taskId}/orchestration`

## Visibility and authz
- Requires normal task visibility plus `relationships:read` for dependency details.
- When the caller lacks `relationships:read`, task detail remains readable and orchestration sections are omitted server-side.

## How to verify the feature is working
1. Open a parent task with linked child tasks and explicit dependency relationships.
2. Confirm the detail payload includes `orchestration.planner.summary`, `orchestration.planner.items`, and `orchestration.planner.readyWork`.
3. Verify child items resolve to `ready`, `blocked`, `in_progress`, or `done` without frontend inference.
4. Resolve a blocking child task and refresh task detail.
5. Confirm newly unblocked work appears in `readyWork` on the next read-model refresh.
6. Verify invalid graphs surface normalized blocker types such as `circular_dependency` or `missing_dependency`.

## How to rollback
1. Disable `FF_DEPENDENCY_PLANNER`.
2. Confirm `/tasks/{taskId}/detail` still renders without orchestration sections.
3. Confirm `/tasks/{taskId}/orchestration` returns `503 feature_disabled`.

## Feature flags
- Runtime flag env var: `FF_DEPENDENCY_PLANNER`
- Reference: `/docs/feature-flags.md`

## Common errors + resolutions
- **503 feature_disabled** → verify `FF_DEPENDENCY_PLANNER` is enabled.
- **403 forbidden / missing `relationships:read`** → use an authorized reader/operator session.
- **Planner shows `missing_dependency`** → the parent references a child task id that is not linked in `relationships.child_task_ids`.
- **Planner shows `circular_dependency`** → fix the child dependency graph; circular relationships are treated as invalid configuration.

## Dashboards + alert links
- Dashboard: `/monitoring/dashboards/dependency-planner.json`
- Alerts: `/monitoring/alerts/dependency-planner.yml`

## Change Ownership Notes
- Changes to dependency-planner payloads in `lib/audit/orchestration.js`, `lib/audit/http.js`, or task-detail rendering in `src/app/App.jsx` should update this runbook or the task-detail OpenAPI contract in the same PR.
