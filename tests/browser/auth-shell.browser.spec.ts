import { expect, test } from '@playwright/test';

const taskListPayload = {
  items: [
    {
      task_id: 'TSK-42',
      tenant_id: 'tenant-a',
      title: 'Wire task detail',
      priority: 'P1',
      current_stage: 'IMPLEMENT',
      current_owner: 'engineer',
      owner: { actor_id: 'engineer', display_name: 'Engineer' },
      blocked: false,
      closed: false,
      waiting_state: null,
      next_required_action: null,
      queue_entered_at: '2026-04-01T15:00:00.000Z',
      freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' },
    },
  ],
};

async function installApiMocks(page) {
  await page.route('**/auth/session', async (route) => {
    const body = route.request().postDataJSON();
    if (body?.authCode !== 'signed-browser-auth-code') {
      await route.fulfill({
        status: 401,
        json: { error: { code: 'invalid_auth_code', message: 'The sign-in code was rejected.' } },
      });
      return;
    }

    const claims = {
      sub: 'pm-1',
      tenant_id: 'tenant-a',
      roles: ['pm', 'reader'],
      exp: Math.floor(Date.now() / 1000) + (60 * 60),
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');

    await route.fulfill({
      json: {
        success: true,
        data: {
          accessToken: `header.${payload}.signature`,
          expiresAt: new Date(Date.now() + (60 * 60 * 1000)).toISOString(),
          claims: {
            tenant_id: 'tenant-a',
            actor_id: 'pm-1',
            roles: ['pm', 'reader'],
          },
        },
      },
    });
  });

  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: taskListPayload });
  });

  await page.route('**/api/ai-agents', async (route) => {
    await route.fulfill({
      json: {
        items: [
          { id: 'architect', display_name: 'Architect', role: 'Architect', active: true },
          { id: 'qa', display_name: 'QA Engineer', role: 'QA', active: true },
          { id: 'engineer', display_name: 'Engineer', role: 'Engineering', active: true },
          { id: 'sre', display_name: 'SRE', role: 'SRE', active: true },
        ],
      },
    });
  });
}

// Governance note: browser-shell route or session changes should keep browser coverage updated in the same change set.

test.describe('authenticated browser app shell', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test('redirects a protected deep link to sign-in and restores it after successful sign-in', async ({ page }) => {
    await page.goto('/tasks?view=board', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in to the workflow app' })).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in\?/);
    await expect(page.getByLabel('Trusted auth code')).toBeEditable();

    await page.getByLabel('Trusted auth code').fill('signed-browser-auth-code');
    await page.getByLabel('API base URL').fill('/api');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'Task list' })).toBeVisible();
    await expect(page).toHaveURL(/\/tasks\?view=board/);
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('routes an expired session back to sign-in with recovery copy', async ({ page }) => {
    await page.addInitScript(() => {
      const claims = {
        sub: 'pm-1',
        tenant_id: 'tenant-a',
        roles: ['pm', 'reader'],
        exp: Math.floor(Date.now() / 1000) - 60,
      };
      const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      window.sessionStorage.setItem(
        'engineering-team.task-browser-session',
        JSON.stringify({
          bearerToken: `header.${payload}.signature`,
          apiBaseUrl: '/api',
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      );
    });

    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in to the workflow app' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Your session expired. Sign in again to continue.');
  });

  test('restores a protected SRE inbox route after sign-in', async ({ page }) => {
    await page.goto('/inbox/sre', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in to the workflow app' })).toBeVisible();

    await page.getByLabel('Trusted auth code').fill('signed-browser-auth-code');
    await page.getByLabel('API base URL').fill('/api');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'SRE Inbox', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/inbox\/sre/);
    await expect(page.locator('.lede')).toContainText('Read-only monitoring inbox');
  });

  test('restores a protected human inbox route after sign-in', async ({ page }) => {
    await page.goto('/inbox/human', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in to the workflow app' })).toBeVisible();

    await page.getByLabel('Trusted auth code').fill('signed-browser-auth-code');
    await page.getByLabel('API base URL').fill('/api');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'Human Stakeholder inbox routing', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/inbox\/human/);
    await expect(page.locator('.role-inbox-toolbar__cue')).toContainText('Decision-ready items appear here only when governed close review or escalation handling is explicitly waiting on a human stakeholder decision.');
  });
});
