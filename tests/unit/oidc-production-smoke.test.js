const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildDryRunOidcEvidence,
  buildOidcDeploymentEvidence,
  hashEvidence,
  runOidcSmoke,
  summarizeOidcChecks,
} = require('../../scripts/verify-oidc-production-smoke');

function jsonResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || null;
      },
    },
    json: async () => body,
  };
}

function createOidcFetch(requests) {
  const protectedUrls = new Set([
    'https://app.example/tasks',
    'https://app.example/tasks?view=board',
    'https://app.example/overview/pm',
  ]);

  return async function fetchImpl(url, init = {}) {
    const requestUrl = String(url);
    requests.push({ url: requestUrl, init });
    if (requestUrl === 'https://idp.example/.well-known/openid-configuration') {
      return jsonResponse({
        authorization_endpoint: 'https://idp.example/oauth2/authorize',
        token_endpoint: 'https://idp.example/oauth2/token',
        end_session_endpoint: 'https://idp.example/logout',
      });
    }
    if (requestUrl.startsWith('https://app.example/auth/callback')) return jsonResponse('<html />');
    if (requestUrl === 'https://app.example/auth/me') {
      return jsonResponse({
        data: {
          actorId: 'pm-1',
          tenantId: 'tenant-a',
          roles: ['pm', 'reader'],
          expiresAt: '2026-05-07T14:00:00.000Z',
        },
      });
    }
    if (protectedUrls.has(requestUrl)) return jsonResponse('<html />');
    if (requestUrl === 'https://app.example/sign-in?reason=signed_out') return jsonResponse('<html />');
    throw new Error(`Unexpected fetch ${requestUrl}`);
  };
}

function assertOidcEvidence(evidence) {
  assert.equal(evidence.summary.passed, true);
  assert.equal(evidence.summary.evidenceRedacted, true);
  assert.equal(evidence.deployment.selectedAuthStrategy, 'oidc');
  assert.equal(evidence.deployment.rollbackTarget, 'last-known-good-oidc-config');
  assert.equal(evidence.accessTokenHash, hashEvidence('raw-access-token'));
  assert.equal(JSON.stringify(evidence).includes('raw-access-token'), false);
  assert.equal(JSON.stringify(evidence).includes('client-secret'), false);
}

test('OIDC smoke deployment evidence records strategy metadata', () => {
  const evidence = buildOidcDeploymentEvidence({
    baseUrl: 'https://app.example',
    deploymentId: 'dpl_oidc',
    rollbackTarget: 'last-known-good-oidc-config',
  });

  assert.equal(evidence.selectedAuthStrategy, 'oidc');
  assert.equal(evidence.id, 'dpl_oidc');
  assert.equal(evidence.rollbackTarget, 'last-known-good-oidc-config');
});

test('OIDC smoke dry-run validates inputs without raw tokens', () => {
  const evidence = buildDryRunOidcEvidence({
    baseUrl: 'https://app.example',
    oidcDiscoveryUrl: 'https://idp.example/.well-known/openid-configuration',
    oidcClientId: 'browser-client',
    accessToken: 'raw-access-token',
    rollbackTarget: 'last-known-good-oidc-config',
  });

  assert.equal(evidence.dryRun, true);
  assert.equal(evidence.summary.networkSkipped, true);
  assert.equal(evidence.deployment.selectedAuthStrategy, 'oidc');
  assert.equal(JSON.stringify(evidence).includes('raw-access-token'), false);
});

test('OIDC summary requires discovery, callback, session, routes, logout, and rollback evidence', () => {
  const summary = summarizeOidcChecks({
    deployment: { rollbackTarget: 'last-known-good-oidc-config' },
    discovery: { ok: true, authorizationEndpointPresent: true, tokenEndpointPresent: true },
    hostedCallback: { ok: true },
    session: { actorId: 'pm-1', tenantId: 'tenant-a', roles: ['pm'] },
    protectedRoutes: [{ ok: true, redirectedToSignIn: false }],
    logout: { providerLogoutConfigured: true, appSignedOutRouteOk: true },
  });

  assert.equal(summary.passed, true);
  assert.equal(summary.evidenceRedacted, true);
});

test('OIDC smoke runner writes redacted evidence for the hosted sign-in path', async () => {
  const requests = [];
  const evidence = await runOidcSmoke({
    baseUrl: 'https://app.example',
    oidcDiscoveryUrl: 'https://idp.example/.well-known/openid-configuration',
    oidcClientId: 'browser-client',
    oidcLogoutUrl: 'https://idp.example/logout',
    accessToken: 'raw-access-token',
    deploymentId: 'dpl_oidc',
    rollbackTarget: 'last-known-good-oidc-config',
    fetchImpl: createOidcFetch(requests),
  });

  assertOidcEvidence(evidence);
  assert.ok(requests.some((request) => request.url === 'https://app.example/auth/me'));
  assert.ok(requests.some((request) => request.init.headers?.authorization));
});
