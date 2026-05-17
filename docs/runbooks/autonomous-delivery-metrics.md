# Autonomous Delivery Metrics MVP Runbook

## Scope
Issue #210 adds a feature-flagged MVP projection for pilot autonomous delivery evidence. It reads existing task/audit history, builds `delivery-retrospective-signal.v1` rows, aggregates `autonomous-delivery-metrics-mvp.v1`, and exposes the result through API routes and the browser report at `/metrics/autonomous-delivery`.

This is not the full #156 analytics platform. Treat it as the pilot evidence path for PM/admin review after supervised delivery.

## Runtime Flags
- `FF_AUTONOMOUS_DELIVERY_METRICS_MVP=false` disables the API/report routes.
- Route wrapper options also accept `autonomousDeliveryMetricsMvpEnabled: false` for tests and embedded runtimes.

## Authorization
- Read metrics: PM, product-owner, SRE, or admin roles with `metrics:read`.
- Rebuild metrics: admin role with `projections:rebuild`.
- Tenant scope always comes from the authenticated request context, not query parameters.

## Routes
- `GET /api/v1/metrics/autonomous-delivery`
- `GET /api/v1/tasks/{taskId}/retrospective-signal`
- `POST /api/v1/metrics/autonomous-delivery/rebuild`

Supported filters for the metrics route are `dateFrom`, `dateTo`, `taskClass`, `tier`, `agent`, and `includeUnknown`.
Unknown legacy evidence is excluded from threshold decisions unless `includeUnknown=true`.

## Projection Rebuild
Use the rebuild route after pilot closeout or after applying migration `013_autonomous_delivery_metrics.sql`.

```bash
curl -sS -X POST "$BASE_URL/api/v1/metrics/autonomous-delivery/rebuild" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"persist":true}'
```

The rebuild is deterministic for the same tenant, filters, and input audit history. Retrospective signal IDs are based on task evidence, not wall-clock rebuild time.

## Data Model
- `autonomous_delivery_retrospective_signals` stores task-level signal payloads and queryable dimensions.
- `autonomous_delivery_metric_snapshots` stores aggregate summaries, breakdowns, and threshold evaluations.
- File-backed local harnesses write `autonomous-delivery-metrics-projection.json` next to the metrics file.

## Observability
Runtime metrics include:
- `feature_autonomous_delivery_rate`
- `feature_operator_interventions_total`
- `feature_retrospective_signal_errors_total`
- `feature_autonomy_policy_blocks_total`
- `feature_autonomous_delivery_metrics_requests_total`
- `feature_autonomous_delivery_metrics_errors_total`
- `feature_autonomous_delivery_rebuilds_total`

Alert manually during the MVP if rebuild errors, API error spikes, or unknown evidence counts exceed the pilot review threshold.

## Rollout
1. Apply `npm run audit:migrate`.
2. Enable `FF_AUTONOMOUS_DELIVERY_METRICS_MVP`.
3. Rebuild for the pilot tenant after supervised closeout.
4. Compare the report against #209 human pilot evidence.
5. Keep expansion decisions blocked unless threshold evaluation and human review both agree.

## Rollback
1. Disable `FF_AUTONOMOUS_DELIVERY_METRICS_MVP`.
2. Leave raw audit/task history intact.
3. If projection storage must be removed, run `db/migrations/013_autonomous_delivery_metrics.down.sql` only after retaining any review evidence needed for #156.
