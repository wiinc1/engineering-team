const { createAuditStore } = require('../lib/audit/store');
const { assertAuditBackendConfiguration, logAuditBackendSelection } = require('../lib/audit/config');
const { createTaskPlatformService } = require('../lib/task-platform');
const { backfillCanonicalTasks } = require('../lib/task-platform/backfill');

async function main() {
  const tenantId = process.env.TENANT_ID || 'engineering-team';
  const backendConfig = assertAuditBackendConfiguration();
  logAuditBackendSelection(backendConfig);
  const store = createAuditStore({
    baseDir: process.cwd(),
    ...backendConfig,
  });
  const taskPlatform = createTaskPlatformService({
    baseDir: process.cwd(),
    ...backendConfig,
  });

  const result = await backfillCanonicalTasks({
    store,
    taskPlatform,
    tenantId,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
