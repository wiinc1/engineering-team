#!/usr/bin/env node
const { runProjectsProductionSmoke } = require('../lib/task-platform/projects-production-smoke');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

runProjectsProductionSmoke({
  baseUrl: readArg('--base-url'),
  tenantId: readArg('--tenant-id'),
  isolationTenantId: readArg('--isolation-tenant-id'),
  actorId: readArg('--actor-id'),
  outputPath: readArg('--out'),
  deploymentId: readArg('--deployment-id'),
  commitSha: readArg('--commit-sha'),
  rollbackTarget: readArg('--rollback-target'),
  allowHttp: hasFlag('--allow-http'),
  skipDatabase: hasFlag('--skip-database'),
})
  .then((evidence) => {
    process.stdout.write(`${JSON.stringify({
      ok: evidence.summary.passed,
      evidencePath: readArg('--out', process.env.PROJECTS_PROD_EVIDENCE_OUT || 'observability/projects-production-smoke.json'),
      generatedAt: evidence.generatedAt,
      summary: evidence.summary,
      projectId: evidence.api.projectId,
      taskId: evidence.api.taskId,
    }, null, 2)}\n`);
    if (!evidence.summary.passed) process.exitCode = 1;
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
