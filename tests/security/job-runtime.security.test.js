'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const envelopeFixture = require('../fixtures/job-runtime/v1-valid-envelope.json');
const { sanitizedError } = require('../../lib/job-runtime/errors');
const { createJobRuntimeLogger } = require('../../lib/job-runtime/observability');
const { createPayloadValidator } = require('../../lib/job-runtime/payload-schema');
const { createTaskCatalog } = require('../../lib/job-runtime/task-catalog');

const root = path.join(__dirname, '../..');

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : [target];
  }).filter((file) => file.endsWith('.js'));
}

test('domain modules cannot import Graphile Worker or reference its internal tables', () => {
  const files = sourceFiles(path.join(root, 'lib'));
  for (const file of files) {
    const relative = path.relative(root, file);
    const source = fs.readFileSync(file, 'utf8');
    if (relative !== 'lib/job-runtime/graphile-adapter.js') {
      assert.equal(source.includes("require('graphile-worker')"), false, relative);
    }
    assert.equal(source.includes('._private_'), false, relative);
    assert.equal(source.includes('graphile_worker._private_'), false, relative);
  }
});

test('pinned dependency lock has integrity and the delivery registry stores no payload', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(packageJson.dependencies['graphile-worker'], '0.17.3');
  assert.equal(lock.packages['node_modules/graphile-worker'].version, '0.17.3');
  assert.match(lock.packages['node_modules/graphile-worker'].integrity, /^sha512-/);
  const migration = fs.readFileSync(path.join(root, 'db/migrations/016_job_runtime_registry.sql'), 'utf8');
  assert.equal(/\bpayload\s+JSONB/i.test(migration), false);
  assert.match(migration, /delivery acknowledgment is not canonical business completion/i);
});

test('commands SQL credentials cookies tokens modules and executable content are rejected', () => {
  const validator = createPayloadValidator();
  const definition = createTaskCatalog().resolve('job_runtime.synthetic', 1);
  const hostileFields = [
    'token', 'credential', 'cookie', 'databaseUrl', 'connectionString', 'sql',
    'command', 'cmd', 'module', 'script', 'executable', 'authorization', 'password',
  ];
  for (const field of hostileFields) {
    const hostile = { ...envelopeFixture, data: { probeId: 'probe-286', [field]: 'hostile-value' } };
    assert.throws(() => validator.validate(hostile, definition), { code: 'job_payload_invalid' }, field);
  }
  const privateKeyMarker = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  for (const value of ['postgres://user:pass@host/db', 'Bearer abcdefghijklmnop', privateKeyMarker]) {
    const hostile = { ...envelopeFixture, data: { probeId: value } };
    assert.throws(() => validator.validate(hostile, definition), { code: 'job_payload_invalid' }, value);
  }
});

test('structured errors and logs never disclose nested secrets', () => {
  const raw = new Error('postgres://user:password@host/db token=forbidden');
  assert.equal(JSON.stringify(sanitizedError(raw)).includes('password'), false);
  const entries = [];
  const logger = createJobRuntimeLogger({ logger: {
    info(payload) { entries.push(payload); },
    error(payload) { entries.push(payload); },
  } });
  logger.error('failure', { nested: { cookie: 'session-value' }, raw_message: raw.message });
  const serialized = JSON.stringify(entries);
  assert.equal(serialized.includes('session-value'), false);
  assert.equal(serialized.includes('password@host'), false);
  assert.equal(serialized.includes('[REDACTED]'), true);
});

test('least-privilege roles are non-login and worker role receives no canonical mutation grant', () => {
  const roles = fs.readFileSync(path.join(root, 'db/roles/job_runtime_roles.sql'), 'utf8');
  const grants = fs.readFileSync(path.join(root, 'lib/job-runtime/postgres-roles.js'), 'utf8');
  assert.equal((roles.match(/NOLOGIN/g) || []).length, 3);
  assert.equal(/GRANT[^;]*(tasks|audit_events)[^;]*worker/i.test(grants), false);
  assert.equal(/GRANT\s+CREATE[^;]*job_runtime_worker/i.test(grants), false);
  assert.match(grants, /SELECT, UPDATE, DELETE[^\n]+job_delivery_registry/);
});
