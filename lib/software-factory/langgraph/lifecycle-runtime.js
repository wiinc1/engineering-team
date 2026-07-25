'use strict';

const { LangGraphRuntimeError } = require('./errors');
const { deriveThreadId } = require('./identity');
const { createLifecycleDefinition } = require('./lifecycle');
const { DEFAULT_HUMAN_GATES } = require('./interrupts');
const { createLangGraphRuntime } = require('./runtime');

function assertWorkloadIdentity(input) {
  if (!input || typeof input !== 'object') throw new LangGraphRuntimeError('langgraph_state_invalid');
  const expectedThreadId = deriveThreadId({ tenantId: input.tenantId, factoryRunId: input.runId });
  if (input.threadId !== expectedThreadId) throw new LangGraphRuntimeError('langgraph_tenant_mismatch');
  if (input.workflowVersion !== 1) {
    throw new LangGraphRuntimeError('langgraph_version_unsupported', { safeDetails: { kind: 'workflow' } });
  }
  return expectedThreadId;
}

function createLifecycleRuntime(options = {}) {
  const definition = createLifecycleDefinition({
    ports: options.ports,
    maxNodeAttempts: options.maxNodeAttempts,
    maxQaAttempts: options.maxQaAttempts,
    nodeAttempts: options.nodeAttempts,
    humanGates: options.humanGates === false ? null : (options.humanGates || DEFAULT_HUMAN_GATES),
  });
  return createLangGraphRuntime({ ...options, ...definition });
}

function createLangGraphWorkloadAdapter(options = {}) {
  const runtime = options.runtime;
  if (!runtime || typeof runtime.invoke !== 'function' || typeof runtime.resume !== 'function') {
    throw new TypeError('A LangGraph runtime with invoke and resume is required.');
  }
  return Object.freeze({
    async start(input) {
      const threadId = assertWorkloadIdentity(input);
      const state = await runtime.invoke({ tenantId: input.tenantId, factoryRunId: input.runId });
      return Object.freeze({
        code: state.lifecycleStatus === 'succeeded' ? 'lifecycle_completed' : 'lifecycle_started',
        threadId,
        lifecycleStatus: state.lifecycleStatus,
        lifecycleNode: state.lifecycleNode,
      });
    },
    async resume(input) {
      const threadId = assertWorkloadIdentity(input);
      const state = await runtime.resume({ tenantId: input.tenantId, factoryRunId: input.runId, threadId });
      return Object.freeze({
        code: state.lifecycleStatus === 'succeeded' ? 'lifecycle_completed' : 'lifecycle_resumed',
        threadId,
        lifecycleStatus: state.lifecycleStatus,
        lifecycleNode: state.lifecycleNode,
      });
    },
    async lookupEffect(input) {
      const threadId = assertWorkloadIdentity(input);
      const record = await runtime.registry.get(input.tenantId, threadId);
      if (!record) return Object.freeze({ completed: false });
      return Object.freeze({
        completed: ['completed', 'failed'].includes(record.status),
        code: record.status === 'completed' ? 'lifecycle_completed' : `lifecycle_${record.status}`,
      });
    },
  });
}

module.exports = { assertWorkloadIdentity, createLangGraphWorkloadAdapter, createLifecycleRuntime };
