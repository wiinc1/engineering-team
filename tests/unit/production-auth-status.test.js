const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ISSUE_151_MIN_SMOKE_AT,
  validateMagicLinkEvidence,
  validateOidcEvidence,
  validateProductionAuthStatus,
  validateStatusDocs,
} = require('../../lib/auth/production-status');

function completeEvidence(overrides = {}) {
  return {
    generatedAt: '2026-05-07T12:00:00.000Z',
    baseUrl: 'https://app.example',
    deployment: {
      selectedAuthStrategy: 'magic-link',
      id: 'dpl_123',
      url: 'https://app.example',
      status: 'Ready',
      commitSha: 'abc1234',
      buildTimestamp: '2026-05-07T11:55:00.000Z',
      rollbackTarget: 'last-known-good-magic-link-config',
    },
    invitedEmailHash: 'hash-admin',
    unknownEmailHash: 'hash-unknown',
    consume: {
      status: 302,
      location: '/tasks',
      tokenHash: 'hash-token',
      sessionCookieSet: true,
      csrfCookieSet: true,
    },
    request: { status: 200, genericResponse: true },
    unknownEmail: { status: 200, genericResponse: true },
    session: {
      actorId: 'admin-1',
      tenantId: 'tenant-int',
      roles: ['admin', 'pm'],
      expiresAtPresent: true,
    },
    protectedRoutes: [{ route: '/tasks', status: 200, ok: true, redirectedToSignIn: false }],
    replay: { status: 302, rejected: true, locationClassification: 'replayed_magic_link' },
    logout: { status: 200, ok: true, clearsSessionCookie: true },
    afterLogout: { status: 401, authRejected: true },
    summary: {
      requestGeneric: true,
      consumeRedirected: true,
      sessionCookieSet: true,
      csrfCookieSet: true,
      meReturnedIdentity: true,
      protectedRoutesLoaded: true,
      logoutRevoked: true,
      unknownEmailGeneric: true,
      replayRejected: true,
      evidenceRedacted: true,
      passed: true,
    },
    ...overrides,
  };
}

function completeOidcEvidence(overrides = {}) {
  return {
    generatedAt: '2026-05-07T12:00:00.000Z',
    baseUrl: 'https://app.example',
    deployment: {
      selectedAuthStrategy: 'oidc',
      id: 'dpl_oidc',
      url: 'https://app.example',
      rollbackTarget: 'last-known-good-oidc-config',
    },
    oidc: {
      discoveryUrlHash: 'hash-discovery',
      clientIdHash: 'hash-client',
      redirectUri: 'https://app.example/auth/callback',
      logoutUrlConfigured: true,
    },
    accessTokenHash: 'hash-access-token',
    discovery: { ok: true, authorizationEndpointPresent: true, tokenEndpointPresent: true },
    hostedCallback: { status: 200, ok: true },
    session: {
      actorId: 'pm-1',
      tenantId: 'tenant-a',
      roles: ['pm', 'reader'],
      expiresAtPresent: true,
    },
    protectedRoutes: [{ route: '/tasks', status: 200, ok: true, redirectedToSignIn: false }],
    logout: { providerLogoutConfigured: true, appSignedOutRouteOk: true },
    summary: {
      discoveryLoaded: true,
      hostedCallbackRouteLoaded: true,
      meReturnedIdentity: true,
      protectedRoutesLoaded: true,
      logoutValidated: true,
      rollbackTargetPresent: true,
      evidenceRedacted: true,
      passed: true,
    },
    ...overrides,
  };
}

test('production auth status docs include canonical issue 151 references', () => {
  const result = validateStatusDocs();

  assert.equal(result.ok, true, result.failures.join('\n'));
});

test('complete issue 151 magic-link evidence passes validation', () => {
  const result = validateMagicLinkEvidence(completeEvidence());

  assert.equal(result.ok, true, result.failures.join('\n'));
});

test('complete issue 151 OIDC evidence passes validation when that strategy is selected', () => {
  const result = validateOidcEvidence(completeOidcEvidence());

  assert.equal(result.ok, true, result.failures.join('\n'));
});

test('issue 151 OIDC evidence requires fresh redacted rollback evidence', () => {
  const stale = validateOidcEvidence(completeOidcEvidence({ generatedAt: '2026-04-28T01:26:34.197Z' }));
  assert.equal(stale.ok, false);
  assert.match(stale.failures.join('\n'), /generatedAt/);

  const leaked = validateOidcEvidence(completeOidcEvidence({ leaked: 'access_token=raw-token' }));
  assert.equal(leaked.ok, false);
  assert.match(leaked.failures.join('\n'), /secret-bearing material/);
});

test('issue 151 magic-link evidence rejects stale or dry-run artifacts', () => {
  const stale = validateMagicLinkEvidence(completeEvidence({ generatedAt: '2026-04-28T01:26:34.197Z' }));
  assert.equal(stale.ok, false);
  assert.match(stale.failures.join('\n'), new RegExp(ISSUE_151_MIN_SMOKE_AT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const dryRun = validateMagicLinkEvidence(completeEvidence({ dryRun: true }));
  assert.equal(dryRun.ok, false);
  assert.match(dryRun.failures.join('\n'), /Dry-run evidence/);
});

test('issue 151 magic-link evidence requires deployment metadata and redaction', () => {
  const missingDeployment = validateMagicLinkEvidence(
    completeEvidence({ deployment: { selectedAuthStrategy: 'magic-link' } })
  );
  assert.equal(missingDeployment.ok, false);
  assert.match(missingDeployment.failures.join('\n'), /deployment URL or ID/);
  assert.match(missingDeployment.failures.join('\n'), /rollbackTarget/);

  const leaked = validateMagicLinkEvidence(
    completeEvidence({ leakedUrl: 'https://app.example/auth/magic-link/consume?token=raw-token' })
  );
  assert.equal(leaked.ok, false);
  assert.match(leaked.failures.join('\n'), /secret-bearing material/);
});

test('default production auth status check allows pending fresh evidence but require-complete blocks it', () => {
  const advisory = validateProductionAuthStatus();
  assert.equal(advisory.docs.ok, true);
  assert.equal(advisory.ok, true);

  const shipGate = validateProductionAuthStatus({ requireComplete: true });
  assert.equal(shipGate.ok, false);
  assert.equal(shipGate.evidence.ok, false);
});

test('production auth status check accepts absolute evidence paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-151-status-'));
  const evidencePath = path.join(dir, 'magic-link-production-smoke.json');
  fs.writeFileSync(evidencePath, `${JSON.stringify(completeEvidence())}\n`);

  const result = validateProductionAuthStatus({ evidencePath, requireComplete: true });

  assert.equal(result.ok, true, result.evidence.failures.join('\n'));
});
