'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork, spawn } = require('node:child_process');
const { after, before, test } = require('node:test');
const { Pool } = require('pg');
const {
  createLangGraphRuntime, deriveThreadId, LIFECYCLE_NODE_NAMES,
} = require('../../lib/software-factory/langgraph');

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? test : test.skip;
const recovery = connectionString && process.env.LANGGRAPH_POSTGRES_CONTAINER ? test : test.skip;
const workerPath = path.join(__dirname, '../fixtures/langgraph/postgres-process-worker.js');
const identities = {
  process: { tenantId: 'langgraph_process_death', factoryRunId: 'run:process-death:280' },
  recovery: { tenantId: 'langgraph_backup_restore', factoryRunId: 'run:backup-restore:280' },
};
const lifecycleBoundaries = LIFECYCLE_NODE_NAMES.filter((name) => name !== 'terminal');
const happyLifecycleNodes = lifecycleBoundaries.filter((name) => name !== 'fix');
let pool;

function launchWorker(mode, identity, options = {}) {
  const child = fork(workerPath, [], {
    env: {
      ...process.env,
      LANGGRAPH_TEST_MODE: mode,
      LANGGRAPH_TEST_TENANT: identity.tenantId,
      LANGGRAPH_TEST_RUN: identity.factoryRunId,
      LANGGRAPH_TEST_BOUNDARY: options.boundary || '',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.testStderr = '';
  child.stderr.on('data', (chunk) => { child.testStderr += chunk.toString('utf8'); });
  return child;
}

function nextMessage(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('LangGraph worker IPC timed out.')), timeoutMs);
    child.once('message', (message) => { clearTimeout(timer); resolve(message); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      if (code || signal) { clearTimeout(timer); reject(new Error(`LangGraph worker exited before IPC: ${code || signal}: ${child.testStderr}`)); }
    });
  });
}

function exitAfterKill(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.kill('SIGKILL');
  });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

function docker(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`docker ${args[0]} failed (${code}): ${Buffer.concat(stderr).toString('utf8')}`));
    });
    child.stdin.end(input);
  });
}

async function removeThread(identity) {
  const threadId = deriveThreadId(identity);
  for (const table of ['factory_run_actions', 'factory_interrupts', 'checkpoint_writes', 'checkpoint_blobs', 'checkpoints', 'factory_threads']) {
    await pool.query(`DELETE FROM langgraph_checkpoint.${table} WHERE thread_id = $1`, [threadId]);
  }
  await pool.query('DELETE FROM langgraph_checkpoint.integration_process_effects WHERE thread_id = $1', [threadId]);
}

async function effectCounts(identity) {
  const result = await pool.query(`
    SELECT node_name, COUNT(*)::integer AS executions
    FROM langgraph_checkpoint.integration_process_effects
    WHERE thread_id = $1 GROUP BY node_name ORDER BY MIN(effect_id)
  `, [deriveThreadId(identity)]);
  return Object.fromEntries(result.rows.map((row) => [row.node_name, row.executions]));
}

