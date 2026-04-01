const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTaskDetailPageModule,
  matchTaskDetailRoute,
  readTaskDetailRouteState,
} = require('../../src/features/task-detail/route');

test('matchTaskDetailRoute accepts canonical /tasks/:taskId path', () => {
  assert.deepEqual(matchTaskDetailRoute('/tasks/TSK-42'), { taskId: 'TSK-42' });
  assert.deepEqual(matchTaskDetailRoute('/tasks/TSK-42/'), { taskId: 'TSK-42' });
  assert.equal(matchTaskDetailRoute('/tasks/TSK-42/history'), null);
  assert.equal(matchTaskDetailRoute('/work-items/TSK-42'), null);
});

test('readTaskDetailRouteState preserves tab and history filters from URL', () => {
  assert.deepEqual(
    readTaskDetailRouteState('?tab=telemetry&historyEventType=task.created&historyActor=pm-1&historyRange=today'),
    {
      tab: 'telemetry',
      filters: {
        eventType: 'task.created',
        actorId: 'pm-1',
        range: 'today',
      },
    },
  );

  assert.deepEqual(readTaskDetailRouteState(''), {
    tab: 'history',
    filters: {
      eventType: undefined,
      actorId: undefined,
      range: undefined,
    },
  });
});

test('task detail page module loads screen data through the adapter client', async () => {
  const calls = [];
  const page = createTaskDetailPageModule({
    client: {
      async fetchTaskDetailScreenData(taskId, options) {
        calls.push({ taskId, options });
        return {
          summary: { taskId, title: 'Wire task detail', tenantId: 'tenant-a' },
          shell: {
            selectedTab: 'history',
            filters: {},
            historyState: { kind: 'ready' },
            telemetryState: { kind: 'ready' },
            historyItems: [{ id: 'evt-1', title: 'Created', timestampLabel: '2026-04-01T10:00:00.000Z' }],
            telemetryCards: [{ id: 'telemetry-status', label: 'Status', value: 'ok' }],
          },
        };
      },
    },
  });

  const model = await page.load({
    pathname: '/tasks/TSK-42',
    search: '?tab=telemetry&historyEventType=task.created&historyActor=pm-1',
  });

  assert.deepEqual(calls, [
    {
      taskId: 'TSK-42',
      options: {
        filters: {
          eventType: 'task.created',
          actorId: 'pm-1',
          range: undefined,
        },
      },
    },
  ]);
  assert.equal(model.route.taskId, 'TSK-42');
  assert.equal(model.shell.selectedTab, 'telemetry');
  assert.equal(model.shell.historyItems[0].title, 'Created');
  assert.equal(model.shell.telemetryCards[0].label, 'Status');
});

test('task detail page module returns restricted state for authorization failures', async () => {
  const page = createTaskDetailPageModule({
    client: {
      async fetchTaskDetailScreenData() {
        const error = new Error('missing permission: observability:read');
        error.status = 403;
        error.code = 'forbidden';
        error.details = { permission: 'observability:read' };
        throw error;
      },
    },
  });

  const model = await page.load({
    pathname: '/tasks/TSK-99',
    search: '?tab=telemetry',
  });

  assert.equal(model.route.taskId, 'TSK-99');
  assert.equal(model.shell.selectedTab, 'telemetry');
  assert.equal(model.shell.historyState.kind, 'restricted');
  assert.equal(model.shell.telemetryState.kind, 'restricted');
  assert.match(model.shell.telemetryState.detail, /observability:read/);
});

test('task detail page module throws when route does not match', async () => {
  const page = createTaskDetailPageModule({
    client: {
      async fetchTaskDetailScreenData() {
        throw new Error('should not be called');
      },
    },
  });

  await assert.rejects(() => page.load({ pathname: '/tasks/TSK-42/history' }), {
    code: 'route_not_found',
  });
});
