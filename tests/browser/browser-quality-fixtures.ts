import { expect, type Locator, type Page } from '@playwright/test';

export const SESSION_STORAGE_KEY = 'engineering-team.task-browser-session';
export const DISCOVERY_URL = 'https://idp.example/.well-known/openid-configuration';
export const AUTHORIZE_URL = 'https://idp.example/oauth2/authorize';
export const TOKEN_URL = 'https://idp.example/oauth2/token';

const agents = [
  { id: 'pm', display_name: 'PM', role: 'PM', active: true },
  { id: 'architect', display_name: 'Architect', role: 'Architect', active: true },
  { id: 'engineer', display_name: 'Engineer', role: 'Engineering', active: true },
  { id: 'qa', display_name: 'QA Engineer', role: 'QA', active: true },
  { id: 'sre', display_name: 'SRE', role: 'SRE', active: true },
];

const tasks = [
  taskSummary('TSK-DRAFT', 'Shape raw operator notes', 'DRAFT', 'pm', 'PM', {
    priority: null,
    intake_draft: true,
    waiting_state: 'task_refinement',
    next_required_action: 'PM refinement required',
  }),
  taskSummary('TSK-42', 'Wire task detail', 'IMPLEMENT', 'engineer', 'Engineer', {
    priority: 'P1',
    next_required_action: 'Ship browser quality gates',
  }),
  taskSummary('TSK-QA', 'Verify accessibility gates', 'VERIFY', 'qa', 'QA Engineer', {
    priority: 'P1',
    next_required_action: 'QA verification required',
  }),
  taskSummary('TSK-SRE', 'Observe browser quality telemetry', 'SRE_MONITORING', 'sre', 'SRE', {
    priority: 'P2',
    next_required_action: 'SRE monitoring validation is required.',
  }),
  {
    task_id: 'TSK-PM',
    tenant_id: 'tenant-a',
    title: 'Triage cross-browser rollout',
    priority: 'P2',
    current_stage: 'TODO',
    current_owner: null,
    owner: null,
    blocked: false,
    closed: false,
    waiting_state: 'awaiting_pm_decision',
    next_required_action: 'PM triage required',
    queue_entered_at: '2026-05-05T12:04:00.000Z',
    freshness: { status: 'fresh', last_updated_at: '2026-05-05T12:04:00.000Z' },
  },
];

function taskSummary(
  id: string,
  title: string,
  stage: string,
  ownerId: string,
  ownerLabel: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    task_id: id,
    tenant_id: 'tenant-a',
    title,
    priority: 'P2',
    current_stage: stage,
    current_owner: ownerId,
    owner: { actor_id: ownerId, display_name: ownerLabel },
    blocked: false,
    closed: false,
    waiting_state: null,
    next_required_action: null,
    queue_entered_at: '2026-05-05T12:00:00.000Z',
    freshness: { status: 'fresh', last_updated_at: '2026-05-05T12:00:00.000Z' },
    ...overrides,
  };
}

function encodeClaims(claims: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(claims)).toString('base64url');
}

function buildBearerToken(overrides: Record<string, unknown> = {}) {
  const payload = encodeClaims({
    sub: 'pm-1',
    tenant_id: 'tenant-a',
    roles: ['pm', 'reader'],
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  });
  return `header.${payload}.signature`;
}

export async function installBrowserQualityApp(
  page: Page,
  options: { session?: boolean; roles?: string[] } = {},
) {
  await installRuntimeConfig(page);
  if (options.session !== false) {
    await installSession(page, options.roles || ['pm', 'reader']);
  }
  await routeAuth(page);
  await routeAgents(page);
  await routeTaskList(page);
  await routeTaskDetail(page);
  await routeCreatedTask(page);
}

async function installRuntimeConfig(page: Page) {
  await page.addInitScript(
    ({ discoveryUrl, clientId, redirectUri }) => {
      window.__ENGINEERING_TEAM_RUNTIME_CONFIG__ = {
        oidcDiscoveryUrl: discoveryUrl,
        oidcClientId: clientId,
        oidcRedirectUri: redirectUri,
        internalAuthBootstrapEnabled: true,
      };
    },
    {
      discoveryUrl: DISCOVERY_URL,
      clientId: 'browser-quality-client',
      redirectUri: 'http://127.0.0.1:4174/auth/callback',
    },
  );
}

