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

test.describe('DESIGN.md token operationalization visual smoke', () => {
  test('captures primary app, Button states, and task creation form token output', async ({ page }, testInfo) => {
    await installPrimaryAppFixture(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Task workspace' })).toBeVisible();

    const appShot = await page.screenshot({ path: testInfo.outputPath('design-token-primary-app.png') });
    expect(appShot.byteLength).toBeGreaterThan(10_000);

    const css = [
      readCss('src/app/design-tokens.css'),
      readCss('src/components/Button/Button.tokens.css'),
      readCss('src/components/Button/Button.module.css'),
      readCss('src/features/task-creation/TaskCreationForm.tokens.css'),
      readCss('src/features/task-creation/TaskCreationForm.module.css'),
    ].join('\n');

    await page.setContent(`
      <html>
        <head>
          <style>${css}</style>
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
          </main>
        </body>
      </html>
    `);

    const buttonShot = await page.getByLabel('Button states').screenshot({
      path: testInfo.outputPath('design-token-button-states.png'),
    });
    const formShot = await page.getByLabel('Task creation form token smoke').screenshot({
      path: testInfo.outputPath('design-token-task-creation-form.png'),
    });

    expect(buttonShot.byteLength).toBeGreaterThan(4_000);
    expect(formShot.byteLength).toBeGreaterThan(8_000);
  });
});
