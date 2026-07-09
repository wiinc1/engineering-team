#!/usr/bin/env node
const path = require('node:path');
const {
  resolveStagingRuntime,
  assertStagingRuntimeReady,
  applyLocalGoldenPathEnvIfNeeded,
} = require('../lib/task-platform/staging-runtime');
const {
  assertGoldenPathRealEvidencePreflight,
  readGoldenPathRealEvidenceCliOptions,
} = require('../lib/task-platform/golden-path-real-evidence-preflight');
const { runMilestoneAStagingVerify } = require('../lib/audit/milestone-a-staging-verify');
const { runMilestoneHostedPhase6Verify } = require('../lib/audit/milestone-hosted-phase6-verify');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function resolveOutputDir(phase6Only) {
  return readArg(
    '--output-dir',
    process.env.STAGING_EVIDENCE_DIR
      || (phase6Only ? 'observability/milestone-hosted-staging' : 'observability/milestone-a-staging'),
  );
}

function resolveReplayRuntime({ phase6Only, fullReplay, outputDir, realEvidenceOptions }) {
  return applyLocalGoldenPathEnvIfNeeded(assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: readArg('--base-url'),
    jwtSecret: readArg('--jwt-secret'),
    githubWebhookSecret: readArg('--webhook-secret'),
    forgeAdapterUrl: readArg('--forgeadapter-url'),
    openclawUrl: readArg('--openclaw-url'),
    ...realEvidenceOptions,
    agentDrivenPhases: phase6Only || fullReplay || realEvidenceOptions.agentDrivenPhases,
    outputDir,
    requireDelegationSmoke: process.argv.includes('--require-delegation-smoke'),
    skipValidation: process.argv.includes('--skip-validation'),
    skipForgePhases: phase6Only || !fullReplay,
  })));
}

function configureReplayDelegationEnv() {
  process.env.FACTORY_USE_FIXTURE_DELEGATION = process.argv.includes('--live-openclaw') ? 'false' : 'true';
  process.env.FF_FACTORY_AGENT_DRIVEN_PHASE1 = 'true';
  process.env.FF_FACTORY_AGENT_DRIVEN_PHASES = 'true';
}

function assertReplayRealEvidence(realEvidenceOptions, runtime, context) {
  assertGoldenPathRealEvidencePreflight({
    ...realEvidenceOptions,
    baseUrl: runtime.baseUrl,
    operatorUrl: readArg('--operator-url', runtime.baseUrl),
    forgeAdapterBaseUrl: runtime.forgeAdapterUrl,
    requireReadableCandidateProof: true,
    agentDrivenPhases: true,
    skipValidation: runtime.skipValidation,
    fromPhase: context.includes('phase 6') ? 6 : 2,
    toPhase: 6,
  }, { context });
}

function printPhase6Result(evidence, runtime, outputDir) {
  process.stdout.write(`${JSON.stringify({
    ok: evidence.summary.passed,
    profile: 'hosted-phase6',
    baseUrl: runtime.baseUrl,
    operatorUrl: evidence.operatorUrl,
    outputDir,
    summary: evidence.summary,
    artifacts: evidence.artifacts,
  }, null, 2)}\n`);
}

async function runHostedPhase6(runtime, realEvidenceOptions, outputDir) {
  assertReplayRealEvidence(realEvidenceOptions, runtime, 'Hosted phase 6 replay');
  const evidence = await runMilestoneHostedPhase6Verify({
    ...runtime,
    ...realEvidenceOptions,
    operatorUrl: readArg('--operator-url', runtime.baseUrl),
    evidencePath: readArg('--evidence-path'),
    candidateProofPath: readArg('--candidate-proof', process.env.REAL_DELIVERY_CANDIDATE_PROOF_PATH || ''),
    allowLocalHosted: process.argv.includes('--allow-local-hosted'),
    autoMerge: realEvidenceOptions.autoMerge === true,
    outputPath: path.join(outputDir, 'milestone-hosted-phase6-verify.json'),
  });
  printPhase6Result(evidence, runtime, outputDir);
  if (!evidence.summary.passed) process.exitCode = 1;
}

function printStagingResult(evidence, runtime, outputDir) {
  process.stdout.write(`${JSON.stringify({
    ok: evidence.summary.passed,
    profile: 'staging',
    baseUrl: runtime.baseUrl,
    outputDir,
    summary: evidence.summary,
    artifacts: evidence.artifacts,
    note: runtime.skipForgePhases
      ? 'Hosted staging replay verifies workers, bridge config, intake webhook, and factory intake/phase1. Pass --full-replay when forgeadapter is reachable on staging. Pass --phase6-only to replay deploy closeout on hosted operator URL.'
      : null,
  }, null, 2)}\n`);
}

async function runStagingReplay(runtime, realEvidenceOptions, outputDir, fullReplay) {
  if (fullReplay) assertReplayRealEvidence(realEvidenceOptions, runtime, 'Staging full replay');
  const evidence = await runMilestoneAStagingVerify({
    ...runtime,
    ...realEvidenceOptions,
    outputPath: path.join(outputDir, 'milestone-a-staging-verify.json'),
  });
  printStagingResult(evidence, runtime, outputDir);
  if (!evidence.summary.passed) process.exitCode = 1;
}

async function main() {
  const phase6Only = process.argv.includes('--phase6-only');
  const fullReplay = process.argv.includes('--full-replay');
  const realEvidenceOptions = readGoldenPathRealEvidenceCliOptions();
  const outputDir = resolveOutputDir(phase6Only);
  const runtime = resolveReplayRuntime({
    phase6Only,
    fullReplay,
    outputDir,
    realEvidenceOptions,
  });

  configureReplayDelegationEnv();

  if (phase6Only) {
    await runHostedPhase6(runtime, realEvidenceOptions, outputDir);
    return;
  }

  await runStagingReplay(runtime, realEvidenceOptions, outputDir, fullReplay);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
