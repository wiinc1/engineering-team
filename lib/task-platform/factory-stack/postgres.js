'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
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

async function ensurePostgres({ timeoutMs = 60000 } = {}) {
  const existing = await probePostgres(defaultDatabaseUrl());
  if (existing.ok) {
    return {
      ok: true,
      action: 'already_running',
      durableNote: 'External or previously started Postgres on :15432 (Docker/OrbStack/native). API+workers launchd units expect this listener to stay up across reboots.',
      ...existing,
    };
  }

  const dockerBin = resolveDockerBin();
  if (!dockerBin) {
    return {
      ok: false,
      action: 'missing',
      error: 'Postgres is not reachable and Docker is unavailable. Start Postgres on 15432 (OrbStack/Docker compose golden-path, or any durable listener), or install Docker Desktop/OrbStack and re-run factory:stack:up.',
      remediation: [
        'Ensure something listens on 127.0.0.1:15432 with DATABASE_URL credentials.',
        'With Docker/OrbStack: docker compose -p engineering-team-golden-path -f docker-compose.golden-path.yml up -d postgres',
        'Then: npm run factory:stack:up',
      ],
      ...existing,
    };
  }

  execFileSync(dockerBin, ['compose', ...composeArgs(), 'up', '-d', 'postgres'], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probePostgres(defaultDatabaseUrl());
    if (probe.ok) {
      return {
        ok: true,
        action: 'docker_started',
        dockerBin,
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
