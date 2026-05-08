import { expect, test } from '@playwright/test';

const workspaceTasks = [
  {
    task_id: 'TSK-DRAFT',
    tenant_id: 'tenant-a',
    title: 'Shape raw operator notes',
    priority: null,
    current_stage: 'DRAFT',
    current_owner: 'pm',
    owner: { actor_id: 'pm', display_name: 'PM' },
    intake_draft: true,
    waiting_state: 'task_refinement',
    next_required_action: 'PM refinement required',
    freshness: { status: 'fresh', last_updated_at: '2026-05-05T12:00:00.000Z' },
  },
  {
    task_id: 'TSK-VERIFY',
    tenant_id: 'tenant-a',
    title: 'Verify release telemetry',
    priority: 'P1',
    current_stage: 'VERIFY',
    current_owner: 'sre',
    owner: { actor_id: 'sre', display_name: 'SRE' },
    waiting_state: null,
    next_required_action: 'SRE verification required',
    freshness: { status: 'fresh', last_updated_at: '2026-05-05T12:01:00.000Z' },
  },
];

function encodeClaims(claims: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(claims)).toString('base64url');
}

async function installSession(page) {
  const token = `header.${encodeClaims({
    sub: 'pm-1',
    tenant_id: 'tenant-a',
    roles: ['pm', 'reader'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`;

  await page.addInitScript((sessionToken) => {
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

function createdTaskDetailPayload(rawRequirements: string) {
  return {
    task: {
      id: 'TSK-UX',
      title: 'Improve operator task workspace',
      priority: null,
      stage: 'DRAFT',
      status: 'waiting',
    },
    summary: createdTaskSummaryPayload(),
    blockers: [],
    context: createdTaskContextPayload(rawRequirements),
    relations: { linkedPrs: [], childTasks: [] },
    activity: createdTaskActivityPayload(),
    telemetry: createdTaskTelemetryPayload(),
    meta: createdTaskMetaPayload(),
  };
}

function createdTaskSummaryPayload() {
  return {
    owner: { id: 'pm', label: 'PM', kind: 'assigned' },
    workflowStage: { value: 'DRAFT', label: 'Draft' },
    nextAction: { label: 'PM refinement required', source: 'system', overdue: false, waitingOn: 'Task refinement' },
    prStatus: { label: 'No linked PRs', state: 'empty', total: 0, openCount: 0, mergedCount: 0, draftCount: 0 },
    childStatus: { label: 'No child tasks', state: 'empty', total: 0, blockedCount: 0 },
    timers: { queueAgeLabel: 'Just now', lastUpdatedAt: '2026-05-05T12:04:00.000Z', freshness: 'fresh' },
    blockedState: { isBlocked: false, label: 'Waiting', waitingOn: 'Task refinement' },
  };
}

function createdTaskContextPayload(rawRequirements: string) {
  return {
    intakeDraft: true,
    operatorIntakeRequirements: rawRequirements,
    businessContext: null,
    acceptanceCriteria: [],
    definitionOfDone: [],
    technicalSpec: null,
    monitoringSpec: null,
  };
}

function createdTaskActivityPayload() {
  return {
    comments: [],
    auditLog: [
      {
        id: 'evt-intake',
        type: 'task.created',
        summary: 'Task created',
        actor: { id: 'pm-1', label: 'PM 1' },
        occurredAt: '2026-05-05T12:04:00.000Z',
      },
    ],
    auditLogPageInfo: { limit: 25, next_cursor: null, has_more: false },
  };
}

function createdTaskTelemetryPayload() {
  return {
    availability: 'empty',
    lastUpdatedAt: null,
    summary: {},
    emptyStateReason: 'No telemetry signals are linked to this task yet.',
    access: { restricted: false, omission_applied: false, omitted_fields: [] },
  };
}

function createdTaskMetaPayload() {
  return {
    permissions: {
      canViewComments: true,
      canViewAuditLog: true,
      canViewTelemetry: true,
      canViewChildTasks: true,
      canViewLinkedPrMetadata: true,
    },
    freshness: { status: 'fresh', lastUpdatedAt: '2026-05-05T12:04:00.000Z' },
  };
}

async function routeAgents(page) {
  await page.route('**/api/ai-agents', async (route) => {
    await route.fulfill({
      json: {
        items: [
          { id: 'pm', display_name: 'PM', role: 'PM', active: true },
          { id: 'sre', display_name: 'SRE', role: 'SRE', active: true },
        ],
      },
    });
  });
}

async function routeTaskList(page, state: { createdRequirements: string }) {
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { items: workspaceTasks } });
      return;
    }

    state.createdRequirements = String((await route.request().postDataJSON())?.raw_requirements || '');
    await route.fulfill({
      status: 201,
      json: {
        taskId: 'TSK-UX',
        status: 'DRAFT',
        intakeDraft: true,
        nextRequiredAction: 'PM refinement required',
      },
    });
  });
}

