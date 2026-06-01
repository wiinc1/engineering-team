import { expect, test } from '@playwright/test';

type DetailOverrides = {
  blocked?: boolean;
  closeGovernance?: unknown;
  freshness?: string;
  intakeDraft?: boolean;
  monitoring?: unknown;
  nextAction?: string | null;
  owner?: { id: string; label: string; kind: string } | null;
  roles?: string[];
  stage?: string;
  status?: string;
  waitingOn?: string | null;
  waitingState?: string | null;
};

const TASK_ID = 'TSK-153';
const TENANT_ID = 'tenant-a';
const UPDATED_AT = '2026-05-15T10:00:00.000Z';

function ownerFor(overrides: DetailOverrides) {
  return Object.prototype.hasOwnProperty.call(overrides, 'owner')
    ? overrides.owner
    : { id: 'pm', label: 'PM', kind: 'assigned' };
}

function nextActionFor(overrides: DetailOverrides) {
  return overrides.nextAction === null
    ? null
    : { label: overrides.nextAction || 'PM refinement required', source: 'system' };
}

function summaryPayload(overrides: DetailOverrides, stage: string, owner, nextAction) {
  return {
    owner,
    workflowStage: { value: stage, label: stage },
    nextAction,
    prStatus: { label: 'No linked PRs', state: 'empty', total: 0, openCount: 0, mergedCount: 0, draftCount: 0 },
    childStatus: { label: 'No child tasks', state: 'empty', total: 0, blockedCount: 0 },
    timers: { queueAgeLabel: '5m', lastUpdatedAt: UPDATED_AT, freshness: overrides.freshness || 'fresh' },
    blockedState: {
      isBlocked: Boolean(overrides.blocked),
      label: overrides.blocked ? 'Blocked' : 'Active',
      waitingOn: overrides.waitingOn || overrides.waitingState || null,
    },
  };
}

function contextPayload(overrides: DetailOverrides, stage: string) {
  return {
    intakeDraft: Boolean(overrides.intakeDraft ?? stage === 'DRAFT'),
    businessContext: 'Operators need task detail to surface the next workflow step first.',
    acceptanceCriteria: ['Role-specific next actions appear above the fold.'],
    definitionOfDone: ['Role-specific next actions are accessible and tested.'],
    technicalSpec: 'Technical context remains available below the next-action panel.',
    monitoringSpec: 'Monitoring context remains available below the next-action panel.',
    sreMonitoring: overrides.monitoring || {},
    closeGovernance: overrides.closeGovernance || null,
    qaResults: { summary: { total: 0, passedCount: 0, failedCount: 0, retestCount: 0 }, items: [] },
  };
}

function telemetryPayload(overrides: DetailOverrides) {
  return {
    availability: overrides.freshness === 'stale' ? 'stale' : 'available',
    lastUpdatedAt: UPDATED_AT,
    summary: {},
    access: { restricted: false, omission_applied: false, omitted_fields: [] },
  };
}

function detailPayload(overrides: DetailOverrides = {}) {
  const stage = overrides.stage || 'DRAFT';
  const status = overrides.status || 'waiting';
  const owner = ownerFor(overrides);
  const nextAction = nextActionFor(overrides);

  return {
    task: { id: TASK_ID, title: 'Role-specific next action', priority: 'P1', stage, status },
    summary: summaryPayload(overrides, stage, owner, nextAction),
    blockers: overrides.blocked ? [{ id: 'blk-1', label: overrides.waitingOn || 'Blocked by dependency' }] : [],
    context: contextPayload(overrides, stage),
    relations: { linkedPrs: [], childTasks: [] },
    activity: { comments: [], auditLog: [], auditLogPageInfo: { limit: 25, next_cursor: null, has_more: false } },
    telemetry: telemetryPayload(overrides),
    meta: {
      permissions: {
        canViewComments: true,
        canViewAuditLog: true,
        canViewTelemetry: true,
        canViewChildTasks: true,
        canViewLinkedPrMetadata: true,
        canViewOrchestration: true,
      },
      freshness: { status: overrides.freshness || 'fresh', lastUpdatedAt: UPDATED_AT },
    },
  };
}