async function installSession(page: Page, roles: string[]) {
  const token = buildBearerToken({ roles });
  await page.addInitScript(
    ({ sessionKey, sessionToken }) => {
      window.sessionStorage.setItem(
        sessionKey,
        JSON.stringify({
          bearerToken: sessionToken,
          apiBaseUrl: '/api',
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        }),
      );
    },
    { sessionKey: SESSION_STORAGE_KEY, sessionToken: token },
  );
}

async function routeAuth(page: Page) {
  await page.route(DISCOVERY_URL, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      json: { authorization_endpoint: AUTHORIZE_URL, token_endpoint: TOKEN_URL },
    });
  });
  await page.route('**/auth/session', async (route) => {
    await route.fulfill({
      json: {
        success: true,
        data: {
          accessToken: buildBearerToken(),
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
          claims: { tenant_id: 'tenant-a', actor_id: 'pm-1', roles: ['pm', 'reader'] },
        },
      },
    });
  });
}

async function routeAgents(page: Page) {
  await page.route('**/api/ai-agents', async (route) => {
    await route.fulfill({ json: { items: agents } });
  });
}

async function routeTaskList(page: Page) {
  const createState = { title: 'Browser quality intake', requirements: '' };
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { items: tasks } });
      return;
    }
    const payload = await route.request().postDataJSON();
    createState.title = String(payload?.title || createState.title);
    createState.requirements = String(payload?.raw_requirements || '');
    await route.fulfill({
      status: 201,
      json: {
        taskId: 'TSK-UX',
        title: createState.title,
        status: 'DRAFT',
        intakeDraft: true,
        nextRequiredAction: 'PM refinement required',
      },
    });
  });
}

async function routeTaskDetail(page: Page) {
  await page.route('**/api/tasks/TSK-42/detail**', async (route) => {
    await route.fulfill({ json: taskDetailPayload('Wire task detail') });
  });
  await page.route('**/api/tasks/TSK-42/history**', async (route) => {
    await route.fulfill({ json: historyPayload() });
  });
  await page.route('**/api/tasks/TSK-42/observability-summary', async (route) => {
    await route.fulfill({ json: observabilityPayload() });
  });
  await page.route('**/api/tasks/TSK-42', async (route) => {
    await route.fulfill({ json: tasks.find((task) => task.task_id === 'TSK-42') });
  });
}

async function routeCreatedTask(page: Page) {
  await page.route('**/api/tasks/TSK-UX/detail**', async (route) => {
    await route.fulfill({ json: taskDetailPayload('Browser quality intake', true) });
  });
  await page.route('**/api/tasks/TSK-UX/history**', async (route) => {
    await route.fulfill({ json: { items: [], page_info: { next_cursor: null } } });
  });
  await page.route('**/api/tasks/TSK-UX/observability-summary', async (route) => {
    await route.fulfill({ json: observabilityPayload(0) });
  });
  await page.route('**/api/tasks/TSK-UX', async (route) => {
    await route.fulfill({
      json: taskSummary('TSK-UX', 'Browser quality intake', 'DRAFT', 'pm', 'PM', {
        priority: null,
        intake_draft: true,
        waiting_state: 'task_refinement',
        next_required_action: 'PM refinement required',
      }),
    });
  });
}

function taskDetailPayload(title: string, intakeDraft = false) {
  return {
    task: { id: intakeDraft ? 'TSK-UX' : 'TSK-42', title, priority: 'P1', stage: 'IMPLEMENT', status: 'active' },
    summary: taskDetailSummary(intakeDraft),
    blockers: [],
    context: taskDetailContext(intakeDraft),
    relations: { linkedPrs: [], childTasks: [] },
    activity: taskDetailActivity(),
    telemetry: taskDetailTelemetry(),
    orchestration: null,
    meta: taskDetailMeta(),
  };
}

