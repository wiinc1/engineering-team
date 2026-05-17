const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildLiveTaskUpdateResponse } = require('../../lib/audit/live-task-updates');

test('live task freshness OpenAPI contract documents the polling endpoint and payload fields', () => {
  const spec = fs.readFileSync(path.join(process.cwd(), 'docs/api/live-task-freshness-updates-openapi.yml'), 'utf8');

  assert.match(spec, /\/v1\/tasks\/updates:/);
  assert.match(spec, /operationId: listLiveTaskFreshnessUpdates/);
  for (const field of ['cursor', 'pollAfterMs', 'updates', 'entityType', 'entityId', 'updateType', 'version', 'updatedAt', 'payload']) {
    assert.match(spec, new RegExp(`${field}:`));
  }
  assert.match(spec, /additionalProperties: false/);
  assert.match(spec, /bearerAuth/);
});

test('runtime live task update payload conforms to the documented envelope shape', async () => {
  const response = await buildLiveTaskUpdateResponse({
    tenantId: 'tenant-contract',
    cursor: '',
    store: { listTaskSummaries: async () => [] },
    taskPlatform: {
      listTasks: async () => [{
        taskId: 'TSK-CONTRACT',
        tenantId: 'tenant-contract',
        title: 'Contract payload',
        status: 'BACKLOG',
        version: 1,
        updatedAt: '2026-05-17T12:00:00.000Z',
      }],
      listProjects: async () => [],
      listProjectMutations: async () => [],
    },
  });

  assert.equal(typeof response.data.cursor, 'string');
  assert.equal(typeof response.data.position, 'number');
  assert.equal(response.data.pollAfterMs, 8000);
  assert.equal(response.data.updates.length, 1);
  const [update] = response.data.updates;
  assert.equal(update.entityType, 'task');
  assert.equal(update.updateType, 'task_snapshot');
  assert.equal(update.entityId, 'TSK-CONTRACT');
  assert.equal(update.payload.task.task_id, 'TSK-CONTRACT');
});