function taskListItem(detail) {
  return {
    task_id: TASK_ID,
    tenant_id: TENANT_ID,
    title: detail.task.title,
    priority: detail.task.priority,
    current_stage: detail.task.stage,
    current_owner: detail.summary.owner?.id || null,
    owner: detail.summary.owner ? { actor_id: detail.summary.owner.id, display_name: detail.summary.owner.label } : null,
    blocked: detail.summary.blockedState.isBlocked,
    closed: detail.task.status === 'done',
    waiting_state: detail.summary.blockedState.waitingOn,
    next_required_action: detail.summary.nextAction?.label || null,
    queue_entered_at: UPDATED_AT,
    freshness: { status: detail.meta.freshness.status, last_updated_at: detail.meta.freshness.lastUpdatedAt },
  };
}

function taskSummaryResponse(detail) {
  return {
    task_id: TASK_ID,
    tenant_id: TENANT_ID,
    title: detail.task.title,
    priority: detail.task.priority,
    current_stage: detail.task.stage,
    current_owner: detail.summary.owner?.id || null,
    blocked: detail.summary.blockedState.isBlocked,
    waiting_state: detail.summary.blockedState.waitingOn,
    next_required_action: detail.summary.nextAction?.label || null,
    status_indicator: detail.task.status,
    closed: detail.task.status === 'done',
  };
}

async function installSession(page, roles = ['pm', 'reader']) {
  await page.addInitScript((claims) => {
    const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    window.sessionStorage.setItem('engineering-team.task-browser-session', JSON.stringify({
      bearerToken: `header.${body}.signature`,
      apiBaseUrl: '/api',
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    }));
  }, { sub: `${roles[0]}-1`, tenant_id: TENANT_ID, roles, exp: Math.floor(Date.now() / 1000) + 3600 });
}

async function routeTaskList(page, detail) {
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: { items: [taskListItem(detail)] } });
  });
}

