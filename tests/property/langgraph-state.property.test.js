'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { appendObjectsReducer, uniqueSortedReducer, validateFactoryState } = require('../../lib/software-factory/langgraph');
const { artifact, state } = require('../fixtures/langgraph/v1');

function generator(seed = 280) {
  let value = seed >>> 0;
  return () => ((value = (1664525 * value + 1013904223) >>> 0) / 2 ** 32);
}

test('arbitrary supported v1 state round-trips through strict validation', () => {
  const random = generator();
  for (let index = 0; index < 500; index += 1) {
    const nodeCount = Math.floor(random() * 8);
    const nodes = Array.from({ length: nodeCount }, (_, entry) => `node_${entry}`);
    const value = state({
      factoryRunId: `property:${index}`,
      completedNodes: nodes,
      lifecycleNode: nodes.at(-1) || null,
      attempt: Math.floor(random() * 100),
      artifacts: random() > 0.5 ? [artifact(`report_${index}`)] : [],
      decisions: random() > 0.5 ? [{ code: `decision_${index}`, outcome: 'approved' }] : [],
    });
    const validated = validateFactoryState(value);
    assert.deepEqual(JSON.parse(JSON.stringify(validated)), value);
  }
});

test('arbitrary forbidden keys fail closed', () => {
  const random = generator(281);
  const dangerous = ['password', 'api_key', 'authorization', 'private_key', 'access_token'];
  for (let index = 0; index < 250; index += 1) {
    const key = dangerous[Math.floor(random() * dangerous.length)];
    const value = state({ factoryRunId: `hostile:${index}` });
    value[key] = `value-${index}`;
    assert.throws(() => validateFactoryState(value), { code: 'langgraph_state_invalid' });
  }
});

test('reducers are associative and replay deterministic for arbitrary batches', () => {
  const random = generator(282);
  for (let index = 0; index < 500; index += 1) {
    const a = [`node_${Math.floor(random() * 8)}`];
    const b = [`node_${Math.floor(random() * 8)}`];
    const c = [`node_${Math.floor(random() * 8)}`];
    assert.deepEqual(uniqueSortedReducer(uniqueSortedReducer(a, b), c), uniqueSortedReducer(a, [...b, ...c]));
    const objects = [a, b, c].map(([name]) => ({ name }));
    assert.deepEqual(
      appendObjectsReducer(appendObjectsReducer([objects[0]], [objects[1]]), [objects[2]]),
      appendObjectsReducer([objects[0]], [objects[1], objects[2]]),
    );
  }
});
