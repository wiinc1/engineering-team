'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

function dockerEngineAvailable(dockerBin, execFileSyncImpl = execFileSync) {
  try {
    execFileSyncImpl(dockerBin, ['info'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000,
    });
    return true;
  } catch {
    return false;
  }
}

function resolveOrbctlBin({ env = process.env, existsSyncImpl = fs.existsSync } = {}) {
  const candidates = [env.ORBCTL_BIN, '/usr/local/bin/orbctl', '/opt/homebrew/bin/orbctl']
    .filter(Boolean);
  return candidates.find((candidate) => existsSyncImpl(candidate)) || null;
}

function usesOrbStack(dockerBin, execFileSyncImpl = execFileSync) {
  try {
    const context = execFileSyncImpl(dockerBin, ['context', 'show'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
    });
    return String(context).trim().toLowerCase() === 'orbstack';
  } catch {
    return false;
  }
}

async function ensureContainerEngine({
  dockerBin,
  timeoutMs = 45000,
  pollIntervalMs = 500,
  platform = process.platform,
  execFileSyncImpl = execFileSync,
  existsSyncImpl = fs.existsSync,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  nowImpl = Date.now,
  env = process.env,
} = {}) {
  if (dockerEngineAvailable(dockerBin, execFileSyncImpl)) {
    return { ok: true, action: 'engine_already_running', dockerBin };
  }
  const orbctlBin = platform === 'darwin' && usesOrbStack(dockerBin, execFileSyncImpl)
    ? resolveOrbctlBin({ env, existsSyncImpl })
    : null;
  if (!orbctlBin) {
    return { ok: false, action: 'engine_unavailable', error: 'Docker engine is unavailable and no active OrbStack context can be recovered.' };
  }
  try {
    execFileSyncImpl(orbctlBin, ['start', '--all'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: Math.min(timeoutMs, 30000),
    });
  } catch (error) {
    return { ok: false, action: 'orbstack_start_failed', error: error.message, orbctlBin };
  }
  const deadline = nowImpl() + timeoutMs;
  do {
    if (dockerEngineAvailable(dockerBin, execFileSyncImpl)) {
      return { ok: true, action: 'orbstack_started', dockerBin, orbctlBin };
    }
    await sleepImpl(pollIntervalMs);
  } while (nowImpl() < deadline);
  return { ok: false, action: 'orbstack_start_timeout', error: 'OrbStack started but its Docker engine did not become ready in time.', orbctlBin };
}

module.exports = {
  dockerEngineAvailable,
  ensureContainerEngine,
  resolveOrbctlBin,
  usesOrbStack,
};
