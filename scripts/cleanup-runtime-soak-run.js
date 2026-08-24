#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { makeWorkerUtils } = require('graphile-worker');
const { createPgPoolFromEnv } = require('../lib/audit/postgres');
const { ensurePoolErrorHandler } = require('../lib/job-runtime/pool');

function exactRunPrefix(value) {
  const prefix = String(value || '').trim();
  if (!/^soak_[a-z0-9]+_[a-f0-9]+$/.test(prefix)) {
    throw new Error('SOAK_CLEANUP_RUN_PREFIX must be an exact synthetic run prefix.');
  }
  return prefix;
}

function tenantPattern(prefix) {
  const escaped = exactRunPrefix(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^${escaped}_[0-9]+$`;
}

function exactSyntheticTenant(value) {
  const tenant = String(value || '').trim();
  if (tenant.length > 64 || !/^(?:load|soak)_[a-z0-9][a-z0-9_]+$/.test(tenant)) {
    throw new Error('SOAK_CLEANUP_TENANT must be one exact synthetic tenant.');
  }
  return tenant;
}

function exactTenantPattern(tenant) {
  const escaped = exactSyntheticTenant(tenant).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^${escaped}$`;
}

function configuration(env = process.env) {
  const hasRunPrefix = Boolean(String(env.SOAK_CLEANUP_RUN_PREFIX || '').trim());
  const hasTenant = Boolean(String(env.SOAK_CLEANUP_TENANT || '').trim());
  if (hasRunPrefix === hasTenant) throw new Error('Select exactly one scoped cleanup target.');
  const runPrefix = hasRunPrefix ? exactRunPrefix(env.SOAK_CLEANUP_RUN_PREFIX) : null;
  const tenant = hasTenant ? exactSyntheticTenant(env.SOAK_CLEANUP_TENANT) : null;
  const target = runPrefix || tenant;
  if (env.SOAK_CLEANUP_CONFIRM !== `delete:${target}`) {
    throw new Error('SOAK_CLEANUP_CONFIRM must exactly confirm the selected target.');
  }
  if (!String(env.SOAK_CLEANUP_OUTPUT || '').trim()) throw new Error('SOAK_CLEANUP_OUTPUT is required.');
  return Object.freeze({
    output: path.resolve(env.SOAK_CLEANUP_OUTPUT),
    runPrefix,
    target,
    tenant,
    tenantPattern: runPrefix ? tenantPattern(runPrefix) : exactTenantPattern(tenant),
  });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

async function inspectTarget(client, pattern) {
  const jobs = await client.query(`SELECT COUNT(*)::integer AS rows,
    COUNT(DISTINCT payload->>'tenantId')::integer AS tenants,
    COUNT(*) FILTER (WHERE locked_at IS NOT NULL)::integer AS locked
    FROM graphile_worker._private_jobs WHERE payload->>'tenantId' ~ $1`, [pattern]);
  const registry = await client.query(`SELECT COUNT(*)::integer AS rows, COUNT(DISTINCT tenant_id)::integer AS tenants
    FROM job_runtime.job_delivery_registry WHERE tenant_id ~ $1`, [pattern]);
  const actions = await client.query(`SELECT COUNT(*)::integer AS rows
    FROM job_runtime.job_operator_actions WHERE tenant_id ~ $1`, [pattern]);
  const effects = await client.query(`SELECT COUNT(*)::integer AS rows
    FROM job_runtime.job_effect_ledger WHERE tenant_id ~ $1`, [pattern]);
  return Object.freeze({
    graphileJobs: Number(jobs.rows[0].rows),
    graphileTenants: Number(jobs.rows[0].tenants),
    lockedGraphileJobs: Number(jobs.rows[0].locked),
    deliveries: Number(registry.rows[0].rows),
    deliveryTenants: Number(registry.rows[0].tenants),
    actions: Number(actions.rows[0].rows),
    effects: Number(effects.rows[0].rows),
  });
}

async function completeTargetJobs(pool, client, pattern, workerUtilsFactory) {
  const jobIds = (await client.query(`SELECT id::text
    FROM graphile_worker._private_jobs
    WHERE payload->>'tenantId' ~ $1 ORDER BY id`, [pattern])).rows.map((row) => row.id);
  if (!jobIds.length) return Object.freeze({ completedJobs: 0, unlockedWorkers: 0 });
  const workerUtils = await workerUtilsFactory({ pgPool: pool });
  try {
    const workerIds = (await client.query(`SELECT DISTINCT locked_by
      FROM graphile_worker._private_jobs
      WHERE payload->>'tenantId' ~ $1 AND locked_by IS NOT NULL`, [pattern])).rows.map((row) => row.locked_by);
    if (workerIds.length) await workerUtils.withPgClient((pgClient) => pgClient.query(
      'SELECT graphile_worker.force_unlock_workers($1::text[])', [workerIds],
    ));
    let completedJobs = 0;
    for (let index = 0; index < jobIds.length; index += 2_000) {
      completedJobs += (await workerUtils.completeJobs(jobIds.slice(index, index + 2_000))).length;
    }
    return Object.freeze({ completedJobs, unlockedWorkers: workerIds.length });
  } finally {
    await workerUtils.release().catch(() => {});
  }
}

async function deleteTargetApplicationRows(client, pattern) {
  await client.query('BEGIN');
  try {
    await client.query('DELETE FROM job_runtime.job_operator_actions WHERE tenant_id ~ $1', [pattern]);
    await client.query('DELETE FROM job_runtime.job_effect_ledger WHERE tenant_id ~ $1', [pattern]);
    await client.query('DELETE FROM job_runtime.job_delivery_registry WHERE tenant_id ~ $1', [pattern]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function cleanupSoakRun(pool, input, dependencies = {}) {
  const client = await pool.connect();
  try {
    const before = await inspectTarget(client, input.tenantPattern);
    const completed = await completeTargetJobs(
      pool, client, input.tenantPattern, dependencies.workerUtilsFactory || makeWorkerUtils,
    );
    const remainingJobs = Number((await client.query(`SELECT COUNT(*)::integer AS count
      FROM graphile_worker._private_jobs WHERE payload->>'tenantId' ~ $1`, [input.tenantPattern])).rows[0].count);
    if (remainingJobs !== 0 || completed.completedJobs !== before.graphileJobs) {
      throw new Error('runtime_soak_graphile_backlog_cleanup_incomplete');
    }
    await deleteTargetApplicationRows(client, input.tenantPattern);
    const after = await inspectTarget(client, input.tenantPattern);
    if (Object.values(after).some((value) => value !== 0)) {
      throw new Error('runtime_soak_application_backlog_cleanup_incomplete');
    }
    return Object.freeze({ before, ...completed, after });
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const input = configuration();
  const startedAt = new Date().toISOString();
  const pool = createPgPoolFromEnv(process.env.DATABASE_URL);
  ensurePoolErrorHandler(pool, { error() {} }, { increment() {} });
  try {
    const result = await cleanupSoakRun(pool, input);
    const evidence = Object.freeze({
      schemaVersion: 1,
      kind: 'runtime_soak_scoped_cleanup',
      status: 'passed',
      redacted: true,
      runPrefix: input.runPrefix,
      tenant: input.tenant,
      target: input.target,
      tenantPattern: input.tenantPattern,
      startedAt,
      completedAt: new Date().toISOString(),
      scriptDigest: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
      ...result,
    });
    writeJson(input.output, evidence);
    process.stdout.write(`${JSON.stringify({ output: input.output, ...result })}\n`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ code: 'runtime_soak_cleanup_failed', message: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  cleanupSoakRun,
  configuration,
  exactRunPrefix,
  exactSyntheticTenant,
  exactTenantPattern,
  inspectTarget,
  main,
  tenantPattern,
};
