import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = process.cwd();

const TASK_ITEMS = [
  {
    task_id: 'TSK-42',
    tenant_id: 'tenant-a',
    title: 'Wire task detail',
    priority: 'P1',
    current_stage: 'TODO',
    current_owner: 'engineer',
    owner: { actor_id: 'engineer', display_name: 'Engineer' },
    blocked: false,
    closed: false,
    waiting_state: null,
    next_required_action: 'Implementation ready',
    queue_entered_at: '2026-04-01T15:00:00.000Z',
    freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' },
  },
  {
    task_id: 'TSK-43',
    tenant_id: 'tenant-a',
    title: 'Triage queue drift',
    priority: 'P2',
    current_stage: 'BACKLOG',
    current_owner: null,
    owner: null,
    blocked: false,
    closed: false,
    waiting_state: 'awaiting_pm_decision',
    next_required_action: 'PM triage required',
    queue_entered_at: '2026-04-01T15:01:00.000Z',
    freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:01:00.000Z' },
  },
];

function readCss(relativePath: string) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function withCss(template: string, css: string) {
  return template.split('/* CSS_PLACEHOLDER */').join(css);
}

const COMPONENT_SMOKE_HTML = `
  <html>
    <head>
      <style>/* CSS_PLACEHOLDER */</style>
      <style>
        body {
          margin: 0;
          padding: var(--design-spacing-6);
          background: var(--color-page-bg);
          color: var(--color-on-surface);
          font-family: var(--design-typography-body-md-font-family);
        }

        .visual-smoke {
          display: grid;
          gap: var(--design-spacing-6);
          max-width: 760px;
        }

        .button-row {
          display: flex;
          gap: var(--design-spacing-3);
          flex-wrap: wrap;
          padding: var(--design-spacing-4);
          background: var(--color-surface);
          border: var(--design-border-soft);
          border-radius: var(--design-radius-panel);
        }
      </style>
    </head>
    <body>
      <main class="visual-smoke">
        <section class="button-row" aria-label="Button states">
          <button class="button primary md">Primary</button>
          <button class="button secondary md">Secondary</button>
          <button class="button outline md">Outline</button>
          <button class="button destructive md">Destructive</button>
          <button class="button primary md disabled" disabled>Disabled</button>
        </section>

        <form class="form" aria-label="Task creation form token smoke">
          <div class="field">
            <label for="title">Title</label>
            <input id="title" value="Tokenized task intake" />
          </div>
          <div class="field">
            <label for="requirements">Requirements *</label>
            <textarea id="requirements">Capture the operator request and acceptance notes.</textarea>
            <p class="help">Include request, acceptance notes, links, risks, and known constraints.</p>
          </div>
          <ul class="validationErrors">
            <li>Example validation message</li>
          </ul>
          <p class="error">Example service error message</p>
          <div class="actions">
            <button class="button primary md" type="button">Create task draft</button>
          </div>
        </form>

        <section class="detail-card" aria-label="Flattened nested summary card smoke">
          <h2>Summary metrics</h2>
          <div class="summary-grid">
            <article data-testid="flattened-summary-card">
              <span>Open risks</span>
              <strong>2</strong>
            </article>
          </div>
        </section>
      </main>
    </body>
  </html>
`;

const TASK_CREATE_DARK_PAGE_HTML = `
  <html>
    <head>
      <style>/* CSS_PLACEHOLDER */</style>
      <style>
        body {
          margin: 0;
          background: var(--color-page-bg);
          color: var(--color-on-surface);
          font-family: var(--design-typography-body-md-font-family);
        }
      </style>
    </head>
    <body>
      <main class="app-shell">
        <section class="task-create-page" aria-labelledby="task-create-title">
          <div class="task-create-page__header">
            <p class="eyebrow">New task</p>
            <h1 id="task-create-title">Add a new task</h1>
            <p class="lede">Paste the raw request here to create a PM intake draft and route it into the task workflow.</p>
          </div>
          <form class="form" aria-label="Create task">
            <div class="field">
              <label for="task-title">Title</label>
              <input id="task-title" value="Dark title-first intake" />
            </div>
            <div class="field">
              <label for="task-requirements">Requirements *</label>
              <textarea id="task-requirements">Raw operator request from the design-token smoke.</textarea>
              <p class="help">Include request, acceptance notes, links, risks, and known constraints.</p>
            </div>
            <div class="actions">
              <button class="button primary md" type="button">Create task draft</button>
            </div>
          </form>
        </section>
      </main>
    </body>
  </html>
`;

