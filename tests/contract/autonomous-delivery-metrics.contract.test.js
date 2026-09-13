const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { redactReleaseEvidence } = require('../../scripts/verify-factory-staging-smoke');

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

test('hosted factory smoke publishes the stable redacted artifact contract', () => {
  const artifact = redactReleaseEvidence({
    generatedAt: '2026-08-19T20:00:00.000Z', summary: { passed: true, stage: 'phase6_complete' },
    taskId: 'TSK-PRIVATE', operatorUrl: 'https://staging.example.com/private',
  });
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.kind, 'factory-staging-smoke-redacted');
  assert.deepEqual(Object.keys(artifact).sort(), ['evidence', 'generatedAt', 'kind', 'schemaVersion', 'summary']);
  assert.match(artifact.evidence.sourceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(artifact.taskId, undefined);
});
