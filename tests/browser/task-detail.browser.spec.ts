import { expect, test } from '@playwright/test';

const taskListItems = [
  { task_id: 'TSK-42', tenant_id: 'tenant-a', title: 'Wire task detail', priority: 'P1', current_stage: 'IMPLEMENT', current_owner: 'engineer', owner: { actor_id: 'engineer', display_name: 'Engineer' }, blocked: false, closed: false, waiting_state: null, next_required_action: 'Ship browser quality smoke coverage', queue_entered_at: '2026-04-01T15:00:00.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' } },
  { task_id: 'TSK-43', tenant_id: 'tenant-a', title: 'Triage queue drift', priority: 'P2', current_stage: 'TODO', current_owner: null, owner: null, blocked: false, closed: false, waiting_state: 'awaiting_pm_decision', next_required_action: 'PM triage required', queue_entered_at: '2026-04-01T15:00:01.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:01.000Z' } },
  { task_id: 'TSK-44', tenant_id: 'tenant-a', title: 'Stale owner reference', priority: 'P3', current_stage: 'REVIEW', current_owner: 'ghost', owner: { actor_id: 'ghost', display_name: 'ghost' }, blocked: false, closed: false, waiting_state: null, next_required_action: null, queue_entered_at: '2026-04-01T15:00:02.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:02.000Z' } },
  { task_id: 'TSK-45', tenant_id: 'tenant-a', title: 'Restricted owner surface', priority: 'P2', current_stage: 'TODO', current_owner: 'masked', owner: { actor_id: 'masked', display_name: '', redacted: true }, blocked: false, closed: false, waiting_state: 'awaiting_human_approval', next_required_action: 'Human approval required', queue_entered_at: '2026-04-01T15:00:03.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:03.000Z' } },
  { task_id: 'TSK-46', tenant_id: 'tenant-a', title: 'Review test plan', priority: 'P2', current_stage: 'VERIFY', current_owner: 'qa', owner: { actor_id: 'qa', display_name: 'QA Engineer' }, blocked: false, closed: false, waiting_state: null, next_required_action: null, queue_entered_at: '2026-04-01T15:00:04.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:04.000Z' } },
  { task_id: 'TSK-47', tenant_id: 'tenant-a', title: 'Design routing architecture', priority: 'P1', current_stage: 'BACKLOG', current_owner: 'architect', owner: { actor_id: 'architect', display_name: 'Architect' }, blocked: false, closed: false, waiting_state: null, next_required_action: null, queue_entered_at: '2026-04-01T15:00:05.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:05.000Z' } },
];

const taskDetailPayload = {
  task: { id: 'TSK-42', title: 'Wire task detail', priority: 'P1', stage: 'IMPLEMENT', status: 'blocked' },
  summary: {
    owner: { id: 'engineer', label: 'Engineer', kind: 'assigned' },
    workflowStage: { value: 'IMPLEMENT', label: 'Implement' },
    nextAction: { label: 'Await PM decision', source: 'pm', overdue: false, waitingOn: 'PM decision' },
    prStatus: { label: '1 open PR linked', state: 'active', total: 1, openCount: 1, mergedCount: 0, draftCount: 0 },
    childStatus: { label: '1 child task waiting', state: 'warning', total: 1, blockedCount: 0 },
    timers: { queueAgeLabel: '5m', lastUpdatedAt: '2026-04-01T15:00:00.000Z', freshness: 'fresh' },
    blockedState: { isBlocked: true, label: 'Blocked', waitingOn: 'PM decision' },
  },
  blockers: [
    { id: 'blk-1', label: 'Awaiting security sign-off', source: 'Security review', owner: { label: 'Security' }, ageLabel: '2d' },
  ],
  context: {
    businessContext: 'Make task state legible in one place.',
    acceptanceCriteria: ['Given a task page loads, the summary is visible above the fold.'],
    definitionOfDone: ['Task detail page shipped with browser verification.'],
    technicalSpec: 'Server-rendered technical spec',
    monitoringSpec: 'Server-rendered monitoring spec',
  },
  relations: {
    linkedPrs: [{ id: 'pr-12', number: 12, title: 'feat: task detail', state: 'open', merged: false, draft: false, repository: 'wiinc1/engineering-team' }],
    childTasks: [{ id: 'TSK-43', title: 'Triage queue drift', stage: 'TODO', status: 'waiting', owner: { label: 'qa' }, blocked: false }],
  },
  activity: {
    comments: [{ id: 'c-1', actor: { label: 'PM 1' }, summary: 'Need follow-up' }],
    auditLog: [
      { id: 'evt-1', type: 'task.created', summary: 'Task created', actor: { id: 'pm-1', label: 'PM 1' }, occurredAt: '2026-04-01T14:55:00.000Z' },
      { id: 'evt-2', type: 'task.assigned', summary: 'Owner assigned', actor: { id: 'engineer', label: 'Engineer 1' }, occurredAt: '2026-04-01T14:58:00.000Z' },
    ],
    auditLogPageInfo: { limit: 25, next_cursor: null, has_more: false },
  },
  telemetry: { availability: 'available', lastUpdatedAt: '2026-04-01T15:00:00.000Z', summary: {}, emptyStateReason: null, access: { restricted: false, omission_applied: false, omitted_fields: [] } },
  meta: {
    permissions: {
      canViewComments: true,
      canViewAuditLog: true,
      canViewTelemetry: true,
      canViewChildTasks: true,
      canViewLinkedPrMetadata: true,
    },
    freshness: { status: 'fresh', lastUpdatedAt: '2026-04-01T15:00:00.000Z' },
  },
};

