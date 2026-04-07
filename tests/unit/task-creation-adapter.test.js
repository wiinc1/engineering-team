const test = require('node:test');
const assert = require('node:assert/strict');

const { createTaskCreationApiClient } = require('../../src/features/task-creation/adapter');

function createMockFetch(responses) {
  let callIndex = 0;
  const calls = [];

  async function mockFetch(url, init = {}) {
    const response = responses[callIndex] || responses[responses.length - 1];
    calls.push({ url, init });
    callIndex++;

    return {
      ok: response.ok !== false,
      status: response.status || 200,
      json: () => Promise.resolve(response.body || {}),
    };
  }

  mockFetch.calls = calls;
  return mockFetch;
}

test('createTask validates payload before sending', async () => {
  const mockFetch = createMockFetch([{ ok: true, body: { taskId: 'TSK-001' } }]);
  const client = createTaskCreationApiClient({
    baseUrl: 'https://api.example.com',
    fetchImpl: mockFetch,
  });

  await assert.rejects(
    () => client.createTask({ title: '' }, 1),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.ok(err.message.includes('Validation failed'));
      return true;
    }
  );

  assert.equal(mockFetch.calls.length, 0);
});

test('createTask generates task ID and sends request', async () => {
  const mockFetch = createMockFetch([{ ok: true, body: { taskId: 'TSK-001' } }]);
  const client = createTaskCreationApiClient({
    baseUrl: 'https://api.example.com',
    fetchImpl: mockFetch,
  });

  const result = await client.createTask(
    {
      title: 'Test task',
      business_context: 'context',
      acceptance_criteria: 'criteria',
      definition_of_done: 'done',
      priority: 'High',
      task_type: 'Feature',
    },
    1
  );

  assert.equal(mockFetch.calls.length, 1);
  assert.equal(mockFetch.calls[0].url, 'https://api.example.com/tasks');
  assert.equal(mockFetch.calls[0].init.method, 'POST');

  const body = JSON.parse(mockFetch.calls[0].init.body);
  assert.equal(body.taskId, 'TSK-001');
  assert.equal(body.title, 'Test task');
  assert.equal(result.taskId, 'TSK-001');
});

test('createTask propagates API errors', async () => {
  const mockFetch = createMockFetch([
    {
      ok: false,
      status: 400,
      body: { error: { message: 'Bad request', code: 'INVALID_INPUT' } },
    },
  ]);
  const client = createTaskCreationApiClient({
    baseUrl: 'https://api.example.com',
    fetchImpl: mockFetch,
  });

  await assert.rejects(
    () =>
      client.createTask(
        {
          title: 'Test task',
          business_context: 'context',
          acceptance_criteria: 'criteria',
          definition_of_done: 'done',
          priority: 'High',
          task_type: 'Feature',
        },
        1
      ),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'INVALID_INPUT');
      return true;
    }
  );
});

test('saveDraft validates payload before sending', async () => {
  const mockFetch = createMockFetch([{ ok: true, body: { draftId: 'draft-1' } }]);
  const client = createTaskCreationApiClient({
    baseUrl: 'https://api.example.com',
    fetchImpl: mockFetch,
  });

  await assert.rejects(
    () => client.saveDraft({ title: '' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );

  assert.equal(mockFetch.calls.length, 0);
});

test('saveDraft sends valid payload', async () => {
  const mockFetch = createMockFetch([{ ok: true, body: { draftId: 'draft-1' } }]);
  const client = createTaskCreationApiClient({
    baseUrl: 'https://api.example.com',
    fetchImpl: mockFetch,
  });

  const result = await client.saveDraft({
    title: 'Draft task',
    business_context: 'context',
    acceptance_criteria: 'criteria',
    definition_of_done: 'done',
    priority: 'Medium',
    task_type: 'Bug',
  });

  assert.equal(mockFetch.calls.length, 1);
  assert.equal(mockFetch.calls[0].url, 'https://api.example.com/tasks/draft');
  assert.equal(mockFetch.calls[0].init.method, 'POST');

  const body = JSON.parse(mockFetch.calls[0].init.body);
  assert.equal(body.title, 'Draft task');
  assert.equal(result.draftId, 'draft-1');
});

test('fetchTaskDraft validates task ID format', async () => {
  const mockFetch = createMockFetch([{ ok: true, body: { taskId: 'TSK-001' } }]);
  const client = createTaskCreationApiClient({
    baseUrl: 'https://api.example.com',
    fetchImpl: mockFetch,
  });

  await assert.rejects(
    () => client.fetchTaskDraft('invalid-id'),
    (err) => {
      assert.equal(err.code, 'INVALID_TASK_ID');
      assert.ok(err.message.includes('Invalid task ID'));
      return true;
    }
  );

  assert.equal(mockFetch.calls.length, 0);
});

test('fetchTaskDraft sends request for valid task ID', async () => {
  const mockFetch = createMockFetch([{ ok: true, body: { taskId: 'TSK-001', title: 'Draft' } }]);
  const client = createTaskCreationApiClient({
    baseUrl: 'https://api.example.com',
    fetchImpl: mockFetch,
  });

  const result = await client.fetchTaskDraft('TSK-001');

  assert.equal(mockFetch.calls.length, 1);
  assert.equal(mockFetch.calls[0].url, 'https://api.example.com/tasks/draft/TSK-001');
  assert.equal(result.taskId, 'TSK-001');
});

test('deleteTaskDraft validates task ID format', async () => {
  const mockFetch = createMockFetch([{ ok: true, body: { success: true } }]);
  const client = createTaskCreationApiClient({
    baseUrl: 'https://api.example.com',
    fetchImpl: mockFetch,
  });

  await assert.rejects(
    () => client.deleteTaskDraft('bad-id'),
    (err) => {
      assert.equal(err.code, 'INVALID_TASK_ID');
      return true;
    }
  );

  assert.equal(mockFetch.calls.length, 0);
});

test('deleteTaskDraft sends DELETE request for valid task ID', async () => {
  const mockFetch = createMockFetch([{ ok: true, body: { success: true } }]);
  const client = createTaskCreationApiClient({
    baseUrl: 'https://api.example.com',
    fetchImpl: mockFetch,
  });

  const result = await client.deleteTaskDraft('TSK-042');

  assert.equal(mockFetch.calls.length, 1);
  assert.equal(mockFetch.calls[0].url, 'https://api.example.com/tasks/draft/TSK-042');
  assert.equal(mockFetch.calls[0].init.method, 'DELETE');
  assert.equal(result.success, true);
});

test('client includes auth headers when getHeaders is provided', async () => {
  const mockFetch = createMockFetch([{ ok: true, body: { taskId: 'TSK-001' } }]);
  const client = createTaskCreationApiClient({
    baseUrl: 'https://api.example.com',
    fetchImpl: mockFetch,
    getHeaders: () => ({ authorization: 'Bearer test-token' }),
  });

  await client.createTask(
    {
      title: 'Test',
      business_context: 'context',
      acceptance_criteria: 'criteria',
      definition_of_done: 'done',
      priority: 'High',
      task_type: 'Feature',
    },
    1
  );

  assert.equal(mockFetch.calls[0].init.headers['content-type'], 'application/json');
  assert.equal(mockFetch.calls[0].init.headers.authorization, 'Bearer test-token');
});

test('VALID_PRIORITIES and VALID_TASK_TYPES are exported', () => {
  const { VALID_PRIORITIES, VALID_TASK_TYPES } = require('../../src/features/task-creation/adapter');
  assert.ok(Array.isArray(VALID_PRIORITIES));
  assert.ok(Array.isArray(VALID_TASK_TYPES));
  assert.equal(VALID_PRIORITIES.length, 4);
  assert.equal(VALID_TASK_TYPES.length, 5);
});
