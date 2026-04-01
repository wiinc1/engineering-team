#!/usr/bin/env node
const { createPgPoolFromEnv, runMigrations } = require('../lib/audit');

(async () => {
  const pool = createPgPoolFromEnv(process.env.DATABASE_URL);
  try {
    await runMigrations(pool, { baseDir: process.cwd() });
    process.stdout.write('postgres migrations applied\n');
  } finally {
    await pool.end();
  }
})().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
