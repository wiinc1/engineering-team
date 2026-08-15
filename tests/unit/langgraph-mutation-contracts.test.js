'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DEFINITIONS,
  FactoryStateAnnotation,
  LangGraphRuntimeError,
  appendObjectsReducer,
  assertFactoryRunId,
  assertInvocationAllowed,
  assertTenantId,
  assertThreadId,
  boolean,
  deriveThreadId,
  integer,
  jsonBytes,
  runtimeConfig,
  scanForSecrets,
  uniqueSortedReducer,
  validateFactoryState,
} = require('../../lib/software-factory/langgraph');
const { artifact, state } = require('../fixtures/langgraph/v1');

function capture(action) {
  try { action(); } catch (error) { return error; }
  assert.fail('Expected action to throw.');
}

function assertStateError(value, reason, field) {
  const error = capture(() => validateFactoryState(value));
  assert.equal(error.code, 'langgraph_state_invalid');
  assert.equal(error.message, 'Graph state was rejected.');
  assert.equal(error.retryable, false);
  assert.deepEqual(error.safeDetails, { reason, ...(field ? { field } : {}) });
}

test('all stable error definitions preserve exact safe messages and retryability', () => {
  const expected = {
    langgraph_checkpoint_unavailable: ['Checkpoint storage is unavailable.', true],
    langgraph_concurrency_conflict: ['The graph thread is already being resumed.', true],
    langgraph_configuration_invalid: ['LangGraph runtime configuration is invalid.', false],
    langgraph_decision_conflict: ['The graph decision is stale or conflicts with another decision.', false],
    langgraph_decision_forbidden: ['The graph decision is not permitted.', false],
    langgraph_decision_invalid: ['The graph decision was rejected.', false],
    langgraph_interrupt_not_found: ['The graph interrupt was not found.', false],
    langgraph_mutations_disabled: ['Graph mutations are disabled.', false],
    langgraph_migration_mismatch: ['LangGraph checkpoint schema is incompatible.', false],
    langgraph_state_invalid: ['Graph state was rejected.', false],
    langgraph_tenant_mismatch: ['Graph thread tenant binding does not match.', false],
    langgraph_version_unsupported: ['Graph or state version is unsupported.', false],
  };
  assert.deepEqual(DEFINITIONS, expected);
  for (const [code, [message, retryable]] of Object.entries(expected)) {
    const cause = new Error('internal');
    const error = new LangGraphRuntimeError(code, { cause });
    assert.equal(error.name, 'LangGraphRuntimeError');
    assert.equal(error.message, message);
    assert.equal(error.retryable, retryable);
    assert.equal(error.cause, cause);
  }
});

test('configuration errors retain exact safe reasons and whitespace normalization', () => {
  assert.equal(boolean('  YES  ', false), true);
  assert.equal(boolean('  OFF  ', true), false);
  assert.equal(integer(' 7 ', 1, 1, 10), 7);
  const reasons = [
    [() => boolean('wrong', false), 'invalid_boolean'],
    [() => integer('nan', 1, 1, 2), 'invalid_integer'],
    [() => runtimeConfig({ saver: 'redis' }, {}), 'unsupported_checkpointer'],
    [() => runtimeConfig({ production: true, saver: 'memory', pool: {} }, {}), 'production_requires_postgres'],
    [() => runtimeConfig({ production: true, enabled: true }, {}), 'database_url_required'],
    [() => runtimeConfig({ schema: 'public' }, {}), 'schema_must_be_dedicated'],
    [() => assertInvocationAllowed({ enabled: false, killSwitch: false }), 'runtime_disabled'],
    [() => assertInvocationAllowed({ enabled: true, killSwitch: true }), 'global_kill_switch'],
  ];
  for (const [action, reason] of reasons) {
    const error = capture(action);
    assert.equal(error.code, 'langgraph_configuration_invalid');
    assert.deepEqual(error.safeDetails, { reason });
  }
  const normalized = runtimeConfig({ saver: '  POSTGRES  ', resumeLeaseMs: 4000 }, {
    LANGGRAPH_RESUME_LEASE_MS: '9000', NODE_ENV: 'test',
  });
  assert.equal(normalized.saver, 'postgres');
  assert.equal(normalized.resumeLeaseMs, 4000);
  assert.equal(normalized.killSwitch, false);
  assert.equal(normalized.production, false);
  assert.equal(runtimeConfig({ enabled: 'false', killSwitch: 'false' }, {}).enabled, false);
  assert.equal(runtimeConfig({ enabled: 'true', killSwitch: 'true' }, {}).killSwitch, true);
});

test('identifier regexes are fully anchored and failures retain exact reasons', () => {
  const valid = deriveThreadId({ tenantId: 'tenant_ok', factoryRunId: 'run:ok' });
  for (const [action, reason] of [
    [() => assertTenantId('!tenant_ok'), 'tenant_id'],
    [() => assertTenantId('tenant_ok!'), 'tenant_id'],
    [() => assertFactoryRunId('!run'), 'factory_run_id'],
    [() => assertFactoryRunId('run!'), 'factory_run_id'],
    [() => assertThreadId(`x${valid}`), 'thread_id'],
    [() => assertThreadId(`${valid}x`), 'thread_id'],
  ]) {
    const error = capture(action);
    assert.equal(error.code, 'langgraph_state_invalid');
    assert.deepEqual(error.safeDetails, { reason });
  }
});

