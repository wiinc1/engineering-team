'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const VALIDATION_ENV_KEYS_TO_DELETE = Object.freeze([
  'DATABASE_URL',
  'AUDIT_STORE_BACKEND',
  'PGSSLMODE',
  'PGSSL_ACCEPT_SELF_SIGNED',
  'PGSSLMODE_REQUIRE',
  'FF_FACTORY_AGENT_DRIVEN_PHASE1',
  'FF_FACTORY_AGENT_DRIVEN_PHASES',
  'FF_REAL_SPECIALIST_DELEGATION',
  'FACTORY_USE_FIXTURE_DELEGATION',
  'FACTORY_PROOF_PROFILE',
  'SPECIALIST_DELEGATION_RUNNER',
  'SPECIALIST_DELEGATION_BASE_DIR',
  'SPECIALIST_RUNTIME_RUNNER_TIMEOUT_MS',
  'SPECIALIST_DELEGATION_RUNNER_TIMEOUT_MS',
  'OPENCLAW_BASE_URL',
  'OPENCLAW_DELEGATION_TIMEOUT_SEC',
  'OPENCLAW_DELEGATION_THINKING',
  'OPENCLAW_SPECIALIST_MAP',
  'HERMES_BASE_URL',
  'FORGEADAPTER_BASE_URL',
  'FORGEADAPTER_SERVICE_TOKEN',
  'FORGE_SERVICE_TOKEN',
  'FORGE_ADAPTER_TOKEN',
  'STAGING_SKIP_VALIDATION',
  'STAGING_SKIP_FORGE_PHASES',
  'STAGING_SKIP_FORGE_SEED',
  'STAGING_SKIP_PILOT_AGENTS_SEED',
]);

function validationSubprocessEnv(env = process.env) {
  const next = { ...env };
  for (const key of VALIDATION_ENV_KEYS_TO_DELETE) delete next[key];
  next.ALLOW_FILE_AUDIT_BACKEND = 'true';
  next.NODE_ENV = next.NODE_ENV || 'test';
  return next;
}

async function runNpmScript(scriptName, cwd = process.cwd()) {
  try {
    const { stdout, stderr } = await execFileAsync('npm', ['run', scriptName], {
      cwd,
      env: validationSubprocessEnv(),
      timeout: 600000,
    });
    return { ok: true, script: scriptName, stdout, stderr, status: 0 };
  } catch (error) {
    return {
      ok: false,
      script: scriptName,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: error.code || 1,
    };
  }
}

async function runDeployValidation(options = {}) {
  const skip = options.skipValidation === true;
  if (skip) {
    // Intentional skip is a successful local/live proof outcome (not a failed validation).
    return { ok: true, skipped: true, reason: 'skip_validation_flag' };
  }
  const results = {};
  for (const script of ['lint', 'test:unit', 'standards:check']) {
    results[script] = await runNpmScript(script, options.cwd || process.cwd());
    if (!results[script].ok) {
      return { ok: false, results };
    }
  }
  return { ok: true, results };
}

module.exports = {
  VALIDATION_ENV_KEYS_TO_DELETE,
  validationSubprocessEnv,
  runNpmScript,
  runDeployValidation,
};
