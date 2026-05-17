import { expect, test } from '@playwright/test';

function encodeClaims(claims: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(claims)).toString('base64url');
}

async function installLiveSession(page) {
  const token = `header.${encodeClaims({
    sub: 'pm-1',
    tenant_id: 'tenant-a',
    roles: ['pm', 'qa', 'reader'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`;

  await page.addInitScript((sessionToken) => {
    window.localStorage.setItem('engineering-team.live-task-freshness-polling', '1');
    window.localStorage.setItem('engineering-team.live-task-freshness-poll-ms', '100');
    window.sessionStorage.setItem(
      'engineering-team.task-browser-session',
      JSON.stringify({
        bearerToken: sessionToken,
        apiBaseUrl: '/api',
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      }),
    );
  }, token);
}

function taskSummary(updated: boolean) {
  return {
    task_id: 'TSK-LIVE',
    tenant_id: 'tenant-a',
    title: updated ? 'Live update applied' : 'Live update pending',
    priority: 'P1',
    current_stage: updated ? 'VERIFY' : 'IMPLEMENT',
    current_owner: 'qa',
    owner: { actor_id: 'qa', display_name: 'QA' },
    blocked: false,
    closed: false,
    waiting_state: null,
    next_required_action: updated ? 'Review the live update' : 'Wait for polling refresh',
    queue_entered_at: '2026-05-17T12:00:00.000Z',
    freshness: { status: 'fresh', last_updated_at: updated ? '2026-05-17T12:00:02.000Z' : '2026-05-17T12:00:00.000Z' },
  };
}

function taskDetail(updated: boolean) {
  const summary = taskSummary(updated);
  return {
    task: {
      id: summary.task_id,
      title: summary.title,
      priority: summary.priority,
      stage: summary.current_stage,
      status: 'active',
    },
    summary: {
      owner: { id: 'qa', label: 'QA', kind: 'assigned' },
      workflowStage: { value: summary.current_stage, label: updated ? 'Verify' : 'Implement' },
      nextAction: { label: summary.next_required_action, source: 'system', overdue: false, waitingOn: null },
      prStatus: { label: 'No linked PRs', state: 'empty', total: 0, openCount: 0, mergedCount: 0, draftCount: 0 },
      childStatus: { label: 'No child tasks', state: 'empty', total: 0, blockedCount: 0 },
      timers: { queueAgeLabel: 'Just now', lastUpdatedAt: summary.freshness.last_updated_at, freshness: 'fresh' },
      blockedState: { isBlocked: false, label: 'Active', waitingOn: null },
    },
    blockers: [],
    context: { businessContext: 'Live freshness browser test.', acceptanceCriteria: [], definitionOfDone: [] },
    relations: { linkedPrs: [], childTasks: [] },
    activity: { comments: [], auditLog: [], auditLogPageInfo: { limit: 25, next_cursor: null, has_more: false } },
    telemetry: {
      availability: 'empty',
      lastUpdatedAt: null,
      summary: {},
      emptyStateReason: 'No telemetry signals are linked to this task yet.',
      access: { restricted: false, omission_applied: false, omitted_fields: [] },
    },
    meta: {
      permissions: {
        canViewComments: true,
        canViewAuditLog: true,
        canViewTelemetry: true,
        canViewChildTasks: true,
        canViewLinkedPrMetadata: true,
      },
      freshness: { status: 'fresh', lastUpdatedAt: summary.freshness.last_updated_at },
    },
  };
}

async function installAgentRoutes(page) {
  await page.route('**/api/ai-agents', async (route) => {
    await route.fulfill({
      json: {
        items: [
          { id: 'pm', display_name: 'PM', role: 'PM', active: true },
          { id: 'qa', display_name: 'QA', role: 'QA', active: true },
        ],
      },
    });
  });
}

