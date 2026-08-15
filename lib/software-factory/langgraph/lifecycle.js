'use strict';

const { END, isGraphBubbleUp } = require('@langchain/langgraph');
const { LangGraphRuntimeError } = require('./errors');
const { humanGate } = require('./interrupts');

const LIFECYCLE_NODE_NAMES = Object.freeze([
  'intake',
  'pm_refinement',
  'execution_contract',
  'architect_handoff',
  'child_execution',
  'implementation',
  'qa',
  'fix',
  'review',
  'merge_readiness',
  'deployment',
  'sre',
  'closeout',
  'terminal',
]);

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'dead_letter', 'cancelled']);
const RESULT_OUTCOMES = new Set(['success', 'retry', 'failed', 'dead_letter', 'cancelled']);

function code(value, fallback) {
  const normalized = String(value || fallback || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  return /^[a-z][a-z0-9_]{1,63}$/.test(normalized) ? normalized : fallback;
}

function normalizeResult(result = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'node_result' } });
  }
  const outcome = result.outcome || 'success';
  if (!RESULT_OUTCOMES.has(outcome)) {
    throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'node_outcome' } });
  }
  if (result.delegation !== undefined) {
    const delegation = result.delegation;
    if (!delegation || typeof delegation !== 'object' || Array.isArray(delegation)
      || typeof delegation.delegated !== 'boolean'
      || !/^[a-z][a-z0-9_-]{1,63}$/.test(String(delegation.handledBy || ''))) {
      throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'delegation_evidence' } });
    }
    if (delegation.delegated === true && delegation.handledBy === 'factory_orchestrator') {
      throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'delegation_attribution' } });
    }
  }
  return { ...result, outcome };
}

function classifyFailure(error, attempt, maximumAttempts) {
  if (error?.code === 'factory_cancelled') return { outcome: 'cancelled', reason: 'factory_cancelled' };
  if (error?.retryable === true && attempt < maximumAttempts) {
    return { outcome: 'retry', reason: code(error.code, 'node_retryable_failure') };
  }
  return {
    outcome: attempt >= maximumAttempts ? 'dead_letter' : 'failed',
    reason: code(error?.code, 'node_execution_failed'),
  };
}

function childNamespace(id) {
  return `child:${id}`;
}

function validateChildDefinitions(children) {
  if (!Array.isArray(children) || children.length > 128) {
    throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'child_plan' } });
  }
  const ids = new Set();
  const normalized = children.map((child) => {
    const id = String(child?.id || '');
    const dependencies = Array.isArray(child?.dependencies) ? [...child.dependencies] : [];
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(id) || ids.has(id)) {
      throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'child_id' } });
    }
    ids.add(id);
    return { id, dependencies };
  });
  for (const child of normalized) {
    if (child.dependencies.includes(child.id) || child.dependencies.some((dependency) => !ids.has(dependency))) {
      throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'child_dependency' } });
    }
  }
  return normalized;
}

async function executeChildPlan(children, executeChild, context) {
  const plan = validateChildDefinitions(children);
  const pending = new Map(plan.map((child) => [child.id, child]));
  const completed = new Set();
  const runs = new Map(plan.map((child) => [child.id, {
    id: child.id,
    status: child.dependencies.length === 0 ? 'ready' : 'blocked',
    dependencies: child.dependencies,
    attempt: 0,
    namespace: childNamespace(child.id),
  }]));
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((child) => child.dependencies.every((id) => completed.has(id)));
    if (ready.length === 0) {
      throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'child_dependency_cycle' } });
    }
    const results = await Promise.all(ready.map(async (child) => {
      const namespace = childNamespace(child.id);
      const result = normalizeResult(await executeChild(child, {
        ...context,
        namespace,
        idempotencyKey: `${context.idempotencyKey}:${child.id}`,
      }));
      return {
        id: child.id,
        status: result.outcome === 'success'
          ? 'succeeded'
          : result.outcome === 'cancelled' ? 'cancelled' : 'failed',
        dependencies: child.dependencies,
        attempt: 1,
        namespace,
      };
    }));
    for (const run of results) {
      runs.set(run.id, run);
      pending.delete(run.id);
      if (run.status !== 'succeeded') return [...runs.values()];
      completed.add(run.id);
    }
    for (const child of pending.values()) {
      if (child.dependencies.every((id) => completed.has(id))) {
        runs.set(child.id, { ...runs.get(child.id), status: 'ready' });
      }
    }
  }
  return [...runs.values()];
}

function nodeExecutor(name, options) {
  const maximumAttempts = options.nodeAttempts?.[name] || options.maxNodeAttempts || 3;
  return async (state) => {
    const attempt = (state.nodeAttempts?.[name] || 0) + 1;
    const context = Object.freeze({
      tenantId: state.tenantId,
      factoryRunId: state.factoryRunId,
      threadId: state.threadId,
      node: name,
      attempt,
      idempotencyKey: `${state.threadId}:${name}:${attempt}`,
    });
    let result;
    try {
      const gateDecision = humanGate(name, state, options.humanGates?.[name]);
      if (gateDecision?.action === 'reject') {
        return {
          lifecycleStatus: 'failed', terminalReason: `${name}_rejected`,
          decisions: [{ code: `${name}_decision`, outcome: 'rejected' }],
          nodeAttempts: { [name]: attempt }, attempt,
        };
      }
      await options.ports.recordEvent({
        type: 'node_started', node: name, attempt, tenantId: state.tenantId,
        factoryRunId: state.factoryRunId, threadId: state.threadId,
        idempotencyKey: `${context.idempotencyKey}:started`,
      });
      result = await invokeLifecyclePort(name, state, context, gateDecision, options);
      await options.ports.recordEvent({
        type: 'node_finished', node: name, attempt, outcome: result.outcome,
        tenantId: state.tenantId, factoryRunId: state.factoryRunId, threadId: state.threadId,
        idempotencyKey: `${context.idempotencyKey}:finished`,
        ...(result.delegation ? { delegation: result.delegation } : {}),
      });
    } catch (error) {
      if (isGraphBubbleUp(error)) throw error;
      result = classifyFailure(error, attempt, maximumAttempts);
    }

    return lifecycleUpdate(name, state, result, attempt, options);
  };
}

