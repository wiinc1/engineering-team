'use strict';

const crypto = require('crypto');
const { LangGraphRuntimeError } = require('./errors');

const TENANT_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const RUN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const THREAD_PATTERN = /^lg_[a-f0-9]{48}$/;

function assertTenantId(tenantId) {
  if (typeof tenantId !== 'string' || !TENANT_PATTERN.test(tenantId)) {
    throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'tenant_id' } });
  }
  return tenantId;
}

function assertFactoryRunId(factoryRunId) {
  if (typeof factoryRunId !== 'string' || !RUN_PATTERN.test(factoryRunId)) {
    throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'factory_run_id' } });
  }
  return factoryRunId;
}

function deriveThreadId({ tenantId, factoryRunId }) {
  assertTenantId(tenantId);
  assertFactoryRunId(factoryRunId);
  return `lg_${crypto.createHash('sha256').update(`${tenantId}\0${factoryRunId}`, 'utf8').digest('hex').slice(0, 48)}`;
}

function assertThreadId(threadId) {
  if (typeof threadId !== 'string' || !THREAD_PATTERN.test(threadId)) {
    throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'thread_id' } });
  }
  return threadId;
}

module.exports = { RUN_PATTERN, TENANT_PATTERN, THREAD_PATTERN, assertFactoryRunId, assertTenantId, assertThreadId, deriveThreadId };