async function installTaskRoutes(page, state: { updated: boolean }) {
  await page.route('**/api/tasks', async (route) => {
    await route.fulfill({ json: { items: [taskSummary(state.updated)] } });
  });

  await page.route('**/api/tasks/TSK-LIVE/detail**', async (route) => {
    await route.fulfill({ json: taskDetail(state.updated) });
  });

  await page.route('**/api/tasks/TSK-LIVE/history**', async (route) => {
    await route.fulfill({ json: { items: [], page_info: { next_cursor: null } } });
  });

  await page.route('**/api/tasks/TSK-LIVE/observability-summary', async (route) => {
    await route.fulfill({
      json: {
        status: 'ok',
        degraded: false,
        stale: false,
        event_count: 0,
        last_updated_at: '2026-05-17T12:00:00.000Z',
        freshness: { status: 'fresh', last_updated_at: '2026-05-17T12:00:00.000Z' },
        correlation: { approved_correlation_ids: [] },
        access: { restricted: false, omission_applied: false, omitted_fields: [] },
      },
    });
  });

  await page.route('**/api/tasks/TSK-LIVE', async (route) => {
    await route.fulfill({ json: taskSummary(state.updated) });
  });
}

async function installProjectRoutes(page, state: { updated: boolean }) {
  await page.route('**/api/v1/projects**', async (route) => {
    await route.fulfill({
      json: {
        data: [{
          projectId: 'PRJ-LIVE000',
          name: state.updated ? 'Live Project Updated' : 'Live Project Pending',
          summary: 'Polling project',
          status: 'ACTIVE',
          ownerActorId: 'pm-1',
          taskCount: 1,
          version: state.updated ? 2 : 1,
        }],
      },
    });
  });
}

function liveUpdatePayload(state: { pollCount: number }) {
  const secondPoll = state.pollCount > 1;
  return {
    data: {
      cursor: `cursor-${state.pollCount}`,
      pollAfterMs: 100,
      serverTime: new Date().toISOString(),
      updates: secondPoll ? [
        {
          entityType: 'task',
          entityId: 'TSK-LIVE',
          updateType: 'task_snapshot',
          version: 2,
          updatedAt: '2026-05-17T12:00:02.000Z',
          payload: { task: taskSummary(true) },
        },
        {
          entityType: 'project',
          entityId: 'PRJ-LIVE000',
          updateType: 'project_snapshot',
          version: 2,
          updatedAt: '2026-05-17T12:00:02.000Z',
          payload: { project: { projectId: 'PRJ-LIVE000', name: 'Live Project Updated', status: 'ACTIVE', taskCount: 1 } },
        },
      ] : [],
    },
  };
}

async function installUpdateRoute(page, state: { updated: boolean; pollCount: number }) {
  await page.route('**/api/v1/tasks/updates**', async (route) => {
    state.pollCount += 1;
    const secondPoll = state.pollCount > 1;
    if (secondPoll) state.updated = true;
    await route.fulfill({ json: liveUpdatePayload(state) });
  });
}

async function installSharedRoutes(page, state: { updated: boolean; pollCount: number }) {
  await installAgentRoutes(page);
  await installTaskRoutes(page, state);
  await installProjectRoutes(page, state);
  await installUpdateRoute(page, state);
}

test.beforeEach(async ({ page }) => {
  await installLiveSession(page);
});

test('task workspace list refreshes from live task updates without page reload', async ({ page }) => {
  const state = { updated: false, pollCount: 0 };
  await installSharedRoutes(page, state);

  await page.goto('/tasks?view=list', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Live update applied')).toBeVisible({ timeout: 5000 });
  await expect(page).toHaveURL(/\/tasks\?view=list/);
  await expect(page.getByRole('status').filter({ hasText: /Fresh updates applied|No new updates/ })).toBeVisible();
});

test('role inbox refreshes routed task cards from live updates', async ({ page }) => {
  const state = { updated: false, pollCount: 0 };
  await installSharedRoutes(page, state);

  await page.goto('/inbox/qa', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { level: 1, name: 'QA Inbox' })).toBeVisible();
  await expect(page.getByText('Live update applied')).toBeVisible({ timeout: 5000 });
  await expect(page).toHaveURL(/\/inbox\/qa/);
});

test('task detail refreshes the active task summary from live updates', async ({ page }) => {
  const state = { updated: false, pollCount: 0 };
  await installSharedRoutes(page, state);

  await page.goto('/tasks/TSK-LIVE', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Live update applied' })).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel('QA verification required').getByText('Review the live update')).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\/TSK-LIVE/);
});

test('Projects refreshes planning containers from live project updates', async ({ page }) => {
  const state = { updated: false, pollCount: 0 };
  await installSharedRoutes(page, state);

  await page.goto('/projects', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Live Project Updated')).toBeVisible({ timeout: 5000 });
  await expect(page).toHaveURL(/\/projects/);
});
