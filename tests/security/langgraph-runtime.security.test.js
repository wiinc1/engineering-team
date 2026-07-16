'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { requireTenantBinding, withTenantBinding } = require('../../lib/software-factory/langgraph/binding');
const { createThreadRegistry, deriveThreadId, validateFactoryState } = require('../../lib/software-factory/langgraph');
const { artifact, state } = require('../fixtures/langgraph/v1');

test('hostile checkpoint payloads and common credentials are rejected before invocation', () => {
  const payloads = [
    { note: ['-----BEGIN RSA ', 'PRIVATE KEY-----'].join('') },
    { note: 'Bearer abcdefghijklmnopqrstuvwxyz.abcdefghijklmnopqrstuvwxyz.abcdefghijklmnop' },
    { cookie: 'session=value' },
    { nested: { apiKey: 'secret' } },
    { note: 'ghp_abcdefghijklmnopqrstuvwxyz123456' },
    { note: ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz'].join('_') },
  ];
  for (const payload of payloads) {
    const value = state();
    Object.assign(value, payload);
    assert.throws(() => validateFactoryState(value), { code: 'langgraph_state_invalid' });
  }
});

test('checkpointer tenant binding cannot be supplied through graph configuration', async () => {
  const threadId = deriveThreadId({ tenantId: 'tenant_alpha', factoryRunId: 'run:1' });
  assert.throws(() => requireTenantBinding(threadId), { code: 'langgraph_tenant_mismatch' });
  await withTenantBinding({ tenantId: 'tenant_alpha', threadId }, async () => {
    assert.equal(requireTenantBinding(threadId).tenantId, 'tenant_alpha');
    assert.throws(() => requireTenantBinding(deriveThreadId({ tenantId: 'tenant_beta', factoryRunId: 'run:1' })), {
      code: 'langgraph_tenant_mismatch',
    });
  });
});

test('registry tenant filters are parameterized and never interpolated', async () => {
  const calls = [];
  const pool = { async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; } };
  const registry = createThreadRegistry(pool);
  const hostileTenant = "tenant' OR TRUE --";
  await registry.summaries(hostileTenant, { status: 'active', limit: 20 });
  assert.doesNotMatch(calls[0].sql, /OR TRUE|tenant'/);
  assert.equal(calls[0].values[0], hostileTenant);
});

test('state validation errors do not echo hostile values', () => {
  const value = state();
  value.password = 'do-not-leak-this-value';
  let caught;
  try { validateFactoryState(value); } catch (error) { caught = error; }
  assert.ok(caught);
  assert.doesNotMatch(JSON.stringify(caught.safeDetails), /do-not-leak/);
});

test('allowed artifact references reject embedded credentials tokens and key material', () => {
  const references = [
    ['https://user', ':pass@example.invalid/path'].join(''),
    ['https://example.invalid/report?to', 'ken=opaque'].join(''),
    ['https://example.invalid/report?api_', 'key=opaque'].join(''),
    ['artifact://report/Bear', 'er abcdefghijklmnopqrstuvwxyz'].join(''),
    ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'signaturepart'].join('.'),
    ['artifact://report/gh', 'p_abcdefghijklmnopqrstuvwxyz123456'].join(''),
    ['artifact://report/AK', 'IAABCDEFGHIJKLMNOP'].join(''),
    ['artifact://report/AI', 'zaABCDEFGHIJKLMNOPQRSTUVWX'].join(''),
  ];
  for (const reference of references) {
    const value = state({ artifacts: [{ ...artifact(), reference }] });
    assert.throws(() => validateFactoryState(value), { code: 'langgraph_state_invalid' }, reference.slice(0, 24));
  }
});

test('allowed artifact references retain legitimate repository and object-store locations', () => {
  for (const reference of [
    'artifact://test_report',
    'https://github.com/example/repository/pull/280',
    's3://evidence-bucket/reports/280.json?versionId=v1',
    'reports/langgraph/build-280.json',
  ]) {
    const value = validateFactoryState(state({ artifacts: [{ ...artifact(), reference }] }));
    assert.equal(value.artifacts[0].reference, reference);
  }
});

test('artifact reference parser rejects controls malformed URLs and encoded secret fragments', () => {
  for (const reference of [
    'reports/bad\nname.json',
    'http://[invalid',
    'https://example.invalid/report#%E0%A4%A',
    'https://example.invalid/report#api%5Fkey=opaque',
  ]) {
    assert.throws(() => validateFactoryState(state({
      artifacts: [{ ...artifact(), reference }],
    })), { code: 'langgraph_state_invalid' });
  }
  assert.equal(validateFactoryState(state({ artifacts: [{
    ...artifact(), reference: 'https://example.invalid/report#section-one',
  }] })).artifacts.length, 1);
});
