#!/usr/bin/env node
const fs = require('node:fs');
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
  attachProofMetadata,
  validateLiveSessionEvidence,
  assertLiveProofAllowsCompletion,
  FACTORY_PROOF_ERROR_CODES,
} = require('../lib/task-platform/factory-proof-profile');
const { runMilestoneCAgentVerify } = require('../lib/audit/milestone-c-agent-verify');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

async function main() {
  const outputDir = readArg('--output-dir', process.env.STAGING_EVIDENCE_DIR || 'observability/milestone-c-staging');
  const proof = await applyPrimaryFactoryProofProfile({
    argv: process.argv,
    env: process.env,
    openclawUrl: readArg('--openclaw-url'),
  });

  const realEvidenceOptions = readGoldenPathRealEvidenceCliOptions();
  const runtime = applyLocalGoldenPathEnvIfNeeded(assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: readArg('--base-url'),
    jwtSecret: readArg('--jwt-secret'),
    forgeAdapterUrl: readArg('--forgeadapter-url'),
    openclawUrl: proof.openclawBaseUrl || readArg('--openclaw-url'),
    ...realEvidenceOptions,
    agentDrivenPhases: true,
    outputDir,
    requireDelegationSmoke: !process.argv.includes('--skip-delegation-smoke'),
    skipValidation: process.argv.includes('--skip-validation'),
    skipForgePhases: false,
  })));

  process.env.FF_FACTORY_AGENT_DRIVEN_PHASE1 = 'true';
  process.env.FF_FACTORY_AGENT_DRIVEN_PHASES = 'true';

  const evidence = await runMilestoneCAgentVerify({
    ...runtime,
    ...realEvidenceOptions,
    proofProfile: proof.profile,
    openclawUrl: proof.openclawBaseUrl || runtime.openclawUrl,
    outputPath: path.join(outputDir, 'milestone-c-agent-verify.json'),
  });

  let factoryEvidence = evidence.factoryEvidence || evidence.factory?.factoryEvidence || {};
  const factoryEvidencePath = evidence.artifacts?.factoryEvidence;
  if ((!factoryEvidence || !Object.keys(factoryEvidence).length) && factoryEvidencePath && fs.existsSync(factoryEvidencePath)) {
    factoryEvidence = JSON.parse(fs.readFileSync(factoryEvidencePath, 'utf8'));
  }
  const validation = validateLiveSessionEvidence({
    factoryEvidence,
    profile: proof.profile,
    runner: process.env.SPECIALIST_DELEGATION_RUNNER,
    requireAtLeastOneSession: proof.profile === 'live',
  });
  Object.assign(evidence, attachProofMetadata(evidence, proof, validation));
  if (proof.profile === 'live') {
    evidence.summary.checks.push({
      name: 'live_session_evidence',
      ok: validation.ok,
      liveSessionCount: validation.liveSessions?.length || 0,
      errors: validation.errors,
    });
    evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);
    if (!validation.ok) {
      assertLiveProofAllowsCompletion(proof, validation);
    }
  }

  process.stdout.write(`${JSON.stringify({
    ok: evidence.summary.passed,
    milestone: 'C',
    title: 'Agent implements and verifies',
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
