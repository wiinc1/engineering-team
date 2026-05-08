const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ISSUE_REGISTRATION_MIN_SMOKE_AT,
  validateMagicLinkEvidence,
  validateOidcEvidence,
  validateProductionAuthStatus,
  validateRegistrationEvidence,
  validateStatusDocs,
} = require('../../lib/auth/production-status');

function completeRegistrationEvidence(overrides = {}) {
  return {
    generatedAt: '2026-05-08T12:00:00.000Z',
    baseUrl: 'https://app.example',
    deployment: {
      selectedAuthStrategy: 'registration',
      id: 'dpl_registration',
      url: 'https://app.example',
      commitSha: 'abc1234',
      rollbackTarget: 'last-known-good-registration-config',
    },
    registrationEmailHash: 'hash-admin',
    passwordResetEmailHash: 'hash-reset',
    magicLink: { requestStatus: 410, removed: true },
    login: {
      status: 200,
      ok: true,
      sessionCookieSet: true,
      csrfCookieSet: true,
      next: '/tasks',
    },
    session: {
      actorId: 'admin-1',
      tenantId: 'tenant-int',
      roles: ['admin', 'pm'],
      expiresAtPresent: true,
    },
    protectedRoutes: [{ route: '/tasks', status: 200, ok: true, redirectedToSignIn: false }],
    passwordResetRequest: { status: 200, ok: true, genericResponse: true },
    logout: { status: 200, ok: true },
    afterLogout: { status: 401, authRejected: true },
    summary: {
      registrationStrategySelected: true,
      loginAccepted: true,
      sessionCookieSet: true,
      csrfCookieSet: true,
      meReturnedIdentity: true,
      protectedRoutesLoaded: true,
      passwordResetGeneric: true,
      logoutRevoked: true,
      afterLogoutRejected: true,
      magicLinkRemoved: true,
      rollbackTargetPresent: true,
      evidenceRedacted: true,
      passed: true,
    },
    ...overrides,
  };
}

function completeOidcEvidence(overrides = {}) {
  return {
    generatedAt: '2026-05-08T12:00:00.000Z',
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
      passed: true,
      evidenceRedacted: true,
    },
    ...overrides,
  };
}

test('production auth status docs include registration cutover references', () => {
  const result = validateStatusDocs();

  assert.equal(result.ok, true, result.failures.join('\n'));
});

test('complete registration evidence passes validation', () => {
  const result = validateRegistrationEvidence(completeRegistrationEvidence());

  assert.equal(result.ok, true, result.failures.join('\n'));
});

test('complete OIDC evidence still passes validation when OIDC is selected', () => {
  const result = validateOidcEvidence(completeOidcEvidence());

  assert.equal(result.ok, true, result.failures.join('\n'));
});

test('registration evidence rejects stale, dry-run, leaked, and magic-link-active artifacts', () => {
  const stale = validateRegistrationEvidence(completeRegistrationEvidence({ generatedAt: '2026-05-07T01:26:34.197Z' }));
  assert.equal(stale.ok, false);
  assert.match(stale.failures.join('\n'), new RegExp(ISSUE_REGISTRATION_MIN_SMOKE_AT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const dryRun = validateRegistrationEvidence(completeRegistrationEvidence({ dryRun: true }));
  assert.equal(dryRun.ok, false);
  assert.match(dryRun.failures.join('\n'), /Dry-run evidence/);

  const leaked = validateRegistrationEvidence(completeRegistrationEvidence({ raw: 'engineering_team_session=raw-cookie' }));
  assert.equal(leaked.ok, false);
  assert.match(leaked.failures.join('\n'), /secret-bearing material/);

  const magicLinkActive = validateRegistrationEvidence(
    completeRegistrationEvidence({ magicLink: { requestStatus: 200, removed: false } })
  );
  assert.equal(magicLinkActive.ok, false);
  assert.match(magicLinkActive.failures.join('\n'), /magic-link\/request returns 410/);
});

test('magic-link evidence is no longer accepted after registration cutover', () => {
  const result = validateMagicLinkEvidence({});

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /no longer satisfies/);
});

test('default production auth status check allows pending evidence but require-complete blocks it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registration-status-missing-'));
  const evidencePath = path.join(dir, 'missing-registration-auth-production-smoke.json');
  const advisory = validateProductionAuthStatus({ evidencePath });
  assert.equal(advisory.docs.ok, true);
  assert.equal(advisory.ok, true);

  const shipGate = validateProductionAuthStatus({ evidencePath, requireComplete: true });
  assert.equal(shipGate.ok, false);
  assert.equal(shipGate.evidence.ok, false);
});

test('production auth status check accepts absolute registration evidence paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registration-status-'));
  const evidencePath = path.join(dir, 'registration-auth-production-smoke.json');
  fs.writeFileSync(evidencePath, `${JSON.stringify(completeRegistrationEvidence())}\n`);

  const result = validateProductionAuthStatus({ evidencePath, requireComplete: true });

  assert.equal(result.ok, true, result.evidence.failures.join('\n'));
});
