'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { ROOT, defaultDatabaseUrl } = require('./defaults');
const { probePostgres } = require('./health');

function dockerAvailable() {
  try {
    execFileSync('docker', ['info'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 8000,
    });
    return true;
  } catch {
    return false;
  }
}

function composeArgs() {
  return [
    '-p', 'engineering-team-golden-path',
    '-f', path.join(ROOT, 'docker-compose.golden-path.yml'),
  ];
}

async function ensurePostgres({ timeoutMs = 60000 } = {}) {
  const existing = await probePostgres(defaultDatabaseUrl());
  if (existing.ok) {
    return { ok: true, action: 'already_running', ...existing };
  }

  if (!dockerAvailable()) {
    return {
      ok: false,
      action: 'missing',
      error: 'Postgres is not reachable and Docker is unavailable. Start Postgres on 15432 (or install Docker and re-run factory:stack:up).',
      ...existing,
    };
  }

  execFileSync('docker', ['compose', ...composeArgs(), 'up', '-d', 'postgres'], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probePostgres(defaultDatabaseUrl());
    if (probe.ok) return { ok: true, action: 'docker_started', ...probe };
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return {
    ok: false,
    action: 'docker_timeout',
    error: `Timed out waiting for Postgres after docker compose up (${defaultDatabaseUrl()})`,
  };
}

function stopDockerPostgres() {
  if (!dockerAvailable()) {
    return { ok: true, action: 'skipped_no_docker' };
  }
  try {
    execFileSync('docker', ['compose', ...composeArgs(), 'stop', 'postgres'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    return { ok: true, action: 'docker_stopped' };
  } catch (error) {
    return { ok: false, action: 'docker_stop_failed', error: error.message };
  }
}

module.exports = {
  dockerAvailable,
  ensurePostgres,
  stopDockerPostgres,
};