async function waitForExpiredLease(identity, timeoutMs = 3_000) {
  const threadId = deriveThreadId(identity);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query(`SELECT lease_owner, lease_expires_at <= NOW() AS expired
      FROM langgraph_checkpoint.factory_threads WHERE thread_id = $1`, [threadId]);
    if (!result.rows[0]?.lease_owner || result.rows[0].expired) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Lease did not expire for ${threadId}.`);
}

async function checkpointSnapshot(identity) {
  const threadId = deriveThreadId(identity);
  const result = await pool.query(`SELECT graph_version, state_schema_version, status
    FROM langgraph_checkpoint.factory_threads WHERE thread_id = $1`, [threadId]);
  const counts = await pool.query(`SELECT
    (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoints WHERE thread_id = $1) AS checkpoints,
    (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoint_blobs WHERE thread_id = $1) AS blobs,
    (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoint_writes WHERE thread_id = $1) AS writes,
    (SELECT COUNT(*)::integer FROM langgraph_checkpoint.factory_lifecycle_events WHERE thread_id = $1) AS lifecycle_events`, [threadId]);
  return { registry: result.rows[0], counts: counts.rows[0], effects: await effectCounts(identity) };
}

async function runWorker(mode, identity, options = {}) {
  const child = launchWorker(mode, identity, options);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const message = await nextMessage(child);
  if (mode === 'resume' || mode === 'boundary-resume' || mode === 'boundary-inspect') await exited;
  return { child, message };
}

async function proveDatabaseInterruption(container) {
  let unavailable;
  await docker(['pause', container]);
  try {
    unavailable = await runWorker('probe', identities.recovery);
    assert.equal(unavailable.message.type, 'unavailable');
  } finally {
    await docker(['unpause', container]);
  }
  await waitForExit(unavailable.child);
  const deadline = Date.now() + 15_000;
  let recovered;
  while (Date.now() < deadline) {
    recovered = await runWorker('probe', identities.recovery);
    await waitForExit(recovered.child);
    if (recovered.message.type === 'available') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.deepEqual(recovered?.message, {
    type: 'available', graphVersion: 'factory-v1', stateSchemaVersion: 1,
  });
}

async function composedDatabaseSnapshot() {
  const schemas = ['public', 'job_runtime', 'graphile_worker', 'langgraph_checkpoint', 'runtime_control'];
  const tables = await pool.query(`SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE' AND table_schema = ANY($1::text[])
    ORDER BY table_schema, table_name`, [schemas]);
  const counts = {};
  for (const row of tables.rows) {
    const schema = row.table_schema.replace(/"/g, '""');
    const table = row.table_name.replace(/"/g, '""');
    const result = await pool.query(`SELECT COUNT(*)::integer AS count FROM "${schema}"."${table}"`);
    counts[`${row.table_schema}.${row.table_name}`] = result.rows[0].count;
  }
  return counts;
}

async function destroyComposedSchemas() {
  await pool.query(`
    DROP SCHEMA IF EXISTS langgraph_checkpoint CASCADE;
    DROP SCHEMA IF EXISTS job_runtime CASCADE;
    DROP SCHEMA IF EXISTS graphile_worker CASCADE;
    DROP SCHEMA IF EXISTS runtime_control CASCADE;
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public AUTHORIZATION audit;
  `);
}

async function restoreAfterDestructiveLoss(container, backup) {
  await destroyComposedSchemas();
  assert.equal((await pool.query("SELECT to_regnamespace('langgraph_checkpoint') AS schema")).rows[0].schema, null);
  const lost = await runWorker('probe', identities.recovery);
  assert.equal(lost.message.type, 'unavailable');
  await waitForExit(lost.child);
  await destroyComposedSchemas();
  await docker(['exec', '-i', container, 'pg_restore', '-U', 'audit', '-d', 'engineering_team', '--no-owner', '--no-privileges'], backup);
}

before(async () => {
  if (!connectionString) return;
  pool = new Pool({ connectionString, ssl: false, max: 6 });
  const setup = createLangGraphRuntime({
    pool,
    nodes: [{ name: 'setup_node', execute: () => ({ attempt: 1 }) }],
    config: { enabled: true, operationTimeoutMs: 30_000, poolBudget: 2 },
  });
  await setup.setup();
  await setup.close();
  await pool.query(`CREATE TABLE IF NOT EXISTS langgraph_checkpoint.integration_process_effects (
    effect_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    thread_id TEXT NOT NULL,
    node_name TEXT NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await Promise.all(Object.values(identities).map(removeThread));
});

after(async () => {
  if (!pool) return;
  await Promise.all(Object.values(identities).map((identity) => removeThread(identity).catch(() => {})));
  await pool.query('DROP TABLE IF EXISTS langgraph_checkpoint.integration_process_effects').catch(() => {});
  await pool.end();
});

integration('SIGKILLed worker checkpoint resumes in a separate process without duplicate side effects', async () => {
  const paused = await runWorker('pause', identities.process);
  assert.equal(paused.message.type, 'paused');
  assert.deepEqual(paused.message.state.completedNodes, ['process_claimed']);
  assert.deepEqual(await effectCounts(identities.process), { process_claimed: 1 });
  assert.deepEqual(await exitAfterKill(paused.child), { code: null, signal: 'SIGKILL' });

  const resumed = await runWorker('resume', identities.process);
  assert.equal(resumed.message.type, 'completed');
  assert.deepEqual(resumed.message.state.completedNodes, ['process_claimed', 'process_resumed']);
  assert.deepEqual(await effectCounts(identities.process), { process_claimed: 1, process_resumed: 1 });
});

