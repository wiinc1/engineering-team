#!/usr/bin/env node

const { createTaskPlatformService } = require('../lib/task-platform');
const { ensurePilotAgents } = require('../lib/task-platform/pilot-agents');

async function seedPilotAgents(options = {}) {
  const tenantId = options.tenantId || process.env.TENANT_ID || 'engineering-team';
  const actorId = options.actorId || process.env.PILOT_AGENT_SEED_ACTOR_ID || 'system:pilot-agent-seed';
  const taskPlatform = options.taskPlatform || createTaskPlatformService({
    baseDir: options.baseDir || process.cwd(),
    taskPlatformBackend: options.taskPlatformBackend || process.env.TASK_PLATFORM_BACKEND,
    connectionString: options.connectionString || process.env.DATABASE_URL,
    agentRegistry: [],
  });

  return ensurePilotAgents({ taskPlatform, tenantId, actorId });
}

async function main() {
  const result = await seedPilotAgents();
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
  seedPilotAgents,
};
