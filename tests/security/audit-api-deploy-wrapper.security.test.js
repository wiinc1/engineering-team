const assert = require('node:assert/strict');
const test = require('node:test');

function clearServerModules() {
  delete require.cache[require.resolve('../../api/_server.js')];
  delete require.cache[require.resolve('../../scripts/bootstrap-deploy-auth.js')];
  delete require.cache[require.resolve('../../api/v1/task-workflow-proxy.js')];
}

function stubDeployBootstrap(result) {
  const bootstrapPath = require.resolve('../../scripts/bootstrap-deploy-auth.js');
  delete require.cache[bootstrapPath];
  require.cache[bootstrapPath] = {
    id: bootstrapPath,
    filename: bootstrapPath,
    loaded: true,
    exports: {
      runDeployAuthBootstrap: async () => result,
    },
  };
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

test('Vercel API handler fails closed when deploy auth bootstrap fails', async () => {
  clearServerModules();
  stubDeployBootstrap({ ok: false, errors: ['migration failed'] });

  try {
    const { handleRequest } = require('../../api/_server.js');
    const response = createResponseRecorder();

    await handleRequest({}, response);

    assert.equal(response.statusCode, 500);
    assert.equal(response.headers['content-type'], 'application/json');
    assert.equal(JSON.parse(response.body).error.code, 'deploy_auth_bootstrap_failed');
  } finally {
    clearServerModules();
  }
});

test('task workflow proxy rejects unexpected rewritten paths before dispatch', () => {
  clearServerModules();
  const serverPath = require.resolve('../../api/_server.js');
  let dispatched = false;
  require.cache[serverPath] = {
    id: serverPath,
    filename: serverPath,
    loaded: true,
    exports: {
      handleRequest: () => {
        dispatched = true;
      },
    },
  };

  try {
    const handler = require('../../api/v1/task-workflow-proxy.js');
    const response = createResponseRecorder();

    handler({
      url: '/api/v1/task-workflow-proxy?__workflow_path=../metrics',
    }, response);

    assert.equal(dispatched, false);
    assert.equal(response.statusCode, 400);
    assert.equal(response.headers['content-type'], 'application/json');
    assert.equal(JSON.parse(response.body).error.code, 'invalid_workflow_proxy_path');
  } finally {
    clearServerModules();
  }
});

test('task workflow proxy allowlists PM refinement start without broadening traversal access', () => {
  clearServerModules();
  const serverPath = require.resolve('../../api/_server.js');
  const observedUrls = [];
  require.cache[serverPath] = {
    id: serverPath,
    filename: serverPath,
    loaded: true,
    exports: {
      handleRequest: (req) => {
        observedUrls.push(req.url);
      },
    },
  };

  try {
    const handler = require('../../api/v1/task-workflow-proxy.js');
    handler({
      url: '/api/v1/task-workflow-proxy?__workflow_path=tasks/TSK-1/refinement/start',
    }, createResponseRecorder());

    const response = createResponseRecorder();
    handler({
      url: '/api/v1/task-workflow-proxy?__workflow_path=tasks/TSK-1/refinement/../events',
    }, response);

    assert.deepEqual(observedUrls, ['/api/v1/tasks/TSK-1/refinement/start']);
    assert.equal(response.statusCode, 400);
    assert.equal(response.headers['content-type'], 'application/json');
    assert.equal(JSON.parse(response.body).error.code, 'invalid_workflow_proxy_path');
  } finally {
    clearServerModules();
  }
});

test('task workflow proxy rejects unversioned audit write and traversal paths before dispatch', () => {
  clearServerModules();
  const serverPath = require.resolve('../../api/_server.js');
  let dispatched = false;
  require.cache[serverPath] = {
    id: serverPath,
    filename: serverPath,
    loaded: true,
    exports: {
      handleRequest: () => {
        dispatched = true;
      },
    },
  };

  try {
    const handler = require('../../api/v1/task-workflow-proxy.js');
    for (const auditPath of ['tasks/TSK-1/events', '../tasks/TSK-1/history']) {
      const response = createResponseRecorder();

      handler({
        url: `/api/v1/task-workflow-proxy?__audit_path=${encodeURIComponent(auditPath)}`,
      }, response);

      assert.equal(response.statusCode, 400);
      assert.equal(response.headers['content-type'], 'application/json');
      assert.equal(JSON.parse(response.body).error.code, 'invalid_audit_proxy_path');
    }
    assert.equal(dispatched, false);
  } finally {
    clearServerModules();
  }
});
