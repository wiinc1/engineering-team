#!/usr/bin/env node
const {
  buildForgeReadyApprovedContract,
  seedForgeLocalSmokeTask,
} = require('../lib/forge-local-smoke/seed-task');

function parseArgs(argv) {
  const args = {
    'task-id': process.env.FORGE_LOCAL_SMOKE_TASK_ID || 'TSK-LOCAL001',
    'tenant-id': process.env.TENANT_ID || 'engineering-team',
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await seedForgeLocalSmokeTask({
    taskId: args['task-id'],
    tenantId: args['tenant-id'],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildForgeReadyApprovedContract,
  seedForgeLocalSmokeTask,
};