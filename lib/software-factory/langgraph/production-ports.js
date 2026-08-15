'use strict';

const { LangGraphRuntimeError } = require('./errors');

const PRODUCTION_SERVICE_BINDINGS = Object.freeze({
  intake: Object.freeze(['intake', 'create']),
  pm_refinement: Object.freeze(['refinement', 'refine']),
  execution_contract: Object.freeze(['contracts', 'createAndApprove']),
  architect_handoff: Object.freeze(['architecture', 'handoff']),
  implementation: Object.freeze(['implementation', 'execute']),
  qa: Object.freeze(['quality', 'verify']),
  fix: Object.freeze(['quality', 'fix']),
  review: Object.freeze(['review', 'approve']),
  merge_readiness: Object.freeze(['mergeReadiness', 'verify']),
  deployment: Object.freeze(['deployment', 'deploy']),
  sre: Object.freeze(['sre', 'monitor']),
  closeout: Object.freeze(['closeout', 'complete']),
});

function configurationError(reason, details = {}) {
  return new LangGraphRuntimeError('langgraph_configuration_invalid', {
    safeDetails: { reason, ...details },
  });
}

function operation(services, path) {
  const [domain, method] = path;
  const value = services?.[domain]?.[method];
  return typeof value === 'function' ? value.bind(services[domain]) : null;
}

function assertProductionLifecycleServices(services) {
  const missing = [];
  if (typeof services?.runs?.resolve !== 'function') missing.push('runs.resolve');
  if (typeof services?.audit?.record !== 'function') missing.push('audit.record');
  if (typeof services?.children?.plan !== 'function') missing.push('children.plan');
  if (typeof services?.children?.execute !== 'function') missing.push('children.execute');
  for (const path of Object.values(PRODUCTION_SERVICE_BINDINGS)) {
    if (!operation(services, path)) missing.push(path.join('.'));
  }
  if (missing.length) throw configurationError('lifecycle_services_missing', { missing: missing.sort() });
  return services;
}

function canonicalRun(run, expected, options = {}) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    throw configurationError('canonical_run_missing');
  }
  if (run.tenantId !== expected.tenantId || run.factoryRunId !== expected.factoryRunId) {
    throw new LangGraphRuntimeError('langgraph_tenant_mismatch');
  }
  const taskId = typeof run.taskId === 'string' && run.taskId.trim() ? run.taskId : null;
  if (!taskId && !options.allowMissingTask) {
    throw configurationError('canonical_task_missing');
  }
  return Object.freeze({
    tenantId: run.tenantId,
    factoryRunId: run.factoryRunId,
    taskId,
    projectId: run.projectId || null,
    queueId: run.queueId || null,
    version: Number.isInteger(run.version) ? run.version : null,
  });
}

function domainRequest(run, state, context, extra = {}) {
  return Object.freeze({
    run,
    lifecycle: Object.freeze({
      node: context.node,
      attempt: context.attempt,
      idempotencyKey: context.idempotencyKey,
      threadId: context.threadId,
      completedNodes: Object.freeze([...(state.completedNodes || [])]),
      qaAttempt: state.qaAttempts || 0,
      ...(context.namespace ? { namespace: context.namespace } : {}),
      ...(context.decision ? { decision: context.decision } : {}),
    }),
    ...extra,
  });
}

async function resolveRun(services, state, node) {
  const expected = { tenantId: state.tenantId, factoryRunId: state.factoryRunId };
  return canonicalRun(await services.runs.resolve(expected), expected, {
    allowMissingTask: node === 'intake',
  });
}

function eventPort(services) {
  return async (event) => {
    const run = canonicalRun(await services.runs.resolve({
      tenantId: event.tenantId, factoryRunId: event.factoryRunId,
    }), event, { allowMissingTask: event.node === 'intake' && event.type === 'node_started' });
    return services.audit.record(Object.freeze({
      run, type: event.type, node: event.node, attempt: event.attempt,
      outcome: event.outcome || null, idempotencyKey: event.idempotencyKey,
      threadId: event.threadId, delegation: event.delegation || null,
    }));
  };
}

function childPlanPort(services) {
  return async (state, context) => {
    const run = await resolveRun(services, state, 'child_execution');
    return services.children.plan(domainRequest(run, state, context));
  };
}

function childExecutionPort(services) {
  return async (child, context) => {
    const expected = { tenantId: context.tenantId, factoryRunId: context.factoryRunId };
    const run = canonicalRun(await services.runs.resolve(expected), expected);
    return services.children.execute(Object.freeze({
      run,
      child: Object.freeze({ id: child.id, dependencies: Object.freeze([...child.dependencies]) }),
      lifecycle: Object.freeze({
        node: context.node, attempt: context.attempt, namespace: context.namespace,
        idempotencyKey: context.idempotencyKey, threadId: context.threadId,
      }),
    }));
  };
}

function createProductionLifecyclePorts(input) {
  const services = assertProductionLifecycleServices(input);
  const ports = {
    recordEvent: eventPort(services),
    planChildren: childPlanPort(services),
    executeChild: childExecutionPort(services),
  };
  for (const [node, path] of Object.entries(PRODUCTION_SERVICE_BINDINGS)) {
    const execute = operation(services, path);
    ports[node] = async (state, context) => {
      const run = await resolveRun(services, state, node);
      return execute(domainRequest(run, state, context));
    };
  }
  return Object.freeze(ports);
}

module.exports = {
  PRODUCTION_SERVICE_BINDINGS,
  assertProductionLifecycleServices,
  canonicalRun,
  createProductionLifecyclePorts,
  domainRequest,
};