async function routeCreatedTaskDetail(page, state: { createdRequirements: string }) {
  await page.route('**/api/tasks/TSK-UX/detail**', async (route) => {
    await route.fulfill({ json: createdTaskDetailPayload(state.createdRequirements) });
  });
}

async function routeCreatedTaskHistory(page) {
  await page.route('**/api/tasks/TSK-UX/history**', async (route) => {
    await route.fulfill({ json: { items: [], page_info: { next_cursor: null } } });
  });
}

async function routeCreatedTaskObservability(page) {
  await page.route('**/api/tasks/TSK-UX/observability-summary', async (route) => {
    await route.fulfill({
      json: {
        status: 'ok',
        degraded: false,
        stale: false,
        event_count: 0,
        last_updated_at: '2026-05-05T12:04:00.000Z',
        freshness: { status: 'fresh', last_updated_at: '2026-05-05T12:04:00.000Z' },
        correlation: { approved_correlation_ids: [] },
        access: { restricted: false, omission_applied: false, omitted_fields: [] },
      },
    });
  });
}

async function routeCreatedTaskSummary(page) {
  await page.route('**/api/tasks/TSK-UX', async (route) => {
    await route.fulfill({
      json: {
        task_id: 'TSK-UX',
        tenant_id: 'tenant-a',
        title: 'Improve operator task workspace',
        priority: null,
        current_stage: 'DRAFT',
        current_owner: 'pm',
        blocked: false,
        waiting_state: 'task_refinement',
        next_required_action: 'PM refinement required',
        freshness: { status: 'fresh', last_updated_at: '2026-05-05T12:04:00.000Z' },
        status_indicator: 'fresh',
        closed: false,
      },
    });
  });
}

async function mockWorkspaceApi(page) {
  const state = { createdRequirements: '' };
  await routeAgents(page);
  await routeTaskList(page, state);
  await routeCreatedTaskDetail(page, state);
  await routeCreatedTaskHistory(page);
  await routeCreatedTaskObservability(page);
  await routeCreatedTaskSummary(page);
}

async function assertWorkspaceBoard(page) {
  await expect(page.getByRole('heading', { name: 'Task workspace' })).toBeVisible();
  await expect(page.getByLabel('Task board')).toBeVisible();
  await expect(page.getByLabel('Intake Draft column')).toContainText('Shape raw operator notes');
  await expect(page.getByLabel('SRE Verification column')).toContainText('Verify release telemetry');
}

async function assertWorkspaceNavigation(page) {
  const primaryNav = page.getByRole('group', { name: 'Primary task navigation' });
  const secondaryNav = page.getByRole('group', { name: 'Secondary workspace navigation' });

  await expect(primaryNav.getByRole('button', { name: 'New task' })).toBeVisible();
  await expect(secondaryNav.getByRole('button', { name: 'PM overview' })).toBeVisible();
  await expect(secondaryNav.getByLabel('Role inboxes')).toBeVisible();
}

