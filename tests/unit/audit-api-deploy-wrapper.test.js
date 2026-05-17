const assert = require('node:assert/strict');
const test = require('node:test');

const API_ENTRYPOINTS = [
  '../../api/index.js',
  '../../api/[...route].js',
  '../../api/auth/[...route].js',
  '../../api/auth/email/verify/[...route].js',
  '../../api/auth/magic-link/[...route].js',
  '../../api/auth/password-reset/[...route].js',
  '../../api/auth/users/[userId].js',
  '../../api/v1/[...route].js',
  '../../api/v1/projects/[...route].js',
  '../../api/v1/task-workflow-proxy.js',
  '../../api/v1/tasks/[taskId].js',
  '../../api/v1/tasks/[taskId]/[action].js',
];

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function withStubbedServer(handleRequest, callback) {
  const serverPath = require.resolve('../../api/_server.js');
  delete require.cache[serverPath];
  require.cache[serverPath] = {
    id: serverPath,
    filename: serverPath,
    loaded: true,
    exports: { handleRequest },
  };

  try {
    callback();
  } finally {
    delete require.cache[serverPath];
    for (const entrypoint of API_ENTRYPOINTS) clearModule(entrypoint);
  }
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(chunk = '') {
      this.body += String(chunk);
    },
  };
}

test('Vercel API entrypoints return the request handler promise', () => {
  for (const entrypoint of API_ENTRYPOINTS) {
    const expected = Promise.resolve({ handled: entrypoint });
    withStubbedServer(() => expected, () => {
      clearModule(entrypoint);
      const handler = require(entrypoint);
      assert.equal(handler({}, {}), expected);
    });
  }
});

test('task workflow proxy restores the rewritten workflow URL before dispatch', () => {
  let observedUrl = null;
  const expected = Promise.resolve({ handled: true });
  withStubbedServer(req => {
    observedUrl = req.url;
    return expected;
  }, () => {
    clearModule('../../api/v1/task-workflow-proxy.js');
    const handler = require('../../api/v1/task-workflow-proxy.js');
    const result = handler({
      url: '/api/v1/task-workflow-proxy?__workflow_path=tasks/TSK-1/execution-contract/approve&source=backend',
    }, {});

    assert.equal(result, expected);
    assert.equal(observedUrl, '/api/v1/tasks/TSK-1/execution-contract/approve?source=backend');
  });
});

test('task workflow proxy rejects routes outside the versioned workflow allowlist', () => {
  let dispatched = false;
  withStubbedServer(() => {
    dispatched = true;
  }, () => {
    clearModule('../../api/v1/task-workflow-proxy.js');
    const handler = require('../../api/v1/task-workflow-proxy.js');
    const response = createResponseRecorder();

    handler({
      url: '/api/v1/task-workflow-proxy?__workflow_path=tasks/TSK-1/admin/delete',
    }, response);

    assert.equal(dispatched, false);
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).error.code, 'invalid_workflow_proxy_path');
  });
});

test('Vercel server wrapper selects and logs the canonical runtime backend', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../../api/_server.js'), 'utf8');

  assert.match(source, /assertAuditBackendConfiguration\(\{\s*runtimeEnv: 'production'/);
  assert.match(source, /logAuditBackendSelection\(backendConfig, logger, \{ runtimeEnv: 'production' \}\)/);
  assert.match(source, /backend: backendConfig\.backend/);
  assert.match(source, /connectionString: backendConfig\.connectionString/);
});
