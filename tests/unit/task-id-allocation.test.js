const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateProductionTaskId } = require('../../lib/audit/task-id-allocation');
const { SEQUENTIAL_TASK_ID_PATTERN } = require('../../lib/task-platform/task-id');

test('allocateProductionTaskId returns sequential ids from task platform list', async () => {
  const taskPlatform = {
    async listTasks() {
      return [{ taskId: 'TSK-010' }, { taskId: 'TSK-020' }];
    },
  };
  const taskId = await allocateProductionTaskId({
    taskPlatform,
    tenantId: 'engineering-team',
  });
  assert.equal(taskId, 'TSK-021');
  assert.match(taskId, SEQUENTIAL_TASK_ID_PATTERN);
});

test('allocateProductionTaskId increments from audit store summaries when provided', async () => {
  const store = {
    async listTaskSummaries() {
      return [{ task_id: 'TSK-005' }, { task_id: 'TSK-099' }];
    },
  };
  const taskId = await allocateProductionTaskId({
    store,
    tenantId: 'engineering-team',
  });
  assert.equal(taskId, 'TSK-100');
});