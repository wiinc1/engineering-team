const assert = require('node:assert/strict');
const test = require('node:test');

const versionHandler = require('../../api/version');

function createResponseRecorder() {
  return {
    statusCode: 0,
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

function withEnv(overrides, callback) {
  const original = { ...process.env };
  process.env = { ...original, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
  }

  try {
    callback();
  } finally {
    process.env = original;
  }
}

test('/api/version returns hosted health and version metadata', () => {
  withEnv({
    VERCEL_ENV: 'preview',
    NODE_ENV: 'test',
    VERCEL_GIT_COMMIT_SHA: 'vercel-sha',
    GITHUB_SHA: 'github-sha',
    COMMIT_SHA: 'commit-sha',
    VERCEL_URL: 'strict-real-delivery.vercel.app',
    DEPLOYMENT_URL: 'https://deployment.example.com',
    PRODUCTION_URL: 'https://production.example.com',
  }, () => {
    const response = createResponseRecorder();

    versionHandler({ method: 'GET', url: '/api/version' }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/json');

    const payload = JSON.parse(response.body);
    assert.equal(payload.status, 'healthy');
    assert.equal(payload.environment, 'preview');
    assert.equal(payload.commitSha, 'vercel-sha');
    assert.equal(payload.deploymentUrl, 'https://strict-real-delivery.vercel.app');
    assert.equal(payload.source, 'vercel');
    assert.equal(typeof payload.checkedAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(payload.checkedAt)));
  });
});

test('/api/version falls back through commit and deployment environment variables', () => {
  withEnv({
    VERCEL_ENV: undefined,
    NODE_ENV: 'production',
    VERCEL_GIT_COMMIT_SHA: undefined,
    GITHUB_SHA: 'github-sha',
    COMMIT_SHA: 'commit-sha',
    VERCEL_URL: undefined,
    DEPLOYMENT_URL: 'deployment.example.com',
    PRODUCTION_URL: 'https://production.example.com',
  }, () => {
    const payload = versionHandler.buildVersionPayload(process.env, new Date('2026-07-07T12:34:56.789Z'));

    assert.deepEqual(payload, {
      status: 'healthy',
      environment: 'production',
      checkedAt: '2026-07-07T12:34:56.789Z',
      commitSha: 'github-sha',
      deploymentUrl: 'https://deployment.example.com',
      source: 'vercel',
    });
  });
});

test('/api/version reports nullable fields when hosted metadata is unavailable', () => {
  const payload = versionHandler.buildVersionPayload({
    VERCEL_ENV: '',
    NODE_ENV: '',
    VERCEL_GIT_COMMIT_SHA: '',
    GITHUB_SHA: '',
    COMMIT_SHA: '',
    VERCEL_URL: '',
    DEPLOYMENT_URL: '',
    PRODUCTION_URL: '',
  }, new Date('2026-07-07T00:00:00.000Z'));

  assert.deepEqual(payload, {
    status: 'healthy',
    environment: null,
    checkedAt: '2026-07-07T00:00:00.000Z',
    commitSha: null,
    deploymentUrl: null,
    source: 'vercel',
  });
});
