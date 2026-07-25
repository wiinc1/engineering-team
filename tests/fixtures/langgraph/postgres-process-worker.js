'use strict';

const { Pool } = require('pg');
const {
  createLangGraphRuntime, createLifecycleRuntime, deriveThreadId,
} = require('../../../lib/software-factory/langgraph');

const tenantId = process.env.LANGGRAPH_TEST_TENANT;
const factoryRunId = process.env.LANGGRAPH_TEST_RUN;
const threadId = deriveThreadId({ tenantId, factoryRunId });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 750,
  max: 4,
  ssl: false,
});

function send(message) {
  if (typeof process.send === 'function') process.send(message);
}

function testNodes() {
  const record = (nodeName) => pool.query(`
    INSERT INTO langgraph_checkpoint.integration_process_effects (thread_id, node_name)
    VALUES ($1, $2)
  `, [threadId, nodeName]);
  return [
    { name: 'process_claimed', execute: async () => { await record('process_claimed'); return { attempt: 1 }; } },
    { name: 'process_resumed', execute: async () => { await record('process_resumed'); return { decisions: [{ code: 'process_resumed', outcome: 'approved' }] }; } },
  ];
}

function lifecyclePorts() {
  const record = (nodeName) => pool.query(`
    INSERT INTO langgraph_checkpoint.integration_process_effects (thread_id, node_name)
    VALUES ($1, $2)
  `, [threadId, nodeName]);
  return {
    async recordEvent(event) {
      if (event.type === 'node_finished') await record(event.node);
    },
    async planChildren() { return []; },
    async executeChild() { return { outcome: 'success' }; },
    async invoke(name) {
      if (name === 'qa' && process.env.LANGGRAPH_TEST_BOUNDARY === 'fix') {
        const prior = await pool.query(`SELECT COUNT(*)::integer AS count
          FROM langgraph_checkpoint.integration_process_effects
          WHERE thread_id = $1 AND node_name = 'qa'`, [threadId]);
        return { outcome: 'success', qaOutcome: prior.rows[0].count === 0 ? 'fail' : 'pass' };
      }
      return { outcome: 'success' };
    },
  };
}

function buildRuntime(mode) {
  if (mode.startsWith('boundary-')) {
    return createLifecycleRuntime({
      pool,
      ports: lifecyclePorts(),
      humanGates: false,
      // A resumed process compiles the same graph definition as the process
      // that wrote the checkpoint. The completed boundary is not re-run.
      interruptAfter: [process.env.LANGGRAPH_TEST_BOUNDARY],
      config: { enabled: true, operationTimeoutMs: 10_000, poolBudget: 2, resumeLeaseMs: 10_000 },
    });
  }
  return createLangGraphRuntime({
    pool,
    nodes: testNodes(),
    interruptAfter: mode === 'pause' ? ['process_claimed'] : undefined,
    config: { enabled: true, operationTimeoutMs: 1_000, poolBudget: 2 },
  });
}

async function run() {
  const mode = process.env.LANGGRAPH_TEST_MODE;
  const runtime = buildRuntime(mode);
  try {
    await runtime.setup();
    if (mode === 'probe') {
      const health = await runtime.health({ deep: true });
      send({ type: 'available', graphVersion: health.graphVersion, stateSchemaVersion: health.stateSchemaVersion });
      return;
    }
    const pausing = mode === 'pause' || mode === 'boundary-pause';
    const state = mode === 'boundary-inspect'
      ? await runtime.runStatus({ tenantId, threadId })
      : pausing
        ? await runtime.invoke({ tenantId, factoryRunId })
        : await runtime.resume({ tenantId, threadId });
    send({ type: pausing ? 'paused' : 'completed', state });
    if (pausing) await new Promise(() => {});
  } catch (error) {
    send({ type: 'unavailable', code: error.code || error.name, reason: error.safeDetails?.reason || null });
    if (mode !== 'probe') process.exitCode = 1;
  } finally {
    if (mode !== 'pause' && mode !== 'boundary-pause') {
      await runtime.close().catch(() => {});
      await pool.end().catch(() => {});
    }
  }
}

run().catch((error) => {
  send({ type: 'fatal', code: error.code || error.name });
  process.exitCode = 1;
});
