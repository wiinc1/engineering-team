const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildLiveTaskUpdateResponse,
  encodeUpdateCursor,
  parseUpdateCursor,
  sanitizeCursor,
  taskUpdateFromRecords,
} = require('../../lib/audit/live-task-updates');

test('live task update cursors round-trip and accept an empty starting cursor', () => {
  assert.deepEqual(parseUpdateCursor(''), { position: 0 });
  const cursor = encodeUpdateCursor({ position: 12345.9 });
  assert.deepEqual(parseUpdateCursor(cursor), { position: 12345 });
  assert.deepEqual(parseUpdateCursor('42'), { position: 42 });
});

test('live task update cursor validation returns sanitized cursor details', () => {
  assert.equal(sanitizeCursor('bad cursor<script>'), 'badcursorscript');
  assert.throws(
    () => parseUpdateCursor('not valid cursor!'),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'invalid_cursor');
      assert.equal(error.details.cursor, 'notvalidcursor');
      return true;
    },
  );
});

test('task updates expose a narrow permission-safe task payload', () => {
  const update = taskUpdateFromRecords(
    {
      task_id: 'TSK-1',
      tenant_id: 'tenant-a',
      title: 'Projected title',
      current_stage: 'VERIFY',
      current_owner: 'qa',
      freshness: { status: 'fresh', last_updated_at: '2026-05-17T10:00:00.000Z' },
      context: { secret: true },
      comments: [{ body: 'hidden' }],
      telemetry: { raw: 'hidden' },
    },
    {
      taskId: 'TSK-1',
      tenantId: 'tenant-a',
      title: 'Canonical title',
      status: 'IMPLEMENT',
      version: 3,
      updatedAt: '2026-05-17T09:59:59.000Z',
      context: { secret: true },
    },
  );

  assert.equal(update.entityType, 'task');
  assert.equal(update.entityId, 'TSK-1');
  assert.equal(update.version, 3);
  assert.equal(update.payload.task.title, 'Projected title');
  assert.equal(update.payload.task.current_stage, 'VERIFY');
  assert.equal(Object.hasOwn(update.payload.task, 'context'), false);
  assert.equal(Object.hasOwn(update.payload.task, 'comments'), false);
  assert.equal(Object.hasOwn(update.payload.task, 'telemetry'), false);
});

test('live task update response filters deltas after the supplied cursor', async () => {
  const store = {
    listTaskSummaries: async () => [{
      task_id: 'TSK-1',
      tenant_id: 'tenant-a',
      title: 'Task one',
      current_stage: 'BACKLOG',
      freshness: { status: 'fresh', last_updated_at: '2026-05-17T10:00:00.000Z' },
    }],
  };
  const taskPlatform = {
    listTasks: async () => [{
      taskId: 'TSK-1',
      tenantId: 'tenant-a',
      title: 'Task one',
      status: 'BACKLOG',
      version: 1,
      updatedAt: '2026-05-17T10:00:00.000Z',
    }],
    listProjects: async () => [{
      projectId: 'PRJ-ABCDEFGH',
      name: 'Launch',
      status: 'ACTIVE',
      taskCount: 1,
      version: 2,
      updatedAt: '2026-05-17T10:01:00.000Z',
    }],
  };

  const first = await buildLiveTaskUpdateResponse({ store, taskPlatform, tenantId: 'tenant-a', cursor: '' });
  assert.equal(first.data.updates.length, 2);
  assert.equal(first.data.pollAfterMs, 8000);
  const second = await buildLiveTaskUpdateResponse({ store, taskPlatform, tenantId: 'tenant-a', cursor: first.data.cursor });
  assert.equal(second.data.updates.length, 0);
  assert.equal(second.data.position, first.data.position);
});
