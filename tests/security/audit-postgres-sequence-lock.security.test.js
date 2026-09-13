const test = require('node:test');
const assert = require('node:assert/strict');
const { taskSequenceLockParameters } = require('../../lib/audit/postgres');

test('audit sequence locks fail closed without a task boundary', () => {
  assert.throws(
    () => taskSequenceLockParameters({}),
    /taskId is required for audit sequence allocation/,
  );
  assert.throws(
    () => taskSequenceLockParameters({ taskId: '   ' }),
    /taskId is required for audit sequence allocation/,
  );
});

test('audit sequence lock keys preserve tenant isolation for matching task ids', () => {
  const tenantA = taskSequenceLockParameters({ tenantId: 'tenant-a', taskId: 'TSK-SHARED' });
  const tenantB = taskSequenceLockParameters({ tenantId: 'tenant-b', taskId: 'TSK-SHARED' });

  assert.notDeepEqual(tenantA, tenantB);
  assert.equal(tenantA[1], tenantB[1]);
  assert.notEqual(tenantA[0], tenantB[0]);
});
