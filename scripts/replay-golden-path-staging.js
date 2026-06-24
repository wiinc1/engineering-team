#!/usr/bin/env node
const path = require('node:path');
const {
  resolveStagingRuntime,
  assertStagingRuntimeReady,
  applyLocalGoldenPathEnvIfNeeded,
} = require('../lib/task-platform/staging-runtime');
const { runMilestoneAStagingVerify } = require('../lib/audit/milestone-a-staging-verify');
const { runMilestoneHostedPhase6Verify } = require('../lib/audit/milestone-hosted-phase6-verify');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

async function main() {
  const phase6Only = process.argv.includes('--phase6-only');
  const outputDir = readArg(
    '--output-dir',
    process.env.STAGING_EVIDENCE_DIR
      || (phase6Only ? 'observability/milestone-hosted-staging' : 'observability/milestone-a-staging'),
  );
  const runtime = applyLocalGoldenPathEnvIfNeeded(assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: readArg('--base-url'),
    jwtSecret: readArg('--jwt-secret'),
    githubWebhookSecret: readArg('--webhook-secret'),
    forgeAdapterUrl: readArg('--forgeadapter-url'),
    openclawUrl: readArg('--openclaw-url'),
    outputDir,
    requireDelegationSmoke: process.argv.includes('--require-delegation-smoke'),
    skipValidation: !process.argv.includes('--run-validation'),
    skipForgePhases: phase6Only || !process.argv.includes('--full-replay'),
  })));

  process.env.FACTORY_USE_FIXTURE_DELEGATION = process.argv.includes('--live-openclaw') ? 'false' : 'true';
  process.env.FF_FACTORY_AGENT_DRIVEN_PHASE1 = 'true';
  process.env.FF_FACTORY_AGENT_DRIVEN_PHASES = 'true';

  if (phase6Only) {
    const evidence = await runMilestoneHostedPhase6Verify({
      ...runtime,
      operatorUrl: readArg('--operator-url', runtime.baseUrl),
      evidencePath: readArg('--evidence-path'),
      allowLocalHosted: process.argv.includes('--allow-local-hosted'),
      autoMerge: process.argv.includes('--auto-merge'),
      outputPath: path.join(outputDir, 'milestone-hosted-phase6-verify.json'),
    });

    process.stdout.write(`${JSON.stringify({
      ok: evidence.summary.passed,
      profile: 'hosted-phase6',
      baseUrl: runtime.baseUrl,
      operatorUrl: evidence.operatorUrl,
      outputDir,
      summary: evidence.summary,
      artifacts: evidence.artifacts,
    }, null, 2)}\n`);

    if (!evidence.summary.passed) process.exitCode = 1;
    return;
  }

  const evidence = await runMilestoneAStagingVerify({
    ...runtime,
    outputPath: path.join(outputDir, 'milestone-a-staging-verify.json'),
  });

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

  if (!evidence.summary.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});