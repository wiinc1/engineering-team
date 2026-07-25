'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  PRODUCTION_SERVICE_BINDINGS,
  assertProductionLifecycleServices,
  canonicalRun,
  createProductionLifecyclePorts,
} = require('../../lib/software-factory/langgraph/production-ports');
const {
  enabled,
  loadProductionLifecycleHandlerFactory,
  loadProductionLifecycleHandlers,
  loadProductionLifecycleServices,
  resolveServiceModule,
} = require('../../lib/software-factory/langgraph/production-service-loader');
const {
  assertHandlers,
  createCanonicalLifecycleAudit,
  createCanonicalLifecycleServices,
  createCanonicalRunResolver,
} = require('../../lib/task-platform/langgraph-lifecycle-services');
const { isWorkflowAuditEventType } = require('../../lib/audit/event-types');

function services(overrides = {}) {
  const calls = [];
  const record = (name, result = { outcome: 'success' }) => async (request) => {
    calls.push([name, request]);
    return result;
  };
  return {
    calls,
    runs: { resolve: record('runs.resolve', { tenantId: 'tenant_alpha', factoryRunId: 'factory:281', taskId: 'TSK-281', projectId: 'PRJ-281', version: 7 }) },
    audit: { record: record('audit.record') },
    intake: { create: record('intake.create') },
    refinement: { refine: record('refinement.refine') },
    contracts: { createAndApprove: record('contracts.createAndApprove') },
    architecture: { handoff: record('architecture.handoff') },
    children: { plan: record('children.plan', [{ id: 'api', dependencies: [] }]), execute: record('children.execute') },
    implementation: { execute: record('implementation.execute', { outcome: 'success', delegation: { delegated: true, handledBy: 'jr_engineer' } }) },
    quality: { verify: record('quality.verify', { outcome: 'success', qaOutcome: 'pass' }), fix: record('quality.fix') },
    review: { approve: record('review.approve') },
    mergeReadiness: { verify: record('mergeReadiness.verify') },
    deployment: { deploy: record('deployment.deploy') },
    sre: { monitor: record('sre.monitor') },
    closeout: { complete: record('closeout.complete') },
    ...overrides,
  };
}

function state() {
  return {
    tenantId: 'tenant_alpha', factoryRunId: 'factory:281', threadId: 'lg_thread',
    completedNodes: ['intake'], qaAttempts: 1,
  };
}

function context(node) {
  return {
    tenantId: 'tenant_alpha', factoryRunId: 'factory:281', threadId: 'lg_thread', node,
    attempt: 2, idempotencyKey: `lg_thread:${node}:2`,
  };
}

function canonicalMockStore(appended, queries) {
  return {
    kind: 'postgres',
    pool: {
      async query(sql, params) {
        queries.push([sql, params]);
        return { rows: [{
          tenant_id: 'tenant_alpha', queue_id: 'factory:281', task_id: 'TSK-281',
          project_id: 'PRJ-281', attempts: 2,
        }] };
      },
    },
    async appendEvent(event) { appended.push(event); return { event, duplicate: false }; },
  };
}

test('production lifecycle ports bind every graph node to its canonical domain operation', async () => {
  const bundle = services();
  const ports = createProductionLifecyclePorts(bundle);
  for (const [node, binding] of Object.entries(PRODUCTION_SERVICE_BINDINGS)) {
    const result = await ports[node](state(), context(node));
    assert.equal(result.outcome, 'success');
    const call = bundle.calls.find(([name]) => name === binding.join('.'));
    assert.ok(call, `${node} did not invoke ${binding.join('.')}`);
    assert.deepEqual(call[1].run, {
      tenantId: 'tenant_alpha', factoryRunId: 'factory:281', taskId: 'TSK-281',
      projectId: 'PRJ-281', queueId: null, version: 7,
    });
    assert.equal(call[1].lifecycle.idempotencyKey, `lg_thread:${node}:2`);
    assert.deepEqual(call[1].lifecycle.completedNodes, ['intake']);
  }
});

test('production lifecycle ports bind child DAG and audit events with stable identities', async () => {
  const bundle = services();
  const ports = createProductionLifecyclePorts(bundle);
  assert.deepEqual(await ports.planChildren(state(), context('child_execution')), [{ id: 'api', dependencies: [] }]);
  await ports.executeChild({ id: 'api', dependencies: [] }, { ...context('child_execution'), namespace: 'child:api' });
  await ports.recordEvent({
    type: 'node_finished', node: 'qa', attempt: 2, outcome: 'success',
    tenantId: 'tenant_alpha', factoryRunId: 'factory:281', threadId: 'lg_thread',
    idempotencyKey: 'lg_thread:qa:2:finished',
  });
  const child = bundle.calls.find(([name]) => name === 'children.execute')[1];
  assert.deepEqual(child.child, { id: 'api', dependencies: [] });
  assert.equal(child.lifecycle.namespace, 'child:api');
  const audit = bundle.calls.find(([name]) => name === 'audit.record')[1];
  assert.equal(audit.run.taskId, 'TSK-281');
  assert.equal(audit.idempotencyKey, 'lg_thread:qa:2:finished');
  assert.equal(audit.outcome, 'success');
});

test('production lifecycle composition fails closed on incomplete services or forged canonical identity', async () => {
  assert.throws(() => assertProductionLifecycleServices({}), (error) => {
    assert.equal(error.code, 'langgraph_configuration_invalid');
    assert.ok(error.safeDetails.missing.includes('runs.resolve'));
    assert.ok(error.safeDetails.missing.includes('closeout.complete'));
    return true;
  });
  assert.throws(() => canonicalRun(null, {}), { code: 'langgraph_configuration_invalid' });
  assert.throws(() => canonicalRun({ tenantId: 'wrong', factoryRunId: 'factory:281', taskId: 'TSK' }, {
    tenantId: 'tenant_alpha', factoryRunId: 'factory:281',
  }), { code: 'langgraph_tenant_mismatch' });
  assert.throws(() => canonicalRun({ tenantId: 'tenant_alpha', factoryRunId: 'factory:281' }, {
    tenantId: 'tenant_alpha', factoryRunId: 'factory:281',
  }), { code: 'langgraph_configuration_invalid' });
  assert.equal(canonicalRun({ tenantId: 'tenant_alpha', factoryRunId: 'factory:281' }, {
    tenantId: 'tenant_alpha', factoryRunId: 'factory:281',
  }, { allowMissingTask: true }).taskId, null);
  const bundle = services({
    runs: { resolve: async () => ({ tenantId: 'tenant_other', factoryRunId: 'factory:281', taskId: 'TSK' }) },
  });
  await assert.rejects(() => createProductionLifecyclePorts(bundle).qa(state(), context('qa')), {
    code: 'langgraph_tenant_mismatch',
  });
});

test('taskless canonical runs are permitted only for intake execution and its start event', async () => {
  const bundle = services({
    runs: {
      resolve: async () => ({ tenantId: 'tenant_alpha', factoryRunId: 'factory:281', taskId: null }),
    },
  });
  const ports = createProductionLifecyclePorts(bundle);
  assert.deepEqual(await ports.intake(state(), context('intake')), { outcome: 'success' });
  await ports.recordEvent({
    type: 'node_started', node: 'intake', attempt: 1,
    tenantId: 'tenant_alpha', factoryRunId: 'factory:281', threadId: 'lg_thread',
    idempotencyKey: 'lg_thread:intake:1:started',
  });
  assert.equal(bundle.calls.find(([name]) => name === 'audit.record')[1].run.taskId, null);
  await assert.rejects(() => ports.recordEvent({
    type: 'node_finished', node: 'intake', attempt: 1, outcome: 'success',
    tenantId: 'tenant_alpha', factoryRunId: 'factory:281', threadId: 'lg_thread',
    idempotencyKey: 'lg_thread:intake:1:finished',
  }), { code: 'langgraph_configuration_invalid' });
  await assert.rejects(() => ports.qa(state(), context('qa')), {
    code: 'langgraph_configuration_invalid',
  });
});

test('revision-controlled lifecycle service loader is disabled safely and rejects paths outside the app', () => {
  const root = path.resolve(__dirname, '../..');
  assert.equal(loadProductionLifecycleServices({ enabled: false, baseDir: root, env: {} }), null);
  const loaded = loadProductionLifecycleServices({
    enabled: true,
    baseDir: root,
    modulePath: 'tests/fixtures/langgraph/production-lifecycle-services.js',
    env: {},
  });
  assert.equal(typeof loaded.closeout.complete, 'function');
  const handlers = loadProductionLifecycleHandlers({
    enabled: true,
    baseDir: root,
    modulePath: 'tests/fixtures/langgraph/production-lifecycle-services.js',
    env: {},
  });
  assert.equal(typeof handlers.closeout.complete, 'function');
  assert.throws(() => resolveServiceModule('../package.json', root), /inside the application directory/);
  assert.throws(() => loadProductionLifecycleServices({ enabled: true, baseDir: root, env: {} }), /is required/);
  for (const value of [true, 'true', '1', 'yes', 'on']) assert.equal(enabled(value), true);
  for (const value of [false, '', 'off']) assert.equal(enabled(value), false);
});

