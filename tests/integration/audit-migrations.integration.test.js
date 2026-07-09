// Issue #193 standards evidence: audit integration coverage remains active after lint-only whitespace cleanup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runMigrations } = require('../../lib/audit/postgres');

test('audit migration runner applies forward migrations without rollback files', async () => {
  const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-migrations-'));
  fs.writeFileSync(path.join(migrationsDir, '001_audit_forward.sql'), 'SELECT 1 AS forward_one;');
  fs.writeFileSync(path.join(migrationsDir, '001_audit_forward.down.sql'), 'SELECT 1 AS rollback_one;');
  fs.writeFileSync(path.join(migrationsDir, '002_audit_forward.sql'), 'SELECT 2 AS forward_two;');

  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('SELECT version FROM schema_migrations')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  await runMigrations(pool, { migrationsDir });

  const executedSql = queries.map((query) => query.sql).join('\n');
  assert.match(executedSql, /SELECT 1 AS forward_one/);
  assert.match(executedSql, /SELECT 2 AS forward_two/);
  assert.doesNotMatch(executedSql, /SELECT 1 AS rollback_one/);
  assert.deepEqual(
    queries
      .filter((query) => query.sql.includes('INSERT INTO schema_migrations'))
      .map((query) => query.params[0]),
    ['001_audit_forward.sql', '002_audit_forward.sql']
  );
});

test('autonomous delivery metrics migration defines reversible signal and snapshot projections', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/013_autonomous_delivery_metrics.sql'), 'utf8');
  const rollback = fs.readFileSync(path.join(__dirname, '../../db/migrations/013_autonomous_delivery_metrics.down.sql'), 'utf8');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS autonomous_delivery_retrospective_signals/);
  assert.match(migration, /operator_intervention_count/);
  assert.match(migration, /excluded_from_thresholds/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS autonomous_delivery_metric_snapshots/);
  assert.match(rollback, /DROP TABLE IF EXISTS autonomous_delivery_metric_snapshots/);
  assert.match(rollback, /DROP TABLE IF EXISTS autonomous_delivery_retrospective_signals/);
});

test('factory delivery queue migration defines durable leases and idempotent submit', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/015_factory_delivery_queue.sql'), 'utf8');
  const rollback = fs.readFileSync(path.join(__dirname, '../../db/migrations/015_factory_delivery_queue.down.sql'), 'utf8');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS factory_delivery_queue/);
  assert.match(migration, /UNIQUE \(tenant_id, idempotency_key\)/);
  assert.match(migration, /CHECK \(btrim\(queue_id\) <> ''\)/);
  assert.match(migration, /CHECK \(btrim\(idempotency_key\) <> ''\)/);
  assert.match(migration, /lease_expires_at/);
  assert.match(migration, /dead_letter/);
  assert.match(migration, /idx_factory_delivery_queue_claim/);
  assert.match(rollback, /DROP TABLE IF EXISTS factory_delivery_queue/);
});
