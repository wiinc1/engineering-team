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

test('LangGraph lifecycle event migration is append-only, taskless-intake safe, and rollback guarded', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/022_langgraph_lifecycle_events.sql'), 'utf8');
  const rollback = fs.readFileSync(path.join(__dirname, '../../db/migrations/022_langgraph_lifecycle_events.down.sql'), 'utf8');
  const runtimeRollback = fs.readFileSync(path.join(__dirname, '../../db/migrations/018_langgraph_runtime_persistence.down.sql'), 'utf8');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS langgraph_checkpoint\.factory_lifecycle_events/);
  assert.match(migration, /task_id TEXT,/);
  assert.match(migration, /UNIQUE \(tenant_id, idempotency_key\)/);
  assert.match(migration, /event_type IN \('node_started','node_finished'\)/);
  assert.match(migration, /factory_lifecycle_events is append-only/);
  assert.match(migration, /BEFORE UPDATE/);
  assert.match(migration, /BEFORE DELETE/);
  assert.match(rollback, /rollback refused/);
  assert.match(runtimeRollback, /lifecycle_event_rows/);
});

test('joint runtime cutover migration preserves digest-bound append-only audit evidence', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/023_runtime_cutover_apply_audit.sql'), 'utf8');
  const rollback = fs.readFileSync(path.join(__dirname, '../../db/migrations/023_runtime_cutover_apply_audit.down.sql'), 'utf8');

  assert.match(migration, /ADD COLUMN IF NOT EXISTS reconciliation_digest VARCHAR\(71\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS runtime_control\.cutover_audit/);
  assert.match(migration, /approval_digest VARCHAR\(71\) NOT NULL UNIQUE/);
  assert.match(migration, /cutover_audit is append-only/);
  assert.match(migration, /BEFORE UPDATE ON runtime_control\.cutover_audit/);
  assert.match(migration, /BEFORE DELETE ON runtime_control\.cutover_audit/);
  assert.match(rollback, /DROP TABLE IF EXISTS runtime_control\.cutover_audit/);
  assert.match(rollback, /DROP COLUMN IF EXISTS reconciliation_digest/);
});