test('state patterns are anchored and every rejection emits exact non-secret reason/field', () => {
  assertStateError(state({ lifecycleNode: 'node_ok!' }), 'lifecycle_node');
  assertStateError(state({ lifecycleNode: '!node_ok' }), 'lifecycle_node');
  assertStateError(state({ completedNodes: [1] }), 'node_name', 'completedNodes');
  assertStateError(state({ completedNodes: Array.from({ length: 129 }, (_, index) => `node_${index}`) }), 'array_shape', 'completedNodes');
  assertStateError(state({ completedNodes: ['node_ok', 'node_ok'] }), 'duplicate_node', 'completedNodes');
  assertStateError(state({ artifacts: [{ ...artifact(), kind: 'kind_ok!' }] }), 'artifact_kind', 'artifacts.0.kind');
  assertStateError(state({ artifacts: [{ ...artifact(), kind: '!kind_ok' }] }), 'artifact_kind', 'artifacts.0.kind');
  assertStateError(state({ artifacts: [{ ...artifact(), checksum: `xsha256:${'a'.repeat(64)}` }] }), 'artifact_checksum', 'artifacts.0.checksum');
  assertStateError(state({ artifacts: [{ ...artifact(), checksum: `sha256:${'a'.repeat(64)}x` }] }), 'artifact_checksum', 'artifacts.0.checksum');
  assertStateError(state({ artifacts: [{ ...artifact(), reference: '' }] }), 'artifact_reference', 'artifacts.0.reference');
  assert.equal(validateFactoryState(state({ artifacts: [{ ...artifact(), reference: 'x' }] })).artifacts[0].reference, 'x');
  assert.equal(validateFactoryState(state({ artifacts: [{ ...artifact(), reference: 'x'.repeat(512) }] })).artifacts[0].reference.length, 512);
  assertStateError(state({ decisions: [{ code: 'code_ok!', outcome: 'approved' }] }), 'decision_code', 'decisions.0.code');
  assertStateError(state({ decisions: [{ code: '!code_ok', outcome: 'approved' }] }), 'decision_code', 'decisions.0.code');
  assertStateError(state({ decisions: [{ code: 'code_ok', outcome: 'unknown' }] }), 'decision_outcome', 'decisions.0.outcome');
  assert.equal(validateFactoryState(state({ completedNodes: Array.from({ length: 128 }, (_, index) => `node_${index}`) })).completedNodes.length, 128);
  assert.equal(validateFactoryState(state({ attempt: 1000 })).attempt, 1000);
});

test('secret patterns cover exact and embedded key variants and credential formats', () => {
  for (const key of ['password', 'passwords', 'my_password_value', 'apikey', 'api_key', 'privatekey', 'private_key', 'credentials']) {
    const error = capture(() => scanForSecrets({ [key]: 'value' }));
    assert.deepEqual(error.safeDetails, { reason: 'secret_key', field: `$.${key}` });
  }
  for (const secret of [
    ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
    'sk_test_abcdefghijklmnop',
    'pk_live_abcdefghijklmnop',
    'ghr_abcdefghijklmnopqrst',
    'Bearer    abc.def/ghi==',
  ]) {
    const error = capture(() => scanForSecrets({ note: secret }));
    assert.equal(error.safeDetails.reason, 'secret_value');
    assert.equal(error.safeDetails.field, '$.note');
  }
});

test('serialization, identity mismatch, size and versions retain exact contracts', () => {
  assert.equal(jsonBytes('é'), Buffer.byteLength(JSON.stringify('é'), 'utf8'));
  const tooLarge = state({ artifacts: [{ ...artifact(), reference: 'x'.repeat(200) }] });
  const sizeError = capture(() => validateFactoryState(tooLarge, { maxBytes: 1 }));
  assert.deepEqual(sizeError.safeDetails, { reason: 'state_too_large' });
  const tenantMismatch = state({ tenantId: 'tenant_other' });
  tenantMismatch.threadId = deriveThreadId({ tenantId: 'tenant_alpha', factoryRunId: tenantMismatch.factoryRunId });
  assert.equal(capture(() => validateFactoryState(tenantMismatch)).code, 'langgraph_tenant_mismatch');
  for (const [overrides, kind] of [[{ schemaVersion: 2 }, 'state'], [{ graphVersion: 'factory-v2' }, 'graph']]) {
    const error = capture(() => validateFactoryState(state(overrides)));
    assert.equal(error.code, 'langgraph_version_unsupported');
    assert.deepEqual(error.safeDetails, { kind });
  }
});

test('annotation defaults and reducer results are exact', () => {
  const expected = {
    schemaVersion: 1, graphVersion: 'factory-v1', tenantId: '', factoryRunId: '', threadId: '', lifecycleNode: null,
    completedNodes: [], artifacts: [], decisions: [], attempt: 0, updatedAt: '1970-01-01T00:00:00.000Z',
    lifecycleStatus: 'running', qaOutcome: null, qaAttempts: 0, terminalReason: null, nodeAttempts: {}, childRuns: [],
  };
  assert.deepEqual(Object.fromEntries(Object.entries(FactoryStateAnnotation.spec).map(([key, channel]) => [key, channel.initialValueFactory()])), expected);
  assert.deepEqual(uniqueSortedReducer(['b'], ['a']), ['a', 'b']);
  assert.deepEqual(appendObjectsReducer([{ code: 'b' }], [{ code: 'a' }]), [{ code: 'a' }, { code: 'b' }]);
});
