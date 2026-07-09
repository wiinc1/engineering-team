const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildFactoryQueueImport,
  buildFactoryQueueInsert,
} = require('../../lib/task-platform/factory-delivery-queue-postgres');

function requirement(overrides = {}) {
  return {
    title: 'Queue durability',
    requirements: 'Persist factory queue entries in Postgres.',
    templateTier: 'Simple',
    changeKind: 'bugfix',
    changedFiles: ['lib/task-platform/factory-delivery.js'],
    ...overrides,
  };
}

test('factory queue insert ignores blank explicit idempotency fields', () => {
  const blankInput = requirement({ id: '   ', idempotencyKey: '   ' });
  const blank = buildFactoryQueueInsert(blankInput, 0, { tenantId: 'tenant-a' });
  const derived = buildFactoryQueueInsert(requirement(), 0, { tenantId: 'tenant-a' });
  const explicit = buildFactoryQueueInsert(requirement({ idempotencyKey: ' explicit-key ' }), 0, { tenantId: 'tenant-a' });

  assert.notEqual(blank.params[1], '');
  assert.equal(blank.params[2], derived.params[2]);
  assert.match(blank.params[2], /^[a-f0-9]{64}$/);
  assert.equal(explicit.params[2], 'explicit-key');
});

test('factory queue import ignores blank explicit idempotency fields', () => {
  const blank = buildFactoryQueueImport(requirement({ id: '   ', idempotencyKey: '   ' }), 0, { tenantId: 'tenant-a' });
  const derived = buildFactoryQueueImport(requirement(), 0, { tenantId: 'tenant-a' });

  assert.notEqual(blank.params[1], '');
  assert.equal(blank.params[2], derived.params[2]);
  assert.match(blank.params[2], /^[a-f0-9]{64}$/);
});
