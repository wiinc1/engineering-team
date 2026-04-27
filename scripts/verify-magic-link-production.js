#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const GENERIC_MAGIC_LINK_MESSAGE = 'If the email is eligible, a sign-in link has been sent.';
const DEFAULT_EVIDENCE_PATH = 'observability/magic-link-production-smoke.json';

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function hashEvidence(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function normalizeBaseUrl(value) {
  const baseUrl = String(value || '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('AUTH_PROD_BASE_URL or --base-url is required');
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error('Production magic-link smoke requires an HTTPS base URL');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function buildUrl(baseUrl, route) {
  return new URL(route, `${baseUrl}/`).toString();
}

function splitSetCookie(headerValue) {
  return String(headerValue || '')
    .split(/,(?=\s*engineering_team_(?:session|csrf)=)/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  return splitSetCookie(headers.get('set-cookie'));
}

function cookieHeaderFromSetCookies(setCookies) {
  return setCookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

function readCookieValue(cookieHeader, name) {
  const prefix = `${name}=`;
  return String(cookieHeader || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) || '';
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
  if (!magicLinkUrl) throw new Error('AUTH_PROD_MAGIC_LINK_URL or --magic-link-url is required for consume phase');
  const parsed = new URL(magicLinkUrl);
  const tokenHash = hashEvidence(parsed.searchParams.get('token'));
  const response = await fetchImpl(parsed.toString(), { redirect: 'manual' });
  const setCookies = getSetCookies(response.headers);
  const cookieHeader = cookieHeaderFromSetCookies(setCookies);
  const csrfToken = decodeURIComponent(readCookieValue(cookieHeader, 'engineering_team_csrf'));
  return {
    status: response.status,
    location: response.headers.get('location') || '',
    tokenHash,
    cookieHeader,
    csrfToken,
    sessionCookieSet: setCookies.some((cookie) => cookie.startsWith('engineering_team_session=') && cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax')),
    csrfCookieSet: setCookies.some((cookie) => cookie.startsWith('engineering_team_csrf=') && cookie.includes('SameSite=Lax')),
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
    headers: {
      accept: 'application/json',
      cookie: cookieHeader,
      'x-csrf-token': csrfToken,
    },
  });
  return {
    status: response.status,
    ok: response.ok,
    clearsSessionCookie: getSetCookies(response.headers).some((cookie) => cookie.startsWith('engineering_team_session=') && cookie.includes('Max-Age=0')),
  };
}

async function verifyReplay({ magicLinkUrl, fetchImpl = fetch }) {
  if (!magicLinkUrl) return { skipped: true };
  const response = await fetchImpl(magicLinkUrl, { redirect: 'manual' });
  return {
    skipped: false,
    status: response.status,
    rejected: response.status >= 300 && response.status < 400 && String(response.headers.get('location') || '').includes('replayed_magic_link'),
    locationClassification: String(response.headers.get('location') || '').includes('replayed_magic_link') ? 'replayed_magic_link' : 'other',
  };
}

function parseProtectedRoutes(value) {
  const routes = String(value || '').split(',').map((route) => route.trim()).filter(Boolean);
  return routes.length ? routes : ['/tasks', '/tasks?view=board', '/overview/pm'];
}

function summarizeChecks(evidence) {
  const checks = {
    requestGeneric: evidence.request?.genericResponse === true,
    consumeRedirected: evidence.consume?.status >= 300 && evidence.consume?.status < 400,
    sessionCookieSet: evidence.consume?.sessionCookieSet === true,
    csrfCookieSet: evidence.consume?.csrfCookieSet === true,
    meReturnedIdentity: Boolean(evidence.session?.actorId && evidence.session?.tenantId && Array.isArray(evidence.session?.roles)),
    protectedRoutesLoaded: Array.isArray(evidence.protectedRoutes) && evidence.protectedRoutes.every((route) => route.ok && !route.redirectedToSignIn),
    logoutRevoked: evidence.logout?.ok === true && evidence.afterLogout?.authRejected === true,
    unknownEmailGeneric: evidence.unknownEmail?.genericResponse === true,
    replayRejected: evidence.replay?.rejected === true,
  };
  return {
    ...checks,
    passed: Object.values(checks).every(Boolean),
  };
}

function writeEvidence(filePath, evidence) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

function buildDryRunEvidence(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  return {
    generatedAt: new Date().toISOString(),
    dryRun: true,
    baseUrl,
    invitedEmailHash: hashEvidence(options.email),
    unknownEmailHash: hashEvidence(options.unknownEmail),
    taskDetailPath: options.taskDetailPath || null,
    protectedRoutes: parseProtectedRoutes(options.protectedRoutes),
    hasMagicLinkUrl: Boolean(options.magicLinkUrl),
    summary: {
      passed: true,
      networkSkipped: true,
      evidenceRedacted: true,
    },
    nextStep: 'Run without --dry-run against production after Vercel and Resend are ready.',
  };
}

async function runSmoke(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const evidence = {
    generatedAt: new Date().toISOString(),
    baseUrl,
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

  evidence.request = await requestMagicLink({
    baseUrl,
    email: options.email,
    next: options.next || '/tasks',
    fetchImpl: options.fetchImpl,
  });

  if (!options.magicLinkUrl) {
    evidence.nextStep = 'Paste the received magic-link URL into AUTH_PROD_MAGIC_LINK_URL or --magic-link-url and rerun this command.';
    evidence.summary = summarizeChecks(evidence);
    return evidence;
  }

  const consume = await consumeMagicLink({ magicLinkUrl: options.magicLinkUrl, fetchImpl: options.fetchImpl });
  evidence.consume = {
    status: consume.status,
    location: consume.location,
    tokenHash: consume.tokenHash,
    sessionCookieSet: consume.sessionCookieSet,
    csrfCookieSet: consume.csrfCookieSet,
  };

  const currentSession = await fetchJsonWithCookie({
    baseUrl,
    route: '/auth/me',
    cookieHeader: consume.cookieHeader,
    fetchImpl: options.fetchImpl,
  });
  evidence.session = currentSession.response.ok ? {
    actorId: currentSession.payload?.data?.actorId || null,
    tenantId: currentSession.payload?.data?.tenantId || null,
    roles: currentSession.payload?.data?.roles || [],
    expiresAtPresent: Boolean(currentSession.payload?.data?.expiresAt),
  } : {
    errorStatus: currentSession.response.status,
  };

  const protectedRoutes = parseProtectedRoutes(options.protectedRoutes);
  if (options.taskDetailPath) protectedRoutes.push(options.taskDetailPath);
  evidence.protectedRoutes = [];
  for (const route of protectedRoutes) {
    evidence.protectedRoutes.push(await verifyProtectedRoute({
      baseUrl,
      route,
      cookieHeader: consume.cookieHeader,
      fetchImpl: options.fetchImpl,
    }));
  }

  if (options.unknownEmail) {
    evidence.unknownEmail = await requestMagicLink({
      baseUrl,
      email: options.unknownEmail,
      next: '/tasks',
      fetchImpl: options.fetchImpl,
    });
  }

  evidence.replay = await verifyReplay({ magicLinkUrl: options.magicLinkUrl, fetchImpl: options.fetchImpl });
  evidence.logout = await logout({
    baseUrl,
    cookieHeader: consume.cookieHeader,
    csrfToken: consume.csrfToken,
    fetchImpl: options.fetchImpl,
  });

  const afterLogout = await fetchJsonWithCookie({
    baseUrl,
    route: '/auth/me',
    cookieHeader: consume.cookieHeader,
    fetchImpl: options.fetchImpl,
  });
  evidence.afterLogout = {
    status: afterLogout.response.status,
    authRejected: afterLogout.response.status === 401,
  };
  evidence.summary = summarizeChecks(evidence);
  return evidence;
}

async function main() {
  const options = {
    baseUrl: readArg('--base-url', process.env.AUTH_PROD_BASE_URL),
    email: readArg('--email', process.env.AUTH_PROD_INVITED_EMAIL),
    unknownEmail: readArg('--unknown-email', process.env.AUTH_PROD_UNKNOWN_EMAIL),
    magicLinkUrl: readArg('--magic-link-url', process.env.AUTH_PROD_MAGIC_LINK_URL),
    next: readArg('--next', process.env.AUTH_PROD_NEXT || '/tasks'),
    protectedRoutes: readArg('--protected-routes', process.env.AUTH_PROD_PROTECTED_ROUTES || ''),
    taskDetailPath: readArg('--task-detail-path', process.env.AUTH_PROD_TASK_DETAIL_PATH || ''),
  };
  const evidencePath = readArg('--evidence-out', process.env.AUTH_PROD_EVIDENCE_OUT || DEFAULT_EVIDENCE_PATH);
  const evidence = hasFlag('--dry-run') ? buildDryRunEvidence(options) : await runSmoke(options);
  writeEvidence(evidencePath, evidence);
  process.stdout.write(`${JSON.stringify({
    evidencePath,
    summary: evidence.summary,
    nextStep: evidence.nextStep || null,
    manualEvidenceRequired: evidence.manualEvidenceRequired,
  }, null, 2)}\n`);
  if (hasFlag('--require-complete') && !evidence.summary?.passed) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  GENERIC_MAGIC_LINK_MESSAGE,
  cookieHeaderFromSetCookies,
  buildDryRunEvidence,
  hashEvidence,
  normalizeBaseUrl,
  parseProtectedRoutes,
  runSmoke,
  summarizeChecks,
};
