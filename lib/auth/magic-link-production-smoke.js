const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const GENERIC_MAGIC_LINK_MESSAGE = 'If the email is eligible, a sign-in link has been sent.';
const DEFAULT_EVIDENCE_PATH = 'observability/magic-link-production-smoke.json';

function hashEvidence(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : null;
}

function normalizeBaseUrl(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('AUTH_PROD_BASE_URL or --base-url is required');
  const url = new URL(normalized);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('Production magic-link smoke requires an HTTPS base URL');
  }
  return url.toString().replace(/\/+$/, '');
}

function buildUrl(baseUrl, route) {
  return new URL(route, `${baseUrl}/`).toString();
}

function splitSetCookie(header) {
  return String(header || '')
    .split(/,(?=\s*engineering_team_(?:session|csrf)=)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function getSetCookies(headers) {
  return typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : splitSetCookie(headers.get('set-cookie'));
}

function cookieHeaderFromSetCookies(cookies) {
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

function readCookieValue(cookieHeader, name) {
  const prefix = `${name}=`;
  return (
    String(cookieHeader || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length) || ''
  );
}

function parseProtectedRoutes(value) {
  const routes = String(value || '')
    .split(',')
    .map((route) => route.trim())
    .filter(Boolean);
  return routes.length ? routes : ['/tasks', '/tasks?view=board', '/overview/pm'];
}

function buildDeploymentEvidence(options = {}) {
  return {
    selectedAuthStrategy: options.selectedAuthStrategy || 'magic-link',
    id: options.deploymentId || null,
    url: options.deploymentUrl || options.baseUrl || null,
    status: options.deploymentStatus || null,
    commitSha: options.commitSha || null,
    buildTimestamp: options.buildTimestamp || null,
    rollbackTarget: options.rollbackTarget || null,
  };
}

async function requestMagicLink({ baseUrl, email, next = '/tasks', fetchImpl = fetch }) {
  if (!email) throw new Error('AUTH_PROD_INVITED_EMAIL or --email is required for request phase');
  const response = await fetchImpl(buildUrl(baseUrl, '/auth/magic-link/request'), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ email, next }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`magic-link request failed with ${response.status}`);
  return {
    status: response.status,
    genericResponse: payload?.message === GENERIC_MAGIC_LINK_MESSAGE,
    message: payload?.message || '',
  };
}

async function consumeMagicLink({ magicLinkUrl, fetchImpl = fetch }) {
  if (!magicLinkUrl) {
    throw new Error('AUTH_PROD_MAGIC_LINK_URL or --magic-link-url is required for consume phase');
  }
  const url = new URL(magicLinkUrl);
  const tokenHash = hashEvidence(url.searchParams.get('token'));
  const response = await fetchImpl(url.toString(), { redirect: 'manual' });
  const setCookies = getSetCookies(response.headers);
  const cookieHeader = cookieHeaderFromSetCookies(setCookies);
  const csrfToken = decodeURIComponent(readCookieValue(cookieHeader, 'engineering_team_csrf'));
  return {
    status: response.status,
    location: response.headers.get('location') || '',
    tokenHash,
    cookieHeader,
    csrfToken,
    sessionCookieSet: setCookies.some(
      (cookie) =>
        cookie.startsWith('engineering_team_session=') &&
        cookie.includes('HttpOnly') &&
        cookie.includes('SameSite=Lax')
    ),
    csrfCookieSet: setCookies.some(
      (cookie) => cookie.startsWith('engineering_team_csrf=') && cookie.includes('SameSite=Lax')
    ),
  };
}

async function fetchJsonWithCookie({ baseUrl, route, cookieHeader, fetchImpl = fetch }) {
  const response = await fetchImpl(buildUrl(baseUrl, route), {
    headers: { accept: 'application/json', cookie: cookieHeader },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function verifyProtectedRoute({ baseUrl, route, cookieHeader, fetchImpl = fetch }) {
  const response = await fetchImpl(buildUrl(baseUrl, route), {
    headers: { cookie: cookieHeader },
    redirect: 'manual',
  });
  return {
    route,
    status: response.status,
    ok: response.status >= 200 && response.status < 400,
    redirectedToSignIn: String(response.headers.get('location') || '').includes('/sign-in'),
  };
}

async function logout({ baseUrl, cookieHeader, csrfToken, fetchImpl = fetch }) {
  const response = await fetchImpl(buildUrl(baseUrl, '/auth/logout'), {
    method: 'POST',
    headers: { accept: 'application/json', cookie: cookieHeader, 'x-csrf-token': csrfToken },
  });
  return {
    status: response.status,
    ok: response.ok,
    clearsSessionCookie: getSetCookies(response.headers).some(
      (cookie) => cookie.startsWith('engineering_team_session=') && cookie.includes('Max-Age=0')
    ),
  };
}

async function verifyReplay({ magicLinkUrl, fetchImpl = fetch }) {
  if (!magicLinkUrl) return { skipped: true };
  const response = await fetchImpl(magicLinkUrl, { redirect: 'manual' });
  const location = String(response.headers.get('location') || '');
  return {
    skipped: false,
    status: response.status,
    rejected: response.status >= 300 && response.status < 400 && location.includes('replayed_magic_link'),
    locationClassification: location.includes('replayed_magic_link') ? 'replayed_magic_link' : 'other',
  };
}

function summarizeChecks(evidence) {
  const checks = {
    requestGeneric: evidence.request?.genericResponse === true,
    consumeRedirected: evidence.consume?.status >= 300 && evidence.consume?.status < 400,
    sessionCookieSet: evidence.consume?.sessionCookieSet === true,
    csrfCookieSet: evidence.consume?.csrfCookieSet === true,
    meReturnedIdentity: !!(
      evidence.session?.actorId &&
      evidence.session?.tenantId &&
      Array.isArray(evidence.session?.roles)
    ),
    protectedRoutesLoaded:
      Array.isArray(evidence.protectedRoutes) &&
      evidence.protectedRoutes.every((route) => route.ok && !route.redirectedToSignIn),
    logoutRevoked: evidence.logout?.ok === true && evidence.afterLogout?.authRejected === true,
    unknownEmailGeneric: evidence.unknownEmail?.genericResponse === true,
    replayRejected: evidence.replay?.rejected === true,
    evidenceRedacted: true,
  };
  return { ...checks, passed: Object.values(checks).every(Boolean) };
}

function writeEvidence(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function buildDryRunEvidence(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  return {
    generatedAt: new Date().toISOString(),
    dryRun: true,
    baseUrl,
    deployment: buildDeploymentEvidence({ ...options, baseUrl }),
    invitedEmailHash: hashEvidence(options.email),
    unknownEmailHash: hashEvidence(options.unknownEmail),
    taskDetailPath: options.taskDetailPath || null,
    protectedRoutes: parseProtectedRoutes(options.protectedRoutes),
    hasMagicLinkUrl: !!options.magicLinkUrl,
    summary: { passed: true, networkSkipped: true, evidenceRedacted: true },
    nextStep: 'Run without --dry-run against production after Vercel and Resend are ready.',
  };
}

function createSmokeEvidence(baseUrl, options = {}) {
  return {
    generatedAt: new Date().toISOString(),
    baseUrl,
    deployment: buildDeploymentEvidence({ ...options, baseUrl }),
    invitedEmailHash: hashEvidence(options.email),
    unknownEmailHash: hashEvidence(options.unknownEmail),
    taskDetailPath: options.taskDetailPath || null,
    request: null,
    consume: null,
    session: null,
    protectedRoutes: [],
    logout: null,
    afterLogout: null,
    unknownEmail: null,
    replay: null,
    manualEvidenceRequired: [
      'Vercel production deployment READY',
      'Resend delivery event for the invited email',
      'Admin-created invited user exists in production',
      'Monitoring evidence contains counts/rates only and no tokens or secrets',
      'Rollback evidence identifies the last known-good deployment/config',
    ],
  };
}

function recordIncompleteLinkRequest(evidence) {
  evidence.nextStep =
    'Paste the received magic-link URL into AUTH_PROD_MAGIC_LINK_URL or --magic-link-url and rerun this command.';
  evidence.summary = summarizeChecks(evidence);
  return evidence;
}

async function recordConsumeEvidence(evidence, options = {}) {
  const consume = await consumeMagicLink({
    magicLinkUrl: options.magicLinkUrl,
    fetchImpl: options.fetchImpl,
  });
  evidence.consume = {
    status: consume.status,
    location: consume.location,
    tokenHash: consume.tokenHash,
    sessionCookieSet: consume.sessionCookieSet,
    csrfCookieSet: consume.csrfCookieSet,
  };
  return consume;
}

async function recordSessionEvidence(evidence, baseUrl, cookieHeader, fetchImpl) {
  const session = await fetchJsonWithCookie({
    baseUrl,
    route: '/auth/me',
    cookieHeader,
    fetchImpl,
  });
  evidence.session = session.response.ok
    ? {
        actorId: session.payload?.data?.actorId || null,
        tenantId: session.payload?.data?.tenantId || null,
        roles: session.payload?.data?.roles || [],
        expiresAtPresent: !!session.payload?.data?.expiresAt,
      }
    : { errorStatus: session.response.status };
}

async function recordProtectedRoutes(evidence, baseUrl, cookieHeader, options = {}) {
  const protectedRoutes = parseProtectedRoutes(options.protectedRoutes);
  if (options.taskDetailPath) protectedRoutes.push(options.taskDetailPath);
  for (const route of protectedRoutes) {
    evidence.protectedRoutes.push(
      await verifyProtectedRoute({
        baseUrl,
        route,
        cookieHeader,
        fetchImpl: options.fetchImpl,
      })
    );
  }
}

async function recordUnknownEmailAndReplay(evidence, baseUrl, options = {}) {
  if (options.unknownEmail) {
    evidence.unknownEmail = await requestMagicLink({
      baseUrl,
      email: options.unknownEmail,
      next: '/tasks',
      fetchImpl: options.fetchImpl,
    });
  }
  evidence.replay = await verifyReplay({
    magicLinkUrl: options.magicLinkUrl,
    fetchImpl: options.fetchImpl,
  });
}

async function recordLogoutEvidence(evidence, baseUrl, consume, fetchImpl) {
  evidence.logout = await logout({
    baseUrl,
    cookieHeader: consume.cookieHeader,
    csrfToken: consume.csrfToken,
    fetchImpl,
  });
  const afterLogout = await fetchJsonWithCookie({
    baseUrl,
    route: '/auth/me',
    cookieHeader: consume.cookieHeader,
    fetchImpl,
  });
  evidence.afterLogout = {
    status: afterLogout.response.status,
    authRejected: afterLogout.response.status === 401,
  };
}

async function runSmoke(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const evidence = createSmokeEvidence(baseUrl, options);
  evidence.request = await requestMagicLink({
    baseUrl,
    email: options.email,
    next: options.next || '/tasks',
    fetchImpl: options.fetchImpl,
  });

  if (!options.magicLinkUrl) return recordIncompleteLinkRequest(evidence);

  const consume = await recordConsumeEvidence(evidence, options);
  await recordSessionEvidence(evidence, baseUrl, consume.cookieHeader, options.fetchImpl);
  await recordProtectedRoutes(evidence, baseUrl, consume.cookieHeader, options);
  await recordUnknownEmailAndReplay(evidence, baseUrl, options);
  await recordLogoutEvidence(evidence, baseUrl, consume, options.fetchImpl);
  evidence.summary = summarizeChecks(evidence);
  return evidence;
}

module.exports = {
  DEFAULT_EVIDENCE_PATH,
  GENERIC_MAGIC_LINK_MESSAGE,
  buildDeploymentEvidence,
  buildDryRunEvidence,
  cookieHeaderFromSetCookies,
  hashEvidence,
  normalizeBaseUrl,
  parseProtectedRoutes,
  runSmoke,
  summarizeChecks,
  writeEvidence,
};
