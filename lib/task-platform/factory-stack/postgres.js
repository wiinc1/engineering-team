'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ensureContainerEngine } = require('./container-engine');
const { ROOT, defaultDatabaseUrl } = require('./defaults');
const { probePostgres } = require('./health');

const DOCKER_CANDIDATES = [
  process.env.DOCKER_BIN,
  'docker',
  '/usr/local/bin/docker',
  '/opt/homebrew/bin/docker',
  path.join(process.env.HOME || '', '.orbstack/bin/docker'),
].filter(Boolean);

function resolveDockerBin() {
  for (const candidate of DOCKER_CANDIDATES) {
    try {
      if (candidate === 'docker') {
        execFileSync('docker', ['version', '--format', '{{.Client.Version}}'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5000,
        });
        return 'docker';
      }
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function dockerAvailable() {
  const bin = resolveDockerBin();
  if (!bin) return false;
  try {
    execFileSync(bin, ['info'], {
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

async function startPostgresContainer({ timeoutMs, ensureContainerEngineImpl }) {
  const dockerBin = resolveDockerBin();
  if (!dockerBin) {
    return {
      ok: false, action: 'missing',
      error: 'Postgres is not reachable and Docker is unavailable. Start Postgres on 15432 or install Docker/OrbStack.',
      remediation: ['Ensure something listens on 127.0.0.1:15432.', 'Install Docker Desktop/OrbStack, then run npm run factory:stack:up.'],
    };
  }
  const engine = await ensureContainerEngineImpl({ dockerBin, timeoutMs: Math.min(timeoutMs, 45000) });
  if (!engine.ok) {
    return {
      ok: false, action: engine.action, error: engine.error,
      remediation: ['Start the configured container engine.', 'For OrbStack: orbctl start --all', 'Then: npm run factory:stack:up'],
    };
  }
  try {
    execFileSync(dockerBin, ['compose', ...composeArgs(), 'up', '-d', 'postgres'], { cwd: ROOT, stdio: 'inherit' });
  } catch (error) {
    return { ok: false, action: 'docker_compose_failed', error: error.message, dockerBin };
  }
  return { ok: true, dockerBin, engineAction: engine.action };
}

async function ensurePostgres({
  timeoutMs = 60000, ensureContainerEngineImpl = ensureContainerEngine, probePostgresImpl = probePostgres,
} = {}) {
  const existing = await probePostgresImpl(defaultDatabaseUrl());
  if (existing.ok) {
    return {
      ok: true,
      action: 'already_running',
      durableNote: 'External or previously started Postgres on :15432 (Docker/OrbStack/native). API+workers launchd units expect this listener to stay up across reboots.',
      ...existing,
    };
  }

  const container = await startPostgresContainer({ timeoutMs, ensureContainerEngineImpl });
  if (!container.ok) return { ...existing, ...container, ok: false };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probePostgresImpl(defaultDatabaseUrl());
    if (probe.ok) {
      return {
        ok: true,
        action: container.engineAction === 'orbstack_started' ? 'orbstack_and_postgres_started' : 'docker_started',
        dockerBin: container.dockerBin,
        durableNote: 'Postgres started via docker compose; keep the engine (Docker/OrbStack) running so :15432 survives host use. API+workers are launchd KeepAlive.',
        ...probe,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return {
    ok: false,
    action: 'docker_timeout',
    error: `Timed out waiting for Postgres after docker compose up (${defaultDatabaseUrl()})`,
  };
}

function stopDockerPostgres() {
  const dockerBin = resolveDockerBin();
  if (!dockerBin) {
    return { ok: true, action: 'skipped_no_docker' };
  }
  try {
    execFileSync(dockerBin, ['compose', ...composeArgs(), 'stop', 'postgres'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    return { ok: true, action: 'docker_stopped', dockerBin };
  } catch (error) {
    return { ok: false, action: 'docker_stop_failed', error: error.message };
  }
}

module.exports = {
  resolveDockerBin,
  dockerAvailable,
  ensurePostgres,
  stopDockerPostgres,
};