test('lifecycle loader supports object exports and rejects async or absent composition roots', () => {
  const root = path.resolve(__dirname, '../..');
  const common = { enabled: true, baseDir: root, env: {} };
  const objects = { ...common, modulePath: 'tests/fixtures/langgraph/production-lifecycle-objects.js' };
  assert.equal(typeof loadProductionLifecycleServices(objects).sre.monitor, 'function');
  assert.equal(typeof loadProductionLifecycleHandlers(objects).quality.verify, 'function');
  const asynchronous = { ...common, modulePath: 'tests/fixtures/langgraph/production-lifecycle-async.js' };
  assert.throws(() => loadProductionLifecycleServices(asynchronous), /must be synchronous/);
  assert.throws(() => loadProductionLifecycleHandlers(asynchronous), /must be synchronous/);
  assert.throws(() => loadProductionLifecycleHandlers({
    ...common, modulePath: 'tests/fixtures/langgraph/production-lifecycle-empty.js',
  }), /must export/);
});

test('lifecycle handler factory materializes lazily with the canonical runtime store', () => {
  const root = path.resolve(__dirname, '../..');
  const env = { FF_LANGGRAPH_RUNTIME: 'true' };
  const store = { kind: 'postgres', pool: { query() {} } };
  const factory = loadProductionLifecycleHandlerFactory({
    baseDir: root,
    modulePath: 'tests/fixtures/langgraph/production-lifecycle-context.js',
    env,
  });
  const handlers = factory({ store });
  assert.equal(handlers.context.store, store);
  assert.equal(handlers.context.env, env);
  assert.equal(handlers.context.baseDir, root);
  assert.equal(typeof handlers.deployment.deploy, 'function');
  assert.throws(() => loadProductionLifecycleHandlers({
    enabled: true,
    baseDir: root,
    modulePath: 'tests/fixtures/langgraph/production-lifecycle-context.js',
    env: {},
  }), /canonical store context is required/);
});

test('lifecycle loader rejects a symlink that escapes the revision root', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'langgraph-loader-'));
  const outsideFile = path.resolve(temporaryRoot, '..', `langgraph-outside-${process.pid}.js`);
  fs.writeFileSync(outsideFile, 'module.exports = {};\n');
  fs.symlinkSync(outsideFile, path.join(temporaryRoot, 'services.js'));
  try {
    assert.throws(() => resolveServiceModule('services.js', temporaryRoot), /inside the application directory/);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    fs.rmSync(outsideFile, { force: true });
  }
});

test('canonical lifecycle composition resolves runs from PostgreSQL and writes idempotent audit events', async () => {
  const appended = [];
  const queries = [];
  const fixture = services();
  const { calls: _calls, runs: _runs, audit: _audit, ...handlers } = fixture;
  const canonical = createCanonicalLifecycleServices({ store: canonicalMockStore(appended, queries), handlers });
  assert.deepEqual(await canonical.runs.resolve({ tenantId: 'tenant_alpha', factoryRunId: 'factory:281' }), {
    tenantId: 'tenant_alpha', factoryRunId: 'factory:281', queueId: 'factory:281',
    taskId: 'TSK-281', projectId: 'PRJ-281', version: 3,
  });
  assert.deepEqual(queries[0][1], ['tenant_alpha', 'factory:281']);
  const startedResult = await canonical.audit.record({
    run: { tenantId: 'tenant_alpha', factoryRunId: 'factory:281', taskId: 'TSK-281' },
    type: 'node_started', node: 'qa', attempt: 1, outcome: null,
    idempotencyKey: 'thread:qa:1:started', threadId: 'lg_thread', delegation: null,
  });
  const finishedResult = await canonical.audit.record({
    run: { tenantId: 'tenant_alpha', factoryRunId: 'factory:281', taskId: 'TSK-281' },
    type: 'node_finished', node: 'qa', attempt: 1, outcome: 'success',
    idempotencyKey: 'thread:qa:1:finished', threadId: 'lg_thread',
    delegation: { delegated: true, handledBy: 'qa' },
  });
  assert.equal(appended[0].eventType, 'task.langgraph_node_started');
  assert.equal(appended[1].eventType, 'task.langgraph_node_finished');
  assert.equal(appended[0].actorId, 'system:langgraph-runtime');
  assert.equal(appended[0].actorType, 'system');
  assert.equal(appended[0].source, 'langgraph-runtime');
  assert.equal(appended[0].payload.graph_version, 'factory-v1');
  assert.equal(appended[1].payload.outcome, 'success');
  assert.deepEqual(appended[1].payload.delegation, { delegated: true, handledBy: 'qa' });
  assert.equal(appended[1].correlationId, 'lg_thread');
  assert.equal(isWorkflowAuditEventType(appended[0].eventType), true);
  assert.equal(isWorkflowAuditEventType(appended[1].eventType), true);
  assert.equal(queries.filter(([sql]) => /factory_lifecycle_events/.test(sql)).length, 2);
  assert.equal(queries[1][1][3], 'TSK-281');
  assert.equal(queries[2][1][8], 'success');
  assert.equal(startedResult.duplicate, false);
  assert.equal(startedResult.canonicalAudit.event, appended[0]);
  assert.equal(finishedResult.event.task_id, 'TSK-281');
  assert.equal(finishedResult.canonicalAudit.event, appended[1]);
  await assert.rejects(() => canonical.audit.record({ type: 'unknown', run: {} }), /only accepts/);
});

