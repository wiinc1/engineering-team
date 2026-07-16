'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { MemorySaver } = require('@langchain/langgraph');
const {
  compileFactoryGraph,
  deriveThreadId,
  runtimeConfig,
  validateFactoryState,
} = require('../../lib/software-factory/langgraph');
const { state } = require('../fixtures/langgraph/v1');

test('AC1: exact LangGraph packages, existing-pool constructor, and dedicated schema are present', () => {
  const pkg = require('../../package.json');
  assert.equal(pkg.dependencies['@langchain/langgraph'], '1.4.8');
  assert.equal(pkg.dependencies['@langchain/langgraph-checkpoint-postgres'], '1.0.4');
  assert.match(fs.readFileSync('lib/software-factory/langgraph/checkpointer.js', 'utf8'), /constructor\(pool/);
  assert.match(fs.readFileSync('db/migrations/018_langgraph_runtime_persistence.sql', 'utf8'), /langgraph_checkpoint/);
});

test('AC2: durable registry contract includes thread, namespace, graph/state versions, tenant, and UTC timestamps', () => {
  const sql = fs.readFileSync('db/migrations/018_langgraph_runtime_persistence.sql', 'utf8');
  for (const field of ['thread_id', 'checkpoint_namespace', 'graph_version', 'state_schema_version', 'tenant_id', 'checkpointed_at', 'created_at', 'updated_at']) {
    assert.match(sql, new RegExp(field));
  }
  assert.match(sql, /TIMESTAMPTZ/g);
});

test('AC3: replacement graph resumes at next node without replaying completed node', async () => {
  const saver = new MemorySaver();
  const executions = { first: 0, second: 0 };
  const nodes = [
    { name: 'first_node', execute: () => { executions.first += 1; return { attempt: 1 }; } },
    { name: 'second_node', execute: () => { executions.second += 1; return {}; } },
  ];
  const input = state();
  const config = { configurable: { thread_id: input.threadId, checkpoint_ns: 'factory' } };
  const workerOne = compileFactoryGraph({ nodes, checkpointer: saver, interruptAfter: ['first_node'], maxStateBytes: 262144, clock: { now: Date.now } });
  await workerOne.invoke(input, config);
  const workerTwo = compileFactoryGraph({ nodes, checkpointer: saver, maxStateBytes: 262144, clock: { now: Date.now } });
  const result = await workerTwo.invoke(null, config);
  assert.deepEqual(executions, { first: 1, second: 1 });
  assert.deepEqual(result.completedNodes, ['first_node', 'second_node']);
});

test('AC4: invalid, oversized, secret, cross-tenant, and unsupported states fail closed', () => {
  const invalid = [
    state({ attempt: -1 }),
    state({ graphVersion: 'factory-v9' }),
    state({ tenantId: 'tenant_beta' }),
    { ...state(), password: 'hidden' },
  ];
  invalid[2].threadId = deriveThreadId({ tenantId: 'tenant_alpha', factoryRunId: invalid[2].factoryRunId });
  for (const value of invalid) assert.throws(() => validateFactoryState(value, { maxBytes: 4096 }));
  const oversized = state();
  oversized.artifacts = [{ kind: 'report', reference: 'x'.repeat(5000), checksum: `sha256:${'a'.repeat(64)}` }];
  assert.throws(() => validateFactoryState(oversized, { maxBytes: 4096 }));
});

test('AC5: migration rollback is data-preserving and refuses referenced threads', () => {
  const up = fs.readFileSync('db/migrations/018_langgraph_runtime_persistence.sql', 'utf8');
  const down = fs.readFileSync('db/migrations/018_langgraph_runtime_persistence.down.sql', 'utf8');
  assert.doesNotMatch(up, /audit_events|audit_outbox|\bDROP\b|\bTRUNCATE\b/);
  assert.match(down, /rollback refused/);
  assert.match(down, /checkpoint_rows/);
});

test('AC6: production rejects in-memory and file savers with stable configuration error', () => {
  for (const saver of ['memory', 'file']) {
    assert.throws(() => runtimeConfig({ production: true, saver, pool: {} }, {}), {
      code: 'langgraph_configuration_invalid', safeDetails: { reason: 'production_requires_postgres' },
    });
  }
});
