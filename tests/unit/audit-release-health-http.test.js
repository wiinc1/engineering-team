const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAuditApiServer } = require('../../lib/audit/http-projects');
const {
  RELEASE_HEALTH_SCHEMA_VERSION,
  buildReleaseHealthPayload,
} = require('../../lib/audit/release-health-http');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writableEnded: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(chunk = '') {
      this.body += String(chunk);
      this.writableEnded = true;
    },
  };
}

function requestPath(pathname, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-release-health-'));
  const { server } = createAuditApiServer({
    baseDir,
    releaseCommitSha: COMMIT_SHA,
    ...options,
  });
  const response = createResponseRecorder();
  server.emit('request', { method: options.method || 'GET', url: pathname, headers: {} }, response);
  return response;
}

test('release health exposes commit-bearing /version without auth', async () => {
  const response = requestPath('/version');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');

  const body = JSON.parse(response.body);
  assert.equal(body.schemaVersion, RELEASE_HEALTH_SCHEMA_VERSION);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'engineering-team-audit-api');
  assert.equal(body.commitSha, COMMIT_SHA);
  assert.equal(body.commit_sha, COMMIT_SHA);
});

test('release health supports HEAD /version without a body', async () => {
  const response = requestPath('/version', { method: 'HEAD' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body, '');
});

test('release health rejects unsupported methods with method_not_allowed', async () => {
  const response = requestPath('/version', { method: 'POST' });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers['cache-control'], 'no-store');

  const body = JSON.parse(response.body);
  assert.equal(body.error.code, 'method_not_allowed');
});

test('release health route works through API and backend proxy prefixes', async () => {
  for (const pathname of ['/api/version', '/backend/version', '/health']) {
    const response = requestPath(pathname);
    assert.equal(response.statusCode, 200, pathname);
    assert.equal(JSON.parse(response.body).commitSha, COMMIT_SHA, pathname);
  }
});

test('release health payload prefers explicit commit and falls back to env', () => {
  assert.deepEqual(
    buildReleaseHealthPayload({ releaseCommitSha: COMMIT_SHA }, {}),
    {
      schemaVersion: RELEASE_HEALTH_SCHEMA_VERSION,
      status: 'ok',
      service: 'engineering-team-audit-api',
      commitSha: COMMIT_SHA,
      commit_sha: COMMIT_SHA,
      source: 'options',
    },
  );

  const envPayload = buildReleaseHealthPayload({}, { ENGINEERING_TEAM_COMMIT_SHA: COMMIT_SHA });
  assert.equal(envPayload.status, 'ok');
  assert.equal(envPayload.commitSha, COMMIT_SHA);
  assert.equal(envPayload.source, 'env:ENGINEERING_TEAM_COMMIT_SHA');
});