async function installApiMocks(page) {
  await page.addInitScript(() => {
    const claims = {
      sub: 'pm-1',
      tenant_id: 'tenant-a',
      roles: ['pm', 'reader'],
      exp: Math.floor(Date.now() / 1000) + (60 * 60),
    };
    const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    window.sessionStorage.setItem(
      'engineering-team.task-browser-session',
      JSON.stringify({
        bearerToken: `header.${payload}.signature`,
        apiBaseUrl: '/api',
        expiresAt: new Date(Date.now() + (60 * 60 * 1000)).toISOString(),
      }),
    );
  });

  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: { items: taskListItems } });
  });

  await page.route('**/api/tasks/TSK-42', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: {
      task_id: 'TSK-42', tenant_id: 'tenant-a', title: 'Wire task detail', priority: 'P1', current_stage: 'IMPLEMENT', current_owner: 'engineer', blocked: true, waiting_state: 'pm_decision', next_required_action: 'Await PM decision', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' }, status_indicator: 'fresh', closed: false,
    } });
  });

  await page.route('**/api/tasks/TSK-42/detail**', async (route) => {
    await route.fulfill({ json: taskDetailPayload });
  });

  await page.route('**/api/tasks/TSK-42/history**', async (route) => {
    await route.fulfill({ json: { items: [
      { item_id: 'evt-1', event_type: 'task.created', event_type_label: 'Task created', occurred_at: '2026-04-01T14:55:00.000Z', actor: { actor_id: 'pm-1', display_name: 'PM 1' }, display: { summary: 'Task created' }, sequence_number: 1, source: 'audit-api' },
      { item_id: 'evt-2', event_type: 'task.assigned', event_type_label: 'Task assigned', occurred_at: '2026-04-01T14:58:00.000Z', actor: { actor_id: 'engineer', display_name: 'Engineer 1' }, display: { summary: 'Owner assigned' }, sequence_number: 2, source: 'audit-api' },
    ], page_info: { next_cursor: null } } });
  });

  await page.route('**/api/tasks/TSK-42/observability-summary', async (route) => {
    await route.fulfill({ json: { status: 'ok', degraded: false, stale: false, event_count: 2, last_updated_at: '2026-04-01T15:00:00.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' }, correlation: { approved_correlation_ids: ['corr-1'] }, access: { restricted: false, omission_applied: false, omitted_fields: [] } } });
  });

  await page.route('**/api/ai-agents', async (route) => {
    await route.fulfill({ json: { items: [
      { id: 'architect', display_name: 'Architect', role: 'Architect', active: true },
      { id: 'qa', display_name: 'QA Engineer', role: 'QA', active: true },
      { id: 'engineer', display_name: 'Engineer', role: 'Engineering', active: true },
    ] } });
  });
}

async function openRoute(page, route: string, expectedHeading: string | null = 'Wire task detail') {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  if (expectedHeading) {
    await expect(page.getByRole('heading', { name: expectedHeading })).toBeVisible();
  }
}