function taskDetailSummary(intakeDraft: boolean) {
  return {
    owner: { id: 'engineer', label: 'Engineer', kind: 'assigned' },
    workflowStage: { value: intakeDraft ? 'DRAFT' : 'IMPLEMENT', label: intakeDraft ? 'Draft' : 'Implement' },
    nextAction: { label: intakeDraft ? 'PM refinement required' : 'Ship browser quality gates', source: 'system' },
    prStatus: { label: 'No linked PRs', state: 'empty', total: 0, openCount: 0, mergedCount: 0, draftCount: 0 },
    childStatus: { label: 'No child tasks', state: 'empty', total: 0, blockedCount: 0 },
    timers: { queueAgeLabel: '5m', lastUpdatedAt: '2026-05-05T12:00:00.000Z', freshness: 'fresh' },
    blockedState: { isBlocked: false, label: 'Ready', waitingOn: null },
  };
}

function taskDetailContext(intakeDraft: boolean) {
  return {
    intakeDraft,
    operatorIntakeRequirements: intakeDraft ? 'Raw operator request from the browser quality gate.' : null,
    businessContext: 'Make browser quality gates visible before merge.',
    acceptanceCriteria: ['Critical routes have visual, accessibility, and performance gates.'],
    definitionOfDone: ['Browser quality gates pass in CI with artifacts.'],
    technicalSpec: 'Playwright drives deterministic fixture routes against the Vite preview.',
    monitoringSpec: 'Core Web Vitals budgets are attached as browser test artifacts.',
  };
}

function taskDetailActivity() {
  return {
    comments: [{ id: 'c-1', actor: { label: 'QA' }, summary: 'Expand browser verification coverage.' }],
    auditLog: [{
      id: 'evt-1',
      type: 'task.created',
      summary: 'Task created',
      actor: { id: 'pm-1', label: 'PM' },
      occurredAt: '2026-05-05T11:55:00.000Z',
    }],
    auditLogPageInfo: { limit: 25, next_cursor: null, has_more: false },
  };
}

function taskDetailTelemetry() {
  return {
    availability: 'available',
    lastUpdatedAt: '2026-05-05T12:00:00.000Z',
    summary: { eventCount: 2 },
    emptyStateReason: null,
    access: { restricted: false, omission_applied: false, omitted_fields: [] },
  };
}

function taskDetailMeta() {
  return {
    permissions: {
      canViewComments: true,
      canViewAuditLog: true,
      canViewTelemetry: true,
      canViewChildTasks: true,
      canViewLinkedPrMetadata: true,
      canViewOrchestration: false,
    },
    freshness: { status: 'fresh', lastUpdatedAt: '2026-05-05T12:00:00.000Z' },
  };
}

function historyPayload() {
  return {
    items: [
      {
        item_id: 'evt-1',
        event_type: 'task.created',
        event_type_label: 'Task created',
        occurred_at: '2026-05-05T11:55:00.000Z',
        actor: { actor_id: 'pm-1', display_name: 'PM' },
        display: { summary: 'Task created' },
        sequence_number: 1,
        source: 'audit-api',
      },
    ],
    page_info: { next_cursor: null },
  };
}

function observabilityPayload(eventCount = 2) {
  return {
    status: 'ok',
    degraded: false,
    stale: false,
    event_count: eventCount,
    last_updated_at: '2026-05-05T12:00:00.000Z',
    freshness: { status: 'fresh', last_updated_at: '2026-05-05T12:00:00.000Z' },
    correlation: { approved_correlation_ids: ['browser-quality-gate'] },
    access: { restricted: false, omission_applied: false, omitted_fields: [] },
  };
}

export async function stabilizeVisualState(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        caret-color: transparent !important;
        font-family: Arial, sans-serif !important;
        transition-duration: 0s !important;
      }
    `,
  });
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
}

export async function openNavigationIfCollapsed(page: Page) {
  const openButton = page.getByRole('button', { name: 'Open navigation' });
  if (await openButton.isVisible().catch(() => false)) {
    await openButton.click();
  }
}

export async function expectVisibleFocus(locator: Locator) {
  await expect(locator).toBeFocused();
  const visible = await locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return style.outlineStyle !== 'none'
      || style.boxShadow !== 'none'
      || style.borderColor !== 'rgba(0, 0, 0, 0)';
  });
  expect(visible).toBe(true);
}