async function routeTaskDetailEndpoints(page, detail) {
  await page.route(`**/api/tasks/${TASK_ID}/detail**`, async (route) => route.fulfill({ json: detail }));
  await page.route(`**/api/tasks/${TASK_ID}/history**`, async (route) => route.fulfill({ json: { items: [], page_info: { next_cursor: null } } }));
  await page.route(`**/api/tasks/${TASK_ID}/observability-summary`, async (route) => route.fulfill({
    json: {
      status: 'ok',
      event_count: 0,
      freshness: { status: detail.meta.freshness.status, last_updated_at: detail.meta.freshness.lastUpdatedAt },
      correlation: { approved_correlation_ids: [] },
      access: { restricted: false, omission_applied: false, omitted_fields: [] },
    },
  }));
  await page.route(`**/api/tasks/${TASK_ID}`, async (route) => route.fulfill({ json: taskSummaryResponse(detail) }));
  await page.route(`**/api/v1/tasks/${TASK_ID}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: { data: { taskId: TASK_ID, version: 3, owner: null } } });
  });
}

async function routeAgents(page) {
  const agents = [
    { id: 'pm', agentId: 'pm', display_name: 'PM', displayName: 'PM', role: 'PM', active: true, assignable: true },
    { id: 'architect', agentId: 'architect', display_name: 'Architect', displayName: 'Architect', role: 'Architect', active: true, assignable: true },
    { id: 'engineer', agentId: 'engineer', display_name: 'Engineer', displayName: 'Engineer', role: 'Engineering', active: true, assignable: true },
    { id: 'qa', agentId: 'qa', display_name: 'QA Engineer', displayName: 'QA Engineer', role: 'QA', active: true, assignable: true },
  ];
  await page.route('**/api/v1/ai-agents?includeInactive=true', async (route) => route.fulfill({ json: { data: agents } }));
  await page.route('**/api/ai-agents', async (route) => route.fulfill({
    json: {
      items: agents,
    },
  }));
}

async function installTaskDetailMock(page, detail, roles = ['pm', 'reader']) {
  await installSession(page, roles);
  await routeTaskList(page, detail);
  await routeTaskDetailEndpoints(page, detail);
  await routeAgents(page);
}

async function openTaskDetail(page, detail, roles = ['pm', 'reader']) {
  await installTaskDetailMock(page, detail, roles);
  await page.goto(`/tasks/${TASK_ID}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Role-specific next action', exact: true })).toBeVisible();
}

const nextActionCases = [
  {
    name: 'PM assignment',
    roles: ['pm', 'reader'],
    detail: detailPayload({ stage: 'BACKLOG', status: 'waiting', owner: null, nextAction: 'Assign the task owner' }),
    action: 'pm_assignment',
    title: 'Assign the next owner',
    cta: 'Assign owner',
  },
  {
    name: 'PM refinement',
    roles: ['pm', 'reader'],
    detail: detailPayload({ stage: 'DRAFT', status: 'waiting', intakeDraft: true, nextAction: 'PM refinement required' }),
    action: 'pm_refinement',
    title: 'PM refinement required',
    cta: 'Retry PM refinement',
  },
  {
    name: 'QA verification',
    roles: ['qa', 'reader'],
    detail: detailPayload({
      stage: 'QA_TESTING',
      status: 'active',
      owner: { id: 'qa', label: 'QA Engineer', kind: 'assigned' },
      nextAction: 'QA verification required',
    }),
    action: 'qa_verification',
    title: 'QA verification required',
    cta: 'Submit QA result',
  },
  {
    name: 'SRE monitoring',
    roles: ['sre', 'reader'],
    detail: detailPayload({
      stage: 'SRE_MONITORING',
      status: 'active',
      nextAction: 'SRE monitoring validation is required.',
      monitoring: { state: 'active', canApprove: true, timeRemainingLabel: '47h remaining' },
    }),
    action: 'sre_monitoring',
    title: 'SRE monitoring action',
    cta: 'Approve monitoring',
  },
  {
    name: 'blocked engineer',
    roles: ['engineer', 'reader'],
    detail: detailPayload({
      stage: 'IMPLEMENTATION',
      status: 'blocked',
      blocked: true,
      waitingOn: 'PR merge is blocking deployment',
      nextAction: null,
    }),
    action: 'blocked_or_waiting',
    title: 'Task is blocked',
    cta: 'Open blockers and discussion',
  },
  {
    name: 'waiting engineer',
    roles: ['engineer', 'reader'],
    detail: detailPayload({ stage: 'REVIEW', status: 'waiting', waitingState: 'awaiting_dependency', nextAction: null }),
    action: 'blocked_or_waiting',
    title: 'Task is waiting',
    cta: 'Open blockers and discussion',
  },
  {
    name: 'done review',
    roles: ['pm', 'reader'],
    detail: detailPayload({ stage: 'DONE', status: 'done', nextAction: null }),
    action: 'done_passive_review',
    title: 'Task is complete',
    cta: 'Review closeout history',
  },
  {
    name: 'stale passive monitoring',
    roles: ['engineer', 'reader'],
    detail: detailPayload({ stage: 'REVIEW', status: 'active', nextAction: null, freshness: 'stale' }),
    action: 'passive_monitoring',
    title: 'No immediate action',
    cta: 'Open relevant section',
  },
];

async function assertPrioritizedNextAction(page, item) {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTaskDetail(page, item.detail, item.roles);

  const panel = page.locator('.task-next-action');
  await expect(panel).toHaveAttribute('data-next-action', item.action);
  await expect(panel.getByRole('heading', { name: item.title })).toBeVisible();
  const cta = panel.getByRole('link', { name: item.cta }).or(panel.getByRole('button', { name: item.cta }));
  await expect(cta).toBeVisible();

  const metrics = await panel.evaluate((node) => ({
    top: node.getBoundingClientRect().top,
    width: node.getBoundingClientRect().width,
    scrollWidth: node.scrollWidth,
  }));
  expect(metrics.top).toBeLessThan(700);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(Math.ceil(metrics.width) + 1);
}

test.describe('task detail next-action browser matrix', () => {
  for (const item of nextActionCases) {
    test(`prioritizes ${item.name} above the fold`, async ({ page }) => {
      await assertPrioritizedNextAction(page, item);
    });
  }
});

test.describe('task detail next-action read states', () => {
  test('shows status without unauthorized next-action controls for restricted readers', async ({ page }) => {
    await openTaskDetail(page, detailPayload({
      stage: 'QA_TESTING',
      status: 'active',
      owner: { id: 'qa', label: 'QA Engineer', kind: 'assigned' },
      nextAction: 'QA verification required',
    }), ['reader']);

    const panel = page.locator('.task-next-action');
    await expect(panel).toHaveAttribute('data-next-action', 'read_only_status');
    await expect(panel).toContainText('Action controls are unavailable for this session.');
    await expect(panel.getByRole('link', { name: 'Submit QA result' })).toHaveCount(0);
  });

  test('labels PM refinement as requested until a refinement artifact exists', async ({ page }) => {
    await openTaskDetail(page, detailPayload({
      stage: 'DRAFT',
      status: 'waiting',
      intakeDraft: true,
      nextAction: 'PM refinement required',
    }), ['pm', 'reader']);

    const panel = page.locator('.task-next-action');
    await expect(panel).toHaveAttribute('data-next-action', 'pm_refinement');
    await expect(panel).toContainText('PM refinement');
    await expect(panel).toContainText('Requested/pending');
    await expect(panel).toContainText('no refinement artifact is complete yet');
  });
});

test.describe('task detail PM refinement retry', () => {
  test('retries pending PM refinement from the next-action panel', async ({ page }) => {
    const retryRequests: unknown[] = [];
    await openTaskDetail(page, detailPayload({
      stage: 'DRAFT',
      status: 'waiting',
      intakeDraft: true,
      nextAction: 'PM refinement required',
      monitoring: { state: 'pending_start', canApprove: false },
    }), ['admin', 'pm', 'sre', 'reader']);

    await page.route(`**/api/v1/tasks/${TASK_ID}/refinement/start`, async (route) => {
      retryRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 202,
        json: { success: true, data: { taskId: TASK_ID, status: 'failed' } },
      });
    });

    await page.getByRole('button', { name: 'Retry PM refinement' }).click();
    await expect.poll(() => retryRequests.length).toBe(1);
    expect(retryRequests).toEqual([{ trigger: 'task_detail_retry_button' }]);
  });
});

test.describe('task detail owner assignment route', () => {
  test('saves owner assignment through the canonical v1 owner route', async ({ page }) => {
    const ownerRequests: unknown[] = [];
    await page.route(`**/api/v1/tasks/${TASK_ID}`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({ json: { data: { taskId: TASK_ID, version: 3, owner: null } } });
    });
    await page.route(`**/api/v1/tasks/${TASK_ID}/owner`, async (route) => {
      ownerRequests.push(route.request().postDataJSON());
      await route.fulfill({ json: { data: { taskId: TASK_ID, version: 4, owner: { agentId: 'pm', displayName: 'PM', role: 'PM' } } } });
    });

    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    const version = await page.evaluate(async (taskId) => {
      const response = await fetch(`/api/v1/tasks/${taskId}`);
      return (await response.json()).data.version;
    }, TASK_ID);
    await page.evaluate(async ({ taskId, currentVersion }) => {
      await fetch(`/api/v1/tasks/${taskId}/owner`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ownerAgentId: 'pm', version: currentVersion }),
      });
    }, { taskId: TASK_ID, currentVersion: version });

    expect(ownerRequests).toEqual([{ ownerAgentId: 'pm', version: 3 }]);
  });
});
