const {
  buildDeploymentEvidence,
  hashEvidence,
  normalizeBaseUrl,
  parseProtectedRoutes,
  writeEvidence,
} = require('./magic-link-production-smoke');

const DEFAULT_OIDC_EVIDENCE_PATH = 'observability/oidc-production-smoke.json';

function buildOidcDeploymentEvidence(options = {}) {
  return buildDeploymentEvidence({
    ...options,
    selectedAuthStrategy: 'oidc',
  });
}

function defaultRedirectUri(baseUrl) {
  return `${baseUrl}/auth/callback`;
}

function buildUrl(baseUrl, route) {
  return new URL(route, `${baseUrl}/`).toString();
}

async function readJsonResponse(response) {
  return response.json().catch(() => ({}));
}

async function fetchOidcDiscovery({ oidcDiscoveryUrl, fetchImpl = fetch }) {
  if (!oidcDiscoveryUrl) {
    throw new Error('AUTH_PROD_OIDC_DISCOVERY_URL or --oidc-discovery-url is required.');
  }
  const response = await fetchImpl(oidcDiscoveryUrl, {
    headers: { accept: 'application/json' },
  });
  const payload = await readJsonResponse(response);
  return {
    status: response.status,
    ok: response.ok,
    authorizationEndpointPresent: !!payload.authorization_endpoint,
    tokenEndpointPresent: !!payload.token_endpoint,
    logoutEndpointPresent: !!(payload.end_session_endpoint || payload.logout_endpoint),
  };
}

async function verifyHostedCallbackRoute({ baseUrl, fetchImpl = fetch }) {
  const response = await fetchImpl(
    buildUrl(baseUrl, '/auth/callback?error=smoke_check&error_description=Smoke%20check'),
    { redirect: 'manual' }
  );
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 500,
  };
}

