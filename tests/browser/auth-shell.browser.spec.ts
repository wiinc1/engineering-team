// Golden-path local dev sign-in uses proxied same-origin /auth/* when VITE_TASK_API_BASE_URL is empty.
import { expect, test } from '@playwright/test';

const tasksFixture = {
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
const discoveryUrl = 'https://idp.example/.well-known/openid-configuration';
const authorizeUrl = 'https://idp.example/oauth2/authorize';
const tokenUrl = 'https://idp.example/oauth2/token';

function buildSessionClaims(overrides = {}) {
  return {
    sub: 'pm-1',
    tenant_id: 'tenant-a',
    roles: ['pm', 'reader'],
    exp: Math.floor(Date.now() / 1e3) + 3600,
    ...overrides,
  };
}

function buildBearerToken(overrides = {}) {
  const payload = Buffer.from(JSON.stringify(buildSessionClaims(overrides))).toString('base64url');
  return `header.${payload}.signature`;
}

async function mockOidcRoutes(page) {
  await page.route(discoveryUrl, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      json: { authorization_endpoint: authorizeUrl, token_endpoint: tokenUrl },
    });
  });
  await page.route(tokenUrl, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      json: { access_token: buildBearerToken(), expires_in: 3600, token_type: 'Bearer' },
    });
  });
}

async function mockInternalSessionRoute(page) {
  await page.route('**/auth/session', async (route) => {
    if (route.request().postDataJSON()?.authCode !== 'signed-browser-auth-code') {
      await route.fulfill({
        status: 401,
        json: { error: { code: 'invalid_auth_code', message: 'The sign-in code was rejected.' } },
      });
      return;
    }
    await route.fulfill({
      json: {
        success: true,
        data: {
          accessToken: buildBearerToken(),
          expiresAt: new Date(Date.now() + 3600 * 1e3).toISOString(),
          claims: { tenant_id: 'tenant-a', actor_id: 'pm-1', roles: ['pm', 'reader'] },
        },
      },
    });
  });
}

async function mockTaskRoutes(page) {
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: tasksFixture });
  });
}

async function mockAgentRoutes(page) {
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

async function mockAuthenticatedRoutes(page) {
  await mockOidcRoutes(page);
  await mockInternalSessionRoute(page);
  await mockTaskRoutes(page);
  await mockAgentRoutes(page);
}

const pendingAdminUser = {
  userId: 'user-pending',
  email: 'wiinc1@hotmail.com',
  tenantId: 'tenant-int',
  actorId: 'user-050da52cf762f914',
  roles: ['reader'],
  lastSignInAt: null,
};

async function addAdminSession(page) {
  const adminToken = buildBearerToken({ sub: 'admin-1', roles: ['admin', 'reader'] });
  await page.addInitScript((token) => {
    window.sessionStorage.setItem(
      'engineering-team.task-browser-session',
      JSON.stringify({
        bearerToken: token,
        apiBaseUrl: '/api',
        expiresAt: new Date(Date.now() + 3600 * 1e3).toISOString(),
      })
    );
  }, adminToken);
}

async function fulfillPendingUserAdminRoute(route, state) {
  const request = route.request();
  const url = request.url();

  if (request.method() === 'GET' && url.endsWith('/auth/users')) {
    await route.fulfill({
      json: { data: [{ ...pendingAdminUser, status: state.currentStatus }] },
    });
    return;
  }

  if (request.method() === 'PATCH' && url.endsWith('/auth/users/user-pending')) {
    const body = request.postDataJSON();
    state.patches.push(body);
    state.currentStatus = String(body?.status || state.currentStatus);
    await route.fulfill({ json: { success: true } });
    return;
  }

  await route.fallback();
}

async function mockPendingUserAdminRoutes(page) {
  const state = { currentStatus: 'pending_approval', patches: [] };
  await page.route('**/auth/users**', (route) => fulfillPendingUserAdminRoute(route, state));
  return state;
}

async function openNavigationIfCollapsed(page) {
  const openButton = page.getByRole('button', { name: 'Open navigation' });
  if (await openButton.isVisible().catch(() => false)) {
    await openButton.click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ discoveryUrl: runtimeDiscoveryUrl, clientId, redirectUri }) => {
      window.__ENGINEERING_TEAM_RUNTIME_CONFIG__ = {
        oidcDiscoveryUrl: runtimeDiscoveryUrl,
        oidcClientId: clientId,
        oidcRedirectUri: redirectUri,
        internalAuthBootstrapEnabled: true,
      };
    },
    {
      discoveryUrl,
      clientId: 'browser-client',
      redirectUri: 'http://127.0.0.1:4174/auth/callback',
    }
  );
  await mockAuthenticatedRoutes(page);
});

  test('redirects a protected deep link to sign-in and restores it after successful sign-in', async ({ page }) => {
    await page.goto('/tasks?view=board', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in to Engineering Team' })).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in\?/);
    await expect(page.getByRole('button', { name: 'Continue with enterprise sign-in' })).toBeVisible();
    await expect(page.getByLabel('Trusted auth code')).toBeEditable();

    await page.getByLabel('Trusted auth code').fill('signed-browser-auth-code');
    await page.getByLabel('API base URL').fill('/api');
    await page.getByRole('button', { name: 'Use internal bootstrap fallback' }).click();

    await expect(page.getByRole('heading', { name: 'Task workspace' })).toBeVisible();
    await expect(page).toHaveURL(/\/tasks\?view=board/);
    await openNavigationIfCollapsed(page);
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('searches the task workspace from the authenticated left rail', async ({ page }) => {
    await addAdminSession(page);

    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Task workspace' })).toBeVisible();
    await expect(page.getByText('Current session')).toHaveCount(0);
    await openNavigationIfCollapsed(page);

    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    const search = nav.getByRole('search', { name: 'Task search' });
    await expect(search.getByLabel('Search tasks')).toBeVisible();

    await search.getByLabel('Search tasks').fill('Wire');
    await search.getByRole('button', { name: 'Search' }).click();

    await expect(page).toHaveURL(/\/tasks\?search=Wire/);
    await expect(page.getByText('Wire task detail')).toBeVisible();
  });

  test('collapses and reopens the authenticated left rail', async ({ page }) => {
    await addAdminSession(page);
    await page.addInitScript(() => {
      window.localStorage.removeItem('engineering-team-nav-open');
    });

    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Task workspace' })).toBeVisible();
    await openNavigationIfCollapsed(page);

    const shell = page.locator('main.app-shell');
    const nav = page.locator('#primary-navigation');
    const collapseButton = page.getByRole('button', { name: 'Collapse navigation' });

    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    await expect(collapseButton).toHaveAttribute('aria-controls', 'primary-navigation');
    await expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    await expect(shell).not.toHaveClass(/app-shell--nav-collapsed/);

    await collapseButton.click();

    const openButton = page.getByRole('button', { name: 'Open navigation' });
    await expect(openButton).toHaveAttribute('aria-expanded', 'false');
    await expect(shell).toHaveClass(/app-shell--nav-collapsed/);
    await expect(nav).toHaveClass(/app-nav--collapsed/);
    await expect(nav).toHaveAttribute('aria-hidden', 'true');
    expect(await page.evaluate(() => window.localStorage.getItem('engineering-team-nav-open'))).toBe('false');

    const collapsedRail = page.getByRole('navigation', { name: 'Collapsed navigation' });
    await expect(collapsedRail).toBeVisible();
    await expect(collapsedRail.getByRole('button', { name: 'Kanban board' })).toHaveAttribute('aria-pressed', 'true');
    await expect(collapsedRail.getByRole('button', { name: 'Task workspace' })).toHaveAttribute('title', 'Task workspace');
    await expect(collapsedRail.getByRole('button', { name: 'Search tasks' }).locator('.app-nav-rail__icon svg')).toBeVisible();

    await collapsedRail.getByRole('button', { name: 'Task workspace' }).click();

    await expect(page).toHaveURL(/\/tasks\?view=list$/);
    await expect(shell).toHaveClass(/app-shell--nav-collapsed/);
    await expect(collapsedRail.getByRole('button', { name: 'Task workspace' })).toHaveAttribute('aria-pressed', 'true');

    await collapsedRail.getByRole('button', { name: 'Search tasks' }).click();

    await expect(page.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('navigation', { name: 'Collapsed navigation' })).toHaveCount(0);
    await expect(shell).not.toHaveClass(/app-shell--nav-collapsed/);
    await expect(nav).not.toHaveClass(/app-nav--collapsed/);
    expect(await page.evaluate(() => window.localStorage.getItem('engineering-team-nav-open'))).toBe('true');
  });

  test('shows a safe no-login-path configuration state when preview auth is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      window.__ENGINEERING_TEAM_RUNTIME_CONFIG__ = { internalAuthBootstrapEnabled: false };
    });

    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in to Engineering Team' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with enterprise sign-in' })).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('This deployment has no enabled sign-in method.');
    await expect(page.getByLabel('Trusted auth code')).toHaveCount(0);
  });

  test('routes an expired session back to sign-in with recovery copy', async ({ page }) => {
    await page.addInitScript(() => {
      const claims = {
        sub: 'pm-1',
        tenant_id: 'tenant-a',
        roles: ['pm', 'reader'],
        exp: Math.floor(Date.now() / 1e3) - 60,
      };
      const payload = btoa(JSON.stringify(claims))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
      window.sessionStorage.setItem(
        'engineering-team.task-browser-session',
        JSON.stringify({
          bearerToken: `header.${payload}.signature`,
          apiBaseUrl: '/api',
          expiresAt: new Date(Date.now() - 6e4).toISOString(),
        })
      );
    });

    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in to Engineering Team' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Your session expired. Sign in again to continue.');
  });

  test('restores a protected SRE inbox route after sign-in', async ({ page }) => {
    await page.goto('/inbox/sre', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in to Engineering Team' })).toBeVisible();

    await page.getByLabel('Trusted auth code').fill('signed-browser-auth-code');
    await page.getByLabel('API base URL').fill('/api');
    await page.getByRole('button', { name: 'Use internal bootstrap fallback' }).click();

    await expect(page.getByRole('heading', { name: 'SRE Inbox', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/inbox\/sre/);
    await expect(page.locator('.lede')).toContainText('Read-only monitoring inbox');
  });

  test('restores a protected human inbox route after sign-in', async ({ page }) => {
    await page.goto('/inbox/human', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in to Engineering Team' })).toBeVisible();

    await page.getByLabel('Trusted auth code').fill('signed-browser-auth-code');
    await page.getByLabel('API base URL').fill('/api');
    await page.getByRole('button', { name: 'Use internal bootstrap fallback' }).click();

    await expect(page.getByRole('heading', { name: 'Human Stakeholder inbox routing', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/inbox\/human/);
    await expect(page.locator('.role-inbox-toolbar__cue')).toContainText(
      'Decision-ready items appear here only when governed close review or escalation handling is explicitly waiting on a human stakeholder decision.'
    );
    await expect(page.locator('.role-inbox-toolbar__cue')).toContainText('Decision-ready');
  });

  test('renders the configured registration sign-in form', async ({ page }) => {
    await page.addInitScript(() => {
      window.__ENGINEERING_TEAM_RUNTIME_CONFIG__ = {
        productionAuthStrategy: 'registration',
        internalAuthBootstrapEnabled: false,
      };
    });

    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in to Engineering Team' })).toBeVisible();
    await expect(page.getByText('Access your task workspace and inboxes.')).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create an account' })).toBeVisible();
    await expect(page.getByLabel('API base URL')).toHaveCount(0);

    const styles = await page.locator('.auth-card').evaluate((node) => {
      const card = window.getComputedStyle(node);
      const shell = window.getComputedStyle(document.querySelector('.app-shell--auth'));
      const body = window.getComputedStyle(document.body);
      return {
        borderRadius: card.borderRadius,
        paddingTop: card.paddingTop,
        backgroundImage: card.backgroundImage,
        color: card.color,
        shellMaxWidth: shell.maxWidth,
        shellPaddingTop: shell.paddingTop,
        shellBackgroundImage: shell.backgroundImage,
        bodyBackgroundImage: body.backgroundImage,
        bodyColor: body.color,
      };
    });

    expect(styles.borderRadius).toBe('12px');
    expect(['18px', '24px']).toContain(styles.paddingTop);
    expect(styles.backgroundImage).toBe('none');
    expect(styles.color).toBe('rgb(15, 23, 42)');
    expect(styles.shellMaxWidth).toBe('1120px');
    expect(styles.shellPaddingTop).toBe('48px');
    expect(styles.shellBackgroundImage).toBe('none');
    expect(styles.bodyBackgroundImage).toBe('none');
    expect(styles.bodyColor).toBe('rgb(15, 23, 42)');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with enterprise sign-in' })).toHaveCount(0);
    await expect(page.getByLabel('Trusted auth code')).toHaveCount(0);
  });

  test('defaults Vercel preview runtime config to registration auth', async ({ page }) => {
    await page.addInitScript(() => {
      window.__ENGINEERING_TEAM_RUNTIME_CONFIG__ = {
        vercelEnv: 'preview',
        internalAuthBootstrapEnabled: true,
      };
    });

    await page.goto('/sign-in?next=%2F', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in to Engineering Team' })).toBeVisible();
    await expect(page.getByText('Access your task workspace and inboxes.')).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Trusted auth code')).toHaveCount(0);
    await expect(page.getByLabel('API base URL')).toHaveCount(0);
  });

  test('supports public signup with approval copy and reset modes', async ({ page }) => {
    await page.addInitScript(() => {
      window.__ENGINEERING_TEAM_RUNTIME_CONFIG__ = {
        productionAuthStrategy: 'registration',
        internalAuthBootstrapEnabled: false,
      };
    });

    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email address').fill('person@example.com');
    await page.getByRole('button', { name: 'Create an account' }).click();

    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(
      page.getByText('Create an account. An admin will approve access before you can use Engineering Team.')
    ).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveValue('person@example.com');
    await expect(page.getByText('At least 12 characters with one letter and one number.')).toBeVisible();
    await expect(page.getByLabel('Invite code')).toHaveCount(0);

    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to Engineering Team' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveValue('person@example.com');
    await expect(page.getByRole('button', { name: 'Create an account' })).toBeVisible();

    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveValue('person@example.com');
    await expect(page.getByRole('button', { name: 'Send reset instructions' })).toBeVisible();
  });

  test('keeps pending approval visible in user admin until explicitly approved', async ({ page }) => {
    await addAdminSession(page);
    const adminRoutes = await mockPendingUserAdminRoutes(page);

    await page.goto('/admin/users', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'User admin' })).toBeVisible();
    await expect(page.getByText('wiinc1@hotmail.com')).toBeVisible();
    await expect(page.getByLabel('Status for wiinc1@hotmail.com')).toHaveValue('pending_approval');

    const approveButton = page.getByRole('button', { name: 'Approve' });
    await expect(approveButton).toBeVisible();
    await approveButton.press('Enter');

    await expect(page.getByRole('status')).toContainText('User approved.');
    await expect(page.getByLabel('Status for wiinc1@hotmail.com')).toHaveValue('active');
    expect(adminRoutes.patches.at(-1)).toMatchObject({ status: 'active' });
  });

  test('completes an enterprise callback and restores the deep-linked board route', async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem(
        'engineering-team.oidc-transaction',
        JSON.stringify({
          state: 'callback-state',
          codeVerifier: 'callback-verifier',
          nonce: 'callback-nonce',
          next: '/tasks?view=board',
          apiBaseUrl: '/api',
        })
      );
    });

    await page.goto('/auth/callback?code=oidc-code&state=callback-state', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Task workspace' })).toBeVisible();
    await expect(page).toHaveURL(/\/tasks\?view=board/);
    await expect(page.getByRole('tab', { name: 'Kanban board' })).toHaveAttribute('aria-selected', 'true');
  });
