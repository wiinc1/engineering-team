const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createAuditApiServer } = require('../../lib/audit/http-projects');
const { seedForgeLocalSmokeTask } = require('../../lib/forge-local-smoke/seed-task');
const { createFileAuditStore } = require('../../lib/audit/store');

async function withAuditApi(baseDir, forgeToken, callback) {
  const { server } = createAuditApiServer({
    baseDir,
    jwtSecret: 'forge-local-smoke-int-secret',
    forgeServiceToken: forgeToken,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('integration: local smoke seed produces forge execution-readiness response', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-local-smoke-int-'));
  const forgeToken = 'local-forge-smoke-token';
  const taskId = 'TSK-LOCAL001';

  process.env.ALLOW_FILE_AUDIT_BACKEND = 'true';
  process.env.AUDIT_STORE_BACKEND = 'file';
  process.env.FORGE_SERVICE_TOKEN = forgeToken;

  try {
    const store = createFileAuditStore({ baseDir, workflowEngineEnabled: false });
    const seedResult = await seedForgeLocalSmokeTask({
      taskId,
      tenantId: 'engineering-team',
      baseDir,
      store,
    });
    assert.equal(seedResult.ok, true);

    await withAuditApi(baseDir, forgeToken, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/tasks/${taskId}/forge-execution-readiness`, {
        headers: { authorization: `Bearer ${forgeToken}` },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.taskId, taskId);
      assert.equal(body.targetRepo, 'wiinc1/forgeadapter');
      assert.equal(body.projectId, 'forgeadapter');
    });
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});