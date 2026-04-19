const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAuditBackend, assertAuditBackendConfiguration } = require('../../lib/audit');
const { isSpecialistDelegationEnabled } = require('../../lib/audit/feature-flags');

test('defaults to postgres when a connection string is available', () => {
  assert.equal(resolveAuditBackend({ connectionString: 'postgres://example' }), 'postgres');
});

test('defaults to file when no explicit backend or database url is present', () => {
  assert.equal(resolveAuditBackend({}), 'file');
});

test('rejects file backend outside local-like environments', () => {
  assert.throws(
    () => assertAuditBackendConfiguration({ backend: 'file', runtimeEnv: 'production' }),
    /Production must use Supabase Postgres/,
  );
});

test('requires database url for postgres backend', () => {
  assert.throws(
    () => assertAuditBackendConfiguration({ backend: 'postgres' }),
    /DATABASE_URL is required/,
  );
});

test('allows explicit local file backend during development', () => {
  const result = assertAuditBackendConfiguration({ backend: 'file', runtimeEnv: 'development' });
  assert.equal(result.backend, 'file');
  assert.equal(result.connectionString, undefined);
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
