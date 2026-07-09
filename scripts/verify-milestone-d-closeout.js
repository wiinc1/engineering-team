#!/usr/bin/env node
const path = require('node:path');
const {
  resolveStagingRuntime,
  assertStagingRuntimeReady,
  applyLocalGoldenPathEnvIfNeeded,
} = require('../lib/task-platform/staging-runtime');
const {
  readGoldenPathRealEvidenceCliOptions,
} = require('../lib/task-platform/golden-path-real-evidence-preflight');
const { runMilestoneDCloseoutVerify } = require('../lib/audit/milestone-d-closeout-verify');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

async function main() {
  const outputDir = readArg('--output-dir', process.env.STAGING_EVIDENCE_DIR || 'observability/milestone-d-staging');
  const realEvidenceOptions = readGoldenPathRealEvidenceCliOptions();
  const runtime = applyLocalGoldenPathEnvIfNeeded(assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: readArg('--base-url'),
    jwtSecret: readArg('--jwt-secret'),
    forgeAdapterUrl: readArg('--forgeadapter-url'),
    openclawUrl: readArg('--openclaw-url'),
    ...realEvidenceOptions,
    agentDrivenPhases: true,
    outputDir,
    requireDelegationSmoke: !process.argv.includes('--skip-delegation-smoke'),
    skipValidation: process.argv.includes('--skip-validation'),
    skipForgePhases: false,
  })));

  process.env.FACTORY_USE_FIXTURE_DELEGATION = process.argv.includes('--live-openclaw') ? 'false' : 'true';
  process.env.FF_FACTORY_AGENT_DRIVEN_PHASE1 = 'true';
  process.env.FF_FACTORY_AGENT_DRIVEN_PHASES = 'true';

  const evidence = await runMilestoneDCloseoutVerify({
    ...runtime,
    ...realEvidenceOptions,
    outputPath: path.join(outputDir, 'milestone-d-closeout-verify.json'),
  });

  process.stdout.write(`${JSON.stringify({
    ok: evidence.summary.passed,
    milestone: 'D',
    title: 'Closeout automation and delivery report',
    outputDir,
    summary: evidence.summary,
    artifacts: evidence.artifacts,
    milestoneDComplete: evidence.artifacts?.milestoneDComplete || null,
  }, null, 2)}\n`);

  if (!evidence.summary.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
