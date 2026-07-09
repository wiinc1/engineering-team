#!/usr/bin/env node
const path = require('node:path');
const { resolveStagingRuntime, assertStagingRuntimeReady } = require('../lib/task-platform/staging-runtime');
const { runFactoryStagingSmoke } = require('../lib/audit/milestone-a-staging-verify');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

async function main() {
  const runtime = assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: readArg('--base-url'),
    jwtSecret: readArg('--jwt-secret'),
    outputDir: readArg('--output-dir', process.env.STAGING_EVIDENCE_DIR || 'observability/milestone-a-staging'),
    requireDelegationSmoke: process.argv.includes('--require-delegation-smoke'),
    skipValidation: process.argv.includes('--skip-validation'),
  }));
  const outputPath = readArg(
    '--out',
    path.join(runtime.outputDir, 'factory-staging-smoke.json'),
  );
  const evidence = await runFactoryStagingSmoke(runtime, outputPath);
  process.stdout.write(`${JSON.stringify({
    ok: evidence.summary.passed,
    evidencePath: outputPath,
    summary: evidence.summary,
  }, null, 2)}\n`);
  if (!evidence.summary.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
