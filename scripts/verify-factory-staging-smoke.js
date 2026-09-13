#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveStagingRuntime, assertStagingRuntimeReady } = require('../lib/task-platform/staging-runtime');
const { runFactoryStagingSmoke } = require('../lib/audit/milestone-a-staging-verify');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function redactReleaseEvidence(evidence) {
  const sourceDigest = `sha256:${crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex')}`;
  return Object.freeze({
    schemaVersion: 1,
    kind: 'factory-staging-smoke-redacted',
    generatedAt: evidence.generatedAt,
    summary: {
      passed: evidence.summary?.passed === true,
      stage: evidence.summary?.stage || null,
    },
    evidence: { sourceDigest },
  });
}

async function main() {
  const runtime = assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: readArg('--base-url'),
    jwtSecret: readArg('--jwt-secret', process.env.STAGING_JWT_SECRET || ''),
    outputDir: readArg('--output-dir', process.env.STAGING_EVIDENCE_DIR || 'observability/milestone-a-staging'),
    requireDelegationSmoke: process.argv.includes('--require-delegation-smoke'),
    skipValidation: process.argv.includes('--skip-validation'),
  }));
  const outputPath = readArg(
    '--out',
    path.join(runtime.outputDir, 'factory-staging-smoke.json'),
  );
  const rawEvidence = await runFactoryStagingSmoke(runtime, outputPath);
  const evidence = process.argv.includes('--redacted-release-evidence')
    ? redactReleaseEvidence(rawEvidence) : rawEvidence;
  if (evidence !== rawEvidence) fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    ok: evidence.summary.passed,
    evidencePath: outputPath,
    summary: evidence.summary,
  }, null, 2)}\n`);
  if (!evidence.summary.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, readArg, redactReleaseEvidence };
