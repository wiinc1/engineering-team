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
  '../../api/v1/ai-agents.js',
  '../../api/v1/tasks.js',
  '../../api/v1/tasks/[...route].js',
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
