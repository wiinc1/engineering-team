# Live Task Freshness Polling Runbook

## Scope

Polling-based freshness keeps task detail, Projects, Command Center queue/list/board, and role inbox routes current during pilot workflows. The browser polls `GET /api/v1/tasks/updates?cursor=...`, reconciles newer Task and Project snapshots, and falls back to the existing manual refresh actions.

## Feature Flags

- Server rollback: set `FF_LIVE_TASK_FRESHNESS_POLLING=0` or pass `liveTaskUpdatesEnabled: false`. The endpoint returns `503 feature_disabled`.
- Browser rollout: set `VITE_FF_LIVE_TASK_FRESHNESS_POLLING=1` for builds that should poll by default.
- Local browser override: `localStorage["engineering-team.live-task-freshness-polling"] = "1"` enables polling, and `"0"` disables it.
- Local poll tuning: `localStorage["engineering-team.live-task-freshness-poll-ms"] = "8000"` overrides the poll interval for smoke tests and staged rollout checks.

## Normal Operation

1. Open a protected task route.
2. Confirm the freshness indicator shows `Polling` and then `Fresh`.
3. Change a task stage, owner, Project membership, validation state, or Project metadata from another session.
4. Confirm the route updates within 10 seconds without a full page reload.
5. Confirm the `Refresh now` button still works.

## Failure Modes

- `stale`: the last successful poll is older than the stale threshold.
- `reconnecting`: a recent poll failed and retry is in progress.
- `degraded`: repeated poll failures occurred.
- `disabled`: browser rollout flag is off, or the route is relying on manual refresh only.

## Observability

Track these metrics from the audit store metrics endpoint or deployment telemetry:

- `feature_live_task_updates_events_total`
- `feature_live_task_updates_latency_seconds`
- `feature_live_task_updates_poll_errors_total`
- `feature_live_task_updates_stale_views_total`

Structured endpoint logs include feature, action, outcome, request ID, tenant ID, actor ID, sanitized cursor, update count, status code, and duration. Logs must not include update payload values.

## Triage

1. If users report stale task state, verify browser flag state and server flag state first.
2. Check `feature_live_task_updates_poll_errors_total` for error spikes.
3. Check endpoint responses for `invalid_cursor`, `missing_auth_context`, `forbidden`, or `feature_disabled`.
4. If only Project membership is stale, verify Project mutation records exist and the cursor response includes a task update for the attached task.
5. Use manual refresh as the operator fallback while investigating.

## Rollback

1. Disable the browser rollout flag for new builds or ask affected users to set the local override to `"0"`.
2. Disable the server flag with `FF_LIVE_TASK_FRESHNESS_POLLING=0` if endpoint load or security concerns require immediate stop.
3. Confirm protected routes still load and manual refresh remains available.
