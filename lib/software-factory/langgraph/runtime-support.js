'use strict';

const { asRuntimeError, LangGraphRuntimeError } = require('./errors');
const { GRAPH_VERSION, STATE_SCHEMA_VERSION } = require('./constants');
const { deriveThreadId } = require('./identity');
const { validateFactoryState } = require('./state');

function timeout(promise, milliseconds, options = {}) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { options.onTimeout?.(); } catch {}
        reject(new LangGraphRuntimeError('langgraph_checkpoint_unavailable', { safeDetails: { reason: 'operation_timeout' } }));
      }, milliseconds);
    }),
  ]).catch((error) => { throw asRuntimeError(error); }).finally(() => clearTimeout(timer));
}
function throwIfAborted(signal) {
  if (signal.aborted) throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable', { safeDetails: { reason: 'operation_timeout' } });
}
function initialState(input, config, clock) {
  const threadId = deriveThreadId(input);
  return validateFactoryState({
    schemaVersion: STATE_SCHEMA_VERSION, graphVersion: GRAPH_VERSION,
    tenantId: input.tenantId, factoryRunId: input.factoryRunId, threadId, lifecycleNode: null,
    completedNodes: input.state?.completedNodes || [], artifacts: input.state?.artifacts || [], decisions: input.state?.decisions || [],
    attempt: input.state?.attempt || 0, updatedAt: new Date(clock.now()).toISOString(), lifecycleStatus: input.state?.lifecycleStatus || 'running',
    qaOutcome: input.state?.qaOutcome ?? null, qaAttempts: input.state?.qaAttempts || 0, terminalReason: input.state?.terminalReason ?? null,
    nodeAttempts: input.state?.nodeAttempts || {}, childRuns: input.state?.childRuns || [],
  }, { maxBytes: config.maxStateBytes });
}
function graphRunnableConfig(state, signal) {
  return { configurable: { thread_id: state.threadId, checkpoint_ns: '' }, ...(signal ? { signal } : {}) };
}
function beginLeaseHeartbeat(registry, input, onFailure) {
  let renewal = Promise.resolve();
  let failed = false;
  let stopped = false;
  const intervalMs = Math.max(100, Math.min(10_000, Math.floor(input.leaseMs / 4)));
  const renew = () => {
    renewal = renewal.then(async () => {
      if (failed || stopped) return;
      try { await timeout(registry.renewLease(input), intervalMs); }
      catch (error) { failed = true; try { onFailure(asRuntimeError(error)); } catch {} }
    });
  };
  const schedule = globalThis.setInterval;
  const timer = schedule(renew, intervalMs);
  timer.unref?.();
  return async () => { stopped = true; clearInterval(timer); await renewal; };
}
function interruptFromSnapshot(snapshot) {
  for (const task of snapshot?.tasks || []) {
    for (const item of task?.interrupts || []) {
      const value = item?.value;
      if (!value || typeof value !== 'object' || Number(value.version) !== 1) continue;
      if (!/^[a-z][a-z0-9_]{1,63}$/.test(String(value.type || ''))) continue;
      if (!Array.isArray(value.authorizedRoles) || value.authorizedRoles.length === 0) continue;
      return Object.freeze({
        interruptId: String(item.id), checkpointId: String(snapshot.config?.configurable?.checkpoint_id || ''),
        type: value.type, version: 1, payload: { node: value.node, factoryRunId: value.factoryRunId, threadId: value.threadId },
        authorizedRoles: value.authorizedRoles.map(String), waitReason: String(value.waitReason || '').slice(0, 256),
        nextAction: String(value.nextAction || '').slice(0, 256),
      });
    }
  }
  return null;
}
function sanitizeInterruptRow(row) {
  if (!row) return null;
  return Object.freeze({
    interruptId: row.interrupt_id, threadId: row.thread_id, checkpointId: row.checkpoint_id,
    type: row.interrupt_type, version: Number(row.interrupt_version), authorizedRoles: Object.freeze([...(row.authorized_roles || [])]),
    waitReason: row.wait_reason, nextAction: row.next_action, state: row.state, decisionVersion: Number(row.version),
    createdAt: row.created_at, resolvedAt: row.resolved_at || null,
  });
}

module.exports = { beginLeaseHeartbeat, graphRunnableConfig, initialState, interruptFromSnapshot, sanitizeInterruptRow, throwIfAborted, timeout };
