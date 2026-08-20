'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const {
  validationSubprocessEnv,
} = require('../../lib/task-platform/golden-path-validation');

test('GP-023 child process cannot observe live factory runtime state', () => {
  const env = validationSubprocessEnv({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    DATABASE_URL: 'postgres://live-factory',
    AUTH_JWT_SECRET: 'live-secret',
    FF_EXECUTION_CONTRACTS: 'true',
    FF_FACTORY_TRUSTED_SIMPLE_CLOSE: 'true',
    FACTORY_TRUSTED_DELIVERY: 'true',
    OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
    NODE_ENV: 'production',
  });
  const observed = JSON.parse(execFileSync(process.execPath, ['-e', [
    'const keys = [',
    "  'DATABASE_URL', 'AUTH_JWT_SECRET', 'FF_EXECUTION_CONTRACTS',",
    "  'FF_FACTORY_TRUSTED_SIMPLE_CLOSE', 'FACTORY_TRUSTED_DELIVERY',",
    "  'OPENCLAW_BASE_URL', 'ALLOW_FILE_AUDIT_BACKEND', 'NODE_ENV',",
    '];',
    'console.log(JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]))));',
  ].join('\n')], { encoding: 'utf8', env }));

  assert.deepEqual(observed, {
    DATABASE_URL: null,
    AUTH_JWT_SECRET: null,
    FF_EXECUTION_CONTRACTS: null,
    FF_FACTORY_TRUSTED_SIMPLE_CLOSE: null,
    FACTORY_TRUSTED_DELIVERY: null,
    OPENCLAW_BASE_URL: null,
    ALLOW_FILE_AUDIT_BACKEND: 'true',
    NODE_ENV: 'test',
  });
});