test('taskless intake audit is durable in the run ledger and skips canonical task audit', async () => {
  const appended = [];
  let inserts = 0;
  const store = {
    kind: 'postgres',
    pool: {
      async query(sql, params) {
        assert.match(sql, /factory_lifecycle_events/);
        inserts += 1;
        return { rows: inserts === 1 ? [{ event_id: params[0], task_id: null }] : [] };
      },
    },
    async appendEvent(event) { appended.push(event); return { event, duplicate: false }; },
  };
  const audit = createCanonicalLifecycleAudit(store);
  const event = {
    run: { tenantId: 'tenant_alpha', factoryRunId: 'factory:281', taskId: null },
    type: 'node_started', node: 'intake', attempt: 1, outcome: null,
    idempotencyKey: 'lg_thread:intake:1:started',
    threadId: 'lg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', delegation: null,
  };
  const first = await audit(event);
  const replay = await audit(event);
  assert.equal(first.duplicate, false);
  assert.equal(first.event.task_id, null);
  assert.equal(first.canonicalAudit, null);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.event, null);
  assert.equal(replay.canonicalAudit, null);
  assert.equal(appended.length, 0);
});

test('canonical audit validates every PostgreSQL dependency independently', () => {
  const query = async () => ({ rows: [] });
  const appendEvent = async () => ({ duplicate: false });
  for (const store of [
    null,
    { kind: 'file', pool: { query }, appendEvent },
    { kind: 'postgres', appendEvent },
    { kind: 'postgres', pool: {}, appendEvent },
    { kind: 'postgres', pool: { query } },
  ]) {
    assert.throws(() => createCanonicalLifecycleAudit(store), /Canonical PostgreSQL lifecycle ledger/);
  }
});

test('canonical handler composition names every independently missing production operation', () => {
  const fixture = services();
  const { calls: _calls, runs: _runs, audit: _audit, ...complete } = fixture;
  const paths = [
    ['children', 'plan'], ['children', 'execute'],
    ...Object.values(PRODUCTION_SERVICE_BINDINGS),
  ];
  for (const [domain, method] of paths) {
    const handlers = Object.fromEntries(Object.entries(complete).map(([name, operations]) => [name, { ...operations }]));
    delete handlers[domain][method];
    assert.throws(() => assertHandlers(handlers), new RegExp(`${domain}\\.${method}`));
  }
  assert.equal(assertHandlers(complete), complete);
});

test('canonical audit reconciles a duplicate ledger row into task audit history', async () => {
  const canonicalEvent = { event_id: 'canonical-event' };
  const appended = [];
  const audit = createCanonicalLifecycleAudit({
    kind: 'postgres',
    pool: { async query() { return { rows: [] }; } },
    async appendEvent(event) {
      appended.push(event);
      return { event: canonicalEvent, duplicate: false };
    },
  });
  const result = await audit({
    run: { tenantId: 'tenant_alpha', factoryRunId: 'factory:281', taskId: 'TSK-281' },
    type: 'node_finished', node: 'intake', attempt: 1, outcome: 'success',
    idempotencyKey: 'lg_thread:intake:1:finished',
    threadId: 'lg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', delegation: null,
  });
  assert.equal(appended.length, 1);
  assert.equal(result.duplicate, true);
  assert.equal(result.event, canonicalEvent);
  assert.deepEqual(result.canonicalAudit, { event: canonicalEvent, duplicate: false });
});

test('canonical lifecycle composition rejects non-Postgres stores and incomplete handler bundles', async () => {
  assert.throws(() => createCanonicalRunResolver({ kind: 'file' }), /canonical PostgreSQL/);
  assert.throws(() => createCanonicalLifecycleServices({
    store: { kind: 'postgres', pool: { query() {} }, appendEvent() {} }, handlers: {},
  }), /Incomplete LangGraph lifecycle handlers/);
  const resolver = createCanonicalRunResolver({
    kind: 'postgres', pool: { async query() { return { rows: [] }; } },
  });
  assert.equal(await resolver({ tenantId: 'tenant_alpha', factoryRunId: 'missing' }), null);
});
