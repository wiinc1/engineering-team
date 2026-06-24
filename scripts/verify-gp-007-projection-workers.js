#!/usr/bin/env node
const { runGp007ProjectionWorkersVerify } = require('../lib/audit/gp-007-projection-workers-verify');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

runGp007ProjectionWorkersVerify({
  baseUrl: readArg('--base-url'),
  jwtSecret: readArg('--jwt-secret'),
  outputDir: readArg('--output-dir', process.env.GP_007_EVIDENCE_DIR || 'observability/gp-007-staging'),
  stackStatePath: readArg('--stack-state'),
  waitMs: readArg('--wait-ms'),
  lagThresholdSeconds: readArg('--lag-threshold'),
})
  .then(({ evidence, complete }) => {
    process.stdout.write(`${JSON.stringify({
      ok: evidence.summary.passed,
      milestone: 'GP-007',
      title: 'Always-on projection + outbox workers',
      outputDir: evidence.outputDir,
      summary: evidence.summary,
      complete: complete.summary,
      artifacts: evidence.artifacts,
    }, null, 2)}\n`);
    if (!evidence.summary.passed) process.exitCode = 1;
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });