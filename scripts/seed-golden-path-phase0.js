#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAuditApiServer } = require('../lib/audit/http-projects');
const { runGoldenPathPhase0 } = require('../lib/task-platform/golden-path-phase0');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function withLocalAuditApi(run) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-path-phase0-'));
  const jwtSecret = process.env.AUTH_JWT_SECRET || 'golden-path-local-secret';
  process.env.AUDIT_STORE_BACKEND = 'file';
  process.env.ALLOW_FILE_AUDIT_BACKEND = 'true';
  process.env.FF_WORKFLOW_ENGINE = 'true';

  const { server } = createAuditApiServer({ baseDir, jwtSecret });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    return await run({
      baseUrl: `http://127.0.0.1:${port}`,
      jwtSecret,
      localBaseDir: baseDir,
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function main() {
  const options = {
    baseUrl: readArg('--base-url'),
    tenantId: readArg('--tenant-id'),
    actorId: readArg('--actor-id'),
    epicIssueNumber: readArg('--epic-issue', '269'),
    childIssueNumber: readArg('--child-issue'),
    childIssueUrl: readArg('--child-issue-url'),
    outputPath: readArg('--out'),
  };

  if (hasFlag('--local')) {
    return withLocalAuditApi((local) => runGoldenPathPhase0({ ...options, ...local }));
  }

  return runGoldenPathPhase0(options);
}

main()
  .then((evidence) => {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      projectId: evidence.engineeringTeam.projectId,
      taskId: evidence.engineeringTeam.taskId,
      evidencePath: readArg('--out', 'observability/golden-path-pilot.json'),
      stepsCompleted: evidence.stepsCompleted,
      githubIssueUrl: evidence.githubIssueUrl,
    }, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });