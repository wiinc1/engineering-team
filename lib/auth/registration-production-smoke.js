const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_EVIDENCE_PATH = 'observability/registration-auth-production-smoke.json';
const GENERIC_PASSWORD_RESET_MESSAGE = 'If the email is eligible, password reset instructions have been sent.';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function buildUrl(baseUrl, route) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}${route}`;
}

async function parseJson(response) {
  return response
    .json()
    .catch(() => ({}));
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers.get('set-cookie');
  if (!combined) return [];
  return combined.split(/,(?=\s*engineering_team_(?:session|csrf)=)/i).map((value) => value.trim());
}

function parseCookieValue(setCookies, name) {
  const prefix = `${name}=`;
  const cookie = setCookies.find((item) => item.startsWith(prefix));
  if (!cookie) return '';
  return decodeURIComponent(cookie.slice(prefix.length).split(';')[0] || '');
}

function cookieHeader(setCookies) {
  return setCookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

function responseStatus(response) {
  return { status: response.status, ok: response.ok };
}

function assertHttps(baseUrl, allowHttp = false) {
  const parsed = new URL(baseUrl);
  if (!allowHttp && parsed.protocol !== 'https:') {
    throw new Error('Production registration smoke requires an HTTPS base URL');
  }
}

function assertNoRawSecrets(evidence) {
  const serialized = JSON.stringify(evidence);
  for (const pattern of [
    /engineering_team_session=/i,
    /engineering_team_csrf=/i,
    /AUTH_PROD_REGISTRATION_PASSWORD/i,
    /AUTH_PROD_REGISTRATION_EMAIL/i,
    /"password"\s*:/i,
    /token=[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/i,
  ]) {
    if (pattern.test(serialized)) throw new Error(`Registration smoke evidence is not redacted: ${pattern}`);
  }
  return true;
}

async function runRegistrationProductionSmoke(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required to run registration production smoke');
  const baseUrl = String(options.baseUrl || process.env.AUTH_PROD_BASE_URL || '').trim();
  const email = String(options.email || process.env.AUTH_PROD_REGISTRATION_EMAIL || '').trim();
  const password = String(options.password || process.env.AUTH_PROD_REGISTRATION_PASSWORD || '');
  const resetEmail = String(options.resetEmail || process.env.AUTH_PROD_PASSWORD_RESET_EMAIL || email).trim();
  if (!baseUrl) throw new Error('AUTH_PROD_BASE_URL or --base-url is required');
  if (!email || !password) throw new Error('AUTH_PROD_REGISTRATION_EMAIL and AUTH_PROD_REGISTRATION_PASSWORD are required');
  assertHttps(baseUrl, !!options.allowHttp);

  const deployment = {
    selectedAuthStrategy: options.selectedAuthStrategy || process.env.AUTH_PROD_AUTH_STRATEGY || 'registration',
    id: options.deploymentId || process.env.VERCEL_DEPLOYMENT_ID || null,
    url: baseUrl,
    commitSha: options.commitSha || process.env.VERCEL_GIT_COMMIT_SHA || null,
    rollbackTarget: options.rollbackTarget || process.env.AUTH_PROD_ROLLBACK_TARGET || null,
  };

  const magicLinkResponse = await fetchImpl(buildUrl(baseUrl, '/auth/magic-link/request'), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  const loginResponse = await fetchImpl(buildUrl(baseUrl, '/auth/login'), {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, next: '/tasks' }),
  });
  const loginBody = await parseJson(loginResponse);
  const setCookies = getSetCookieHeaders(loginResponse.headers);
  const cookies = cookieHeader(setCookies);
  const csrfToken = parseCookieValue(setCookies, 'engineering_team_csrf');

  const meResponse = await fetchImpl(buildUrl(baseUrl, '/auth/me'), {
    method: 'GET',
    headers: { accept: 'application/json', cookie: cookies },
  });
  const meBody = await parseJson(meResponse);

  const protectedRoutes = [];
  for (const route of options.protectedRoutes || ['/tasks']) {
    const response = await fetchImpl(buildUrl(baseUrl, route), {
      method: 'GET',
      headers: { accept: 'text/html,application/json', cookie: cookies },
      redirect: 'manual',
    });
    protectedRoutes.push({
      route,
      status: response.status,
      ok: response.ok,
      redirectedToSignIn: String(response.headers.get('location') || '').includes('/sign-in'),
    });
  }

  const passwordResetResponse = await fetchImpl(buildUrl(baseUrl, '/auth/password-reset/request'), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ email: resetEmail }),
  });
  const passwordResetBody = await parseJson(passwordResetResponse);

  const logoutResponse = await fetchImpl(buildUrl(baseUrl, '/auth/logout'), {
    method: 'POST',
    headers: { accept: 'application/json', cookie: cookies, 'x-csrf-token': csrfToken },
  });

  const afterLogoutResponse = await fetchImpl(buildUrl(baseUrl, '/auth/me'), {
    method: 'GET',
    headers: { accept: 'application/json', cookie: cookies },
  });

  const evidence = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    deployment,
    registrationEmailHash: sha256(email.toLowerCase()),
    passwordResetEmailHash: sha256(resetEmail.toLowerCase()),
    magicLink: {
      requestStatus: magicLinkResponse.status,
      removed: magicLinkResponse.status === 410,
    },
    login: {
      ...responseStatus(loginResponse),
      sessionCookieSet: !!parseCookieValue(setCookies, 'engineering_team_session'),
      csrfCookieSet: !!csrfToken,
      next: loginBody?.data?.next || null,
    },
    session: {
      actorId: meBody?.data?.actorId || null,
      tenantId: meBody?.data?.tenantId || null,
      roles: meBody?.data?.roles || [],
      expiresAtPresent: !!meBody?.data?.expiresAt,
    },
    protectedRoutes,
    passwordResetRequest: {
      ...responseStatus(passwordResetResponse),
      genericResponse: passwordResetBody?.message === GENERIC_PASSWORD_RESET_MESSAGE,
    },
    logout: responseStatus(logoutResponse),
    afterLogout: {
      status: afterLogoutResponse.status,
      authRejected: afterLogoutResponse.status === 401,
    },
  };

  evidence.summary = {
    registrationStrategySelected: evidence.deployment.selectedAuthStrategy === 'registration',
    loginAccepted: evidence.login.status === 200 && evidence.login.ok,
    sessionCookieSet: evidence.login.sessionCookieSet,
    csrfCookieSet: evidence.login.csrfCookieSet,
    meReturnedIdentity: !!(evidence.session.actorId && evidence.session.tenantId),
    protectedRoutesLoaded: evidence.protectedRoutes.every((route) => route.ok && !route.redirectedToSignIn),
    passwordResetGeneric: evidence.passwordResetRequest.status === 200 && evidence.passwordResetRequest.genericResponse,
    logoutRevoked: evidence.logout.status === 200 && evidence.logout.ok,
    afterLogoutRejected: evidence.afterLogout.authRejected,
    magicLinkRemoved: evidence.magicLink.removed,
    rollbackTargetPresent: !!deployment.rollbackTarget,
    evidenceRedacted: true,
    passed: false,
  };
  evidence.summary.passed = Object.entries(evidence.summary)
    .filter(([key]) => key !== 'passed')
    .every(([, value]) => value === true);
  evidence.summary.evidenceRedacted = assertNoRawSecrets(evidence);

  if (options.writeEvidence !== false) {
    const outputPath = options.outputPath || process.env.AUTH_PROD_EVIDENCE_OUT || DEFAULT_EVIDENCE_PATH;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  }

  return evidence;
}

module.exports = {
  DEFAULT_EVIDENCE_PATH,
  GENERIC_PASSWORD_RESET_MESSAGE,
  runRegistrationProductionSmoke,
};
