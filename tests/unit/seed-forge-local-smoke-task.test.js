const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildForgeReadyApprovedContract,
  seedForgeLocalSmokeTask,
} = require('../../scripts/seed-forge-local-smoke-task');
const { createFileAuditStore } = require('../../lib/audit/store');

async function withTempBaseDir(callback) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-local-smoke-seed-'));
  try {
    return await callback(baseDir);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

function createSeedStore(baseDir) {
  return createFileAuditStore({
    baseDir,
    workflowEngineEnabled: false,
  });
}

test('buildForgeReadyApprovedContract uses the requested task id in metadata', () => {
  const taskId = 'TSK-CUSTOM99';
  const { createdPayload, approvedContract } = buildForgeReadyApprovedContract(taskId);

  assert.match(createdPayload.title, new RegExp(taskId));
  assert.equal(approvedContract.forge_dispatch.target_repo, 'wiinc1/forgeadapter');
  assert.equal(approvedContract.forge_dispatch.project_id, 'forgeadapter');
});

test('seedForgeLocalSmokeTask seeds execution-ready task in isolated file store', async () => {
  await withTempBaseDir(async (baseDir) => {
    process.env.ALLOW_FILE_AUDIT_BACKEND = 'true';
    process.env.AUDIT_STORE_BACKEND = 'file';

    const result = await seedForgeLocalSmokeTask({
      taskId: 'TSK-LOCAL001',
      tenantId: 'engineering-team',
      baseDir,
      store: createSeedStore(baseDir),
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.equal(result.task.taskId, 'TSK-LOCAL001');
    assert.equal(result.task.summary, 'Local forgeadapter start smoke for TSK-LOCAL001.');
  });
});

test('seedForgeLocalSmokeTask skips when task is already execution-ready', async () => {
  await withTempBaseDir(async (baseDir) => {
    process.env.ALLOW_FILE_AUDIT_BACKEND = 'true';
    process.env.AUDIT_STORE_BACKEND = 'file';
    const store = createSeedStore(baseDir);

    const first = await seedForgeLocalSmokeTask({
      taskId: 'TSK-LOCAL001',
      tenantId: 'engineering-team',
      baseDir,
      store,
    });
    assert.equal(first.ok, true);

    const second = await seedForgeLocalSmokeTask({
      taskId: 'TSK-LOCAL001',
      tenantId: 'engineering-team',
      baseDir,
      store,
    });
    assert.equal(second.ok, true);
    assert.equal(second.skipped, true);
    assert.equal(second.reason, 'already_execution_ready');
  });
});

test('seedForgeLocalSmokeTask rejects conflicting task state without repairing', async () => {
  await withTempBaseDir(async (baseDir) => {
    process.env.ALLOW_FILE_AUDIT_BACKEND = 'true';
    process.env.AUDIT_STORE_BACKEND = 'file';
    const store = createSeedStore(baseDir);

    await store.appendEvent({
      tenantId: 'engineering-team',
      taskId: 'TSK-CONFLICT',
      eventType: 'task.created',
      actorType: 'agent',
      actorId: 'pm-1',
      idempotencyKey: 'create:TSK-CONFLICT',
      payload: {
        title: 'Incomplete task',
        initial_stage: 'DRAFT',
      },
    });

    const result = await seedForgeLocalSmokeTask({
      taskId: 'TSK-CONFLICT',
      tenantId: 'engineering-team',
      baseDir,
      store,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'conflicting_task_state');
    assert.match(result.remediation, /fresh audit data directory/i);
  });
});

test('seedForgeLocalSmokeTask requires file-backend opt-in when AUDIT_STORE_BACKEND=file', async () => {
  await withTempBaseDir(async (baseDir) => {
    const previousAllow = process.env.ALLOW_FILE_AUDIT_BACKEND;
    const previousBackend = process.env.AUDIT_STORE_BACKEND;
    delete process.env.ALLOW_FILE_AUDIT_BACKEND;
    process.env.AUDIT_STORE_BACKEND = 'file';

    try {
      await assert.rejects(
        () => seedForgeLocalSmokeTask({
          taskId: 'TSK-LOCAL001',
          tenantId: 'engineering-team',
          baseDir,
        }),
        /ALLOW_FILE_AUDIT_BACKEND=true/
      );
    } finally {
      if (previousAllow === undefined) delete process.env.ALLOW_FILE_AUDIT_BACKEND;
      else process.env.ALLOW_FILE_AUDIT_BACKEND = previousAllow;
      if (previousBackend === undefined) delete process.env.AUDIT_STORE_BACKEND;
      else process.env.AUDIT_STORE_BACKEND = previousBackend;
    }
  });
});