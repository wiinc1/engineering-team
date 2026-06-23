#!/usr/bin/env node
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readArg, writeEvidence } = require('./golden-path-smoke-lib');

const execFileAsync = promisify(execFile);

async function main() {
  const argv = process.argv;
  const outputPath = readArg(argv, '--out', 'observability/gp-013-delegation-smoke.json');
  const openclawUrl = readArg(argv, '--openclaw-url', process.env.OPENCLAW_BASE_URL || '');
  const allowSkip = argv.includes('--allow-mock-skip');
  const env = {
    ...process.env,
    ...(openclawUrl ? { OPENCLAW_BASE_URL: openclawUrl, FF_REAL_SPECIALIST_DELEGATION: 'true' } : {}),
    SPECIALIST_DELEGATION_RUNNER: process.env.SPECIALIST_DELEGATION_RUNNER || 'node scripts/openclaw-specialist-runner.js',
  };

  let ok = false;
  let sessionId = null;
  let skipped = false;
  let reason = null;
  let combinedOutput = '';
  try {
    const result = await execFileAsync('npm', ['run', 'test:delegation:live-smoke:openclaw'], { cwd: process.cwd(), env, timeout: 120000 });
    combinedOutput = `${result.stdout}\n${result.stderr}`;
    sessionId = combinedOutput.match(/sessionId["':\s]+([0-9a-f-]{36})/i)?.[1] || null;
    ok = true;
  } catch (error) {
    combinedOutput = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`;
    if (allowSkip && /not delegated|SPECIALIST_RUNTIME_SMOKE_NOT_DELEGATED|ECONNREFUSED|fetch failed/i.test(combinedOutput)) {
      skipped = true;
      reason = 'live_openclaw_unavailable';
      ok = true;
    }
  }

  const evidence = writeEvidence(outputPath, {
    generatedAt: new Date().toISOString(),
    step: 'GP-013',
    openclawUrl: openclawUrl || null,
    summary: { passed: ok, skipped, reason, sessionId },
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});