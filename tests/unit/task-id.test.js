const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateSequentialTaskId,
  parseSequentialTaskSequence,
  isSequentialTaskId,
  allocateSequentialTaskIdFromStore,
  allocateSequentialTaskIdForFileStore,
  SEQUENTIAL_TASK_ID_PATTERN,
} = require('../../lib/task-platform/task-id');
const { createFileTaskPlatformService } = require('../../lib/task-platform/service');

test('generateSequentialTaskId emits TSK-NNN format', () => {
  assert.equal(generateSequentialTaskId(1), 'TSK-001');
  assert.equal(generateSequentialTaskId(42), 'TSK-042');
  assert.equal(generateSequentialTaskId(1234), 'TSK-1234');
  assert.match(generateSequentialTaskId(99), SEQUENTIAL_TASK_ID_PATTERN);
});

test('allocateSequentialTaskIdFromStore increments without reuse', () => {
  const store = { task_id_sequences: {}, tasks: {} };
  const first = allocateSequentialTaskIdFromStore(store, 'tenant-a', {
    existingTaskIds: ['TSK-010', 'TSK-020'],
  });
  const second = allocateSequentialTaskIdFromStore(store, 'tenant-a');
  assert.equal(first, 'TSK-021');
  assert.equal(second, 'TSK-022');
  assert.notEqual(first, second);
});

test('file task platform service createTask assigns sequential IDs by default', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-id-file-'));
  const service = createFileTaskPlatformService({ baseDir });

  const first = await service.createTask({
    tenantId: 'engineering-team',
    title: 'First sequential task',
    status: 'DRAFT',
  });
  const second = await service.createTask({
    tenantId: 'engineering-team',
    title: 'Second sequential task',
    status: 'DRAFT',
  });

  assert.match(first.taskId, SEQUENTIAL_TASK_ID_PATTERN);
  assert.match(second.taskId, SEQUENTIAL_TASK_ID_PATTERN);
  assert.equal(
    parseSequentialTaskSequence(second.taskId),
    parseSequentialTaskSequence(first.taskId) + 1,
  );
  assert.equal(isSequentialTaskId(first.taskId), true);
});