async function verifyOidcSession({ baseUrl, accessToken, fetchImpl = fetch }) {
  if (!accessToken) return { skipped: true, reason: 'missing_access_token' };
  const response = await fetchImpl(buildUrl(baseUrl, '/auth/me'), {
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJsonResponse(response);
  const data = payload?.data || {};
  return response.ok
    ? {
        skipped: false,
        status: response.status,
        actorId: data.actorId || data.actor_id || null,
        tenantId: data.tenantId || data.tenant_id || null,
        roles: data.roles || [],
        expiresAtPresent: !!data.expiresAt,
      }
    : { skipped: false, status: response.status, errorCode: payload?.error?.code || null };
}

async function verifyProtectedRoute({ baseUrl, route, accessToken, fetchImpl = fetch }) {
  const response = await fetchImpl(buildUrl(baseUrl, route), {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    redirect: 'manual',
  });
  return {
    route,
    status: response.status,
    ok: response.status >= 200 && response.status < 400,
    redirectedToSignIn: String(response.headers.get('location') || '').includes('/sign-in'),
  };
}

async function verifyProtectedRoutes(evidence, baseUrl, accessToken, options = {}) {
  const protectedRoutes = parseProtectedRoutes(options.protectedRoutes);
  if (options.taskDetailPath) protectedRoutes.push(options.taskDetailPath);
  for (const route of protectedRoutes) {
    evidence.protectedRoutes.push(
      await verifyProtectedRoute({
        baseUrl,
        route,
        accessToken,
        fetchImpl: options.fetchImpl,
      })
    );
  }
}

async function verifyOidcLogout({ baseUrl, oidcLogoutUrl, fetchImpl = fetch }) {
  const response = await fetchImpl(buildUrl(baseUrl, '/sign-in?reason=signed_out'), {
    redirect: 'manual',
  });
  return {
    providerLogoutConfigured: !!oidcLogoutUrl,
    appSignedOutRouteOk: response.status >= 200 && response.status < 500,
    status: response.status,
  };
}

function summarizeOidcChecks(evidence) {
  const checks = {
    discoveryLoaded:
      evidence.discovery?.ok === true &&
      evidence.discovery?.authorizationEndpointPresent === true &&
      evidence.discovery?.tokenEndpointPresent === true,
    hostedCallbackRouteLoaded: evidence.hostedCallback?.ok === true,
    meReturnedIdentity: !!(
      evidence.session?.actorId &&
      evidence.session?.tenantId &&
      Array.isArray(evidence.session?.roles)
    ),
    protectedRoutesLoaded:
      Array.isArray(evidence.protectedRoutes) &&
      evidence.protectedRoutes.every((route) => route.ok && !route.redirectedToSignIn),
    logoutValidated:
      evidence.logout?.providerLogoutConfigured === true &&
      evidence.logout?.appSignedOutRouteOk === true,
    rollbackTargetPresent: !!evidence.deployment?.rollbackTarget,
    evidenceRedacted: true,
  };
  return { ...checks, passed: Object.values(checks).every(Boolean) };
}

function createOidcEvidence(baseUrl, options = {}) {
  const redirectUri = options.oidcRedirectUri || defaultRedirectUri(baseUrl);
  return {
    generatedAt: new Date().toISOString(),
    baseUrl,
    deployment: buildOidcDeploymentEvidence({ ...options, baseUrl }),
    oidc: {
      discoveryUrlHash: hashEvidence(options.oidcDiscoveryUrl),
      clientIdHash: hashEvidence(options.oidcClientId),
      redirectUri,
      logoutUrlConfigured: !!options.oidcLogoutUrl,
    },
    accessTokenHash: hashEvidence(options.accessToken),
    taskDetailPath: options.taskDetailPath || null,
    discovery: null,
    hostedCallback: null,
    session: null,
    protectedRoutes: [],
    logout: null,
    manualEvidenceRequired: [
      'OIDC provider authorize callback completed for the smoke account',
      'Access token was obtained through hosted sign-in and is supplied only to the smoke command',
      'IdP redirect URI allowlist includes the production /auth/callback URL',
      'Monitoring evidence contains counts/rates only and no tokens or secrets',
      'Rollback evidence identifies the last known-good OIDC deployment/config',
    ],
  };
}

function buildDryRunOidcEvidence(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const evidence = createOidcEvidence(baseUrl, options);
  return {
    ...evidence,
    dryRun: true,
    protectedRoutes: parseProtectedRoutes(options.protectedRoutes),
    hasAccessToken: !!options.accessToken,
    summary: { passed: true, networkSkipped: true, evidenceRedacted: true },
    nextStep: 'Run without --dry-run after completing hosted OIDC sign-in for the smoke account.',
  };
}

async function runOidcSmoke(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const evidence = createOidcEvidence(baseUrl, options);

  evidence.discovery = await fetchOidcDiscovery(options);
  evidence.hostedCallback = await verifyHostedCallbackRoute({
    baseUrl,
    fetchImpl: options.fetchImpl,
  });
  evidence.session = await verifyOidcSession({
    baseUrl,
    accessToken: options.accessToken,
    fetchImpl: options.fetchImpl,
  });
  await verifyProtectedRoutes(evidence, baseUrl, options.accessToken, options);
  evidence.logout = await verifyOidcLogout({
    baseUrl,
    oidcLogoutUrl: options.oidcLogoutUrl,
    fetchImpl: options.fetchImpl,
  });
  evidence.summary = summarizeOidcChecks(evidence);
  if (!options.accessToken) {
    evidence.nextStep =
      'Complete hosted OIDC sign-in and provide AUTH_PROD_OIDC_ACCESS_TOKEN or --access-token.';
  }
  return evidence;
}

module.exports = {
  DEFAULT_OIDC_EVIDENCE_PATH,
  buildDryRunOidcEvidence,
  buildOidcDeploymentEvidence,
  runOidcSmoke,
  summarizeOidcChecks,
  writeEvidence,
};