const TASK_DETAIL_SMOKE_HTML = `
  <html>
    <head>
      <style>/* CSS_PLACEHOLDER */</style>
      <style>
        body {
          margin: 0;
          padding: var(--design-spacing-6);
          background: var(--color-page-bg);
          color: var(--color-on-surface);
          font-family: var(--design-typography-body-md-font-family);
        }

        .task-detail-smoke {
          max-width: 920px;
        }
      </style>
    </head>
    <body>
      <main class="task-detail-smoke">
        <section class="shell" aria-label="Task detail token smoke">
          <header class="header">
            <div class="titleBlock">
              <span class="eyebrow">Task activity</span>
              <h2 class="title">History and telemetry</h2>
              <p class="subtitle">History remains distinct from telemetry so operators can audit workflow state quickly.</p>
            </div>
            <div class="tabs" role="tablist" aria-label="Task activity views">
              <button class="tab tabActive" role="tab" aria-selected="true">History</button>
              <button class="tab" role="tab" aria-selected="false">Telemetry</button>
            </div>
          </header>
          <div class="panel">
            <section class="filters" aria-label="History filters">
              <label class="filterField">
                <span class="filterLabel">Event type</span>
                <input class="filterInput" value="assignment" />
              </label>
              <label class="filterField">
                <span class="filterLabel">Actor</span>
                <input class="filterInput" value="pm-1" />
              </label>
            </section>
            <section class="notice noticeWarning" role="status">
              <h3 class="noticeTitle">Partial data</h3>
              <p class="noticeBody">Telemetry freshness is degraded.</p>
              <p class="noticeDetail">Last updated 2026-04-01T15:00:00Z.</p>
            </section>
            <ol class="timeline">
              <li class="item">
                <div class="rail"><span class="dot tone_success"></span></div>
                <article class="card">
                  <div class="header">
                    <div>
                      <h3 class="title">Task assigned</h3>
                      <p class="meta">PM - 2026-04-01T15:00:00Z</p>
                    </div>
                  </div>
                  <p class="detail">Assigned to engineering for implementation.</p>
                  <dl class="metadata">
                    <div class="metadataItem">
                      <dt>Event</dt>
                      <dd>task.assigned</dd>
                    </div>
                    <div class="metadataItem">
                      <dt>Source</dt>
                      <dd>audit projection</dd>
                    </div>
                  </dl>
                </article>
              </li>
            </ol>
            <section class="grid" aria-label="Telemetry cards">
              <article class="card tone_info">
                <p class="label">Status</p>
                <p class="value">fresh</p>
                <p class="hint">Telemetry remains adjacent to the audit stream.</p>
              </article>
              <article class="card tone_warning">
                <p class="label">Event count</p>
                <p class="value">12</p>
                <p class="hint">Review linked correlations before release.</p>
              </article>
            </section>
            <section class="container" aria-label="Stage transition state">
              <div class="header">
                <span class="title">Workflow Transition</span>
                <span class="current-stage">TODO</span>
              </div>
              <div class="form">
                <label class="field">
                  <span class="label">Target Stage</span>
                  <input class="input" value="TECHNICAL_SPEC" />
                </label>
                <p class="error">Example transition validation error</p>
                <div class="actions">
                  <button type="button">Advance Stage</button>
                </div>
              </div>
            </section>
          </div>
        </section>
      </main>
    </body>
  </html>
`;

async function installPrimaryAppFixture(page) {
  await page.addInitScript(() => {
    const claims = {
      sub: 'pm-1',
      tenant_id: 'tenant-a',
      roles: ['pm', 'reader'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    window.sessionStorage.setItem(
      'engineering-team.task-browser-session',
      JSON.stringify({
        bearerToken: `header.${payload}.signature`,
        apiBaseUrl: '/api',
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      }),
    );
  });

  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: { items: TASK_ITEMS } });
  });

  await page.route('**/api/ai-agents', async (route) => {
    await route.fulfill({
      json: {
        items: [
          { id: 'engineer', display_name: 'Engineer', role: 'Engineering', active: true },
          { id: 'qa', display_name: 'QA Engineer', role: 'QA', active: true },
        ],
      },
    });
  });
}

