const test = require('node:test');
const assert = require('node:assert/strict');
const { taskSequenceLockParameters } = require('../../lib/audit/postgres');

test('audit sequence lock defaults and normalizes its tenant and task key', () => {
  assert.deepEqual(
    taskSequenceLockParameters({ taskId: '  TSK-LOCK-1  ' }),
    ['engineering-team', 'TSK-LOCK-1'],
  );
  assert.deepEqual(
    taskSequenceLockParameters({ tenantId: ' tenant-a ', taskId: ' TSK-LOCK-2 ' }),
    ['tenant-a', 'TSK-LOCK-2'],
  );
});
