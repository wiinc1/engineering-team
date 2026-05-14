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
