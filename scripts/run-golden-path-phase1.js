#!/usr/bin/env node
const { withLocalAuditApi } = require('../lib/task-platform/golden-path-local-stack');
const { runGoldenPathPhase1 } = require('../lib/task-platform/golden-path-phase1');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const childIssueNumber = readArg('--child-issue');
  const options = {
    baseUrl: readArg('--base-url'),
    tenantId: readArg('--tenant-id'),
    actorId: readArg('--actor-id'),
    epicIssueNumber: readArg('--epic-issue', '269'),
    childIssueNumber,
    childIssueUrl: readArg(
      '--child-issue-url',
      childIssueNumber ? `https://github.com/wiinc1/engineering-team/issues/${childIssueNumber}` : '',
    ),
    outputPath: readArg('--out', 'observability/golden-path-pilot.json'),
    taskId: readArg('--task-id'),
    projectId: readArg('--project-id'),
    persistDir: readArg('--persist-dir'),
    bootstrapPhase0: hasFlag('--bootstrap'),
    skipArchitectHandoff: hasFlag('--skip-architect-handoff'),
    projectName: readArg('--project-name'),
  };

  if (hasFlag('--local')) {
    return withLocalAuditApi((local) => runGoldenPathPhase1({
      ...options,
      ...local,
      bootstrapPhase0: options.bootstrapPhase0 || hasFlag('--bootstrap'),
    }), {
      persistDir: options.persistDir || undefined,
      pmRefinementDelegateWork: async () => ({
        agentId: 'pm',
        sessionId: 'golden-path-pm-refinement',
        output: 'PM refinement complete for golden path pilot.',
        ownership: { specialistId: 'pm', agentId: 'pm' },
      }),
    });
  }

  return runGoldenPathPhase1(options);
}

main()
  .then((evidence) => {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: evidence.status,
      projectId: evidence.engineeringTeam?.projectId,
      taskId: evidence.engineeringTeam?.taskId,
      contractVersion: evidence.engineeringTeam?.contractVersion,
      approvalMode: evidence.engineeringTeam?.approvalMode,
      forgeReadinessReady: evidence.engineeringTeam?.forgeExecutionReadiness?.ready ?? null,
      evidencePath: readArg('--out', 'observability/golden-path-pilot.json'),
      stepsCompleted: evidence.stepsCompleted,
    }, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
