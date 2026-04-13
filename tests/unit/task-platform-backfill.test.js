const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuditStore } = require('../../lib/audit/store');
const { createTaskPlatformService } = require('../../lib/task-platform');
const { backfillCanonicalTasks } = require('../../lib/task-platform/backfill');

test('backfills audit-projected tasks into the canonical task platform and imports legacy owners', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-platform-backfill-'));
  const store = createAuditStore({ baseDir });
  const taskPlatform = createTaskPlatformService({ baseDir });

  await store.appendEvent({
    tenantId: 'engineering-team',
    taskId: 'TSK-BACKFILL-1',
    eventType: 'task.created',
    actorId: 'pm-1',
    actorType: 'user',
    idempotencyKey: 'create:TSK-BACKFILL-1',
    payload: {
      title: 'Backfill me',
      description: 'Recovered from audit state',
      initial_stage: 'TODO',
      priority: 'P1',
    },
  });
  await store.appendEvent({
    tenantId: 'engineering-team',
    taskId: 'TSK-BACKFILL-1',
    eventType: 'task.assigned',
    actorId: 'pm-1',
    actorType: 'user',
    idempotencyKey: 'assign:TSK-BACKFILL-1',
    payload: {
      assignee: 'engineer-1',
    },
  });

  const result = await backfillCanonicalTasks({
    store,
    taskPlatform,
    tenantId: 'engineering-team',
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.created, 1);
  assert.equal(result.failed, 0);

  const task = taskPlatform.getTask({
    tenantId: 'engineering-team',
    taskId: 'TSK-BACKFILL-1',
  });
  assert.equal(task.title, 'Backfill me');
  assert.equal(task.status, 'TODO');
  assert.equal(task.priority, 'P1');
  assert.equal(task.owner.agentId, 'engineer-1');

  const state = JSON.parse(fs.readFileSync(path.join(baseDir, 'data', 'task-platform.json'), 'utf8'));
  assert.equal(state.ai_agents['engineering-team::engineer-1'].execution_kind, 'legacy-import');
  assert.equal(state.task_sync_checkpoints['engineering-team::TSK-BACKFILL-1'].sync_status, 'synced');
});
