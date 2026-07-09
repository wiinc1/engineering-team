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
const { runMilestoneHostedPhase6Verify } = require('../lib/audit/milestone-hosted-phase6-verify');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

async function main() {
  const outputDir = readArg('--output-dir', process.env.STAGING_EVIDENCE_DIR || 'observability/milestone-hosted-staging');
  const realEvidenceOptions = readGoldenPathRealEvidenceCliOptions();
  const runtime = applyLocalGoldenPathEnvIfNeeded(assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: readArg('--base-url'),
    jwtSecret: readArg('--jwt-secret'),
    forgeAdapterUrl: readArg('--forgeadapter-url'),
    openclawUrl: readArg('--openclaw-url'),
    ...realEvidenceOptions,
    agentDrivenPhases: true,
    outputDir,
    requireDelegationSmoke: false,
    skipValidation: process.argv.includes('--skip-validation'),
    skipForgePhases: true,
  })));

  process.env.FACTORY_USE_FIXTURE_DELEGATION = 'false';
  process.env.FF_FACTORY_AGENT_DRIVEN_PHASE1 = 'true';
  process.env.FF_FACTORY_AGENT_DRIVEN_PHASES = 'true';

  const evidence = await runMilestoneHostedPhase6Verify({
    ...runtime,
    ...realEvidenceOptions,
    agentDrivenPhases: true,
    operatorUrl: readArg('--operator-url', runtime.baseUrl),
    evidencePath: readArg('--evidence-path'),
    candidateProofPath: readArg('--candidate-proof', process.env.REAL_DELIVERY_CANDIDATE_PROOF_PATH || ''),
    allowLocalHosted: process.argv.includes('--allow-local-hosted'),
    autoMerge: realEvidenceOptions.autoMerge === true,
    outputPath: path.join(outputDir, 'milestone-hosted-phase6-verify.json'),
  });

  process.stdout.write(`${JSON.stringify({
    ok: evidence.summary.passed,
    milestone: 'E-phase6',
    title: 'Hosted deploy closeout replay',
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
