# Runbook — Orchestration Scheduler

## What this feature does
Starts and persists coordinator-managed orchestration runs for parent tasks. The scheduler dispatches only ready child work, suppresses duplicate dispatch for already-running items, and records fallback-to-coordinator outcomes truthfully.

## Live route shape
- Read orchestration state: `GET /tasks/{taskId}/orchestration`
- Start or refresh orchestration state: `POST /tasks/{taskId}/orchestration`

## How to verify the feature is working
1. Confirm `FF_DEPENDENCY_PLANNER` and `FF_ORCHESTRATION_SCHEDULER` are enabled.
2. Start orchestration on a parent task with at least one ready child.
3. Verify the response includes a stable `runId`, `run.summary`, and `run.items`.
4. Confirm only `ready` child work is dispatched.
5. Re-run orchestration without changing child state and confirm already-running items are not dispatched twice.
6. Force or simulate a delegation fallback and confirm `fallbackReason`, `userFacingReasonCategory`, and `lastMessage` are persisted in the run item.
7. Mark a running child task complete and refresh orchestration state.
8. Confirm the corresponding run item transitions to `completed` and any newly unblocked child work becomes eligible for dispatch.

## How to rollback
1. Disable `FF_ORCHESTRATION_SCHEDULER`.
2. Confirm `POST /tasks/{taskId}/orchestration` returns `503 feature_disabled`.
3. Leave `FF_DEPENDENCY_PLANNER` enabled if read-only dependency visibility should remain available.

## Feature flags
- `FF_DEPENDENCY_PLANNER`
- `FF_ORCHESTRATION_SCHEDULER`
- Reference: `/docs/feature-flags.md`

## Common errors + resolutions
- **503 feature_disabled** → verify both planner and scheduler flags are enabled.
- **403 forbidden** → the caller lacks mutation permission or `relationships:read`.
- **Fallback reason `not_configured`** → the runtime delegation bridge is unavailable; see `/docs/runbooks/specialist-delegation.md`.
- **Fallback reason `runtime_exec_failed`** → the runtime bridge failed during execution; inspect delegation artifacts and workflow audit logs.

## Dashboards + alert links
- Dashboard: `/monitoring/dashboards/orchestration-scheduler.json`
- Alerts: `/monitoring/alerts/orchestration-scheduler.yml`

## Change Ownership Notes
- Changes to orchestration run state in `lib/audit/orchestration.js` or the `/tasks/{taskId}/orchestration` route in `lib/audit/http.js` should update this runbook and the matching OpenAPI contract in the same PR.
