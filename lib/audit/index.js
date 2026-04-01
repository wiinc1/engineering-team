const { createAuditStore, createFileAuditStore, createPostgresAuditStore } = require('./store');
const { createPgPoolFromEnv, runMigrations } = require('./postgres');
const { resolveAuditBackend, isLocalLikeEnvironment, assertAuditBackendConfiguration } = require('./config');
const { WORKFLOW_AUDIT_EVENT_TYPES } = require('./event-types');
const { createAuditApiServer } = require('./http');
const { createProjectionWorker, createOutboxWorker, createSupervisedWorker } = require('./workers');
const { isAuditFoundationEnabled, assertAuditFoundationEnabled } = require('./feature-flags');
const { DEFAULT_AI_AGENT_REGISTRY, resolveAgentRegistry, findAgentById } = require('./agents');

module.exports = {
  createAuditStore,
  createFileAuditStore,
  createPostgresAuditStore,
  createPgPoolFromEnv,
  runMigrations,
  resolveAuditBackend,
  isLocalLikeEnvironment,
  assertAuditBackendConfiguration,
  createAuditApiServer,
  createProjectionWorker,
  createOutboxWorker,
  createSupervisedWorker,
  isAuditFoundationEnabled,
  assertAuditFoundationEnabled,
  WORKFLOW_AUDIT_EVENT_TYPES,
  DEFAULT_AI_AGENT_REGISTRY,
  resolveAgentRegistry,
  findAgentById,
};
