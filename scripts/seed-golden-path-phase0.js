#!/usr/bin/env node
const { runGoldenPathPhase0 } = require('../lib/task-platform/golden-path-phase0');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

runGoldenPathPhase0({
  baseUrl: readArg('--base-url'),
  tenantId: readArg('--tenant-id'),
  actorId: readArg('--actor-id'),
  epicIssueNumber: readArg('--epic-issue', '269'),
  childIssueNumber: readArg('--child-issue'),
  childIssueUrl: readArg('--child-issue-url'),
  outputPath: readArg('--out'),
})
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