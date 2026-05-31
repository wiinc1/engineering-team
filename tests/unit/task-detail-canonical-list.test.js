const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskDetailApiClient } = require('../../src/features/task-detail/adapter');

test('task detail client uses canonical task-platform list as the primary workspace source', async () => {
  const requests = [];
  const client = createTaskDetailApiClient({
    baseUrl: '/backend',
    fetchImpl: async (url) => {
      requests.push(url);
      assert.equal(url, '/backend/v1/tasks');
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              taskId: 'TSK-CANON',
              tenantId: 'tenant-a',
              title: 'Canonical list task',
              status: 'DRAFT',
              priority: 'P2',
              owner: { agentId: 'pm', displayName: 'Pilot PM', role: 'pm' },
              createdAt: '2026-05-31T17:10:00.000Z',
              updatedAt: '2026-05-31T17:11:00.000Z',
              project: { projectId: 'PRJ-1', name: 'Pilot', status: 'ACTIVE' },
              projectId: 'PRJ-1',
            },
          ],
        }),
      };
    },
  });

  const list = await client.fetchTaskList();

  assert.deepEqual(requests, ['/backend/v1/tasks']);
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].task_id, 'TSK-CANON');
  assert.equal(list.items[0].tenant_id, 'tenant-a');
  assert.equal(list.items[0].current_stage, 'DRAFT');
  assert.equal(list.items[0].current_owner, 'pm');
  assert.equal(list.items[0].owner.display_name, 'Pilot PM');
  assert.equal(list.items[0].project_id, 'PRJ-1');
  assert.equal(list.items[0].project.name, 'Pilot');
  assert.equal(list.items[0].intake_draft, true);
});

test('task detail client falls back to legacy task list when canonical list is unavailable', async () => {
  const requests = [];
  const client = createTaskDetailApiClient({
    baseUrl: '/backend',
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.endsWith('/v1/tasks')) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { code: 'unavailable', message: 'canonical unavailable' } }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              task_id: 'TSK-LEGACY',
              tenant_id: 'tenant-a',
              title: 'Legacy list task',
              current_stage: 'BACKLOG',
            },
          ],
        }),
      };
    },
  });

  const list = await client.fetchTaskList();

  assert.deepEqual(requests, ['/backend/v1/tasks', '/backend/tasks']);
  assert.equal(list.items[0].task_id, 'TSK-LEGACY');
});
