'use strict';

const { interrupt } = require('@langchain/langgraph');
const { LangGraphRuntimeError } = require('./errors');

const DECISION_ACTIONS = new Set(['accept', 'reject', 'edit']);
const DEFAULT_HUMAN_GATES = Object.freeze({
  execution_contract: Object.freeze({ type: 'execution_contract_approval', authorizedRoles: ['pm', 'admin'], waitReason: 'Execution contract approval is required.', nextAction: 'Review and accept, reject, or edit the execution contract.' }),
  architect_handoff: Object.freeze({ type: 'architect_handoff_approval', authorizedRoles: ['architect', 'admin'], waitReason: 'Architect handoff approval is required.', nextAction: 'Review and accept, reject, or edit the architect handoff.' }),
  review: Object.freeze({ type: 'implementation_review', authorizedRoles: ['architect', 'pm', 'admin'], waitReason: 'Implementation review is required.', nextAction: 'Review and accept, reject, or edit the implementation submission.' }),
  merge_readiness: Object.freeze({ type: 'merge_readiness_approval', authorizedRoles: ['sre', 'admin'], waitReason: 'Merge readiness approval is required.', nextAction: 'Review merge evidence and accept or reject readiness.' }),
  closeout: Object.freeze({ type: 'closeout_approval', authorizedRoles: ['pm', 'admin'], waitReason: 'Product closeout approval is required.', nextAction: 'Review delivery evidence and accept or reject closeout.' }),
});

function sanitizeEdits(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LangGraphRuntimeError('langgraph_decision_invalid');
  const allowed = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(key) || typeof item !== 'string' || item.length > 1000) {
      throw new LangGraphRuntimeError('langgraph_decision_invalid');
    }
    allowed[key] = item;
  }
  const bytes = Buffer.byteLength(JSON.stringify(allowed));
  if (bytes > 8192) throw new LangGraphRuntimeError('langgraph_decision_invalid');
  return Object.freeze(allowed);
}

function validateDecision(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !DECISION_ACTIONS.has(value.action)) {
    throw new LangGraphRuntimeError('langgraph_decision_invalid');
  }
  const edits = sanitizeEdits(value.edits);
  if (value.action === 'edit' && (!edits || Object.keys(edits).length === 0)) {
    throw new LangGraphRuntimeError('langgraph_decision_invalid');
  }
  return Object.freeze({ action: value.action, edits });
}

function humanGate(node, state, policy) {
  if (!policy) return null;
  const payload = Object.freeze({
    type: policy.type,
    version: 1,
    node,
    tenantId: state.tenantId,
    factoryRunId: state.factoryRunId,
    threadId: state.threadId,
    authorizedRoles: policy.authorizedRoles,
    waitReason: policy.waitReason,
    nextAction: policy.nextAction,
  });
  return validateDecision(interrupt(payload));
}

function authorizedForInterrupt(interruptRecord, roles = []) {
  const granted = new Set(roles);
  return granted.has('admin') || (interruptRecord.authorizedRoles || []).some((role) => granted.has(role));
}

module.exports = { DECISION_ACTIONS, DEFAULT_HUMAN_GATES, authorizedForInterrupt, humanGate, sanitizeEdits, validateDecision };
