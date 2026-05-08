const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPgPoolFromEnv } = require('../../lib/audit/postgres');

const connectionString = process.env.DATABASE_URL;
const shouldRun = !!connectionString;
const pgTest = shouldRun ? test : test.skip;

const registrationTables = [
  'auth_credentials',
  'auth_email_verification_tokens',
  'auth_password_reset_tokens',
  'auth_login_failures',
];

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function assertTablePresence(client, expected) {
  for (const tableName of registrationTables) {
    const result = await client.query('SELECT to_regclass($1) AS regclass', [tableName]);
    assert.equal(
      result.rows[0].regclass !== null,
      expected,
      `${tableName} presence should be ${expected}`
    );
  }
}

async function readAuthUsersStatusConstraint(client, schemaName) {
  const result = await client.query(
    `
      SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = $1
        AND rel.relname = 'auth_users'
        AND c.conname = 'chk_auth_users_status'
    `,
    [schemaName]
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0].definition;
}

function readMigrationSql(fileName) {
  return fs.readFileSync(path.join(__dirname, '../..', 'db/migrations', fileName), 'utf8');
}

async function createAuthUsersBaseline(client) {
  await client.query(`
    CREATE TABLE auth_users (
      user_id UUID PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      CONSTRAINT chk_auth_users_status CHECK (status IN ('active', 'disabled'))
    )
  `);
}

async function assertRegistrationStatusesAllowed(client, schemaName) {
  const statusConstraint = await readAuthUsersStatusConstraint(client, schemaName);
  assert.match(statusConstraint, /pending_verification/);
  assert.match(statusConstraint, /pending_approval/);
  assert.match(statusConstraint, /invited/);
}

async function assertRegistrationStatusesRemoved(client, schemaName) {
  const statusConstraint = await readAuthUsersStatusConstraint(client, schemaName);
  assert.doesNotMatch(statusConstraint, /pending_verification/);
  assert.doesNotMatch(statusConstraint, /pending_approval/);
  assert.doesNotMatch(statusConstraint, /invited/);
}

async function insertPendingVerificationUser(client) {
  await client.query(
    "INSERT INTO auth_users (user_id, status) VALUES ('00000000-0000-0000-0000-000000000001', 'pending_verification')"
  );
}

async function assertRollbackDisabledPendingUsers(client) {
  const users = await client.query('SELECT status FROM auth_users');
  assert.deepEqual(
    users.rows.map((row) => row.status),
    ['disabled']
  );
}

pgTest(
  'registration auth migration applies, rolls back, and reapplies on live postgres',
  async () => {
    const upSql = readMigrationSql('011_registration_auth.sql');
    const downSql = readMigrationSql('011_registration_auth.down.sql');
    const pool = createPgPoolFromEnv(connectionString);
    const client = await pool.connect();
    const schemaName = `registration_migration_${process.pid}_${Date.now()}`;
    const schemaIdentifier = quoteIdentifier(schemaName);

    try {
      await client.query(`CREATE SCHEMA ${schemaIdentifier}`);
      await client.query(`SET search_path TO ${schemaIdentifier}`);
      await createAuthUsersBaseline(client);

      await client.query(upSql);
      await assertTablePresence(client, true);
      await assertRegistrationStatusesAllowed(client, schemaName);
      await insertPendingVerificationUser(client);

      await client.query(downSql);
      await assertTablePresence(client, false);
      await assertRegistrationStatusesRemoved(client, schemaName);
      await assertRollbackDisabledPendingUsers(client);

      await client.query(upSql);
      await assertTablePresence(client, true);
      await assertRegistrationStatusesAllowed(client, schemaName);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schemaIdentifier} CASCADE`);
      client.release();
      await pool.end();
    }
  }
);
