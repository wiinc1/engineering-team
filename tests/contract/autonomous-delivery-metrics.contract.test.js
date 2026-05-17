const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('autonomous delivery metrics OpenAPI documents the MVP routes, schemas, and feature flag', () => {
  const spec = fs.readFileSync(path.join(__dirname, '../../docs/api/autonomous-delivery-metrics-openapi.yml'), 'utf8');
  for (const expected of [
    '/api/v1/metrics/autonomous-delivery:',
    '/api/v1/tasks/{taskId}/retrospective-signal:',
    '/api/v1/metrics/autonomous-delivery/rebuild:',
    'delivery-retrospective-signal.v1',
    'autonomous-delivery-metrics-mvp.v1',
    'operator-intervention-taxonomy.v1',
    'ff_autonomous_delivery_metrics_mvp',
    'metrics:read',
    'projections:rebuild',
    'includeUnknown',
    'Unknown legacy evidence is',
  ]) {
    assert.match(spec, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