async function readNavigationStyles(page) {
  return page.locator('.app-nav').evaluate((nav) => {
    const newTask = nav.querySelector('.app-nav__primary .app-nav__primary-action');
    const pmOverview = [...nav.querySelectorAll('.app-nav__secondary button')].find(
      (button) => button.textContent === 'PM overview',
    );
    const newTaskStyle = newTask ? window.getComputedStyle(newTask) : null;
    const pmOverviewStyle = pmOverview ? window.getComputedStyle(pmOverview) : null;
    return {
      newTaskBackground: newTaskStyle?.backgroundColor || '',
      pmOverviewBackground: pmOverviewStyle?.backgroundColor || '',
      pmOverviewFontSize: pmOverviewStyle?.fontSize || '',
    };
  });
}

async function assertOwnerFilterEmptyState(page) {
  await page.getByLabel('Owner filter').selectOption('pm');
  await expect(page.getByText('1 cards shown for PM · PM.')).toBeVisible();
  const emptySreColumn = page.getByLabel('SRE Verification column').locator('.task-board__empty');
  await expect(emptySreColumn).toContainText('No matching tasks in this column.');
  await expect(emptySreColumn.locator('.task-board__empty-guidance')).toHaveText(
    'Release verification and monitoring readiness.',
  );
  await page.getByRole('button', { name: 'Clear all filters' }).click();
}

async function assertMobileBoardOverflow(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const boardMetrics = await page.locator('.task-board__scroll').evaluate((element) => {
    const firstColumn = element.querySelector('.task-board__column')?.getBoundingClientRect();
    return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, firstColumnWidth: firstColumn?.width || 0 };
  });

  expect(boardMetrics.scrollWidth).toBeGreaterThan(boardMetrics.clientWidth);
  expect(boardMetrics.firstColumnWidth).toBeLessThanOrEqual(330);
}

async function assertTaskCreationSuccess(page) {
  await expect(page).toHaveURL(/\/tasks\/create$/);
  await expect(page.getByRole('status')).toContainText('TSK-UX is ready for PM refinement');
  await expect(page.getByRole('link', { name: 'Open task detail' })).toHaveAttribute(
    'href',
    '/tasks/TSK-UX?created=intake-draft',
  );
  await expect(page.getByRole('link', { name: 'View task workspace' })).toHaveAttribute('href', '/tasks?view=board');
  await expect(page.getByRole('button', { name: 'Create another task' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create task draft' })).toBeHidden();
}

async function assertCreatedTaskDetail(page) {
  await expect(page).toHaveURL(/\/tasks\/TSK-UX\?created=intake-draft/);
  await expect(page.getByRole('heading', { name: 'Improve operator task workspace' })).toBeVisible();
  await expect(page.locator('.task-created-banner')).toContainText('Intake Draft is ready for PM refinement');
  await expect(page.getByText('Second raw operator request from the browser test.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to task workspace' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installSession(page);
  await mockWorkspaceApi(page);
});

test('renders the task workspace board with scannable columns and mobile overflow control', async ({ page }) => {
  await page.goto('/tasks?view=board', { waitUntil: 'domcontentloaded' });
  await assertWorkspaceBoard(page);
  await assertWorkspaceNavigation(page);

  const navStyles = await readNavigationStyles(page);
  expect(navStyles.newTaskBackground).not.toBe(navStyles.pmOverviewBackground);
  expect(navStyles.pmOverviewFontSize).toBe('13.44px');

  await assertOwnerFilterEmptyState(page);
  await assertMobileBoardOverflow(page);
});

test('creates an intake draft from the workspace and opens the created task with recovery actions', async ({ page }) => {
  await page.goto('/tasks/create', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Add a new task' })).toBeVisible();
  await page.getByLabel(/requirements/i).fill('Raw operator request from the browser test.');
  await page.getByRole('button', { name: 'Create task draft' }).click();
  await assertTaskCreationSuccess(page);

  await page.getByRole('button', { name: 'Create another task' }).click();
  await expect(page.getByLabel(/requirements/i)).toHaveValue('');
  await page.getByLabel(/requirements/i).fill('Second raw operator request from the browser test.');
  await page.getByRole('button', { name: 'Create task draft' }).click();
  await page.getByRole('link', { name: 'Open task detail' }).click();
  await assertCreatedTaskDetail(page);
});
