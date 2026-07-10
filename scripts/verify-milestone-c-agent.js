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
const {
  applyPrimaryFactoryProofProfile,
  finalizeLiveProofEvidence,
  writeMilestoneVerifyReport,
  FACTORY_PROOF_ERROR_CODES,
  readArg: readProofArg,
} = require('../lib/task-platform/factory-proof-profile');
const { runMilestoneCAgentVerify } = require('../lib/audit/milestone-c-agent-verify');

function readArg(name, fallback = '') {
  return readProofArg(process.argv, name, fallback);
}

function resolveMilestoneRuntime(proof, outputDir, realEvidenceOptions) {
  return applyLocalGoldenPathEnvIfNeeded(assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: readArg('--base-url'),
    jwtSecret: readArg('--jwt-secret'),
    forgeAdapterUrl: readArg('--forgeadapter-url'),
    openclawUrl: proof.openclawBaseUrl || readArg('--openclaw-url'),
    ...realEvidenceOptions,
    agentDrivenPhases: true,
    outputDir,
    requireDelegationSmoke: !process.argv.includes('--skip-delegation-smoke'),
    skipValidation: process.argv.includes('--skip-validation'),
    skipForgePhases: process.env.STAGING_SKIP_FORGE_PHASES === 'true',
    skipForgeSeed: process.env.STAGING_SKIP_FORGE_SEED === 'true',
  })));
}

async function main() {
  const outputDir = readArg('--output-dir', process.env.STAGING_EVIDENCE_DIR || 'observability/milestone-c-staging');
  const proof = await applyPrimaryFactoryProofProfile({
    argv: process.argv,
    env: process.env,
    openclawUrl: readArg('--openclaw-url'),
  });
  const realEvidenceOptions = readGoldenPathRealEvidenceCliOptions();
  const runtime = resolveMilestoneRuntime(proof, outputDir, realEvidenceOptions);
  process.env.FF_FACTORY_AGENT_DRIVEN_PHASE1 = 'true';
  process.env.FF_FACTORY_AGENT_DRIVEN_PHASES = 'true';
  const evidence = await runMilestoneCAgentVerify({
    ...runtime,
    ...realEvidenceOptions,
    proofProfile: proof.profile,
    openclawUrl: proof.openclawBaseUrl || runtime.openclawUrl,
    outputPath: path.join(outputDir, 'milestone-c-agent-verify.json'),
  });
  finalizeLiveProofEvidence(evidence, proof);
  writeMilestoneVerifyReport({
    evidence,
    proof,
    milestone: 'C',
    title: 'Agent implements and verifies',
    outputDir,
  });
}

main().catch((error) => {
  const code = error?.code || FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE;
  process.stderr.write(`${code}: ${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
