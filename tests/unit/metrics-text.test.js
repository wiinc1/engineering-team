const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePrometheusMetric } = require('../../lib/audit/metrics-text');

test('parsePrometheusMetric reads gauge lines from prometheus text', () => {
  const text = [
    '# HELP workflow_projection_lag_seconds Projection lag',
    'workflow_projection_lag_seconds 0.5',
    'workflow_projection_events_processed_total 42',
  ].join('\n');
  assert.equal(parsePrometheusMetric(text, 'workflow_projection_lag_seconds'), 0.5);
  assert.equal(parsePrometheusMetric(text, 'workflow_projection_events_processed_total'), 42);
  assert.equal(parsePrometheusMetric(text, 'missing_metric'), null);
});