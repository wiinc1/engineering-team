'use strict';

const { errorEnvelope, LangGraphRuntimeError, normalizeRequestId } = require('./errors');

const STATUS_BY_CODE = Object.freeze({
  langgraph_checkpoint_unavailable: 503,
  langgraph_concurrency_conflict: 409,
  langgraph_configuration_invalid: 503,
  langgraph_migration_mismatch: 503,
  langgraph_state_invalid: 422,
  langgraph_tenant_mismatch: 403,
  langgraph_version_unsupported: 409,
});

function authorized(context, permission) {
  const roles = new Set(context?.roles || []);
  if (roles.has('admin') || roles.has('system')) return true;
  if (permission === 'health') return roles.has('sre') || roles.has('observability');
  return roles.has('reader') || roles.has('engineer') || roles.has('pm') || roles.has('architect') || roles.has('sre');
}

function sanitizeSummary(row) {
  return Object.freeze({
    threadId: row.thread_id,
    factoryRunId: row.factory_run_id,
    namespace: row.checkpoint_namespace,
    graphVersion: row.graph_version,
    stateSchemaVersion: Number(row.state_schema_version),
    status: row.status,
    latestNode: row.latest_node,
    checkpointSizeBytes: Number(row.checkpoint_size_bytes || 0),
    checkpointedAt: row.checkpointed_at,
    retentionExpiresAt: row.retention_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function createLangGraphHttpHandler(runtime) {
  return async function handle(input = {}) {
    const requestId = normalizeRequestId(input.requestId);
    try {
      if (!input.context?.tenantId && input.path !== '/api/v1/internal/langgraph/health') {
        throw new LangGraphRuntimeError('langgraph_tenant_mismatch', { safeDetails: { reason: 'missing_tenant' } });
      }
      if (input.method === 'GET' && input.path === '/api/v1/internal/langgraph/health') {
        if (!authorized(input.context, 'health')) return { status: 403, body: { error: { code: 'forbidden', message: 'Forbidden.', request_id: requestId, requestId } } };
        return { status: 200, body: { success: true, data: await runtime.health({ deep: input.query?.deep === 'true' }), requestId } };
      }
      if (input.method === 'GET' && input.path === '/api/v1/internal/langgraph/checkpoints') {
        if (!authorized(input.context, 'summary')) return { status: 403, body: { error: { code: 'forbidden', message: 'Forbidden.', request_id: requestId, requestId } } };
        const status = input.query?.status || null;
        if (status && !['active', 'paused', 'completed', 'failed', 'expired'].includes(status)) {
          return { status: 400, body: { error: { code: 'invalid_query', message: 'Invalid checkpoint status.', request_id: requestId, requestId } } };
        }
        const rows = await runtime.checkpointSummaries(input.context.tenantId, { status, limit: input.query?.limit });
        return { status: 200, body: { success: true, data: rows.map(sanitizeSummary), requestId } };
      }
      return { status: 404, body: { error: { code: 'not_found', message: 'Not found.', request_id: requestId, requestId } } };
    } catch (error) {
      return { status: STATUS_BY_CODE[error?.code] || 500, body: errorEnvelope(error, requestId) };
    }
  };
}

module.exports = { STATUS_BY_CODE, authorized, createLangGraphHttpHandler, sanitizeSummary };
