#!/usr/bin/env node
const { runRegistrationProductionSmoke } = require('../lib/auth/registration-production-smoke');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

runRegistrationProductionSmoke({
  baseUrl: readArg('--base-url', process.env.AUTH_PROD_BASE_URL),
  email: readArg('--email', process.env.AUTH_PROD_REGISTRATION_EMAIL),
  password: readArg('--password', process.env.AUTH_PROD_REGISTRATION_PASSWORD),
  resetEmail: readArg('--reset-email', process.env.AUTH_PROD_PASSWORD_RESET_EMAIL),
  outputPath: readArg('--out', process.env.AUTH_PROD_EVIDENCE_OUT || 'observability/registration-auth-production-smoke.json'),
  selectedAuthStrategy: readArg('--auth-strategy', process.env.AUTH_PROD_AUTH_STRATEGY || 'registration'),
  deploymentId: readArg('--deployment-id', process.env.VERCEL_DEPLOYMENT_ID),
  commitSha: readArg('--commit-sha', process.env.VERCEL_GIT_COMMIT_SHA),
  rollbackTarget: readArg('--rollback-target', process.env.AUTH_PROD_ROLLBACK_TARGET),
  allowHttp: hasFlag('--allow-http'),
})
  .then((evidence) => {
    process.stdout.write(`${JSON.stringify({
      ok: evidence.summary.passed,
      evidencePath: readArg('--out', process.env.AUTH_PROD_EVIDENCE_OUT || 'observability/registration-auth-production-smoke.json'),
      generatedAt: evidence.generatedAt,
      summary: evidence.summary,
    }, null, 2)}\n`);
    if (!evidence.summary.passed) process.exitCode = 1;
  })
  .catch((error) => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
