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
