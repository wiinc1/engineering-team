const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileLiveUpdates } = require('../../lib/audit/live-task-reconciler');

function lcg(seed) {
  let state = seed;
  return () => {
    state = (state * 48271) % 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function shuffle(values, seed) {
  const random = lcg(seed);
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function update(entityId, version) {
  return {
    entityType: 'task',
    entityId,
    version,
    updatedAt: new Date(Date.UTC(2026, 4, 17, 12, 0, version)).toISOString(),
    payload: { task: { task_id: entityId, version } },
  };
}

test('live task reconciler converges on newest versions for out-of-order streams', () => {
  const stream = [];
  for (const entityId of ['TSK-PROP-A', 'TSK-PROP-B', 'TSK-PROP-C']) {
    for (let version = 1; version <= 8; version += 1) {
      stream.push(update(entityId, version));
    }
  }

  for (let seed = 1; seed <= 100; seed += 1) {
    let state = { versions: {} };
    for (const item of shuffle(stream, seed)) {
      state = reconcileLiveUpdates(state, [item]);
    }
    for (const entityId of ['TSK-PROP-A', 'TSK-PROP-B', 'TSK-PROP-C']) {
      assert.equal(state.versions[`task:default:${entityId}`].version, 8, `seed ${seed} should keep newest ${entityId}`);
    }
  }
});
