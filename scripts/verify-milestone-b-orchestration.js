#!/usr/bin/env node
const path = require('node:path');
const { resolveStagingRuntime, assertStagingRuntimeReady } = require('../lib/task-platform/staging-runtime');
const {
  applyPrimaryFactoryProofProfile,
  attachProofMetadata,
  FACTORY_PROOF_ERROR_CODES,
} = require('../lib/task-platform/factory-proof-profile');
const { runMilestoneBOrchestrationVerify } = require('../lib/audit/milestone-b-orchestration-verify');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

async function main() {
  const outputDir = readArg('--output-dir', process.env.STAGING_EVIDENCE_DIR || 'observability/milestone-b-staging');
  const proof = await applyPrimaryFactoryProofProfile({
    argv: process.argv,
    env: process.env,
    openclawUrl: readArg('--openclaw-url'),
  });

  const runtime = assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: readArg('--base-url'),
    jwtSecret: readArg('--jwt-secret'),
    forgeAdapterUrl: readArg('--forgeadapter-url'),
    openclawUrl: proof.openclawBaseUrl || readArg('--openclaw-url'),
    outputDir,
    requireDelegationSmoke: !process.argv.includes('--skip-delegation-smoke'),
    skipValidation: process.argv.includes('--skip-validation'),
    skipForgePhases: false,
  }));

  process.env.FF_FACTORY_AGENT_DRIVEN_PHASE1 = 'true';

  const evidence = await runMilestoneBOrchestrationVerify({
    ...runtime,
    agentDrivenPhase1: true,
    proofProfile: proof.profile,
    openclawUrl: proof.openclawBaseUrl || runtime.openclawUrl,
    outputPath: path.join(outputDir, 'milestone-b-orchestration-verify.json'),
  });
  Object.assign(evidence, attachProofMetadata(evidence, proof));

  process.stdout.write(`${JSON.stringify({
    ok: evidence.summary.passed,
    milestone: 'B',
    title: 'Factory runs without scripted contracts',
    outputDir,
    proofProfile: proof.profile,
    fixtureDelegation: proof.fixtureDelegation,
    openclawBaseUrl: proof.openclawBaseUrl,
    summary: evidence.summary,
    artifacts: evidence.artifacts,
  }, null, 2)}\n`);

  if (!evidence.summary.passed) process.exitCode = 1;
}

main().catch((error) => {
  const code = error?.code || FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE;
  process.stderr.write(`${code}: ${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
