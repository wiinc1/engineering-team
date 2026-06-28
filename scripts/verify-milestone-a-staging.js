#!/usr/bin/env node
const path = require('node:path');
const { resolveStagingRuntime, assertStagingRuntimeReady } = require('../lib/task-platform/staging-runtime');
const { runMilestoneAStagingVerify } = require('../lib/audit/milestone-a-staging-verify');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

async function main() {
  const outputDir = readArg('--output-dir', process.env.STAGING_EVIDENCE_DIR || 'observability/milestone-a-staging');
  const runtime = assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: readArg('--base-url'),
    jwtSecret: readArg('--jwt-secret'),
    githubWebhookSecret: readArg('--webhook-secret'),
    forgeAdapterUrl: readArg('--forgeadapter-url'),
    openclawUrl: readArg('--openclaw-url'),
    outputDir,
    requireDelegationSmoke: process.argv.includes('--require-delegation-smoke'),
    skipValidation: !process.argv.includes('--run-validation'),
    skipForgePhases: !process.argv.includes('--full-replay'),
  }));

  const evidence = await runMilestoneAStagingVerify({
    ...runtime,
    outputPath: path.join(outputDir, 'milestone-a-staging-verify.json'),
  });

  process.stdout.write(`${JSON.stringify({
    ok: evidence.summary.passed,
    milestone: 'A',
    title: 'Coordinated stack factory is reliable',
    outputDir,
    summary: evidence.summary,
    artifacts: evidence.artifacts,
  }, null, 2)}\n`);

  if (!evidence.summary.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});