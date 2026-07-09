// Golden-path replay seeds forge tasks via Postgres audit store before GP-011 dispatch.
// Hosted worker preflight uses task-platform `/api/v1/tasks/{taskId}/events` append routes on the operator URL.
// Factory orchestrator advances queued requirements through golden-path phases on the local stack.
// Unit tests run through scripts/run-unit-tests.js with sanitized env for isolated file backends.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuditApiServer } = require('../../lib/audit/http-projects');

test('audit foundation OpenAPI documents forge execution-readiness route and canonical task shape', () => {
  const root = path.join(__dirname, '../..');
  const openapi = fs.readFileSync(path.join(root, 'docs/api/audit-foundation-openapi.yml'), 'utf8');
  const platform = fs.readFileSync(path.join(root, 'docs/api/task-platform-openapi.yml'), 'utf8');

  for (const expected of [
    '/tasks/{id}/forge-execution-readiness:',
    'operationId: getForgeExecutionReadiness',
    'ForgeCanonicalTask',
    'forge:read',
    'FORGE_SERVICE_TOKEN',
    'task_not_execution_ready',
  ]) {
    assert.match(openapi, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const expected of [
    'pollForgeExecutionReadiness',
    'golden-path:smoke:gp-002',
    'golden-path:smoke:gp-015',
    'golden-path:smoke:gp-013',
    'contract-coverage audit history rows matching the current implementation attempt',
    'task.sre_monitoring_started',
    'golden-path-phases.js',
  ]) {
    assert.match(platform, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

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

test('audit foundation release health contract returns commit metadata without auth', () => {
  const commitSha = 'abcdef1234567890abcdef1234567890abcdef12';
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-health-contract-'));
  const { server } = createAuditApiServer({ baseDir, releaseCommitSha: commitSha });

  for (const url of ['/version', '/api/version', '/backend/version', '/health']) {
    const response = createResponseRecorder();
    server.emit('request', { method: 'GET', url, headers: {} }, response);
    assert.equal(response.statusCode, 200, url);
    assert.equal(response.headers['cache-control'], 'no-store', url);
    const body = JSON.parse(response.body);
    assert.equal(body.schemaVersion, 'engineering-team-release-health.v1', url);
    assert.equal(body.service, 'engineering-team-audit-api', url);
    assert.equal(body.status, 'ok', url);
    assert.equal(body.commitSha, commitSha, url);
    assert.equal(body.commit_sha, commitSha, url);
  }
});
