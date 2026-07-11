#!/usr/bin/env node
'use strict';

/**
 * KeepAlive watcher for factory Postgres.
 * Ensures golden-path Postgres is reachable (reuse existing listener or docker compose up).
 * Exits non-zero only on fatal config errors so launchd restarts the watcher.
 */

const { ensurePostgres } = require('../lib/task-platform/factory-stack/postgres');

const INTERVAL_MS = Number(process.env.FACTORY_STACK_POSTGRES_ENSURE_INTERVAL_MS || 30000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick() {
  const result = await ensurePostgres({ timeoutMs: 45000 });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ok: result.ok === true,
    action: result.action,
    error: result.error || null,
  });
  process.stdout.write(`${line}\n`);
  return result;
}

async function main() {
  process.stdout.write(JSON.stringify({
    service: 'factory-postgres-ensure',
    intervalMs: INTERVAL_MS,
    startedAt: new Date().toISOString(),
  }) + '\n');

  // Immediate ensure at start (reboot recovery).
  let first = await tick();
  if (!first.ok) {
    // Stay alive and retry; do not crash-loop launchd hard when Docker is slowly starting.
    process.stderr.write(`postgres ensure pending: ${first.error || first.action}\n`);
  }

  for (;;) {
    await sleep(INTERVAL_MS);
    try {
      await tick();
    } catch (error) {
      process.stderr.write(`postgres ensure error: ${error.stack || error.message}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exit(1);
});
