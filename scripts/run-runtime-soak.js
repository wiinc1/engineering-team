#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { createPgPoolFromEnv } = require('../lib/audit/postgres');
const { evidenceDigest } = require('../lib/release-gates/evidence-collector');

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function currentRevision() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function childProcess(script, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { cwd: process.cwd(), env, stdio: 'ignore' });
    const timeout = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', () => {
      clearTimeout(timeout);
      resolve({ ok: false, code: 'spawn_error' });
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, code: signal ? `signal_${signal}` : `exit_${code}` });
    });
  });
}

function windowEnvironment(input, index, windowMs) {
  const tag = `${input.runTag}_${index}`;
  return {
    graphile: {
      ...process.env,
      JOB_RUNTIME_LOAD_DURATION_MS: String(windowMs),
      JOB_RUNTIME_EXPECTED_QPS: String(input.graphileQps),
      JOB_RUNTIME_LOAD_QPS: String(input.graphileQps),
      JOB_RUNTIME_REQUIRED_LOAD_MULTIPLIER: '1',
      JOB_RUNTIME_LOAD_TENANT_ID: `soak_${tag}`.slice(0, 63),
      JOB_RUNTIME_LOAD_OUTPUT: path.join(input.outputDir, 'windows', `${index}-graphile.json`),
    },
    langgraph: {
      ...process.env,
      LANGGRAPH_LOAD_DURATION_MS: String(windowMs),
      LANGGRAPH_LOAD_CONCURRENCY: String(input.langgraphConcurrency),
      LANGGRAPH_CHECKPOINT_WRITE_P95_BUDGET_MS: '250',
      LANGGRAPH_CHECKPOINT_READ_P95_BUDGET_MS: '300',
      LANGGRAPH_LOAD_OUTPUT: path.join(input.outputDir, 'windows', `${index}-langgraph.json`),
    },
  };
}

async function runWindow(input, index, windowMs) {
  const env = windowEnvironment(input, index, windowMs);
  const timeout = windowMs + input.windowTimeoutGraceMs;
  const [graphile, langgraph] = await Promise.all([
    childProcess('scripts/run-job-runtime-load-test.js', env.graphile, timeout),
    childProcess('scripts/run-langgraph-load.js', env.langgraph, timeout),
  ]);
  return Object.freeze({ index, durationMs: windowMs, graphile, langgraph });
}

async function databaseSample(pool) {
  const result = await pool.query(`SELECT
    COUNT(*)::integer AS connections,
    COUNT(*) FILTER (WHERE state = 'idle in transaction')::integer AS idle_in_transaction
    FROM pg_stat_activity WHERE datname = current_database()`);
  return Object.freeze({
    connections: Number(result.rows[0].connections),
    idleInTransaction: Number(result.rows[0].idle_in_transaction),
  });
}

function summarizeWindows(windows, samples, baseline, finalSample, allowance) {
  const violations = windows.reduce((count, window) => (
    count + Number(!window.graphile.ok) + Number(!window.langgraph.ok)
  ), 0);
  const peakConnections = Math.max(...samples.map((sample) => sample.connections));
  const leaks = Number(finalSample.connections > baseline.connections + allowance)
    + Number(finalSample.idleInTransaction > baseline.idleInTransaction);
  return Object.freeze({
    violations,
    leaks,
    windows: windows.length,
    graphilePasses: windows.filter((window) => window.graphile.ok).length,
    langgraphPasses: windows.filter((window) => window.langgraph.ok).length,
    baselineConnections: baseline.connections,
    finalConnections: finalSample.connections,
    peakConnections,
  });
}

function buildComponent(input) {
  const evidence = Object.freeze({
    runId: input.runId,
    deploymentId: input.deploymentId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    windows: input.summary.windows,
    graphilePasses: input.summary.graphilePasses,
    langgraphPasses: input.summary.langgraphPasses,
    connectionSamples: input.sampleCount,
  });
  return Object.freeze({
    schemaVersion: 1,
    runtime: input.runtime,
    kind: 'soak_24h',
    status: input.summary.violations === 0 && input.summary.leaks === 0 ? 'passed' : 'failed',
    revision: input.revision,
    redacted: true,
    digest: evidenceDigest(evidence),
    generatedAt: input.completedAt,
    expiresAt: new Date(Date.parse(input.completedAt) + 7 * 86_400_000).toISOString(),
    provenance: { automation: 'scripts/run-runtime-soak.js', environment: input.environment },
    summary: {
      durationSeconds: input.durationSeconds,
      violations: input.summary.violations,
      leaks: input.summary.leaks,
    },
    evidence,
  });
}

function configuration(env = process.env) {
  const durationSeconds = positiveInteger(env.SOAK_DURATION_SECONDS, 86_400);
  return Object.freeze({
    connectionAllowance: positiveInteger(env.SOAK_CONNECTION_ALLOWANCE, 4),
    deploymentId: String(env.SOAK_DEPLOYMENT_ID || '').trim(),
    durationSeconds,
    environment: String(env.SOAK_ENVIRONMENT || 'staging').trim(),
    graphileQps: positiveInteger(env.SOAK_GRAPHILE_QPS, 25),
    langgraphConcurrency: positiveInteger(env.SOAK_LANGGRAPH_CONCURRENCY, 2),
    outputDir: path.resolve(env.SOAK_OUTPUT_DIR || path.join('.artifacts', 'runtime-soak')),
    revision: String(env.SOAK_REVISION || currentRevision()).trim(),
    runId: `runtime-soak-${Date.now().toString(36)}`,
    runTag: `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
    windowSeconds: Math.min(durationSeconds, positiveInteger(env.SOAK_WINDOW_SECONDS, 300)),
    windowTimeoutGraceMs: positiveInteger(env.SOAK_WINDOW_TIMEOUT_GRACE_MS, 180_000),
  });
}

async function executeSoak(input) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for runtime soak.');
  if (!input.deploymentId) throw new Error('SOAK_DEPLOYMENT_ID is required for runtime soak.');
  const pool = createPgPoolFromEnv(process.env.DATABASE_URL);
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + input.durationSeconds * 1000;
  const baseline = await databaseSample(pool);
  const windows = [];
  const samples = [baseline];
  try {
    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      const windowMs = Math.min(input.windowSeconds * 1000, remainingMs);
      windows.push(await runWindow(input, windows.length, windowMs));
      samples.push(await databaseSample(pool));
    }
    const finalSample = await databaseSample(pool);
    const summary = summarizeWindows(windows, samples, baseline, finalSample, input.connectionAllowance);
    const completedAt = new Date().toISOString();
    const durationSeconds = Math.floor((Date.parse(completedAt) - Date.parse(startedAt)) / 1000);
    for (const runtime of ['graphile', 'langgraph']) {
      writeJson(path.join(input.outputDir, `${runtime}-soak-24h.json`), buildComponent({
        ...input, completedAt, durationSeconds, runtime, sampleCount: samples.length, startedAt, summary,
      }));
    }
    return summary;
  } finally {
    await pool.end();
  }
}

async function main() {
  try {
    const input = configuration();
    const summary = await executeSoak(input);
    process.stdout.write(`${JSON.stringify({ outputDir: input.outputDir, ...summary })}\n`);
    if (summary.violations || summary.leaks) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: 'runtime_soak_failed', message: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { buildComponent, configuration, databaseSample, executeSoak, positiveInteger, summarizeWindows };