async function invokeLifecyclePort(name, state, context, gateDecision, options) {
  if (name === 'child_execution') {
    const children = await options.ports.planChildren?.(state, context) || [];
    const childRuns = await executeChildPlan(children, options.ports.executeChild, context);
    const failed = childRuns.find((child) => child.status !== 'succeeded');
    return failed
      ? { outcome: failed.status === 'cancelled' ? 'cancelled' : 'failed', terminalReason: 'child_execution_failed', childRuns }
      : { outcome: 'success', childRuns };
  }
  if (name === 'terminal') return { outcome: 'success' };
  const namedPort = options.ports[name];
  const port = namedPort || options.ports.invoke;
  if (typeof port !== 'function') {
    throw new LangGraphRuntimeError('langgraph_configuration_invalid', { safeDetails: { reason: 'lifecycle_port_missing', node: name } });
  }
  const gateContext = gateDecision ? Object.freeze({ ...context, decision: gateDecision }) : context;
  return normalizeResult(await (namedPort ? port(state, gateContext) : port(name, state, gateContext)));
}

function lifecycleUpdate(name, state, initialResult, attempt, options) {
  let result = initialResult;
  const update = {
    nodeAttempts: { [name]: attempt }, attempt, artifacts: result.artifacts || [], decisions: result.decisions || [],
    ...(result.childRuns ? { childRuns: result.childRuns } : {}),
  };
  if (name === 'qa') {
    const qaOutcome = result.qaOutcome || (result.outcome === 'success' ? 'pass' : 'fail');
    update.qaOutcome = qaOutcome;
    update.qaAttempts = state.qaAttempts + 1;
    if (qaOutcome === 'fail' && update.qaAttempts >= options.maxQaAttempts) {
      result = { ...result, outcome: 'dead_letter', terminalReason: 'qa_retry_exhausted' };
    }
  }
  if (name === 'fix' && result.outcome === 'success') update.qaOutcome = null;
  if (name === 'closeout' && result.outcome === 'success') update.lifecycleStatus = 'succeeded';
  else if (name === 'terminal') update.lifecycleStatus = state.lifecycleStatus;
  else if (result.outcome === 'success') update.lifecycleStatus = 'running';
  else if (result.outcome === 'retry') update.lifecycleStatus = 'retrying';
  else update.lifecycleStatus = result.outcome;
  if (!['success', 'retry'].includes(result.outcome)) update.terminalReason = code(result.terminalReason || result.reason, 'lifecycle_terminal');
  return update;
}

function standardRoute(nextNode) {
  return {
    route: (state) => {
      if (TERMINAL_STATUSES.has(state.lifecycleStatus)) return 'terminal';
      if (state.lifecycleStatus === 'retrying') return 'retry';
      return 'next';
    },
    targets: { next: nextNode, retry: null, terminal: 'terminal' },
  };
}

function createLifecycleDefinition(options = {}) {
  if (!options.ports || typeof options.ports !== 'object') throw new TypeError('Lifecycle ports are required.');
  if (typeof options.ports.executeChild !== 'function') throw new TypeError('executeChild lifecycle port is required.');
  if (typeof options.ports.recordEvent !== 'function') throw new TypeError('recordEvent lifecycle port is required.');
  const resolved = {
    ...options,
    maxNodeAttempts: options.maxNodeAttempts || 3,
    maxQaAttempts: options.maxQaAttempts || 3,
    humanGates: options.humanGates || null,
  };
  const nodes = LIFECYCLE_NODE_NAMES.map((name) => ({ name, execute: nodeExecutor(name, resolved) }));
  const transitions = {};
  for (let index = 0; index < LIFECYCLE_NODE_NAMES.length - 2; index += 1) {
    const name = LIFECYCLE_NODE_NAMES[index];
    const next = LIFECYCLE_NODE_NAMES[index + 1];
    const transition = standardRoute(next);
    transition.targets.retry = name;
    transitions[name] = transition;
  }
  transitions.qa = {
    route: (state) => {
      if (TERMINAL_STATUSES.has(state.lifecycleStatus)) return 'terminal';
      if (state.lifecycleStatus === 'retrying') return 'retry';
      return state.qaOutcome === 'fail' ? 'fix' : 'review';
    },
    targets: { retry: 'qa', fix: 'fix', review: 'review', terminal: 'terminal' },
  };
  transitions.fix = {
    route: (state) => {
      if (TERMINAL_STATUSES.has(state.lifecycleStatus)) return 'terminal';
      if (state.lifecycleStatus === 'retrying') return 'retry';
      return 'qa';
    },
    targets: { retry: 'fix', qa: 'qa', terminal: 'terminal' },
  };
  transitions.closeout = {
    route: (state) => (state.lifecycleStatus === 'succeeded' ? 'end' : 'terminal'),
    targets: { end: END, terminal: 'terminal' },
  };
  transitions.terminal = END;
  return Object.freeze({ entryNode: 'intake', nodes: Object.freeze(nodes), transitions: Object.freeze(transitions) });
}

module.exports = {
  LIFECYCLE_NODE_NAMES,
  TERMINAL_STATUSES,
  classifyFailure,
  createLifecycleDefinition,
  executeChildPlan,
  normalizeResult,
  validateChildDefinitions,
};