test.describe('task detail browser verification', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test('keeps blocker and first-screen summary content visible on tablet without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 900 });
    await openRoute(page, '/tasks/TSK-42');

    await expect(page.getByRole('alert')).toContainText('Awaiting security sign-off');
    await expect(page.getByRole('region', { name: 'Task summary' })).toContainText('Await PM decision');

    const viewport = page.viewportSize();
    const summaryLayout = await page.locator('.summary-grid--hero').evaluate((node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        columns: style.gridTemplateColumns,
        width: rect.width,
        scrollWidth: node.scrollWidth,
        left: rect.left,
        right: rect.right,
      };
    });

    expect(summaryLayout.columns.split(' ').length).toBeGreaterThan(1);
    expect(summaryLayout.scrollWidth).toBeLessThanOrEqual(Math.ceil(summaryLayout.width) + 1);
    expect(summaryLayout.left).toBeGreaterThanOrEqual(0);
    expect(summaryLayout.right).toBeLessThanOrEqual((viewport?.width ?? 834) + 1);
  });

  test('switches task activity tabs into the mobile two-column pattern and preserves usable controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRoute(page, '/tasks/TSK-42');

    await expect(page.getByRole('tablist', { name: 'Task activity views' })).toBeVisible();
    const tabLayout = await page.getByRole('tablist', { name: 'Task activity views' }).evaluate((node) => {
      const style = window.getComputedStyle(node);
      return {
        display: style.display,
        columns: style.gridTemplateColumns,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      };
    });

    expect(tabLayout.display).toBe('grid');
    expect(tabLayout.columns.split(' ').length).toBe(2);
    expect(tabLayout.scrollWidth).toBeLessThanOrEqual(tabLayout.clientWidth + 1);

    await page.getByRole('tab', { name: 'Telemetry' }).click();
    await expect(page.getByRole('region', { name: 'Telemetry summary' }).getByText('Freshness', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByLabel('History filters')).toBeVisible();
  });

  test('keeps owner metadata readable in the mobile board view', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openRoute(page, '/tasks?view=board', null);

    await expect(page.getByLabel('Task board')).toBeVisible();
    const ownerBadge = page.getByTitle('Owner hidden');
    await expect(ownerBadge).toBeVisible();
    await expect(ownerBadge).toContainText('Owner hidden');

    const badgeLayout = await ownerBadge.evaluate((node) => {
      const style = window.getComputedStyle(node);
      return {
        textAlign: style.textAlign,
        width: node.getBoundingClientRect().width,
        scrollWidth: node.scrollWidth,
      };
    });

    expect(badgeLayout.textAlign).toBe('left');
    expect(badgeLayout.scrollWidth).toBeLessThanOrEqual(Math.ceil(badgeLayout.width) + 1);
  });

  test('meets a local browser render budget stronger than request-count smoke alone', async ({ page }) => {
    test.skip(test.info().project.name === 'firefox', 'Firefox paint/navigation timing differs enough that this local budget is currently Chromium-based.');

    await page.setViewportSize({ width: 1280, height: 900 });
    const startedAt = Date.now();
    await openRoute(page, '/tasks/TSK-42');
    await expect(page.getByRole('region', { name: 'Task summary' })).toContainText('Engineer');
    const renderDurationMs = Date.now() - startedAt;

    const timings = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return {
        domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
        loadEventEnd: nav?.loadEventEnd ?? null,
      };
    });

    expect(renderDurationMs).toBeLessThan(1500);
    expect(timings.domContentLoaded).not.toBeNull();
    expect((timings.domContentLoaded ?? 0)).toBeLessThan(1000);

    const perfMarks = await page.evaluate(() => {
      const paints = performance.getEntriesByType('paint');
      return Object.fromEntries(paints.map((entry) => [entry.name, entry.startTime]));
    });

    expect(Number(perfMarks['first-contentful-paint'] ?? 0)).toBeLessThan(1000);
  });

  test('preserves task-detail structure across supported browser engines', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox', 'Cross-engine assertion is targeted at the non-Chromium coverage path.');

    await page.setViewportSize({ width: 1280, height: 900 });
    await openRoute(page, '/tasks/TSK-42');

    await expect(page.getByRole('region', { name: 'Task summary' })).toContainText('Engineer');
    await expect(page.getByRole('alert')).toContainText('Awaiting security sign-off');
    await expect(page.getByRole('tablist', { name: 'Task activity views' })).toBeVisible();
    await page.getByRole('tab', { name: 'Telemetry' }).click();
    await expect(page.getByRole('region', { name: 'Telemetry summary' })).toContainText('Freshness');
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByLabel('Task history timeline')).toBeVisible();
  });

  test('supports keyboard-first navigation to blockers and activity tabs on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRoute(page, '/tasks/TSK-42');

    const blocker = page.getByRole('alert');
    await blocker.scrollIntoViewIfNeeded();
    await expect(blocker).toContainText('Awaiting security sign-off');

    const historyTab = page.getByRole('tab', { name: 'History' });
    const telemetryTab = page.getByRole('tab', { name: 'Telemetry' });
    await historyTab.focus();
    await expect(historyTab).toBeFocused();
    await expect(historyTab).toHaveAttribute('tabindex', '0');
    await expect(telemetryTab).toHaveAttribute('tabindex', '-1');

    await page.keyboard.press('ArrowRight');
    await expect(telemetryTab).toBeFocused();
    await expect(telemetryTab).toHaveAttribute('tabindex', '0');
    await expect(historyTab).toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'task-activity-tab-telemetry');
    await expect(page.getByRole('region', { name: 'Telemetry summary' }).getByText('Freshness', { exact: true })).toBeVisible();
  });

  test('captures task-detail screenshots across responsive breakpoints for review artifacts', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openRoute(page, '/tasks/TSK-42');
    const desktopShot = await page.screenshot({ path: testInfo.outputPath('task-detail-desktop.png') });

    await page.setViewportSize({ width: 834, height: 900 });
    const tabletShot = await page.screenshot({ path: testInfo.outputPath('task-detail-tablet.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileShot = await page.screenshot({ path: testInfo.outputPath('task-detail-mobile.png') });

    expect(desktopShot.byteLength).toBeGreaterThan(10_000);
    expect(tabletShot.byteLength).toBeGreaterThan(10_000);
    expect(mobileShot.byteLength).toBeGreaterThan(10_000);
  });
});