integration('every production lifecycle node boundary survives process death without re-running completed effects', async () => {
  for (const [index, boundary] of lifecycleBoundaries.entries()) {
    const identity = {
      tenantId: `langgraph_boundary_${String(index).padStart(2, '0')}`,
      factoryRunId: `run:boundary-${String(index).padStart(2, '0')}:281`,
    };
    try {
      const paused = await runWorker('boundary-pause', identity, { boundary });
      assert.equal(paused.message.type, 'paused', `${boundary}: ${JSON.stringify(paused.message)}`);
      assert.ok(paused.message.state.completedNodes.includes(boundary), boundary);
      const before = await effectCounts(identity);
      const expectedBefore = boundary === 'fix'
        ? lifecycleBoundaries.slice(0, lifecycleBoundaries.indexOf('fix') + 1)
        : happyLifecycleNodes.slice(0, happyLifecycleNodes.indexOf(boundary) + 1);
      assert.deepEqual(Object.keys(before), expectedBefore, boundary);
      assert.ok(Object.values(before).every((count) => count === 1), boundary);
      await exitAfterKill(paused.child);
      await waitForExpiredLease(identity);

      const resumed = await runWorker(boundary === 'closeout' ? 'boundary-inspect' : 'boundary-resume', identity, { boundary });
      assert.equal(resumed.message.type, 'completed', `${boundary}: ${JSON.stringify(resumed.message)}`);
      assert.equal(resumed.message.state.lifecycleStatus, 'succeeded', boundary);
      const after = await effectCounts(identity);
      assert.deepEqual(Object.keys(after), boundary === 'fix' ? lifecycleBoundaries : happyLifecycleNodes, boundary);
      assert.ok(Object.entries(after).every(([node, count]) => count === (boundary === 'fix' && node === 'qa' ? 2 : 1)), boundary);
    } finally {
      await removeThread(identity);
    }
  }
});

recovery('composed database backup restores canonical, Graphile, LangGraph, runtime-control, and audit state within RTO', async (context) => {
  const container = process.env.LANGGRAPH_POSTGRES_CONTAINER;
  const paused = await runWorker('pause', identities.recovery);
  assert.equal(paused.message.type, 'paused');
  await exitAfterKill(paused.child);
  const before = await checkpointSnapshot(identities.recovery);
  const composedBefore = await composedDatabaseSnapshot();
  const backup = await docker(['exec', container, 'pg_dump', '-U', 'audit', '-d', 'engineering_team', '-Fc', '--no-owner']);
  assert.ok(backup.length > 1_000);

  const started = Date.now();
  let restored = false;
  try {
    await proveDatabaseInterruption(container);
    await restoreAfterDestructiveLoss(container, backup);
    restored = true;

    const restoredSnapshot = await checkpointSnapshot(identities.recovery);
    assert.deepEqual(restoredSnapshot, before);
    assert.deepEqual(await composedDatabaseSnapshot(), composedBefore);
    const resumed = await runWorker('resume', identities.recovery);
    assert.equal(resumed.message.type, 'completed');
    assert.equal(resumed.message.state.graphVersion, 'factory-v1');
    assert.equal(resumed.message.state.schemaVersion, 1);
    assert.deepEqual(await effectCounts(identities.recovery), { process_claimed: 1, process_resumed: 1 });
    const rtoMs = Date.now() - started;
    assert.ok(rtoMs < 15 * 60_000, `recovery RTO ${rtoMs}ms exceeded 15 minutes`);
    fs.mkdirSync(path.join(process.cwd(), '.artifacts'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), '.artifacts/langgraph-01-recovery.json'), `${JSON.stringify({
      passed: true, rtoMs, graphVersion: 'factory-v1', stateSchemaVersion: 1,
      snapshotEqual: true, restoredRegistry: restoredSnapshot.registry,
      checkpointCounts: restoredSnapshot.counts, sideEffects: await effectCounts(identities.recovery),
      composedSchemas: ['public', 'job_runtime', 'graphile_worker', 'langgraph_checkpoint', 'runtime_control'],
      composedTableCount: Object.keys(composedBefore).length,
    }, null, 2)}\n`);
    context.diagnostic(`LangGraph destructive restore RTO: ${rtoMs}ms`);
  } finally {
    await docker(['unpause', container]).catch(() => {});
    if (!restored) {
      await destroyComposedSchemas().catch(() => {});
      await docker(['exec', '-i', container, 'pg_restore', '-U', 'audit', '-d', 'engineering_team', '--no-owner', '--no-privileges'], backup).catch(() => {});
    }
  }
});
