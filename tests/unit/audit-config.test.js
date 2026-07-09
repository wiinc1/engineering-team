const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveAuditBackend,
  resolveRuntimeAuditBackend,
  assertAuditBackendConfiguration,
  backendSelectionLogEntry,
} = require('../../lib/audit');
const { isSpecialistDelegationEnabled } = require('../../lib/audit/feature-flags');

function withRuntimeEnv(overrides, callback) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('defaults to postgres when a connection string is available', () => {
  assert.equal(resolveAuditBackend({ connectionString: 'postgres://example' }), 'postgres');
});

test('low-level test harness resolver defaults to file when no explicit backend or database url is present', () => {
  withRuntimeEnv({ AUDIT_STORE_BACKEND: undefined, DATABASE_URL: undefined }, () => {
    assert.equal(resolveAuditBackend({}), 'file');
  });
});

test('runtime resolver defaults to postgres when no explicit backend is present', () => {
  withRuntimeEnv({ AUDIT_STORE_BACKEND: undefined, DATABASE_URL: undefined }, () => {
    assert.equal(resolveRuntimeAuditBackend({}), 'postgres');
  });
});

test('runtime guard requires database url when no explicit local fallback is set', () => {
  withRuntimeEnv({ AUDIT_STORE_BACKEND: undefined, DATABASE_URL: undefined }, () => {
    assert.throws(
      () => assertAuditBackendConfiguration({}),
      /DATABASE_URL is required/,
    );
  });
});

test('rejects file backend outside local-like environments', () => {
  withRuntimeEnv({ AUDIT_STORE_BACKEND: undefined, DATABASE_URL: undefined }, () => {
    assert.throws(
      () => assertAuditBackendConfiguration({
        backend: 'file',
        runtimeEnv: 'production',
        allowFileBackend: true,
      }),
      /Production must use operator-hosted Postgres/,
    );
  });
});

test('requires database url for postgres backend', () => {
  withRuntimeEnv({ AUDIT_STORE_BACKEND: undefined, DATABASE_URL: undefined }, () => {
    assert.throws(
      () => assertAuditBackendConfiguration({ backend: 'postgres' }),
      /DATABASE_URL is required/,
    );
  });
});

test('allows explicit local file backend during development', () => {
  withRuntimeEnv({ AUDIT_STORE_BACKEND: undefined, DATABASE_URL: undefined }, () => {
    const result = assertAuditBackendConfiguration({
      backend: 'file',
      runtimeEnv: 'development',
      allowFileBackend: true,
    });
    assert.equal(result.backend, 'file');
    assert.equal(result.connectionString, undefined);
    assert.equal(result.fallbackWarning.code, 'file_backend_fallback');
  });
});

test('rejects implicit local file backend without fallback opt-in', () => {
  withRuntimeEnv({ AUDIT_STORE_BACKEND: undefined, DATABASE_URL: undefined }, () => {
    assert.throws(
      () => assertAuditBackendConfiguration({ backend: 'file', runtimeEnv: 'development' }),
      /explicit local\/test fallback opt-in/,
    );
  });
});

test('emits structured backend selection warning metadata for file fallback', () => {
  const entry = backendSelectionLogEntry({
    backend: 'file',
    fallbackWarning: {
      code: 'file_backend_fallback',
      remediation: 'Start Dockerized Postgres.',
    },
  }, { runtimeEnv: 'test' });

  assert.equal(entry.feature, 'ff_canonical_task_runtime');
  assert.equal(entry.action, 'backend_selection');
  assert.equal(entry.outcome, 'fallback_warning');
  assert.equal(entry.backend_mode, 'file');
  assert.equal(entry.warning_code, 'file_backend_fallback');
});

test('prefers the canonical specialist delegation flag name when reading env-backed rollout controls', () => {
  const previousReal = process.env.FF_REAL_SPECIALIST_DELEGATION;
  const previousLegacy = process.env.FF_SPECIALIST_DELEGATION;

  process.env.FF_REAL_SPECIALIST_DELEGATION = 'false';
  process.env.FF_SPECIALIST_DELEGATION = 'true';

  try {
    assert.equal(isSpecialistDelegationEnabled({}), false);
  } finally {
    if (previousReal === undefined) delete process.env.FF_REAL_SPECIALIST_DELEGATION;
    else process.env.FF_REAL_SPECIALIST_DELEGATION = previousReal;

    if (previousLegacy === undefined) delete process.env.FF_SPECIALIST_DELEGATION;
    else process.env.FF_SPECIALIST_DELEGATION = previousLegacy;
  }
});
