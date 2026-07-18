'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertRuntimeWiring, enabled } = require('../../scripts/run-job-runtime-worker');

test('worker runtime activation requires an explicitly composed lifecycle adapter', () => {
  assert.equal(enabled('yes'), true);
  assert.equal(enabled('off'), false);
  assert.doesNotThrow(() => assertRuntimeWiring({}, { FF_LANGGRAPH_RUNTIME: 'false' }));
  assert.doesNotThrow(() => assertRuntimeWiring({
    workloads: { langGraph: { start() {}, resume() {}, lookupEffect() {} } },
  }, { FF_LANGGRAPH_RUNTIME: 'true' }));
  assert.doesNotThrow(() => assertRuntimeWiring({ infrastructure: {} }, { FF_LANGGRAPH_RUNTIME: 'true' }));
  assert.throws(() => assertRuntimeWiring({}, { FF_LANGGRAPH_RUNTIME: 'true' }), {
    code: 'langgraph_lifecycle_wiring_missing',
  });
  assert.throws(() => assertRuntimeWiring({
    workloads: { langGraph: { start() {}, resume() {} } },
  }, { FF_LANGGRAPH_RUNTIME: 'true' }), { code: 'langgraph_lifecycle_wiring_missing' });
});
