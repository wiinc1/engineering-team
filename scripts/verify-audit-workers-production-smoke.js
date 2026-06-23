#!/usr/bin/env node
const { runAuditWorkersProductionSmoke } = require('../lib/audit/audit-workers-production-smoke');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

runAuditWorkersProductionSmoke({
  baseUrl: readArg('--base-url'),
  tenantId: readArg('--tenant-id'),
  actorId: readArg('--actor-id'),
  outputPath: readArg('--out', process.env.AUDIT_WORKERS_SMOKE_OUT || 'observability/audit-workers-production-smoke.json'),
  lagThresholdSeconds: readArg('--lag-threshold'),
  waitMs: readArg('--wait-ms'),
})
  .then((evidence) => {
    process.stdout.write(`${JSON.stringify({
      ok: evidence.summary.passed,
      evidencePath: readArg('--out', process.env.AUDIT_WORKERS_SMOKE_OUT || 'observability/audit-workers-production-smoke.json'),
      generatedAt: evidence.generatedAt,
      summary: evidence.summary,
      metrics: evidence.metrics,
    }, null, 2)}\n`);
    if (!evidence.summary.passed) process.exitCode = 1;
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });