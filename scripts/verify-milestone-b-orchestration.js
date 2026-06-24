#!/usr/bin/env node
const path = require('node:path');
const { resolveStagingRuntime, assertStagingRuntimeReady } = require('../lib/task-platform/staging-runtime');
const { runMilestoneBOrchestrationVerify } = require('../lib/audit/milestone-b-orchestration-verify');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

async function main() {
  const outputDir = readArg('--output-dir', process.env.STAGING_EVIDENCE_DIR || 'observability/milestone-b-staging');
  const runtime = assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: readArg('--base-url'),
    jwtSecret: readArg('--jwt-secret'),
    forgeAdapterUrl: readArg('--forgeadapter-url'),
    openclawUrl: readArg('--openclaw-url'),
    outputDir,
    requireDelegationSmoke: !process.argv.includes('--skip-delegation-smoke'),
    skipValidation: !process.argv.includes('--run-validation'),
    skipForgePhases: false,
  }));

  process.env.FACTORY_USE_FIXTURE_DELEGATION = process.argv.includes('--live-openclaw') ? 'false' : 'true';
  process.env.FF_FACTORY_AGENT_DRIVEN_PHASE1 = 'true';

  const evidence = await runMilestoneBOrchestrationVerify({
    ...runtime,
    agentDrivenPhase1: true,
    outputPath: path.join(outputDir, 'milestone-b-orchestration-verify.json'),
  });

  process.stdout.write(`${JSON.stringify({
    ok: evidence.summary.passed,
    milestone: 'B',
    title: 'Factory runs without scripted contracts',
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