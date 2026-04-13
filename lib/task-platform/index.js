const { resolveAuditBackend } = require('../audit/config');
const { createFileTaskPlatformService } = require('./service');
const { createPostgresTaskPlatformService } = require('./postgres');

function createTaskPlatformService(options = {}) {
  const backend = options.taskPlatformBackend || resolveAuditBackend(options);
  if (backend === 'postgres') {
    return createPostgresTaskPlatformService(options);
  }
  return createFileTaskPlatformService(options);
}

module.exports = {
  createTaskPlatformService,
};
