const test = require('node:test');
const assert = require('node:assert/strict');
const { createPgPoolFromEnv } = require('../../lib/audit/postgres');

const CONNECTION_STRING = 'postgres://user:pass@localhost:5432/db?sslmode=require';

function withEnv(overrides, callback) {
  const original = {};
  for (const key of Object.keys(overrides)) {
    original[key] = process.env[key];
    if (overrides[key] == null) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }

  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('createPgPoolFromEnv constrains serverless pools by default', async () => {
  const pool = withEnv({
    VERCEL: '1',
    PGPOOL_MAX: null,
    PG_POOL_MAX: null,
    PG_ALLOW_EXIT_ON_IDLE: null,
    PG_IDLE_TIMEOUT_MS: null,
    PG_CONNECTION_TIMEOUT_MS: null,
  }, () => createPgPoolFromEnv(CONNECTION_STRING));

  try {
    assert.equal(pool.options.max, 1);
    assert.equal(pool.options.allowExitOnIdle, true);
    assert.equal(pool.options.idleTimeoutMillis, 10000);
    assert.equal(pool.options.connectionTimeoutMillis, 10000);
    assert.deepEqual(pool.options.ssl, { rejectUnauthorized: true });
  } finally {
    await pool.end();
  }
});

test('createPgPoolFromEnv honors connection-string sslmode over PGSSLMODE=disable', async () => {
  const pool = withEnv({
    PGSSLMODE: 'disable',
  }, () => createPgPoolFromEnv(CONNECTION_STRING));

  try {
    assert.deepEqual(pool.options.ssl, { rejectUnauthorized: true });
  } finally {
    await pool.end();
  }
});

test('createPgPoolFromEnv honors explicit pool sizing overrides', async () => {
  const pool = withEnv({
    VERCEL: '1',
    PG_POOL_MAX: '3',
    PG_IDLE_TIMEOUT_MS: '2500',
    PG_CONNECTION_TIMEOUT_MS: '1500',
    PG_ALLOW_EXIT_ON_IDLE: 'false',
  }, () => createPgPoolFromEnv(CONNECTION_STRING));

  try {
    assert.equal(pool.options.max, 3);
    assert.equal(pool.options.allowExitOnIdle, false);
    assert.equal(pool.options.idleTimeoutMillis, 2500);
    assert.equal(pool.options.connectionTimeoutMillis, 1500);
  } finally {
    await pool.end();
  }
});
