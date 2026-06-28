const path = require('node:path');
const { createRuntimeDelegateWork } = require('../software-factory/runtime-delegation');
const {
  shouldUseLocalPmRefinementDelegate,
  createLocalPmRefinementDelegateWork,
} = require('./local-pm-refinement-delegate');

const DEFAULT_OPENCLAW_RUNNER = 'node scripts/openclaw-specialist-runner.js';

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveOpenClawDelegationRunner(env = process.env, baseDir = process.cwd()) {
  const configured = env.SPECIALIST_DELEGATION_RUNNER || env.PM_REFINEMENT_OPENCLAW_RUNNER;
  if (configured) return configured;
  return `node ${path.join(baseDir, 'scripts/openclaw-specialist-runner.js')}`;
}

function buildOpenClawPmRefinementEnv(env = process.env, baseDir = process.cwd()) {
  return {
    FF_REAL_SPECIALIST_DELEGATION: env.FF_REAL_SPECIALIST_DELEGATION || 'true',
    SPECIALIST_DELEGATION_RUNNER: resolveOpenClawDelegationRunner(env, baseDir),
    SPECIALIST_RUNTIME_RUNNER_TIMEOUT_MS: env.SPECIALIST_RUNTIME_RUNNER_TIMEOUT_MS || '120000',
    OPENCLAW_DELEGATION_TIMEOUT_SEC: env.OPENCLAW_DELEGATION_TIMEOUT_SEC || '90',
    OPENCLAW_DELEGATION_THINKING: env.OPENCLAW_DELEGATION_THINKING || 'low',
    ...(env.OPENCLAW_BIN ? { OPENCLAW_BIN: env.OPENCLAW_BIN } : {}),
    ...(env.OPENCLAW_DELEGATION_LOCAL ? { OPENCLAW_DELEGATION_LOCAL: env.OPENCLAW_DELEGATION_LOCAL } : {}),
    ...(env.OPENCLAW_SPECIALIST_MAP ? { OPENCLAW_SPECIALIST_MAP: env.OPENCLAW_SPECIALIST_MAP } : {}),
  };
}

function shouldUseOpenClawPmRefinementDelegate(env = process.env) {
  if (parseBooleanEnv(env.GOLDEN_PATH_OPENCLAW_PM_REFINEMENT, false)) return true;
  if (env.PM_REFINEMENT_DELEGATE_WORK === 'openclaw') return true;
  if (shouldUseLocalPmRefinementDelegate(env)) return false;
  if (env.PM_REFINEMENT_DELEGATE_WORK === 'local') return false;
  if (env.SPECIALIST_DELEGATION_RUNNER || env.PM_REFINEMENT_OPENCLAW_RUNNER) return true;
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'development';
}

function resolvePmRefinementDelegateWork(env = process.env, baseDir = process.cwd()) {
  if (shouldUseLocalPmRefinementDelegate(env)) {
    return {
      mode: 'local',
      delegateWork: createLocalPmRefinementDelegateWork(),
    };
  }

  if (!shouldUseOpenClawPmRefinementDelegate(env)) {
    return { mode: 'runtime', delegateWork: createRuntimeDelegateWork({ baseDir }) };
  }

  const openClawEnv = buildOpenClawPmRefinementEnv(env, baseDir);
  return {
    mode: 'openclaw',
    delegateWork: createRuntimeDelegateWork({
      baseDir,
      delegationRunnerCommand: openClawEnv.SPECIALIST_DELEGATION_RUNNER,
      runnerEnv: openClawEnv,
      delegationRunnerTimeoutMs: Number(openClawEnv.SPECIALIST_RUNTIME_RUNNER_TIMEOUT_MS),
    }),
    openClawEnv,
  };
}

module.exports = {
  DEFAULT_OPENCLAW_RUNNER,
  buildOpenClawPmRefinementEnv,
  resolveOpenClawDelegationRunner,
  shouldUseOpenClawPmRefinementDelegate,
  resolvePmRefinementDelegateWork,
};