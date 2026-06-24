#!/usr/bin/env node
const { runEtForgeBridgeSmoke } = require('../lib/audit/et-forge-bridge-smoke');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

runEtForgeBridgeSmoke({
  outputPath: readArg('--out', process.env.ET_FORGE_BRIDGE_SMOKE_OUT || 'observability/et-forge-bridge-smoke.json'),
  forgeAdapterBaseUrl: readArg('--forgeadapter-url', process.env.FORGEADAPTER_BASE_URL || ''),
  engineeringTeamBaseUrl: readArg('--base-url', process.env.ENGINEERING_TEAM_BASE_URL || process.env.STAGING_BASE_URL || ''),
  enabled: process.env.ET_FORGE_DISPATCH_ENABLED,
  lifecycleTaskId: readArg('--lifecycle-task-id', process.env.ET_FORGE_LIFECYCLE_TASK_ID || 'TSK-BRIDGESMOKE'),
  probeLiveForge: !process.argv.includes('--skip-forge-health'),
})
  .then((evidence) => {
    process.stdout.write(`${JSON.stringify({
      ok: evidence.summary.passed,
      evidencePath: readArg('--out', process.env.ET_FORGE_BRIDGE_SMOKE_OUT || 'observability/et-forge-bridge-smoke.json'),
      summary: evidence.summary,
    }, null, 2)}\n`);
    if (!evidence.summary.passed) process.exitCode = 1;
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });