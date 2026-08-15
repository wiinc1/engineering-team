'use strict';

const { Command } = require('@langchain/langgraph');
const { withTenantBinding } = require('./binding');
const { LangGraphRuntimeError } = require('./errors');
const { graphRunnableConfig, sanitizeInterruptRow } = require('./runtime-support');
const { projectFactoryState, validateFactoryState } = require('./state');

async function runStatus(runtime, input) {
  if (!runtime.ready || runtime.closed) throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable');
  const record = await runtime.registry.assertBinding(input.tenantId, input.threadId);
  const runnableConfig = graphRunnableConfig({ threadId: input.threadId });
  const snapshot = await withTenantBinding({ tenantId: input.tenantId, threadId: input.threadId }, () => runtime.graph.getState(runnableConfig));
  const values = snapshot?.values || {};
  const pending = await runtime.registry.pendingInterrupt(input.tenantId, input.threadId);
  return Object.freeze({
    threadId: record.thread_id, factoryRunId: record.factory_run_id, graphVersion: record.graph_version,
    stateSchemaVersion: Number(record.state_schema_version), status: record.status,
    currentNode: values.lifecycleNode || record.latest_node || null,
    completedNodes: Object.freeze([...(values.completedNodes || [])]), lifecycleStatus: values.lifecycleStatus || null,
    attempts: Object.freeze({ ...(values.nodeAttempts || {}) }),
    checkpoint: Object.freeze({
      id: record.last_checkpoint_id || null, freshAt: record.checkpointed_at || null,
      stale: Boolean(record.checkpointed_at && Date.now() - Date.parse(record.checkpointed_at) > 300_000),
    }),
    error: values.terminalReason ? Object.freeze({ code: values.terminalReason }) : null,
    interrupt: sanitizeInterruptRow(pending),
    nextAction: pending?.next_action || (record.status === 'failed' ? 'Request an eligible node retry or cancel the run.' : null),
  });
}
async function resumeDecision(runtime, input) {
  runtime.assertReady();
  await runtime.ownershipGuard?.assert();
  const record = await runtime.registry.assertBinding(input.tenantId, input.threadId);
  if (String(record.last_checkpoint_id) !== String(input.checkpointId)) throw new LangGraphRuntimeError('langgraph_decision_conflict');
  const state = { tenantId: input.tenantId, threadId: input.threadId, factoryRunId: record.factory_run_id };
  return runtime.withLease(state, async () => {
    const runnableConfig = graphRunnableConfig(state);
    const result = await runtime.graph.invoke(new Command({ resume: { action: input.action, edits: input.edits || null } }), runnableConfig);
    await runtime.updateCompletionStatus(input.tenantId, input.threadId, runnableConfig, result);
    return validateFactoryState(projectFactoryState(result), { maxBytes: runtime.config.maxStateBytes });
  });
}
async function retryNode(runtime, input) {
  runtime.assertReady();
  await runtime.ownershipGuard?.assert();
  const record = await runtime.registry.assertBinding(input.tenantId, input.threadId);
  const state = { tenantId: input.tenantId, threadId: input.threadId, factoryRunId: record.factory_run_id };
  return runtime.withLease(state, async () => {
    const runnableConfig = graphRunnableConfig(state);
    const values = (await runtime.graph.getState(runnableConfig))?.values || {};
    const attempt = Number(values.nodeAttempts?.[input.node] || 0);
    if (values.lifecycleNode !== input.node || !['failed', 'dead_letter', 'retrying'].includes(values.lifecycleStatus) || attempt >= (input.maxAttempts || 3)) {
      throw new LangGraphRuntimeError('langgraph_decision_conflict', { safeDetails: { reason: 'retry_ineligible' } });
    }
    await runtime.graph.updateState(runnableConfig, { lifecycleStatus: 'retrying', terminalReason: null }, input.node);
    const result = await runtime.graph.invoke(null, runnableConfig);
    await runtime.updateCompletionStatus(input.tenantId, input.threadId, runnableConfig, result);
    return validateFactoryState(projectFactoryState(result), { maxBytes: runtime.config.maxStateBytes });
  });
}
async function cancel(runtime, input) {
  runtime.assertReady();
  await runtime.ownershipGuard?.assert();
  const record = await runtime.registry.assertBinding(input.tenantId, input.threadId);
  if (['completed', 'failed', 'cancelled', 'expired'].includes(record.status)) throw new LangGraphRuntimeError('langgraph_decision_conflict');
  const state = { tenantId: input.tenantId, threadId: input.threadId, factoryRunId: record.factory_run_id };
  return runtime.withLease(state, async () => {
    const runnableConfig = graphRunnableConfig(state);
    const node = (await runtime.graph.getState(runnableConfig))?.values?.lifecycleNode;
    if (!node) throw new LangGraphRuntimeError('langgraph_decision_conflict');
    await runtime.graph.updateState(runnableConfig, { lifecycleStatus: 'cancelled', terminalReason: input.reasonCode || 'operator_cancelled' }, node);
    const result = await runtime.graph.invoke(null, runnableConfig);
    await runtime.updateCompletionStatus(input.tenantId, input.threadId, runnableConfig, result);
    return validateFactoryState(projectFactoryState(result), { maxBytes: runtime.config.maxStateBytes });
  });
}

module.exports = { cancel, resumeDecision, retryNode, runStatus };
