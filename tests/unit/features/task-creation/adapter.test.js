const test = require('node:test');
const assert = require('node:assert/strict');

const { createTaskCreationApiClient } = require('../../../../src/features/task-creation/adapter');

test('task creation API client creates tasks', async () => {
  const mockResponse = {
    ok: true,
    json: () => Promise.resolve({ taskId: 'TSK-001', title: 'Test Task' }),
  };

  const client = createTaskCreationApiClient({
    fetchImpl: () => Promise.resolve(mockResponse),
  });

  const result = await client.createTask({ raw_requirements: 'Raw operator request', title: 'Test Task' });
  
  assert.equal(result.taskId, 'TSK-001');
  assert.equal(result.title, 'Test Task');
});

test('task creation API client handles errors correctly', async () => {
  const mockResponse = {
    ok: false,
    status: 400,
    json: () => Promise.resolve({ 
      error: { 
        message: 'Invalid task data',
        code: 'invalid_data' 
      } 
    }),
  };

  const client = createTaskCreationApiClient({
    fetchImpl: () => Promise.resolve(mockResponse),
  });

  await assert.rejects(
    () => client.createTask({ raw_requirements: 'Raw operator request' }),
    {
      message: 'Invalid task data',
      status: 400,
      code: 'invalid_data'
    }
  );
});
