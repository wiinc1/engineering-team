#!/usr/bin/env node
const smoke = require('../lib/auth/oidc-production-smoke');

const {
  DEFAULT_OIDC_EVIDENCE_PATH,
  buildDryRunOidcEvidence,
  runOidcSmoke,
  writeEvidence,
} = smoke;

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readSmokeOptions() {
  return {
    baseUrl: readArg('--base-url', process.env.AUTH_PROD_BASE_URL),
    oidcDiscoveryUrl: readArg(
      '--oidc-discovery-url',
      process.env.AUTH_PROD_OIDC_DISCOVERY_URL || process.env.VITE_OIDC_DISCOVERY_URL
    ),
    oidcClientId: readArg(
      '--oidc-client-id',
      process.env.AUTH_PROD_OIDC_CLIENT_ID || process.env.VITE_OIDC_CLIENT_ID
    ),
    oidcRedirectUri: readArg(
      '--oidc-redirect-uri',
      process.env.AUTH_PROD_OIDC_REDIRECT_URI || process.env.VITE_OIDC_REDIRECT_URI
    ),
    oidcLogoutUrl: readArg(
      '--oidc-logout-url',
      process.env.AUTH_PROD_OIDC_LOGOUT_URL || process.env.VITE_OIDC_LOGOUT_URL
    ),
    accessToken: readArg('--access-token', process.env.AUTH_PROD_OIDC_ACCESS_TOKEN),
    protectedRoutes: readArg('--protected-routes', process.env.AUTH_PROD_PROTECTED_ROUTES || ''),
    taskDetailPath: readArg('--task-detail-path', process.env.AUTH_PROD_TASK_DETAIL_PATH || ''),
    selectedAuthStrategy: 'oidc',
    deploymentId: readArg('--deployment-id', process.env.AUTH_PROD_DEPLOYMENT_ID || ''),
    deploymentUrl: readArg('--deployment-url', process.env.AUTH_PROD_DEPLOYMENT_URL || ''),
    deploymentStatus: readArg('--deployment-status', process.env.AUTH_PROD_DEPLOYMENT_STATUS || ''),
    commitSha: readArg('--commit-sha', process.env.AUTH_PROD_COMMIT_SHA || ''),
    buildTimestamp: readArg('--build-timestamp', process.env.AUTH_PROD_BUILD_TIMESTAMP || ''),
    rollbackTarget: readArg('--rollback-target', process.env.AUTH_PROD_ROLLBACK_TARGET || ''),
  };
}

function printSmokeResult(evidencePath, evidence) {
  process.stdout.write(
    `${JSON.stringify(
      {
        evidencePath,
        summary: evidence.summary,
        deployment: evidence.deployment,
        nextStep: evidence.nextStep || null,
        manualEvidenceRequired: evidence.manualEvidenceRequired,
      },
      null,
      2
    )}\n`
  );
}

async function main() {
  const options = readSmokeOptions();
  const evidencePath = readArg(
    '--evidence-out',
    process.env.AUTH_PROD_EVIDENCE_OUT || DEFAULT_OIDC_EVIDENCE_PATH
  );
  const evidence = hasFlag('--dry-run') ? buildDryRunOidcEvidence(options) : await runOidcSmoke(options);

  writeEvidence(evidencePath, evidence);
  printSmokeResult(evidencePath, evidence);

  if (hasFlag('--require-complete') && !evidence.summary?.passed) {
    process.exitCode = 1;
  }
}

module.exports = smoke;

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