test('captures primary app token output', async ({ page }, testInfo) => {
  await installPrimaryAppFixture(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();

  const appShot = await page.screenshot({ path: testInfo.outputPath('design-token-primary-app.png') });
  expect(appShot.byteLength).toBeGreaterThan(10_000);
});

test('captures migrated component states and flattened summary cards', async ({ page }, testInfo) => {
  const css = [
    readCss('src/app/design-tokens.css'),
    readCss('src/app/styles.css'),
    readCss('src/components/Button/Button.tokens.css'),
    readCss('src/components/Button/Button.module.css'),
    readCss('src/features/task-creation/TaskCreationForm.tokens.css'),
    readCss('src/features/task-creation/TaskCreationForm.module.css'),
  ].join('\n');

  await page.setContent(withCss(COMPONENT_SMOKE_HTML, css));

  const buttonShot = await page.getByLabel('Button states').screenshot({
    path: testInfo.outputPath('design-token-button-states.png'),
  });
  const formShot = await page.getByLabel('Task creation form token smoke').screenshot({
    path: testInfo.outputPath('design-token-task-creation-form.png'),
  });

  await expect(page.getByRole('button', { name: 'Primary' })).toHaveCSS('background-color', 'rgb(37, 87, 214)');
  await expect(page.getByRole('button', { name: 'Primary' })).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('button', { name: 'Disabled' })).toHaveCSS('opacity', '1');
  expect(buttonShot.byteLength).toBeGreaterThan(4_000);
  expect(formShot.byteLength).toBeGreaterThan(8_000);
  await expect(page.getByTestId('flattened-summary-card')).toHaveCSS('box-shadow', 'none');
});

test('captures dark task creation page tokens from app shell styles', async ({ page }, testInfo) => {
  const css = [
    readCss('src/app/design-tokens.css'),
    readCss('src/app/styles.css'),
    readCss('src/components/Button/Button.tokens.css'),
    readCss('src/components/Button/Button.module.css'),
    readCss('src/features/task-creation/TaskCreationForm.tokens.css'),
    readCss('src/features/task-creation/TaskCreationForm.module.css'),
  ].join('\n');

  await page.setViewportSize({ width: 960, height: 860 });
  await page.setContent(withCss(TASK_CREATE_DARK_PAGE_HTML, css));

  const pageSurface = page.locator('.task-create-page');
  const titleInput = page.getByLabel('Title');
  await expect(pageSurface).toHaveCSS('background-color', 'rgb(11, 16, 24)');
  await expect(pageSurface).toHaveCSS('color', 'rgb(248, 250, 252)');
  await expect(titleInput).toHaveCSS('background-color', 'rgb(15, 23, 42)');
  await expect(titleInput).toHaveCSS('border-color', 'rgb(43, 54, 72)');

  const darkPageShot = await pageSurface.screenshot({
    path: testInfo.outputPath('design-token-task-create-dark-page.png'),
  });
  expect(darkPageShot.byteLength).toBeGreaterThan(10_000);
});

test('captures responsive task detail token output', async ({ page }, testInfo) => {
  const taskDetailCss = [
    readCss('src/app/design-tokens.css'),
    readCss('src/features/task-detail/TaskDetail.tokens.css'),
    readCss('src/features/task-detail/TaskDetailActivityShell.module.css'),
    readCss('src/features/task-detail/TaskHistoryTimeline.module.css'),
    readCss('src/features/task-detail/TelemetrySummary.module.css'),
    readCss('src/features/task-detail/StageTransition.module.css'),
  ].join('\n');

  await page.setViewportSize({ width: 1024, height: 860 });
  await page.setContent(withCss(TASK_DETAIL_SMOKE_HTML, taskDetailCss));

  const detailShot = await page.getByLabel('Task detail token smoke').screenshot({
    path: testInfo.outputPath('design-token-task-detail-states.png'),
  });
  expect(detailShot.byteLength).toBeGreaterThan(12_000);
  await expect(page.getByRole('tab', { name: 'History' })).toHaveCSS('font-weight', '700');
  await expect(page.getByRole('button', { name: 'Advance Stage' })).toHaveCSS('background-color', 'rgb(30, 64, 175)');
  await expect(page.getByRole('button', { name: 'Advance Stage' })).toHaveCSS('color', 'rgb(255, 255, 255)');

  await page.setViewportSize({ width: 390, height: 900 });
  const mobileShot = await page.getByLabel('Task detail token smoke').screenshot({
    path: testInfo.outputPath('design-token-task-detail-mobile.png'),
  });
  expect(mobileShot.byteLength).toBeGreaterThan(10_000);
});
